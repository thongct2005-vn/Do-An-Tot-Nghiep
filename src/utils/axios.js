// HTTP client dùng để gửi request webhook sang endpoint của merchant
const axios = require("axios");
// Module chuẩn của Node.js dùng để tạo HTTP/HTTPS Agent tùy biến
const http = require("http");
const https = require("https");
// Hàm tạo chữ ký HMAC-SHA256 xác thực webhook
const { computeSignature } = require("./hashSecretKey");
// Hàm kiểm tra URL hợp lệ và hàm tra DNS tùy biến chống SSRF / DNS rebinding
const { assertSafeCallbackUrl, safeLookup } = require("./urlGuard");

// Thời gian chờ tối đa (ms) cho mỗi lần gửi webhook; mặc định 8000ms (8 giây) nếu không cấu hình
const WEBHOOK_TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS) || 8000;

// Gắn safeLookup vào Agent để kiểm tra lại IP ngay tại thời điểm mở kết nối TCP/TLS,
// chặn tấn công DNS rebinding (đổi DNS sang IP nội bộ sau bước kiểm tra URL ban đầu)
const httpAgent = new http.Agent({ lookup: safeLookup });
const httpsAgent = new https.Agent({ lookup: safeLookup });

/**
 * Gửi webhook callback (HTTP POST) tới merchant kèm chữ ký xác thực HMAC-SHA256
 * và các lớp bảo vệ chống SSRF / quá tải dữ liệu.
 *
 * @param {object} params
 * @param {string} params.callbackUrl - URL nhận webhook IPN của merchant
 * @param {string} params.secretKey - Khóa bí mật dùng để ký payload
 * @param {number} [params.time] - Unix timestamp (giây) tạo chữ ký, mặc định lấy thời điểm hiện tại
 * @param {*} params.payload - Dữ liệu sự kiện cần gửi sang merchant
 * @param {string} [params.deliveryId] - Mã định danh lần gửi webhook (tùy chọn, dùng chống xử lý trùng)
 * @param {number} [params.attempt] - Số thứ tự lần thử gửi (tùy chọn, dùng khi retry)
 * @returns {Promise<{ status: number }>} Object chứa mã HTTP status phản hồi từ endpoint đích
 */
async function postCallBack({
  callbackUrl,
  secretKey,
  time = Math.floor(Date.now() / 1000),
  payload,
  deliveryId,
  attempt,
}) {
  // Kiểm tra cú pháp URL (http/https, production bắt buộc https) và tra DNS để chặn IP nội bộ
  await assertSafeCallbackUrl(callbackUrl);

  // Serialize payload 1 lần thành chuỗi JSON thô để chữ ký HMAC khớp từng byte với body gửi đi
  const rawBody = JSON.stringify(payload);
  // Ép timestamp sang chuỗi để ghép vào chuỗi ký và gắn lên header X-Timestamp
  const timestamp = String(time);
  // Tạo chữ ký HMAC-SHA256 hex từ "<timestamp>.<rawBody>" bằng secretKey
  const signature = computeSignature(secretKey, timestamp, rawBody);

  const response = await axios.post(callbackUrl, rawBody, {
    headers: {
      "Content-Type": "application/json",
      "X-Timestamp": timestamp,
      "X-Signature": signature,
      // Chỉ gắn thêm header định danh / số lần thử khi được truyền giá trị hợp lệ (truthy)
      ...(deliveryId && { "X-Delivery-Id": deliveryId }),
      ...(attempt && { "X-Delivery-Attempt": String(attempt) }),
    },
    timeout: WEBHOOK_TIMEOUT_MS,
    maxRedirects: 0, // không đi theo redirect (chống SSRF)
    maxContentLength: 64 * 1024, // Giới hạn response nhận về tối đa 64 KB (tránh tràn bộ nhớ/DoS)
    maxBodyLength: 64 * 1024, // Giới hạn request body gửi đi tối đa 64 KB
    httpAgent, // Agent HTTP dùng safeLookup để chặn IP nội bộ lúc kết nối
    httpsAgent, // Agent HTTPS dùng safeLookup để chặn IP nội bộ lúc kết nối
    // Giữ nguyên rawBody khi gửi đi, không để axios tự stringify lại làm sai lệch chữ ký
    transformRequest: [(d) => d],
    // Chỉ coi HTTP 2xx là thành công; các mã khác (3xx/4xx/5xx) sẽ báo lỗi để xử lý thất bại/retry
    validateStatus: (s) => s >= 200 && s < 300,
  });

  // Trả gọn về HTTP status code cho caller
  return { status: response.status };
}

// Xuất postCallBack để gửi webhook và re-export computeSignature cho các module/test dùng chung
module.exports = { postCallBack, computeSignature };
