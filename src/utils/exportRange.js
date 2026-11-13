const { httpError } = require("./httpError");
const { isValidDateOnly } = require("./validators");

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Lấy khoảng mặc định 1 năm gần nhất theo giờ Việt Nam (UTC+7): { startDate, endDate }.
 */
function getOneYearBounds() {
  const vnNow = new Date(Date.now() + VN_OFFSET_MS);
  const endDate = vnNow.toISOString().slice(0, 10);

  const oneYearAgo = new Date(vnNow.getTime());
  oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
  const startDate = oneYearAgo.toISOString().slice(0, 10);

  return { startDate, endDate };
}

/**
 * Kiểm tra & chuẩn hóa khoảng ngày trong vòng 1 năm gần nhất cho các API xem/thống kê.
 */
function resolveOneYearRange(
  startDate,
  endDate,
  {
    defaultToOneYear = true,
    defaultEndToToday = false,
    tooOldMessage = "Chỉ có thể xem dữ liệu trong vòng 1 năm gần nhất",
  } = {},
) {
  const bounds = getOneYearBounds();
  let startDay = null;
  let endDay = null;

  if (startDate) {
    if (!isValidDateOnly(startDate)) {
      throw httpError(400, "Ngày bắt đầu không hợp lệ");
    }
    if (startDate < bounds.startDate) {
      throw httpError(400, tooOldMessage);
    }
    startDay = startDate;
  } else if (defaultToOneYear) {
    startDay = bounds.startDate;
  }

  if (endDate) {
    if (!isValidDateOnly(endDate)) {
      throw httpError(400, "Ngày kết thúc không hợp lệ");
    }
    endDay = endDate;
  } else if (defaultEndToToday) {
    endDay = bounds.endDate;
  }

  if (startDay && endDay && startDay > endDay) {
    throw httpError(400, "Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc");
  }

  return { startDate: startDay, endDate: endDay };
}

/**
 * Kiểm tra khoảng ngày bắt buộc dùng cho API xuất Excel lịch sử giao dịch.
 */
function resolveExportRange(startDate, endDate) {
  if (!startDate || !endDate) {
    throw httpError(400, "Vui lòng chọn khoảng thời gian cần xuất");
  }

  const range = resolveOneYearRange(startDate, endDate, {
    defaultToOneYear: false,
    tooOldMessage:
      "Chỉ có thể xuất lịch sử giao dịch trong vòng 1 năm gần nhất",
  });

  const days =
    Math.round(
      (Date.parse(`${range.endDate}T00:00:00Z`) -
        Date.parse(`${range.startDate}T00:00:00Z`)) /
        DAY_MS,
    ) + 1;

  return { startDate: range.startDate, endDate: range.endDate, days };
}

module.exports = {
  getOneYearBounds,
  resolveOneYearRange,
  resolveExportRange,
};
