const { httpError } = require("../../utils/httpError");

const STATUSES = new Set(["ACTIVE", "BLOCKED"]);
const FIELDS = new Set(["status", "expected_status", "reason"]);

function parseStatusPatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw httpError(400, "Nội dung cập nhật trạng thái merchant không hợp lệ");
  }
  if (Object.keys(body).some(key => !FIELDS.has(key))) {
    throw httpError(400, "Có trường không được phép cập nhật trong trạng thái merchant");
  }
  if (!STATUSES.has(body.status)) {
    throw httpError(400, "Trạng thái không hợp lệ, chỉ chấp nhận ACTIVE hoặc BLOCKED");
  }
  if (!STATUSES.has(body.expected_status)) {
    throw httpError(400, "expected_status là bắt buộc và phải là ACTIVE hoặc BLOCKED");
  }
  if (typeof body.reason !== "string") {
    throw httpError(400, "Lý do thay đổi trạng thái phải là chuỗi từ 5 đến 500 ký tự");
  }
  const reason = body.reason.trim();
  if (reason.includes("\0") || [...reason].length < 5 || [...reason].length > 500) {
    throw httpError(400, "Lý do thay đổi trạng thái phải từ 5 đến 500 ký tự hợp lệ");
  }
  return { status: body.status, expectedStatus: body.expected_status, reason };
}

module.exports = { parseStatusPatch };
