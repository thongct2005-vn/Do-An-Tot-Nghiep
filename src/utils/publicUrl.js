
function readConfiguredBaseUrl() {
  const raw = (process.env.PUBLIC_BASE_URL || "").trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw new Error("Địa chỉ máy chủ không phải URL hợp lệ");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Địa chỉ máy chủ phải bắt đầu bằng http hoặc https");
  }
  return parsed.origin;
}

/**
 * Gọi lúc khởi động server để dừng ngay nếu cấu hình sai (thay vì đợi request đầu tiên).
 */
function assertPublicBaseUrlConfigured() {
  const configured = readConfiguredBaseUrl();
  if (!configured) {
    throw new Error("Thiếu địa chỉ máy chủ");
  }
}

function getPublicBaseUrl(req) {
  const configured = readConfiguredBaseUrl();
  if (configured) return configured;
  return `${req.protocol}://${req.get("host")}`;
}

module.exports = { getPublicBaseUrl, assertPublicBaseUrlConfigured };