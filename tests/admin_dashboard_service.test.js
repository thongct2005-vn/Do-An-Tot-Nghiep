const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const adminDashboardService = require("../src/admin/dashboard/dashboard.service");
const adminDashboardRepository = require("../src/admin/dashboard/dashboard.repository");

describe("Admin Dashboard Service Tests", () => {
  const origGetKpiSummary = adminDashboardRepository.getKpiSummary;
  const origGetStatusDist = adminDashboardRepository.getStatusDistributionByType;
  const origGetPostpaidRevenue =
    adminDashboardRepository.getPostpaidRevenueSummary;
  const origGetCashflow = adminDashboardRepository.getCashflowRowsByBucket;
  const origGetVolume =
    adminDashboardRepository.getTransactionVolumeRowsByBucket;

  beforeEach(() => {
    adminDashboardRepository.getKpiSummary = origGetKpiSummary;
    adminDashboardRepository.getStatusDistributionByType = origGetStatusDist;
    adminDashboardRepository.getPostpaidRevenueSummary = origGetPostpaidRevenue;
    adminDashboardRepository.getCashflowRowsByBucket = origGetCashflow;
    adminDashboardRepository.getTransactionVolumeRowsByBucket = origGetVolume;
  });

  it("getOverview trả về mặc định tháng hiện tại, 5 KPI, doanh thu Ví trả sau và phân bổ trạng thái 4 loại giao dịch", async () => {
    const fakeNow = new Date("2026-11-14T03:00:00.000Z"); // 10:00 ngày 14/11 giờ VN
    let capturedStart = null;
    let capturedNextDay = null;
    let capturedPostpaidStart = null;
    let capturedPostpaidNextDay = null;

    adminDashboardRepository.getKpiSummary = async (start, nextDay) => {
      capturedStart = start;
      capturedNextDay = nextDay;
      return {
        total_transactions: 25,
        total_topup: 50000000,
        total_withdraw: 20000000,
        total_qr_payment: 15000000,
        total_transfer: 10000000,
      };
    };

    adminDashboardRepository.getPostpaidRevenueSummary = async (
      start,
      nextDay,
    ) => {
      capturedPostpaidStart = start;
      capturedPostpaidNextDay = nextDay;
      return {
        total_revenue: 35000,
        service_fee_revenue: 20000,
        late_fee_revenue: 15000,
        fee_tx_count: 2,
      };
    };

    adminDashboardRepository.getStatusDistributionByType = async () => [
      {
        transaction_type: "TOPUP",
        total_count: 10,
        completed_count: 9,
        pending_count: 1,
        failed_count: 0,
      },
      {
        transaction_type: "PAYMENT",
        total_count: 5,
        completed_count: 4,
        pending_count: 0,
        failed_count: 1,
      },
    ];

    const res = await adminDashboardService.getOverview({ now: fakeNow });

    assert.equal(capturedStart.toISOString(), "2026-10-31T17:00:00.000Z");
    assert.equal(capturedNextDay.toISOString(), "2026-11-14T17:00:00.000Z");
    assert.equal(
      capturedPostpaidStart.toISOString(),
      "2026-10-31T17:00:00.000Z",
    );
    assert.equal(
      capturedPostpaidNextDay.toISOString(),
      "2026-11-14T17:00:00.000Z",
    );
    assert.deepEqual(res.period, {
      start_date: "2026-11-01",
      end_date: "2026-11-14",
      timezone: "Asia/Ho_Chi_Minh",
      group_by: "day",
    });
    assert.deepEqual(res.kpis, {
      total_transactions: 25,
      total_topup: 50000000,
      total_withdraw: 20000000,
      net_cashflow: 30000000,
      total_qr_payment: 15000000,
    });
    assert.deepEqual(res.postpaid_revenue, {
      total_revenue: 35000,
      service_fee_revenue: 20000,
      late_fee_revenue: 15000,
      fee_tx_count: 2,
    });
    assert.equal(res.status_distribution.length, 4);
    assert.equal(res.status_distribution[0].type, "TOPUP");
    assert.equal(res.status_distribution[0].completed_percent, 90);
    assert.equal(res.status_distribution[1].type, "WITHDRAW");
    assert.equal(res.status_distribution[1].total_count, 0);
  });

  it("getOverview chuẩn hóa postpaid_revenue về 0 khi kỳ trống hoặc repository trả rỗng", async () => {
    adminDashboardRepository.getKpiSummary = async () => ({
      total_transactions: 0,
      total_topup: 0,
      total_withdraw: 0,
      total_qr_payment: 0,
      total_transfer: 0,
    });
    adminDashboardRepository.getStatusDistributionByType = async () => [];
    adminDashboardRepository.getPostpaidRevenueSummary = async () => null;

    const res = await adminDashboardService.getOverview({
      start_date: "2026-11-01",
      end_date: "2026-11-14",
    });

    assert.deepEqual(res.postpaid_revenue, {
      total_revenue: 0,
      service_fee_revenue: 0,
      late_fee_revenue: 0,
      fee_tx_count: 0,
    });
  });

  it("getCashflow và getTransactionVolume trả cùng danh sách bucket đã zero-fill (01/11..14/11)", async () => {
    adminDashboardRepository.getCashflowRowsByBucket = async () => [
      {
        bucket_key: "2026-11-02",
        topup: 10000000,
        withdraw: 3000000,
        qr_payment: 2000000,
      },
    ];

    adminDashboardRepository.getTransactionVolumeRowsByBucket = async () => [
      {
        bucket_key: "2026-11-02",
        count: 8,
        completed_count: 7,
        pending_count: 1,
        failed_count: 0,
      },
    ];

    const [cashflow, volume] = await Promise.all([
      adminDashboardService.getCashflow({
        start_date: "2026-11-01",
        end_date: "2026-11-14",
      }),
      adminDashboardService.getTransactionVolume({
        start_date: "2026-11-01",
        end_date: "2026-11-14",
      }),
    ]);

    assert.equal(cashflow.buckets.length, 14);
    assert.equal(volume.buckets.length, 14);
    assert.deepEqual(
      cashflow.buckets.map((b) => b.label),
      volume.buckets.map((b) => b.label),
      "Cashflow và Transaction Volume phải có cùng danh sách mốc thời gian trục X",
    );

    // Ngày 01/11 không có giao dịch -> zero-filled = 0
    assert.equal(cashflow.buckets[0].label, "01/11");
    assert.equal(cashflow.buckets[0].topup, 0);
    assert.equal(cashflow.buckets[0].net_flow, 0);
    assert.equal(volume.buckets[0].count, 0);

    // Ngày 02/11 có dữ liệu
    assert.equal(cashflow.buckets[1].label, "02/11");
    assert.equal(cashflow.buckets[1].topup, 10000000);
    assert.equal(cashflow.buckets[1].withdraw, 3000000);
    assert.equal(cashflow.buckets[1].net_flow, 7000000);
    assert.equal(volume.buckets[1].count, 8);
    assert.equal(volume.total_count, 8);
  });
});
