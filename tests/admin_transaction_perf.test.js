const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createTestDatabase } = require("./merchant_test_database");

test("transaction repository optimizations: hybrid countTransactions, 42P01 fallback, and early paged_tx CTE", async (t) => {
  const target = await createTestDatabase();
  const pool = require("../src/config/database");
  const repo = require("../src/admin/transaction/transaction.repository");
  const { advanceRollupCutoff } = require("../src/admin/dashboard/dashboardRollup");

  try {
    const u1 = randomUUID();
    const u2 = randomUUID();
    const admin = randomUUID();
    await pool.query(
      "INSERT INTO users(id, role, full_name, phone, created_at) VALUES ($1,'USER','Sender One','0901111111','2026-10-01'),($2,'MERCHANT','Recv One','0902222222','2026-10-01'),($3,'ADMIN','Admin Op','0909999999','2026-10-01')",
      [u1, u2, admin],
    );

    const tx1 = `TX-${randomUUID().slice(0, 8)}`;
    const tx2 = `TX-${randomUUID().slice(0, 8)}`;
    const tx3 = `TX-${randomUUID().slice(0, 8)}`;
    const tx4 = `TX-${randomUUID().slice(0, 8)}`;

    await pool.query(
      `INSERT INTO transactions(id, source_user_id, destination_user_id, transaction_type, status, amount, created_at)
       VALUES
         ($1, $5, $6, 'TRANSFER', 'SUCCESS', 100000, '2026-11-10T03:00:00+07:00'),
         ($2, $5, $6, 'PAYMENT', 'PENDING', 200000, '2026-11-10T04:00:00+07:00'),
         ($3, NULL, $6, 'TOPUP', 'SUCCESS', 500000, '2026-11-11T05:00:00+07:00'),
         ($4, $5, $6, 'TRANSFER', 'SUCCESS', 15000000, '2026-11-16T02:00:00+07:00')`,
      [tx1, tx2, tx3, tx4, u1, u2],
    );

    // Two audit records for tx1 to ensure DISTINCT ON returns only 1 row with latest admin_id
    await pool.query(
      `INSERT INTO admin_user_change_history(id, admin_id, user_id, action, reason, new_values, created_at)
       VALUES
         ($1, $3, $4, 'ADMIN_OP_P2P', 'first reason', $5::jsonb, '2026-11-10T03:01:00+07:00'),
         ($2, $3, $4, 'ADMIN_OP_P2P', 'second reason', $5::jsonb, '2026-11-10T03:02:00+07:00')`,
      [randomUUID(), randomUUID(), admin, u1, JSON.stringify({ transaction_id: tx1 })],
    );

    const startDate = new Date("2026-11-01T00:00:00+07:00");
    const endDate = new Date("2026-11-20T00:00:00+07:00");

    await t.test("42P01 fallback before dashboard_tx_hourly migration exists", async () => {
      const cnt = await repo.countTransactions({
        type: "ALL",
        status: "ALL",
        initiatedBy: "ALL",
        anomaly: "ALL",
        keyword: "",
        startDate,
        endDate,
      });
      assert.equal(cnt, 4);

      const items = await repo.getTransactions({
        type: "ALL",
        status: "ALL",
        initiatedBy: "ALL",
        anomaly: "ALL",
        keyword: "",
        startDate,
        endDate,
        limit: 10,
        offset: 0,
      });
      assert.equal(items.length, 4);
      const row1 = items.find((i) => i.id === tx1);
      assert.equal(row1.initiator_role, "ADMIN");
      assert.equal(row1.admin_id, admin);
      assert.equal(row1.admin_name, "Admin Op");
    });

    await t.test("countTransactions uses dashboard_tx_hourly + tail cleanly and matches filters 100%", async () => {
      const dashDdl = fs.readFileSync(
        path.join(__dirname, "../migrations/20261116_dashboard_tx_hourly_rollup.sql"),
        "utf8",
      );
      await pool.query(dashDdl);
      await pool.query(
        `UPDATE public.dashboard_rollup_state SET rollup_until = '2026-11-01T00:00:00+07:00' WHERE id = 1`,
      );
      await advanceRollupCutoff(pool);

      const totalAll = await repo.countTransactions({
        type: "ALL",
        status: "ALL",
        initiatedBy: "ALL",
        anomaly: "ALL",
        keyword: "",
        startDate,
        endDate,
      });
      assert.equal(totalAll, 4);

      const totalTransferSuccess = await repo.countTransactions({
        type: "TRANSFER",
        status: "SUCCESS",
        initiatedBy: "ALL",
        anomaly: "ALL",
        keyword: "",
        startDate,
        endDate,
      });
      assert.equal(totalTransferSuccess, 2);

      // Specific filters still yield accurate counts & rows
      const adminCount = await repo.countTransactions({
        type: "ALL",
        status: "ALL",
        initiatedBy: "ADMIN",
        anomaly: "ALL",
        keyword: "",
        startDate,
        endDate,
      });
      assert.equal(adminCount, 1);

      const adminRows = await repo.getTransactions({
        type: "ALL",
        status: "ALL",
        initiatedBy: "ADMIN",
        anomaly: "ALL",
        keyword: "",
        startDate,
        endDate,
        limit: 10,
        offset: 0,
      });
      assert.equal(adminRows.length, 1);
      assert.equal(adminRows[0].id, tx1);

      const highValCount = await repo.countTransactions({
        type: "ALL",
        status: "ALL",
        initiatedBy: "ALL",
        anomaly: "HIGH_VALUE_TX",
        keyword: "",
        startDate,
        endDate,
      });
      assert.equal(highValCount, 1);

      const kwRows = await repo.getTransactions({
        type: "ALL",
        status: "ALL",
        initiatedBy: "ALL",
        anomaly: "ALL",
        keyword: "Sender One",
        startDate,
        endDate,
        limit: 10,
        offset: 0,
      });
      assert.equal(kwRows.length, 3);
    });
  } finally {
    await pool.end();
    await target.cleanup();
  }
});
