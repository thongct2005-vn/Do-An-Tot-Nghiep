// Đọc và kiểm tra địa chỉ server từ biến môi trường PUBLIC_BASE_URL.
// Trả về origin chuẩn (vd "https://api.example.com") hoặc null nếu chưa cấu hình.
function readConfiguredBaseUrl() {
  const raw = (process.env.PUBLIC_BASE_URL || "").trim();
  if (!raw) return null;

  let parsed;
  try {
    // Ném lỗi nếu chuỗi không phải URL hợp lệ
    parsed = new URL(raw);
  } catch (_) {
    throw new Error("Địa chỉ máy chủ không phải URL hợp lệ");
  }

  // Chỉ chấp nhận http hoặc https (chặn "ftp:", "javascript:", ...)
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Địa chỉ máy chủ phải bắt đầu bằng http hoặc https");
  }

  // origin = giao thức + tên miền + cổng, bỏ path/query/dấu "/" thừa
  return parsed.origin;
}

/**
 * Gọi lúc khởi động server để dừng ngay nếu cấu hình sai
 * (thay vì đợi request đầu tiên mới phát hiện).
 */
function assertPublicBaseUrlConfigured() {
  const configured = readConfiguredBaseUrl();   // sai định dạng thì tự ném lỗi ở đây
  if (!configured) {
    throw new Error("Thiếu địa chỉ máy chủ");   // bắt buộc phải có
  }
}

// Lấy địa chỉ gốc để tạo link.
function getPublicBaseUrl(req) {
  const configured = readConfiguredBaseUrl();
  // Ưu tiên giá trị cấu hình trong .env
  if (configured) return configured;
  // Dự phòng: suy ra từ request hiện tại (giao thức + header Host)
  return `${req.protocol}://${req.get("host")}`;
}

module.exports = { getPublicBaseUrl, assertPublicBaseUrlConfigured };