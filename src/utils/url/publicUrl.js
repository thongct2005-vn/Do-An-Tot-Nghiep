/**
 * Đọc và chuẩn hóa origin từ biến môi trường `PUBLIC_BASE_URL`.
 *
 * @returns {string|null} Origin chuẩn (vd: "https://api.example.com") hoặc `null` nếu chưa cấu hình
 * @throws {Error} Khi URL sai định dạng hoặc không dùng giao thức `http`/`https`
 */
function readConfiguredBaseUrl() {
  const raw = (process.env.PUBLIC_BASE_URL || "").trim();
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw new Error("Địa chỉ máy chủ không phải URL hợp lệ");
  }

  // Chỉ chấp nhận http/https để chặn scheme nguy hiểm (ftp:, javascript:, ...)
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Địa chỉ máy chủ phải bắt đầu bằng http hoặc https");
  }

  // Lấy origin chuẩn (giao thức + host + port), bỏ path/query và dấu "/" thừa
  return parsed.origin;
}

/**
 * Kiểm tra cấu hình `PUBLIC_BASE_URL` ngay lúc khởi động server
 * để dừng sớm nếu thiếu hoặc sai định dạng (thay vì đợi tới request đầu tiên).
 */
function assertPublicBaseUrlConfigured() {
  const configured = readConfiguredBaseUrl();
  if (!configured) {
    throw new Error("Thiếu địa chỉ máy chủ");
  }
}

/**
 * Lấy địa chỉ gốc công khai để tạo link (ưu tiên `PUBLIC_BASE_URL`, dự phòng lấy từ request).
 */
function getPublicBaseUrl(req) {
  const configured = readConfiguredBaseUrl();
  if (configured) return configured;

  return `${req.protocol}://${req.get("host")}`;
}

module.exports = { getPublicBaseUrl, assertPublicBaseUrlConfigured };
