// reports.service.js: Nghiệp vụ tổng hợp báo cáo phí Merchant, tăng trưởng tài khoản/giao dịch và thống kê đăng nhập Admin.
const pool = require("../../config/database");
const { httpError } = require("../../utils/common/http");
const adminReportsRepository = require("./reports.repository");
const { filters } = require("./reports.helpers");

const adminReportsService = {
  filters,
  REPORT_SQL: adminReportsRepository.REPORT_SQL,

  async report(input, { db = pool, allMerchants = false } = {}) {
    const f = filters(input);
    const baseFilters = {
      merchant_id: f.merchant,
      transaction_type: f.type || "ALL",
    };
    const effectiveScope = allMerchants ? "full" : f.scope;
    const rollupUntil = await adminReportsRepository.getReportCutoff(db);

    if (effectiveScope === "kpi") {
      const revenue = await adminReportsRepository.queryFeeRevenueSummary(
        db,
        f,
        rollupUntil,
      );
      return {
        overview: { revenue },
        period: f.period,
        filters: baseFilters,
      };
    }

    if (effectiveScope === "merchants") {
      const paged = await adminReportsRepository.queryMerchantsPage(
        db,
        f,
        rollupUntil,
        { allMerchants: false },
      );
      return {
        merchants: paged.merchants,
        total_merchants: paged.total_merchants,
        period: f.period,
        filters: baseFilters,
        pagination: { page: f.page, limit: f.limit, total: paged.total_merchants },
      };
    }

    const data = await adminReportsRepository.queryReportFull(
      db,
      f,
      rollupUntil,
      { allMerchants },
    );
    const g = data.gateway;
    g.resolved = g.success + g.expired + g.failed + g.cancelled;
    g.success_rate = g.resolved ? (g.success / g.resolved) * 100 : null;
    return {
      ...data,
      period: f.period,
      filters: baseFilters,
      pagination: {
        page: allMerchants ? 1 : f.page,
        limit: allMerchants ? data.total_merchants : f.limit,
        total: data.total_merchants,
      },
    };
  },

  async growth(input, { db = pool } = {}) {
    const f = filters(input);
    const previous = new Date(
      f.startInstant.getTime() - (f.nextDayInstant - f.startInstant),
    );
    const { accountsRows, volume } = await adminReportsRepository.getGrowthData(
      db,
      f,
      previous,
    );

    const calcGrowthPercent = (current, prev) =>
      prev === 0 ? null : ((current - prev) / prev) * 100;
    const accounts = (f.role === "ALL" ? ["USER", "MERCHANT"] : [f.role]).map(
      (role) => {
        const r = accountsRows.find((a) => a.role === role) || {
          role,
          current: 0,
          previous: 0,
          total: 0,
        };
        return {
          ...r,
          growth_percent: calcGrowthPercent(r.current, r.previous),
        };
      },
    );
    const transactions = {
      ...volume,
      count_growth_percent: calcGrowthPercent(
        volume.current_count,
        volume.previous_count,
      ),
      gross_growth_percent: calcGrowthPercent(
        volume.current_gross,
        volume.previous_gross,
      ),
    };
    return {
      accounts,
      transactions,
      period: f.period,
      previous_period: {
        start: previous.toISOString(),
        end_exclusive: f.startIso,
      },
    };
  },

  async exportReport(input, adminId) {
    const { buffer } =
      await require("./financialReport.service").exportFinancialReport(
        input,
        adminId,
      );
    return buffer;
  },

  async logins(input) {
    const f = filters(input);
    if (require("mongoose").connection.readyState !== 1) {
      throw httpError(503, "Dữ liệu đăng nhập tạm thời không khả dụng");
    }
    return require("../user/user.service").getLoginStats({
      start_date: f.startDate,
      end_date: f.endDate,
    });
  },
};

module.exports = adminReportsService;
