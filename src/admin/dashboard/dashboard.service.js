// dashboard.service.js: Nghiệp vụ tổng hợp KPI, phân bổ trạng thái và chuỗi thời gian Admin Dashboard.
const adminDashboardRepository = require("./dashboard.repository");
const {
  resolveAdminDateRange,
  generateTimeBuckets,
} = require("../../utils/common/dateRange");
const {
  CANONICAL_TX_TYPES,
  buildBucketRowMap,
} = require("./dashboard.helpers");

const adminDashboardService = {
  /**
   * GET /api/v2/admin/dashboard/overview
   * Trả về 5 chỉ số KPI dòng tiền, doanh thu thực thu Ví trả sau và phân bổ trạng thái giao dịch theo 4 loại trong kỳ.
   */
  async getOverview({ start_date, end_date, now } = {}) {
    const range = resolveAdminDateRange(start_date, end_date, { now });

    const [kpiRow, statusRows, postpaidRow] = await Promise.all([
      adminDashboardRepository.getKpiSummary(
        range.startInstant,
        range.nextDayInstant,
      ),
      adminDashboardRepository.getStatusDistributionByType(
        range.startInstant,
        range.nextDayInstant,
      ),
      adminDashboardRepository.getPostpaidRevenueSummary(
        range.startInstant,
        range.nextDayInstant,
      ),
    ]);

    const totalTransactions = Number(kpiRow?.total_transactions || 0);
    const totalTopup = Number(kpiRow?.total_topup || 0);
    const totalWithdraw = Number(kpiRow?.total_withdraw || 0);
    const netCashflow = totalTopup - totalWithdraw;
    const totalQrPayment = Number(kpiRow?.total_qr_payment || 0);

    const serviceFeeRevenue = Number(postpaidRow?.service_fee_revenue || 0);
    const lateFeeRevenue = Number(postpaidRow?.late_fee_revenue || 0);
    const totalPostpaidRevenue = Number(
      postpaidRow?.total_revenue ?? serviceFeeRevenue + lateFeeRevenue,
    );
    const postpaidFeeTxCount = Number(postpaidRow?.fee_tx_count || 0);

    const statusByType = new Map();
    for (const row of statusRows || []) {
      statusByType.set(String(row.transaction_type).toUpperCase(), row);
    }

    const statusDistribution = CANONICAL_TX_TYPES.map(({ type, label }) => {
      const row = statusByType.get(type);
      const totalCount = Number(row?.total_count || 0);
      const completedCount = Number(row?.completed_count || 0);
      const pendingCount = Number(row?.pending_count || 0);
      const failedCount = Number(row?.failed_count || 0);

      const completedPercent =
        totalCount > 0 ? Number(((completedCount / totalCount) * 100).toFixed(1)) : 0;
      const pendingPercent =
        totalCount > 0 ? Number(((pendingCount / totalCount) * 100).toFixed(1)) : 0;
      const failedPercent =
        totalCount > 0
          ? Number(
              Math.max(0, 100 - completedPercent - pendingPercent).toFixed(1),
            )
          : 0;

      return {
        type,
        label,
        total_count: totalCount,
        completed_count: completedCount,
        pending_count: pendingCount,
        failed_count: failedCount,
        completed_percent: completedPercent,
        pending_percent: pendingPercent,
        failed_percent: failedPercent,
      };
    });

    return {
      period: range.period,
      kpis: {
        total_transactions: totalTransactions,
        total_topup: totalTopup,
        total_withdraw: totalWithdraw,
        net_cashflow: netCashflow,
        total_qr_payment: totalQrPayment,
      },
      postpaid_revenue: {
        total_revenue: totalPostpaidRevenue,
        service_fee_revenue: serviceFeeRevenue,
        late_fee_revenue: lateFeeRevenue,
        fee_tx_count: postpaidFeeTxCount,
      },
      status_distribution: statusDistribution,
    };
  },

  /**
   * GET /api/v2/admin/dashboard/cashflow
   * Trả về chuỗi thời gian Nạp, Rút, Thanh toán QR và Dòng tiền ròng (Net Flow) đã zero-fill.
   */
  async getCashflow({ start_date, end_date, now } = {}) {
    const range = resolveAdminDateRange(start_date, end_date, { now });
    const baseBuckets = generateTimeBuckets(range);
    const rows = await adminDashboardRepository.getCashflowRowsByBucket(
      range.startInstant,
      range.nextDayInstant,
      range.groupBy,
    );

    const rowMap = buildBucketRowMap(rows);

    let totalTopup = 0;
    let totalWithdraw = 0;
    let totalQrPayment = 0;

    const buckets = baseBuckets.map((b) => {
      const matched = rowMap.get(b.key);
      const topup = Number(matched?.topup || 0);
      const withdraw = Number(matched?.withdraw || 0);
      const qrPayment = Number(matched?.qr_payment || 0);
      const netFlow = topup - withdraw;

      totalTopup += topup;
      totalWithdraw += withdraw;
      totalQrPayment += qrPayment;

      return {
        bucket_key: b.key,
        label: b.label,
        start_date: b.start_date,
        end_date: b.end_date,
        topup,
        withdraw,
        qr_payment: qrPayment,
        net_flow: netFlow,
      };
    });

    return {
      period: range.period,
      summary: {
        total_topup: totalTopup,
        total_withdraw: totalWithdraw,
        total_qr_payment: totalQrPayment,
        net_cashflow: totalTopup - totalWithdraw,
      },
      buckets,
    };
  },

  /**
   * GET /api/v2/admin/dashboard/transaction-volume
   * Trả về số lượng giao dịch phát sinh theo từng mốc thời gian (không cộng dồn, mốc không có trả 0).
   */
  async getTransactionVolume({ start_date, end_date, now } = {}) {
    const range = resolveAdminDateRange(start_date, end_date, { now });
    const baseBuckets = generateTimeBuckets(range);
    const rows =
      await adminDashboardRepository.getTransactionVolumeRowsByBucket(
        range.startInstant,
        range.nextDayInstant,
        range.groupBy,
      );

    const rowMap = buildBucketRowMap(rows);

    let totalCount = 0;
    const buckets = baseBuckets.map((b) => {
      const matched = rowMap.get(b.key);
      const count = Number(matched?.count || 0);
      const completedCount = Number(matched?.completed_count || 0);
      const pendingCount = Number(matched?.pending_count || 0);
      const failedCount = Number(matched?.failed_count || 0);

      totalCount += count;

      return {
        bucket_key: b.key,
        label: b.label,
        start_date: b.start_date,
        end_date: b.end_date,
        count,
        completed_count: completedCount,
        pending_count: pendingCount,
        failed_count: failedCount,
      };
    });

    return {
      period: range.period,
      total_count: totalCount,
      buckets,
    };
  },
};

module.exports = adminDashboardService;
