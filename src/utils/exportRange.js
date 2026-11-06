const { httpError } = require("./httpError");
const { isValidDateOnly } = require("./validators");
const { EXPORT } = require("../config/limits");

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Kiểm tra khoảng ngày dùng cho API xuất Excel.
 * Ngày ở dạng YYYY-MM-DD (giờ Việt Nam), bắt buộc có cả 2 đầu.
 * Trả về { startDate, endDate, days }.
 */
function resolveExportRange(startDate, endDate) {
  if (!startDate || !endDate) {
    throw httpError(400, "Vui lòng chọn khoảng thời gian cần xuất");
  }
  if (!isValidDateOnly(startDate)) {
    throw httpError(400, "Ngày bắt đầu không hợp lệ");
  }
  if (!isValidDateOnly(endDate)) {
    throw httpError(400, "Ngày kết thúc không hợp lệ");
  }
  if (startDate > endDate) {
    throw httpError(400, "Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc");
  }

  // Lấy số ngày giữa 2 mốc thời gian
  const days =
    Math.round(
      (Date.parse(`${endDate}T00:00:00Z`) -
        Date.parse(`${startDate}T00:00:00Z`)) / // Ra mili giây nên phải chia để ra số ngày
        DAY_MS,
    ) + 1;
  if (days > EXPORT.MAX_DAYS) {
    throw httpError(
      400,
      `Mỗi lần chỉ được xuất tối đa ${EXPORT.MAX_DAYS} ngày, vui lòng chọn khoảng ngắn hơn`,
    );
  }

  // Chỉ cho xem dữ liệu trong 1 năm gần nhất
  const oneYearAgo = new Date(Date.now() + VN_OFFSET_MS); // Trả về thời gian hiện tại - mili giây
  oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1); // Gán lại năm hiện tại lùi đi 1
  // Chuyển oneYearAgo thành chuỗi định dạng ISO, ví dụ: '2025-11-05T20:27:16.000Z', lấy 10 kí tự đầu 
  if (startDate < oneYearAgo.toISOString().slice(0, 10)) { 
    throw httpError(
      400,
      "Chỉ có thể xuất lịch sử giao dịch trong vòng 1 năm gần nhất",
    );
  }

  return { startDate, endDate, days };
}

module.exports = { resolveExportRange };