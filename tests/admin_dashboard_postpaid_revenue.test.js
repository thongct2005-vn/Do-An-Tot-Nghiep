const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { once } = require("node:events");
const { createTestDatabase } = require("./merchant_test_database");

test("Dashboard overview postpaid_revenue aggregates collected POSTPAID_SERVICE_FEE and POSTPAID_LATE_FEE accurately", async () => {
  const target = await createTestDatabase();
  const pool = require("../src/config/database");
  const dashboardService = require("../src/admin/dashboard/dashboard.service");
  const jwt = require("../src/utils/jwt");

  const feeWalletId = "00000000-0000-7000-8000-000000000001";
  const postpaidWalletId = "00000000-0000-7000-8000-000000000002";
  const userId = randomUUID();
  const merchantId = randomUUID();
  const adminId = randomUUID();
  let server;

  async function insertTxAndFees({
    type = "PAYMENT",
    status = "SUCCESS",
    amount = 100000,
    sourceId = userId,
    destId = postpaidWalletId,
    createdAt = "2026-11-05T10:00:00+07:00",
    fees = [],
  }) {
    const txId = randomUUID();
    await pool.query(
      `INSERT INTO transactions(id, source_user_id, destination_user_id, transaction_type, status, amount, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [txId, sourceId, destId, type, status, amount, createdAt],
    );
    for (const fee of fees) {
      await pool.query(
        `INSERT INTO fee_ledger_entries(
           id, transaction_id, merchant_user_id, payer_user_id, fee_type, amount,
           fee_wallet_user_id, fee_wallet_balance_before, fee_wallet_balance_after, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $6, $8)`,
        [
          randomUUID(),
          txId,
          fee.merchantId || null,
          sourceId,
          fee.feeType,
          fee.amount,
          feeWalletId,
          fee.createdAt || createdAt,
        ],
      );
    }
    return txId;
  }

  try {
    const indexSql = fs.readFileSync(
      path.join(__dirname, "../migrations/20261125_postpaid_fee_ledger_index.sql"),
      "utf8",
    );
    await pool.query(indexSql);

    const idxRes = await pool.query(
      `SELECT i.indisvalid
         FROM pg_class c
         JOIN pg_index i ON c.oid = i.indexrelid
        WHERE c.relname = 'idx_fee_ledger_postpaid_created_tx'`,
    );
    assert.equal(idxRes.rows[0]?.indisvalid, true);

    await pool.query(
      `INSERT INTO users(id, role, full_name, created_at)
       VALUES ($1, 'USER', 'User VTS', '2026-10-01'),
              ($2, 'MERCHANT', 'Merchant VTS', '2026-10-01'),
              ($3, 'ADMIN', 'Admin VTS', '2026-10-01')`,
      [userId, merchantId, adminId],
    );

    // 1. Giao dịch tất toán trả đồng thời cả phí dịch vụ + phí trễ hạn (cùng 1 transaction_id => 1 lượt)
    await insertTxAndFees({
      amount: 300000,
      createdAt: "2026-11-01T00:00:00+07:00",
      fees: [
        { feeType: "POSTPAID_LATE_FEE", amount: 15000 },
        { feeType: "POSTPAID_SERVICE_FEE", amount: 20000 },
      ],
    });

    // 2. Giao dịch tất toán cuối ngày cuối kỳ (23:59:59.999+07) chỉ trả phí dịch vụ
    await insertTxAndFees({
      amount: 120000,
      createdAt: "2026-11-14T23:59:59.999+07:00",
      fees: [{ feeType: "POSTPAID_SERVICE_FEE", amount: 20000 }],
    });

    // 3. Các bản ghi KHÔNG được tính vào doanh thu thực thu Ví trả sau:
    // - Thanh toán QR bằng Ví trả sau có QR_FEE (đã tính ở Doanh thu phí Merchant)
    await insertTxAndFees({
      sourceId: postpaidWalletId,
      destId: merchantId,
      amount: 500000,
      createdAt: "2026-11-10T12:00:00+07:00",
      fees: [{ feeType: "QR_FEE", amount: 6000, merchantId }],
    });
    // - USER_FEE / WITHDRAW_FEE / MONTHLY_PLAN_FEE
    await insertTxAndFees({
      type: "WITHDRAW",
      destId: null,
      amount: 100000,
      createdAt: "2026-11-10T12:00:00+07:00",
      fees: [{ feeType: "WITHDRAW_FEE", amount: 1100 }],
    });
    // - Giao dịch PENDING hoặc FAILED
    await insertTxAndFees({
      status: "PENDING",
      amount: 50000,
      createdAt: "2026-11-10T12:00:00+07:00",
      fees: [{ feeType: "POSTPAID_LATE_FEE", amount: 10000 }],
    });
    await insertTxAndFees({
      status: "FAILED",
      amount: 50000,
      createdAt: "2026-11-10T12:00:00+07:00",
      fees: [{ feeType: "POSTPAID_SERVICE_FEE", amount: 20000 }],
    });
    // - Ngoài khoảng ngày (00:00:00 ngày 15/11 giờ VN)
    await insertTxAndFees({
      amount: 80000,
      createdAt: "2026-11-15T00:00:00+07:00",
      fees: [{ feeType: "POSTPAID_LATE_FEE", amount: 12000 }],
    });
    // - Công nợ phát sinh trong postpaid_entries chưa tất toán (chưa có fee_ledger_entries)
    await pool.query(
      `INSERT INTO postpaid_wallets(user_id, status, credit_limit, used_amount, billed_amount, service_fee_amount, late_fee_amount)
       VALUES ($1, 'PAST_DUE', 2000000, 130000, 100000, 20000, 10000)`,
      [userId],
    );
    await pool.query(
      `INSERT INTO postpaid_entries(user_id, action, amount, delta_used, used_before, used_after, cycle_month, created_at)
       VALUES
         ($1, 'SERVICE_FEE', 20000, 20000, 100000, 120000, '2026-11', '2026-11-10T08:00:00+07:00'),
         ($1, 'LATE_FEE', 10000, 10000, 120000, 130000, '2026-11', '2026-11-12T08:00:00+07:00')`,
      [userId],
    );

    const overview = await dashboardService.getOverview({
      start_date: "2026-11-01",
      end_date: "2026-11-14",
    });

    assert.deepEqual(Object.keys(overview.kpis).sort(), [
      "net_cashflow",
      "total_qr_payment",
      "total_topup",
      "total_transactions",
      "total_withdraw",
    ]);
    assert.deepEqual(overview.postpaid_revenue, {
      total_revenue: 55000,
      service_fee_revenue: 40000,
      late_fee_revenue: 15000,
      fee_tx_count: 2,
    });

    const emptyOverview = await dashboardService.getOverview({
      start_date: "2025-01-01",
      end_date: "2025-01-31",
    });
    assert.deepEqual(emptyOverview.postpaid_revenue, {
      total_revenue: 0,
      service_fee_revenue: 0,
      late_fee_revenue: 0,
      fee_tx_count: 0,
    });

    // Kiểm tra end-to-end qua Express route /api/v2/admin/dashboard/overview
    const tokens = jwt.generateAuthTokens({ id: adminId, role: "ADMIN" });
    await pool.query("UPDATE users SET refresh_token = $1 WHERE id = $2", [
      tokens.refreshToken,
      adminId,
    ]);

    const express = require("express");
    const app = express();
    app.use("/dashboard", require("../src/admin/dashboard/dashboard.routes"));
    app.use((err, req, res, _next) =>
      res.status(err.statusCode || 500).json({ message: err.message }),
    );
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");

    const resp = await fetch(
      `http://127.0.0.1:${server.address().port}/dashboard/overview?start_date=2026-11-01&end_date=2026-11-14`,
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
    );
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.deepEqual(body.data.postpaid_revenue, {
      total_revenue: 55000,
      service_fee_revenue: 40000,
      late_fee_revenue: 15000,
      fee_tx_count: 2,
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
    await target.cleanup();
  }
});
