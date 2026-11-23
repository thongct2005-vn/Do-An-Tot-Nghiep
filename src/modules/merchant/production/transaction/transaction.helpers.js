// transaction.helpers.js: Hàm dựng cửa sổ thời gian, phân nhóm biểu đồ doanh thu và kiểm tra lọc cho Merchant Transaction.
const { httpError } = require("../../../../utils/common/http");
const { getOneYearBounds } = require("../../../../utils/common/dateRange");
const merchantAuthRepository = require("../auth/auth.repository");

const TRANSACTION_TYPES = ["TRANSFER", "TOPUP", "WITHDRAW", "PAYMENT", "REFUND"];
const MERCHANT_FUNDING_ALIAS_MAP = {
  LUMAPAY: "MAIN_WALLET",
  MAIN_WALLET: "MAIN_WALLET",
  WALLET: "MAIN_WALLET",
  BANK: "BANK",
};

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function getOtpMerchant({ userId, phone }) {
  const user = phone
    ? await merchantAuthRepository.findMerchantByPhone(phone)
    : null;
  if (
    !user ||
    user.id !== userId ||
    user.status !== "ACTIVE" ||
    user.role !== "MERCHANT"
  ) {
    throw httpError(401, "Phiên xác thực không hợp lệ");
  }
  if (!user.email) {
    throw httpError(404, "Không tìm thấy email liên kết với số điện thoại");
  }
  return user;
}

function normalizeProductIdFilter(productId) {
  if (productId === undefined || productId === null) return null;
  const trimmed = String(productId).trim();
  if (!trimmed) return null;
  if (trimmed.length > 100) {
    throw httpError(400, "Mã sản phẩm không hợp lệ");
  }
  return trimmed;
}

function parseUtcYmd(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addUtcDays(dateObj, days) {
  return new Date(dateObj.getTime() + days * 86400000);
}

function toYmdUtc(dateObj) {
  return dateObj.toISOString().slice(0, 10);
}

function getWeekMondayUtc(dateObj) {
  const dayOffset = (dateObj.getUTCDay() + 6) % 7;
  return addUtcDays(dateObj, -dayOffset);
}

function formatShortDm(ymd) {
  const [, m, d] = String(ymd).split("-");
  return `${d}/${m}`;
}

function isoYmdToVn(ymd) {
  return ymd ? String(ymd).split("-").reverse().join("/") : "";
}

function resolveRevenueChartWindow(period, monthYm = "") {
  const { startDate: minOneYearYmd, endDate: todayYmd } = getOneYearBounds();
  const todayUtc = parseUtcYmd(todayYmd);

  if (
    (period === "day" || period === "week") &&
    /^\d{4}-\d{2}$/.test(monthYm)
  ) {
    const [y, m] = monthYm.split("-").map(Number);
    if (m < 1 || m > 12) {
      throw httpError(400, "Tháng tra cứu không hợp lệ");
    }
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const rawStart = `${monthYm}-01`;
    const rawEnd = `${monthYm}-${String(daysInMonth).padStart(2, "0")}`;
    const startDate = rawStart < minOneYearYmd ? minOneYearYmd : rawStart;
    const endDate = rawEnd > todayYmd ? todayYmd : rawEnd;
    if (startDate > endDate) {
      throw httpError(
        400,
        "Chỉ có thể xem biểu đồ doanh thu trong vòng 1 năm gần nhất",
      );
    }
    return { startDate, endDate };
  }

  if (period === "day") {
    const startUtc = addUtcDays(todayUtc, -6);
    return { startDate: toYmdUtc(startUtc), endDate: todayYmd };
  }

  if (period === "week") {
    const monthAgo = new Date(
      Date.UTC(
        todayUtc.getUTCFullYear(),
        todayUtc.getUTCMonth() - 1,
        todayUtc.getUTCDate() + 1,
      ),
    );
    const startMon = getWeekMondayUtc(monthAgo);
    const rawStart = toYmdUtc(startMon);
    return {
      startDate: rawStart < minOneYearYmd ? minOneYearYmd : rawStart,
      endDate: todayYmd,
    };
  }

  const startMonth = new Date(
    Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth() - 11, 1),
  );
  const rawStart = toYmdUtc(startMonth);
  return {
    startDate: rawStart < minOneYearYmd ? minOneYearYmd : rawStart,
    endDate: todayYmd,
  };
}

function buildRevenueChartBuckets(dailyRows, period, range, selectedMonth = "") {
  const dailyMap = new Map();
  (dailyRows || []).forEach((item) => {
    const ymd = String(item.date_str || item.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
    dailyMap.set(ymd, {
      revenue: Number(item.revenue) || 0,
      gross_revenue: Number(item.gross_revenue) || 0,
      merchant_fee: Number(item.merchant_fee) || 0,
      order_count: Number(item.order_count) || 0,
    });
  });

  const buckets = [];
  const startUtc = parseUtcYmd(range.startDate);
  const endUtc = parseUtcYmd(range.endDate);
  const isFullMonth = /^\d{4}-\d{2}$/.test(selectedMonth);

  if (period === "day") {
    for (let cur = startUtc; cur <= endUtc; cur = addUtcDays(cur, 1)) {
      const ymd = toYmdUtc(cur);
      const val = dailyMap.get(ymd) || {
        revenue: 0,
        gross_revenue: 0,
        merchant_fee: 0,
        order_count: 0,
      };
      buckets.push({
        key: ymd,
        label: isFullMonth ? ymd.slice(8, 10) : formatShortDm(ymd),
        fullLabel: isoYmdToVn(ymd),
        startDate: ymd,
        endDate: ymd,
        revenue: val.revenue,
        gross_revenue: val.gross_revenue,
        merchant_fee: val.merchant_fee,
        order_count: val.order_count,
      });
    }
    return buckets;
  }

  if (period === "week") {
    if (isFullMonth) {
      let curStart = startUtc;
      while (curStart <= endUtc) {
        const rawEnd = addUtcDays(curStart, 6);
        const curEnd = rawEnd > endUtc ? endUtc : rawEnd;
        const wStart = toYmdUtc(curStart);
        const wEnd = toYmdUtc(curEnd);

        let revenue = 0;
        let grossRevenue = 0;
        let merchantFee = 0;
        let orderCount = 0;
        for (let d = curStart; d <= curEnd; d = addUtcDays(d, 1)) {
          const val = dailyMap.get(toYmdUtc(d));
          if (val) {
            revenue += val.revenue;
            grossRevenue += val.gross_revenue;
            merchantFee += val.merchant_fee;
            orderCount += val.order_count;
          }
        }

        buckets.push({
          key: wStart,
          label: `${formatShortDm(wStart)} - ${formatShortDm(wEnd)}`,
          fullLabel: `${isoYmdToVn(wStart)} - ${isoYmdToVn(wEnd)}`,
          startDate: wStart,
          endDate: wEnd,
          revenue,
          gross_revenue: grossRevenue,
          merchant_fee: merchantFee,
          order_count: orderCount,
        });
        curStart = addUtcDays(curStart, 7);
      }
      return buckets;
    }

    let curMon = getWeekMondayUtc(startUtc);
    while (curMon <= endUtc) {
      const curSun = addUtcDays(curMon, 6);
      const wStartDate = curMon < startUtc ? startUtc : curMon;
      const wEndDate = curSun > endUtc ? endUtc : curSun;
      const wStart = toYmdUtc(wStartDate);
      const wEnd = toYmdUtc(wEndDate);

      let revenue = 0;
      let grossRevenue = 0;
      let merchantFee = 0;
      let orderCount = 0;
      for (let d = wStartDate; d <= wEndDate; d = addUtcDays(d, 1)) {
        const val = dailyMap.get(toYmdUtc(d));
        if (val) {
          revenue += val.revenue;
          grossRevenue += val.gross_revenue;
          merchantFee += val.merchant_fee;
          orderCount += val.order_count;
        }
      }

      buckets.push({
        key: wStart,
        label: `${formatShortDm(wStart)} - ${formatShortDm(wEnd)}`,
        fullLabel: `${isoYmdToVn(wStart)} - ${isoYmdToVn(wEnd)}`,
        startDate: wStart,
        endDate: wEnd,
        revenue,
        gross_revenue: grossRevenue,
        merchant_fee: merchantFee,
        order_count: orderCount,
      });
      curMon = addUtcDays(curMon, 7);
    }
    return buckets;
  }

  let y = startUtc.getUTCFullYear();
  let m = startUtc.getUTCMonth();
  const endY = endUtc.getUTCFullYear();
  const endM = endUtc.getUTCMonth();

  while (y < endY || (y === endY && m <= endM)) {
    const ym = `${y}-${String(m + 1).padStart(2, "0")}`;
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const mStart = `${ym}-01`;
    const mEndRaw = `${ym}-${String(daysInMonth).padStart(2, "0")}`;
    const mEnd = mEndRaw > range.endDate ? range.endDate : mEndRaw;

    let revenue = 0;
    let grossRevenue = 0;
    let merchantFee = 0;
    let orderCount = 0;
    dailyMap.forEach((val, ymd) => {
      if (ymd.startsWith(ym)) {
        revenue += val.revenue;
        grossRevenue += val.gross_revenue;
        merchantFee += val.merchant_fee;
        orderCount += val.order_count;
      }
    });

    buckets.push({
      key: ym,
      label: `T${m + 1}/${String(y).slice(-2)}`,
      fullLabel: `Tháng ${String(m + 1).padStart(2, "0")}/${y}`,
      startDate: mStart,
      endDate: mEnd,
      revenue,
      gross_revenue: grossRevenue,
      merchant_fee: merchantFee,
      order_count: orderCount,
    });

    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }
  return buckets;
}

module.exports = {
  TRANSACTION_TYPES,
  MERCHANT_FUNDING_ALIAS_MAP,
  toNumberOrNull,
  getOtpMerchant,
  normalizeProductIdFilter,
  resolveRevenueChartWindow,
  buildRevenueChartBuckets,
};

