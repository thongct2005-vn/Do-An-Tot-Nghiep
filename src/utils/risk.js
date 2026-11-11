const { ipKeyGenerator } = require("express-rate-limit");
const { sanitizePhone } = require("./sanitize");
const { isValidPhone } = require("./validators");
const pool = require("../config/database");
const { emitToUser } = require("./socket");

/* ============================================================================
 * BẢNG CÔNG THỨC TÍNH ĐIỂM RỦI RO (RISK SCORING) & ĐIỀU KIỆN KHÓA / CHẶN
 * ============================================================================
 * 
 * 1. NGUYÊN TẮC:
 *    - Không tin tín hiệu đơn lẻ: Phải có NHIỀU tín hiệu cộng dồn mới bị chặn (block).
 *    - Điều này giúp tránh chặn nhầm người dùng hợp lệ cùng mạng Wi-Fi/NAT/4G.
 *
 * 2. CÔNG THỨC CỘNG ĐIỂM: Tổng điểm = Tín hiệu (1) + (2) + (3) + (4) + (5) + (6) + (7)
 *    --------------------------------------------------------------------------------------
 *    | Nhóm tín hiệu                            | Ngưỡng vi phạm          | Điểm cộng     |
 *    |------------------------------------------|-------------------------|---------------|
 *    | (1) Tốc độ request từ 1 IP (trong 1p)    | > 20 req                | +15 điểm      |
 *    |                                          | > 45 req                | +30 điểm      |
 *    |------------------------------------------|-------------------------|---------------|
 *    | (2) 1 IP thử nhiều SĐT (trong 10p)       | >= 3 số khác nhau       | +20 điểm      |
 *    |                                          | >= 6 số khác nhau       | +40 điểm      |
 *    |------------------------------------------|-------------------------|---------------|
 *    | (3) 1 SĐT bị nhiều nguồn/IP thử (trong 10p)| >= 3 nguồn khác nhau  | +20 điểm      |
 *    |                                          | >= 5 nguồn khác nhau    | +30 điểm      |
 *    |------------------------------------------|-------------------------|---------------|
 *    | (4) Số lần login/OTP sai của SĐT (15p)   | >= 3 lần                | +20 điểm      |
 *    |                                          | >= 5 lần                | +28 điểm      |
 *    |------------------------------------------|-------------------------|---------------|
 *    | (5) Dữ liệu sai hình dạng                | SĐT sai định dạng VN    | +15 điểm      |
 *    |                                          | Body/Phone sai kiểu dữ  | +30 điểm      |
 *    |                                          | liệu (object/array lạ)  |               |
 *    |------------------------------------------|-------------------------|---------------|
 *    | (6) Bẫy Honeypot (điền vào trường ẩn)    | Điền 1 trường ẩn        | +35 điểm      |
 *    |                                          | Điền từ 2 trường trở lên| +50 điểm      |
 *    |------------------------------------------|-------------------------|---------------|
 *    | (7) Dấu hiệu Bot qua Header              | Thiếu X-Device-Id (App) | +6 điểm       |
 *    |                                          | User-Agent quá ngắn     | +8 điểm       |
 *    |                                          | User-Agent curl/python..| +16 điểm      |
 *    |                                          | (Tối đa nhóm bot header)| Max: 22 điểm  |
 *    --------------------------------------------------------------------------------------
 *
 * 3. KHI NÀO KHÓA / CHẶN (HTTP 429) & KHI NÀO THỬ THÁCH (CHALLENGE)?
 *    Được kiểm tra bởi middleware `riskGuard({ challenge, block })`:
 *
 *    - CHẶN (BLOCK - trả về HTTP 429 "Bạn thao tác quá nhiều lần..."):
 *      Khi TỔNG ĐIỂM >= block (nếu RISK_DRY_RUN=false).
 *      + /otp/send-otp           : Điểm >= 55  (Chặn sớm nhất để chống cháy cước/bom OTP)
 *      + /auth/register, /forgot : Điểm >= 60  (Chặn bot cày acc rác, bot dính honeypot)
 *      + /transaction/transfer...: Điểm >= 65  (Bảo vệ giao dịch tiền tệ)
 *      + /auth/login             : Điểm >= 70  (Khoan dung hơn cho người gõ nhầm mật khẩu)
 *
 *    - THỬ THÁCH (CHALLENGE - bật cờ req.risk.challenge = true):
 *      Khi TỔNG ĐIỂM >= challenge (thường từ 30 - 40 điểm).
 *      Dùng để controller bắt người dùng thực hiện thêm bước xác thực phụ (như OTP, CAPTCHA).
 * ============================================================================ */
const SECOND = 1000;
const MINUTE = 60 * SECOND;

const WINDOWS = {
  IP_VELOCITY_MS: 1 * MINUTE, // Cửa sổ đo tốc độ request từ 1 IP (1 phút)
  IP_PHONES_MS: 10 * MINUTE, // Cửa sổ đếm số SĐT khác nhau 1 IP thử (10 phút)
  PHONE_SOURCES_MS: 10 * MINUTE, // Cửa sổ đếm số nguồn (IP/thiết bị) thử 1 SĐT (10 phút)
  PHONE_FAILURES_MS: 15 * MINUTE, // Cửa sổ lưu số lần đăng nhập/OTP sai của 1 SĐT (15 phút)
};

// Ngưỡng nhẹ (mid) và nặng (high) cùng số điểm cộng tương ứng cho 7 nhóm tín hiệu
const RULES = {
  // 1. Tốc độ request từ 1 IP trong 1 phút
  IP_RATE: { mid: 20, high: 45, midScore: 15, highScore: 30 },

  // 2. Một IP thử nhiều SĐT khác nhau trong 10 phút
  IP_MULTI_PHONE: { mid: 3, high: 6, midScore: 20, highScore: 40 },

  // 3. Một SĐT bị nhiều IP / thiết bị cùng thử trong 10 phút
  PHONE_MULTI_SOURCE: { mid: 3, high: 5, midScore: 20, highScore: 30 },

  // 4. Số lần đăng nhập / OTP thất bại gần đây của SĐT đó trong 15 phút
  // Tổng (3) + (4) tối đa = 30 + 28 = 58 (< 60), đảm bảo chủ acc thật trên App chính chủ (botScore = 0, IP sạch)
  // không bị khóa oan khi có botnet ở IP khác cố tình bắn sai vào SĐT của họ.
  PHONE_FAILURES: { mid: 3, high: 5, midScore: 20, highScore: 28 },

  // 5. Dữ liệu sai hình dạng (SĐT sai chuẩn VN / body sai kiểu dữ liệu)
  MALFORMED: { lightScore: 15, heavyScore: 30 },

  // 6. Honeypot — các trường ẩn người thật không bao giờ nhìn thấy để điền
  HONEYPOT: { singleScore: 35, multiScore: 50 },

  // 7. Dấu hiệu bot qua Header (chỉ cộng điểm nhỏ làm chất xúc tác)
  BOT: { missingDeviceScore: 6, shortUaScore: 8, botUaScore: 16, maxScore: 22 },
};

// Các trường bẫy (honeypot) ẩn trên form/body
const HONEYPOT_FIELDS = [
  "website",
  "fax",
  "company_url",
  "homepage",
  "middle_name_hp",
];

// Mẫu User-Agent phổ biến của công cụ tự động / crawler / script
const BOT_UA_REGEX =
  /\b(curl|wget|python-requests|python-urllib|httpx|aiohttp|scrapy|httpclient|go-http-client|java\/|libwww-perl|headlesschrome|phantomjs|selenium|playwright|puppeteer)\b/i;

/* ============================================================================
 * Bộ lưu trữ trong RAM (Map + Set), tự động dọn rác định kỳ
 * ============================================================================ */
const MAX_MEMORY_KEYS = 50000;
const MAX_SET_MEMBERS = 200;

function createMemoryStore({ cleanupIntervalMs = MINUTE } = {}) {
  // key -> { count: number, expiresAt: number }
  const counters = new Map();
  // key -> { values: Set<string>, expiresAt: number }
  const sets = new Map();

  // Dọn rác định kỳ; dùng unref() để không giữ tiến trình Node sống khi tắt server/test
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of counters) {
      if (entry.expiresAt <= now) counters.delete(key);
    }
    for (const [key, entry] of sets) {
      if (entry.expiresAt <= now) sets.delete(key);
    }
  }, cleanupIntervalMs);
  if (typeof timer.unref === "function") timer.unref();

  // Tránh phình RAM nếu bị tấn công tạo vô số key ngẫu nhiên
  function evictOldestIfFull(map) {
    if (map.size < MAX_MEMORY_KEYS) return;
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }

  return {
    incr(key, ttlMs) {
      const now = Date.now();
      let entry = counters.get(key);
      if (!entry || entry.expiresAt <= now) {
        evictOldestIfFull(counters);
        entry = { count: 0, expiresAt: now + ttlMs };
        counters.set(key, entry);
      }
      entry.count += 1;
      return entry.count;
    },

    get(key) {
      const now = Date.now();
      const entry = counters.get(key);
      if (!entry || entry.expiresAt <= now) {
        if (entry) counters.delete(key);
        return 0;
      }
      return entry.count;
    },

    addDistinct(key, member, ttlMs) {
      const now = Date.now();
      let entry = sets.get(key);
      if (!entry || entry.expiresAt <= now) {
        evictOldestIfFull(sets);
        entry = { values: new Set(), expiresAt: now + ttlMs };
        sets.set(key, entry);
      }
      if (entry.values.size < MAX_SET_MEMBERS) {
        entry.values.add(String(member));
      }
      return entry.values.size;
    },

    clear() {
      counters.clear();
      sets.clear();
    },

    del(key) {
      counters.delete(key);
      sets.delete(key);
    },
  };
}

let store = createMemoryStore();

function resetRiskStore() {
  store.clear();
}

/* ============================================================================
 * Các hàm chuẩn hóa dữ liệu đầu vào từ req
 * ============================================================================ */

// Chuẩn hóa IP: ưu tiên req.ip của Express (đã tôn trọng cấu hình trust proxy),
// gom subnet IPv6 (/56) và đổi ::ffff:1.2.3.4 -> 1.2.3.4
function extractIp(req) {
  const rawIp =
    (typeof req?.ip === "string" && req.ip.trim()) ||
    req?.socket?.remoteAddress ||
    "127.0.0.1";
  try {
    return ipKeyGenerator(rawIp);
  } catch (_) {
    return rawIp;
  }
}

// Chuẩn hóa SĐT Việt Nam: chuyển +84/84 đầu về 0 rồi lọc chữ số qua sanitizePhone
function normalizeVnPhone(raw) {
  const cleaned = sanitizePhone(raw);
  if (!cleaned || cleaned === "INVALID") return "";
  if (cleaned.length === 11 && cleaned.startsWith("84")) {
    return `0${cleaned.slice(2)}`;
  }
  return cleaned;
}

// Lấy SĐT mục tiêu của request (ưu tiên body -> token OTP/Forgot -> token User)
function extractPhone(req) {
  const candidates = [
    req?.body?.phone,
    req?.otpUser?.phone,
    req?.forgotUser?.phone,
    req?.user?.phone,
  ];
  for (const item of candidates) {
    const normalized = normalizeVnPhone(item);
    if (normalized) return normalized;
  }
  return "";
}

// Đọc header không phân biệt hoa thường (tương thích cả Express req.get lẫn object req giả khi test)
function getHeader(req, name) {
  if (typeof req?.get === "function") {
    const val = req.get(name);
    if (val !== undefined) return String(val);
  }
  const headers = req?.headers;
  if (!headers || typeof headers !== "object") return "";
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower && headers[key] != null) {
      return String(headers[key]);
    }
  }
  return "";
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

/* ============================================================================
 * Ghi nhận hành vi vào RAM Store (record & recordFailure)
 * ============================================================================ */

/**
 * Ghi nhận sự kiện của request hiện tại và trả về các chỉ số thống kê trong cửa sổ thời gian.
 */
function record(req) {
  const ip = extractIp(req);
  const candidatePhone = extractPhone(req);
  const validPhone = isValidPhone(candidatePhone) ? candidatePhone : "";
  const deviceId = getHeader(req, "x-device-id").trim().slice(0, 64);

  // Định danh nguồn thử vào 1 SĐT: kết hợp IP + DeviceId để nhận diện cả xoay IP lẫn đổi thiết bị
  const sourceFingerprint = deviceId ? `${ip}|dev:${deviceId}` : `${ip}|no-dev`;

  const ipCount = store.incr(`ip:req:${ip}`, WINDOWS.IP_VELOCITY_MS);
  const phonesPerIp = validPhone
    ? store.addDistinct(`ip:phones:${ip}`, validPhone, WINDOWS.IP_PHONES_MS)
    : 0;
  const sourcesPerPhone = validPhone
    ? store.addDistinct(
        `phone:sources:${validPhone}`,
        sourceFingerprint,
        WINDOWS.PHONE_SOURCES_MS,
      )
    : 0;
  const recentFailures = validPhone ? store.get(`phone:fail:${validPhone}`) : 0;

  return {
    ip,
    phone: validPhone,
    ipCount,
    phonesPerIp,
    sourcesPerPhone,
    recentFailures,
  };
}

/**
 * Ghi nhận 1 lần thất bại (sai mật khẩu, sai OTP, sai PIN...) cho SĐT.
 * Gọi trong controller/service khi xác thực thất bại.
 */
function recordFailure(phone) {
  const normalized = normalizeVnPhone(phone);
  if (!normalized || !isValidPhone(normalized)) return 0;
  return store.incr(`phone:fail:${normalized}`, WINDOWS.PHONE_FAILURES_MS);
}

/**
 * Xóa bộ đếm thất bại và nguồn thử của SĐT sau khi xác thực thành công hoặc được Admin mở khóa.
 */
function clearFailure(phone) {
  const normalized = normalizeVnPhone(phone);
  if (!normalized) return;
  store.del(`phone:fail:${normalized}`);
  store.del(`phone:sources:${normalized}`);
}

/**
 * Khóa tài khoản trong bảng users (status = 'BLOCKED') khi SĐT bị chặn bởi Risk / RateLimit.
 * Giúp Admin nhìn thấy trạng thái BLOCKED trên trang quản trị và có thể mở khóa lại.
 */
async function blockAccountByPhone(phone) {
  const normalized = normalizeVnPhone(phone);
  if (!normalized || !isValidPhone(normalized)) return null;
  try {
    const result = await pool.query(
      `
      UPDATE users
      SET status = 'BLOCKED',
          refresh_token = NULL,
          fcm_token = NULL,
          updated_at = NOW()
      WHERE phone = $1
        AND role IN ('USER', 'MERCHANT')
        AND status = 'ACTIVE'
      RETURNING id, phone, role, status
      `,
      [normalized],
    );
    const blockedUser = result.rows[0] || null;
    if (blockedUser?.id) {
      try {
        emitToUser(blockedUser.id, "force_logout", {
          reason:
            "Tài khoản của bạn đã bị khóa do phát hiện hành vi bất thường",
        });
      } catch (_) {}
    }
    return blockedUser;
  } catch (err) {
    console.error("[RISK] Lỗi khi cập nhật status BLOCKED theo phone:", err.message);
    return null;
  }
}

/* ============================================================================
 * Các hàm chấm điểm từng nhóm tín hiệu tĩnh (5, 6, 7)
 * ============================================================================ */

// Tín hiệu 5: Kiểm tra hình dạng dữ liệu (body và định dạng SĐT Việt Nam)
function evaluatePayloadShape(req, reasons) {
  let score = 0;
  const method = String(req?.method || "POST").toUpperCase();
  const expectsBody =
    method === "POST" || method === "PUT" || method === "PATCH";
  const body = req?.rawBodyForRisk !== undefined ? req.rawBodyForRisk : req?.body;

  if (expectsBody && !isPlainObject(body)) {
    score += RULES.MALFORMED.heavyScore;
    reasons.push("malformed_body_not_object");
    return score;
  }

  if (isPlainObject(body) && "phone" in body) {
    const rawPhone = body.phone;
    // Truyền object/array vào trường phone (ví dụ tấn công type juggling / injection)
    if (
      rawPhone !== null &&
      rawPhone !== undefined &&
      typeof rawPhone !== "string" &&
      typeof rawPhone !== "number"
    ) {
      score += RULES.MALFORMED.heavyScore;
      reasons.push("malformed_phone_wrong_type");
    } else if (
      rawPhone !== null &&
      rawPhone !== undefined &&
      String(rawPhone).trim() !== ""
    ) {
      const normalized = normalizeVnPhone(rawPhone);
      if (!normalized || !isValidPhone(normalized)) {
        score += RULES.MALFORMED.lightScore;
        reasons.push("malformed_phone_invalid_vn");
      }
    }
  }

  return score;
}

// Tín hiệu 6: Honeypot (trường ẩn mà người dùng thật không bao giờ điền)
function evaluateHoneypot(req, reasons) {
  const body = req?.rawBodyForRisk !== undefined ? req.rawBodyForRisk : req?.body;
  if (!isPlainObject(body)) return 0;

  let filledCount = 0;
  for (const field of HONEYPOT_FIELDS) {
    const val = body[field];
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      filledCount += 1;
    }
  }

  if (filledCount >= 2) {
    reasons.push(`honeypot_filled_multi(${filledCount})`);
    return RULES.HONEYPOT.multiScore;
  }
  if (filledCount === 1) {
    reasons.push("honeypot_filled_single");
    return RULES.HONEYPOT.singleScore;
  }
  return 0;
}

// Tín hiệu 7: Dấu hiệu bot qua Header (chỉ cộng điểm nhỏ)
function evaluateBotHeaders(req, reasons) {
  let botScore = 0;
  const ua = getHeader(req, "user-agent").trim();
  const deviceId = getHeader(req, "x-device-id").trim();

  if (!ua) {
    botScore += RULES.BOT.botUaScore;
    reasons.push("bot_missing_user_agent");
  } else if (BOT_UA_REGEX.test(ua)) {
    botScore += RULES.BOT.botUaScore;
    reasons.push("bot_automation_user_agent");
  } else if (ua.length < 10) {
    botScore += RULES.BOT.shortUaScore;
    reasons.push("bot_short_user_agent");
  }

  // Web Dashboard từ trình duyệt hợp lệ có Origin sẽ không bắt buộc X-Device-Id như App Mobile
  const hasBrowserOrigin = Boolean(getHeader(req, "origin").trim());
  if (!deviceId && !hasBrowserOrigin) {
    botScore += RULES.BOT.missingDeviceScore;
    reasons.push("bot_missing_device_id");
  }

  return Math.min(botScore, RULES.BOT.maxScore);
}

/* ============================================================================
 * Hàm chính: risk(req)
 * Gom tất cả 7 tín hiệu thành tổng điểm rủi ro { score, reasons, metrics }
 * ============================================================================ */
function risk(req) {
  const reasons = [];
  let score = 0;

  // Đánh giá các tín hiệu hành vi có trạng thái (1 -> 4)
  const metrics = record(req);

  // 1. Tốc độ request từ 1 IP
  if (metrics.ipCount > RULES.IP_RATE.high) {
    score += RULES.IP_RATE.highScore;
    reasons.push(`ip_rate_high(${metrics.ipCount})`);
  } else if (metrics.ipCount > RULES.IP_RATE.mid) {
    score += RULES.IP_RATE.midScore;
    reasons.push(`ip_rate_mid(${metrics.ipCount})`);
  }

  // 2. Một IP thử nhiều SĐT khác nhau
  if (metrics.phonesPerIp >= RULES.IP_MULTI_PHONE.high) {
    score += RULES.IP_MULTI_PHONE.highScore;
    reasons.push(`ip_multi_phone_high(${metrics.phonesPerIp})`);
  } else if (metrics.phonesPerIp >= RULES.IP_MULTI_PHONE.mid) {
    score += RULES.IP_MULTI_PHONE.midScore;
    reasons.push(`ip_multi_phone_mid(${metrics.phonesPerIp})`);
  }

  // 3. Một SĐT bị nhiều IP / thiết bị cùng thử
  if (metrics.sourcesPerPhone >= RULES.PHONE_MULTI_SOURCE.high) {
    score += RULES.PHONE_MULTI_SOURCE.highScore;
    reasons.push(`phone_multi_source_high(${metrics.sourcesPerPhone})`);
  } else if (metrics.sourcesPerPhone >= RULES.PHONE_MULTI_SOURCE.mid) {
    score += RULES.PHONE_MULTI_SOURCE.midScore;
    reasons.push(`phone_multi_source_mid(${metrics.sourcesPerPhone})`);
  }

  // 4. Số lần đăng nhập / OTP thất bại gần đây của SĐT đó
  if (metrics.recentFailures >= RULES.PHONE_FAILURES.high) {
    score += RULES.PHONE_FAILURES.highScore;
    reasons.push(`phone_failures_high(${metrics.recentFailures})`);
  } else if (metrics.recentFailures >= RULES.PHONE_FAILURES.mid) {
    score += RULES.PHONE_FAILURES.midScore;
    reasons.push(`phone_failures_mid(${metrics.recentFailures})`);
  }

  // 5. Dữ liệu sai hình dạng
  score += evaluatePayloadShape(req, reasons);

  // 6. Honeypot
  score += evaluateHoneypot(req, reasons);

  // 7. Dấu hiệu bot qua Header (điểm nhỏ)
  score += evaluateBotHeaders(req, reasons);

  return {
    score,
    reasons,
    metrics,
  };
}

module.exports = {
  risk,
  record,
  recordFailure,
  clearFailure,
  blockAccountByPhone,
  resetRiskStore,
  RULES,
};
