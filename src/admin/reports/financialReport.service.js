// financialReport.service.js: Nghiệp vụ đọc snapshot nhất quán và xuất workbook Excel báo cáo tài chính Admin.
const { Pool } = require("pg");
const { uuidv7 } = require("uuidv7");
const defaultPool = require("../../config/database");
const adminFinancialReportRepository = require("./financialReport.repository");
const {
  exactInteger,
  previousRange,
  percentChange,
} = require("./financialReport.data");
const {
  isMissingRelationError,
  ensureReportRollupConsistent,
  queryGrowthVolume,
} = require("./reportRollup");
const {
  ensureRollupConsistent: ensureDashboardRollupConsistent,
} = require("../dashboard/dashboardRollup");

const adminFinancialReportService = {
  async readSnapshot(pool, filters, adminId) {
    if (pool === defaultPool || pool instanceof Pool) {
      await ensureReportRollupConsistent(pool).catch(() => null);
      await ensureDashboardRollupConsistent(pool).catch(() => null);
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const meta =
        await adminFinancialReportRepository.getSnapshotAdminMetadata(
          client,
          adminId,
        );
      if (!meta) throw new Error("Không tìm thấy người xuất báo cáo");
      const { rollupUntil, dashRollupUntil } =
        await adminFinancialReportRepository.readSnapshotRollupState(client);
      const data = await adminFinancialReportRepository.readFinancialData(
        client,
        filters,
        { rollupUntil, dashRollupUntil },
      );
      const previous = previousRange(filters);
      const accounts = await adminFinancialReportRepository.getAccountGrowthRows(
        client,
        filters,
        previous,
      );
      let txVolume;
      try {
        txVolume = await queryGrowthVolume(
          client,
          filters,
          previous.startInstant,
          dashRollupUntil,
        );
      } catch (err) {
        if (dashRollupUntil && isMissingRelationError(err)) {
          txVolume = await queryGrowthVolume(
            client,
            filters,
            previous.startInstant,
            null,
          );
        } else {
          throw err;
        }
      }
      data.growth = {
        accounts: (filters.role && filters.role !== "ALL"
          ? [filters.role]
          : ["USER", "MERCHANT"]
        ).map((role) => {
          const row = accounts.find((r) => r.role === role) || {
            current: 0,
            previous: 0,
            total: 0,
          };
          const current = exactInteger(row.current);
          const prev = exactInteger(row.previous);
          return {
            role,
            current,
            previous: prev,
            total: exactInteger(row.total),
            growth: percentChange(current, prev),
          };
        }),
        transactions: Object.fromEntries(
          Object.entries(txVolume).map(([k, v]) => [k, exactInteger(v)]),
        ),
      };
      data.metadata = {
        admin_id: adminId,
        admin_name: meta.admin_name,
        financial_snapshot_at: meta.snapshot_at,
      };
      data.period = filters.period;
      data.filters = {
        merchant_id: filters.merchant,
        transaction_type: filters.type || "ALL",
        role: filters.role || "ALL",
      };
      data.previous_period = {
        start: previous.startInstant,
        end_exclusive: previous.nextDayInstant,
      };
      await client.query("COMMIT");
      return data;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  async attachLogins(data, input, readLogins) {
    const startedAt = new Date();
    try {
      const result = await readLogins({
        start_date: input.start_date,
        end_date: input.end_date,
      });
      data.logins = {
        available: true,
        summary: {
          total_logins: exactInteger(result.summary.total_logins),
          unique_users: exactInteger(result.summary.unique_users),
        },
        read_started_at: startedAt,
        read_completed_at: new Date(),
      };
    } catch (_) {
      data.logins = {
        available: false,
        read_started_at: startedAt,
        read_completed_at: new Date(),
        message: "Dữ liệu đăng nhập tạm thời không khả dụng",
      };
    }
    return data;
  },

  async exportFinancialReport(
    input,
    adminId,
    { pool = defaultPool, readLogins, renderer } = {},
  ) {
    const reports = require("./reports.service");
    const filters = reports.filters(input);
    const data = await adminFinancialReportService.readSnapshot(
      pool,
      filters,
      adminId,
    );
    await adminFinancialReportService.attachLogins(
      data,
      data.period,
      readLogins || reports.logins,
    );
    data.metadata.report_id = uuidv7();
    data.metadata.generated_at = new Date().toISOString();
    data.reconciliation = require("./financialReport.reconciliation").reconcile(data);
    const book = await (
      renderer || require("./financialReport.export").buildWorkbook
    )(data);
    const buffer = await book.xlsx.writeBuffer();
    await adminFinancialReportRepository.insertReportOutbox(
      pool,
      data.metadata.report_id,
      {
        report_id: data.metadata.report_id,
        admin_id: adminId,
        period: data.period,
        filters: data.filters,
        financial_snapshot_at: data.metadata.financial_snapshot_at,
        generated_at: data.metadata.generated_at,
        workbook_version: 1,
        merchant_rows: data.merchant.merchants.length,
        logins_available: data.logins.available,
        reconciliation: data.reconciliation.map(
          ({ name, status, difference }) => ({ name, status, difference }),
        ),
      },
    );
    const fileName = `Bao_cao_tai_chinh_vi_dien_tu_${data.period.start_date.replaceAll("-", "")}_${data.period.end_date.replaceAll("-", "")}.xlsx`;
    return { buffer, fileName, reportId: data.metadata.report_id };
  },
};

module.exports = adminFinancialReportService;
