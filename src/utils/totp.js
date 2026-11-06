const crypto = require("crypto");

// TOTP theo RFC 6238 (HMAC-SHA1, 6 số, 30 giây) - tương thích Google Authenticator.
// TOTP = mã OTP 6 số tự đổi mỗi 30 giây, app điện thoại và server cùng tính ra
// từ "khóa bí mật chung" + thời gian hiện tại, nên không cần gửi SMS.
const STEP_SECONDS = 30; // mỗi mã sống 30 giây
const DIGITS = 6; // mã gồm 6 chữ số
const WINDOW = 1; // chấp nhận lệch ±1 bước (±30 giây) do đồng hồ điện thoại
// Bảng 32 ký tự của base32 (A-Z và 2-7), đây là định dạng khóa mà Google Authenticator đọc
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// Đổi byte thật → chuỗi base32 (để hiển thị khóa/QR cho người dùng nhập vào app).
// Mỗi ký tự base32 biểu diễn 5 bit, nên gom bit của các byte rồi cắt từng nhóm 5 bit.
function base32Encode(buffer) {
  let bits = 0; // số bit đang chờ xử lý trong value
  let value = 0; // chứa các bit đang chờ
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte; // nạp thêm 8 bit của byte hiện tại
    bits += 8;
    while (bits >= 5) {
      // Đủ 5 bit: lấy 5 bit cao nhất ra, tra bảng thành 1 ký tự
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  // Còn dư bit lẻ thì đệm thêm số 0 bên phải cho đủ 5 bit rồi lấy ký tự cuối
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

// Đổi chuỗi base32 → byte thật (ngược với base32Encode).
// Mỗi ký tự cho 5 bit, gom đủ 8 bit thì tạo ra 1 byte.
function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const bytes = [];
  // Bỏ dấu "=" đệm ở cuối, đổi về chữ hoa cho nhất quán
  for (const ch of String(text).replace(/=+$/, "").toUpperCase()) {
    const idx = B32.indexOf(ch); // vị trí ký tự trong bảng = giá trị 5 bit
    if (idx === -1) throw new Error("Khoá TOTP không hợp lệ"); // ký tự ngoài bảng
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      // Đủ 8 bit: lấy ra 1 byte
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// HOTP (RFC 4226): từ khóa bí mật + một con số đếm (counter) tính ra mã 6 số.
// TOTP chính là HOTP với counter = "đang ở bước 30 giây thứ mấy".
function hotp(secretBuffer, counter) {
  // 1. Đổi counter thành 8 byte (big-endian)
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));

  // 2. Tính HMAC-SHA1 của counter bằng khóa bí mật → 20 byte
  const hmac = crypto.createHmac("sha1", secretBuffer).update(message).digest();

  // 3. "Dynamic truncation": rút 20 byte thành 1 số 31 bit
  //    - offset = 4 bit cuối của byte cuối cùng (giá trị 0-15)
  //    - lấy 4 byte bắt đầu từ vị trí offset, ghép thành 1 số nguyên
  //    - & 0x7f ở byte đầu để bỏ bit dấu (luôn ra số dương)
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];

  // 4. Lấy 6 chữ số cuối (chia lấy dư cho 10^6), thêm số 0 phía trước nếu thiếu
  //    vd 4829 → "004829"
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

const totpUtil = {
  STEP_SECONDS,

  // Tạo khóa bí mật mới: 20 byte ngẫu nhiên (160 bit) mã hoá base32.
  // Khóa này hiển thị dưới dạng QR/chuỗi để người dùng thêm vào Google Authenticator.
  generateSecret() {
    return base32Encode(crypto.randomBytes(20));
  },

  // Tính "bước thời gian" hiện tại = số lần 30 giây đã trôi qua kể từ 1/1/1970.
  // Hai bên (server và app) cùng thời điểm sẽ ra cùng một bước → cùng một mã.
  currentStep(nowMs = Date.now()) {
    return Math.floor(nowMs / 1000 / STEP_SECONDS);
  },

  /**
   * Kiểm tra mã người dùng nhập.
   * Trả về bước thời gian (time step) nếu nhập đúng, null nếu sai.
   * Chỉ chấp nhận bước lớn hơn lastStep để một mã không dùng được hai lần
   * (chống replay: kẻ xấu thấy mã vừa dùng rồi dùng lại).
   * Nơi gọi nên lưu step trả về làm lastStep cho lần sau.
   */
  verifyCode(secretBase32, code, { lastStep = null, nowMs = Date.now() } = {}) {
    // Buffer.from("123456") - <Buffer 31 32 33 34 35 36>
    // Đổi sang Buffer vì timingSafeEqual chỉ nhận Buffer (giống isSameSignature)
    const input = Buffer.from(String(code));
    const secret = base32Decode(secretBase32); // khóa base32 → byte thật
    const now = totpUtil.currentStep(nowMs);
    let matched = null;
    // Thử cả 3 bước: trước (-1), hiện tại (0), sau (+1) để chịu được đồng hồ lệch.
    // Duyệt hết cửa sổ và so sánh hằng thời gian để không lộ thông tin qua thời gian xử lý
    for (let i = -WINDOW; i <= WINDOW; i++) {
      const step = now + i;
      const expected = Buffer.from(hotp(secret, step)); // mã đúng tại bước này
      const same =
        expected.length === input.length &&
        crypto.timingSafeEqual(expected, input);
      // Khớp + chưa có kết quả trước đó + bước phải mới hơn lastStep (chưa dùng)
      if (same && matched === null && (lastStep === null || step > lastStep)) {
        matched = step;
      }
    }
    return matched;
  },

  // Tạo URI otpauth:// để vẽ thành mã QR cho Google Authenticator quét.
  // Dạng: otpauth://totp/<Issuer>:<Tài khoản>?secret=...&issuer=...
  // encodeURIComponent để ký tự đặc biệt (khoảng trắng, @...) không phá URI.
  buildOtpAuthUri({ secret, account, issuer }) {
    const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
    return (
      `otpauth://totp/${label}?secret=${secret}` +
      `&issuer=${encodeURIComponent(issuer)}` +
      `&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`
    );
  },

  // Mã hóa khóa TOTP trước khi lưu DB (AES-256-GCM, khóa TOTP_ENC_KEY: 64 ký tự hex).
  // Kết quả: <iv>:<tag>:<ciphertext> (base64), cùng cách với encryptSecretKey trước đó.
  // Cần mã hóa vì lộ khóa TOTP thì kẻ xấu tự sinh được mã 6 số của người dùng.
  encryptSecret(plain) {
    const key = getKey();
    const iv = crypto.randomBytes(12); // iv ngẫu nhiên mới mỗi lần
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag(); // lấy sau final()
    return [iv, tag, encrypted].map((b) => b.toString("base64")).join(":");
  },

  // Giải mã khóa TOTP đọc từ DB: tách 3 phần, base64 → Buffer, giải mã và kiểm tra tag.
  // Ném lỗi nếu sai khóa hoặc dữ liệu bị sửa.
  decryptSecret(payload) {
    const key = getKey();
    const [iv, tag, encrypted] = String(payload)
      .split(":")
      .map((part) => Buffer.from(part, "base64"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag); // đưa tag vào trước final()
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  },
};

// Đọc khóa mã hóa 32 byte từ biến môi trường TOTP_ENC_KEY (64 ký tự hex).
// Giống getEncryptionKey ở phần trước: sai định dạng thì báo lỗi ngay.
function getKey() {
  const hex = process.env.TOTP_ENC_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("Thiếu hoặc sai biến môi trường TOTP_ENC_KEY (cần 64 ký tự hex)");
  }
  return Buffer.from(hex, "hex");
}

module.exports = totpUtil;