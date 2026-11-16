const { httpError } = require("./httpError");
const { isValidDateOnly } = require("./validators");

const VN_TIMEZONE = "Asia/Ho_Chi_Minh";
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Lấy đối tượng Date đã dịch sang múi giờ Việt Nam (UTC+7) để đọc YYYY-MM-DD qua toISOString().
 */
function getVnNowDate(now = new Date()) {
  return new Date(now.getTime() + VN_OFFSET_MS);
}

/**
 * Tính số ngày bao gồm cả ngày bắt đầu và ngày kết thúc (YYYY-MM-DD).
 */
function calcInclusiveDays(startDate, endDate) {
  return (
    Math.round(
      (Date.parse(`${endDate}T00:00:00.000Z`) -
        Date.parse(`${startDate}T00:00:00.000Z`)) /
        DAY_MS,
    ) + 1
  );
}

/**
 * Lấy khoảng ngày mặc định của tháng hiện tại (từ ngày 01 đến hôm nay) theo múi giờ Việt Nam (UTC+7).
 * @param {Date} [now=new Date()]
 * @returns {{ startDate: string, endDate: string }}
 */
function getCurrentMonthBoundsInVietnam(now = new Date()) {
  const vnNow = getVnNowDate(now);
  const endDate = vnNow.toISOString().slice(0, 10);
  const startDate = `${endDate.slice(0, 7)}-01`;
  return { startDate, endDate };
}

/**
 * Cộng/trừ số ngày vào chuỗi YYYY-MM-DD.
 * @param {string} dateStr
 * @param {number} days
 * @returns {string}
 */
function addDaysToDateStr(dateStr, days) {
  const ms = Date.parse(`${dateStr}T00:00:00.000Z`) + days * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Tìm ngày Thứ Hai (ISO week start) của chuỗi ngày YYYY-MM-DD.
 * @param {string} dateStr
 * @returns {string}
 */
function getMondayOfDateStr(dateStr) {
  const dt = new Date(`${dateStr}T00:00:00.000Z`);
  const dayOfWeek = dt.getUTCDay(); // 0 (CN) -> 6 (T7)
  const diffToMonday = (dayOfWeek + 6) % 7;
  return addDaysToDateStr(dateStr, -diffToMonday);
}

/**
 * Định dạng YYYY-MM-DD -> dd/MM.
 * @param {string} dateStr
 * @returns {string}
 */
function formatDayMonthLabel(dateStr) {
  const [, mm, dd] = dateStr.split("-");
  return `${dd}/${mm}`;
}

/**
 * Xác định cách nhóm dữ liệu (group_by) dựa vào tổng số ngày trong kỳ.
 * - 1 ngày: hour
 * - 2–31 ngày: day
 * - 32–180 ngày: week
 * - > 180 ngày: month
 * @param {number} totalDays
 * @returns {"hour" | "day" | "week" | "month"}
 */
function determineGroupBy(totalDays) {
  if (totalDays <= 1) return "hour";
  if (totalDays <= 31) return "day";
  if (totalDays <= 180) return "week";
  return "month";
}

/**
 * Chuẩn hóa khoảng thời gian lọc cho Web Admin theo múi giờ Asia/Ho_Chi_Minh.
 * Quy đổi thành khoảng nửa mở [startInstant, nextDayInstant) để bao trọn ngày kết thúc (23:59:59.999).
 *
 * @param {string} [startDateParam]
 * @param {string} [endDateParam]
 * @param {{ now?: Date }} [options]
 */
function resolveAdminDateRange(startDateParam, endDateParam, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const defaults = getCurrentMonthBoundsInVietnam(now);

  const rawStart =
    typeof startDateParam === "string" ? startDateParam.trim() : "";
  const rawEnd = typeof endDateParam === "string" ? endDateParam.trim() : "";

  let startDate = rawStart;
  let endDate = rawEnd;

  if (!startDate && !endDate) {
    startDate = defaults.startDate;
    endDate = defaults.endDate;
  } else if (startDate && !endDate) {
    if (!isValidDateOnly(startDate)) {
      throw httpError(400, "Định dạng start_date không hợp lệ (YYYY-MM-DD)");
    }
    endDate = defaults.endDate >= startDate ? defaults.endDate : startDate;
  } else if (!startDate && endDate) {
    if (!isValidDateOnly(endDate)) {
      throw httpError(400, "Định dạng end_date không hợp lệ (YYYY-MM-DD)");
    }
    startDate = `${endDate.slice(0, 7)}-01`;
  }

  if (!isValidDateOnly(startDate)) {
    throw httpError(400, "Định dạng start_date không hợp lệ (YYYY-MM-DD)");
  }
  if (!isValidDateOnly(endDate)) {
    throw httpError(400, "Định dạng end_date không hợp lệ (YYYY-MM-DD)");
  }

  if (startDate > endDate) {
    throw httpError(
      400,
      "Khoảng thời gian không hợp lệ: start_date không được lớn hơn end_date",
    );
  }

  const nextDayDate = addDaysToDateStr(endDate, 1);
  const startInstant = new Date(`${startDate}T00:00:00.000+07:00`);
  const nextDayInstant = new Date(`${nextDayDate}T00:00:00.000+07:00`);
  const totalDays = calcInclusiveDays(startDate, endDate);
  const groupBy = determineGroupBy(totalDays);

  return {
    startDate,
    endDate,
    nextDayDate,
    startInstant,
    nextDayInstant,
    startIso: startInstant.toISOString(),
    nextDayIso: nextDayInstant.toISOString(),
    timezone: VN_TIMEZONE,
    totalDays,
    groupBy,
    period: {
      start_date: startDate,
      end_date: endDate,
      timezone: VN_TIMEZONE,
      group_by: groupBy,
    },
  };
}

/**
 * Sinh danh sách đầy đủ các mốc thời gian (buckets) liên tục cho khoảng ngày đã chọn
 * để phục vụ zero-fill (mốc không có dữ liệu vẫn trả 0).
 *
 * @param {{ startDate: string, endDate: string, groupBy: "hour" | "day" | "week" | "month" }} range
 * @returns {Array<{ key: string, label: string, start_date: string, end_date: string }>}
 */
function generateTimeBuckets(range) {
  const { startDate, endDate, groupBy } = range;
  const buckets = [];

  if (groupBy === "hour") {
    for (let h = 0; h < 24; h += 1) {
      const hh = String(h).padStart(2, "0");
      buckets.push({
        key: `${startDate} ${hh}`,
        label: `${hh}h`,
        start_date: startDate,
        end_date: startDate,
      });
    }
    return buckets;
  }

  if (groupBy === "day") {
    let curr = startDate;
    while (curr <= endDate) {
      buckets.push({
        key: curr,
        label: formatDayMonthLabel(curr),
        start_date: curr,
        end_date: curr,
      });
      curr = addDaysToDateStr(curr, 1);
    }
    return buckets;
  }

  if (groupBy === "week") {
    let weekMonday = getMondayOfDateStr(startDate);
    while (weekMonday <= endDate) {
      const weekSunday = addDaysToDateStr(weekMonday, 6);
      const effectiveStart = weekMonday < startDate ? startDate : weekMonday;
      const effectiveEnd = weekSunday > endDate ? endDate : weekSunday;
      buckets.push({
        key: weekMonday,
        label: formatDayMonthLabel(effectiveStart),
        start_date: effectiveStart,
        end_date: effectiveEnd,
      });
      weekMonday = addDaysToDateStr(weekMonday, 7);
    }
    return buckets;
  }

  // groupBy === "month"
  let [currYear, currMonth] = startDate.slice(0, 7).split("-").map(Number);
  const [endYear, endMonth] = endDate.slice(0, 7).split("-").map(Number);

  while (
    currYear < endYear ||
    (currYear === endYear && currMonth <= endMonth)
  ) {
    const mm = String(currMonth).padStart(2, "0");
    const monthKey = `${currYear}-${mm}`;
    const firstOfMonth = `${monthKey}-01`;
    const lastDayNum = new Date(Date.UTC(currYear, currMonth, 0)).getUTCDate();
    const lastOfMonth = `${monthKey}-${String(lastDayNum).padStart(2, "0")}`;

    buckets.push({
      key: monthKey,
      label: `T${currMonth}/${currYear}`,
      start_date: firstOfMonth < startDate ? startDate : firstOfMonth,
      end_date: lastOfMonth > endDate ? endDate : lastOfMonth,
    });

    currMonth += 1;
    if (currMonth > 12) {
      currMonth = 1;
      currYear += 1;
    }
  }

  return buckets;
}

/**
 * Lấy khoảng mặc định 1 năm gần nhất theo giờ Việt Nam (UTC+7): { startDate, endDate }.
 */
function getOneYearBounds(now = new Date()) {
  const vnNow = getVnNowDate(now);
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

  const days = calcInclusiveDays(range.startDate, range.endDate);

  return { startDate: range.startDate, endDate: range.endDate, days };
}

module.exports = {
  VN_TIMEZONE,
  VN_OFFSET_MS,
  getCurrentMonthBoundsInVietnam,
  addDaysToDateStr,
  getMondayOfDateStr,
  determineGroupBy,
  resolveAdminDateRange,
  generateTimeBuckets,
  getOneYearBounds,
  resolveOneYearRange,
  resolveExportRange,
};

