const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createTestDatabase } = require("./merchant_test_database");

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

test("App Mobile & Merchant Core Coexistence: v1 + v2 parallel triggers keep flows accurate and low-latency", async (t) => {
  const target = await createTestDatabase();
  Object.assign(process.env, {
    SYSTEM_FEE_WALLET_ID: "00000000-0000-7000-8000-000000000001",
    SYSTEM_FEE_WALLET_PHONE: "SYS_FEE_01",
  });

  const pool = require("../src/config/database");
  const txRepo = require("../src/modules/transaction/transaction.repository");
  const gatewayRepo = require("../src/modules/merchant/shared/paymentRequest/paymentRequest.repository");
  const { disableV2Triggers, enableV2TriggersAndReconcile } = require("../scripts/emergency_v2_triggers");

  const payerId = randomUUID();
  const receiverId = randomUUID();
  const merchantId = randomUUID();

  try {
    await pool.query(
      `INSERT INTO public.users (id, role, full_name, phone, balance, status)
       VALUES
         ($1, 'USER', 'Mobile Payer', '0988000001', 500000000, 'ACTIVE'),
         ($2, 'USER', 'Mobile Receiver', '0988000002', 0, 'ACTIVE'),
         ($3, 'MERCHANT', 'Merchant Shop', '0988000003', 0, 'ACTIVE')`,
      [payerId, receiverId, merchantId]
    );

    await pool.query(
      `INSERT INTO public.user_kyc (id, user_id, status, created_at, updated_at)
       VALUES ($1, $2, 'APPROVED', NOW(), NOW())`,
      [`KYC_${payerId.slice(0, 8)}`, payerId]
    );

    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uk_coexist_tx_idem ON public.transactions (idempotency_key) WHERE idempotency_key IS NOT NULL`
    );

    // Apply current live v1 triggers (20261116 + 20261124) and set finite watermarks before NOW()
    await pool.query(
      fs.readFileSync(path.join(__dirname, "../migrations/20261116_dashboard_tx_hourly_rollup.sql"), "utf8")
    );
    await pool.query(
      fs.readFileSync(path.join(__dirname, "../migrations/20261124_report_hybrid_rollup.sql"), "utf8")
    );
    await pool.query(`
      UPDATE public.dashboard_rollup_state SET rollup_until = DATE_TRUNC('hour', NOW() - INTERVAL '1 hour') WHERE id = 1;
      UPDATE public.report_rollup_state SET rollup_until = DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh' WHERE id = 1;
    `);

    async function runAppTransfer() {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await txRepo.executeTransfer(client, {
          sourceUserId: payerId,
          destinationUserId: receiverId,
          amount: 10000,
          idempotencyKey: `P2P_${randomUUID()}`,
        });
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    }

    async function runMerchantQrPayment(amt = 25000) {
      const reqRow = await gatewayRepo.insertMerchantPaymentRequest({
        id: randomUUID(),
        referenceCode: `REF_${randomUUID().slice(0, 12)}`,
        destinationUserId: merchantId,
        amount: amt,
        orderId: `ORD_${randomUUID().slice(0, 12)}`,
        credentialsRevision: "0",
      });
      const paid = await txRepo.processQRPayment({
        sourceUserId: payerId,
        referenceCode: reqRow.reference_code,
        transactionType: "PAYMENT",
        idempotencyKey: `QR_${randomUUID()}`,
      });
      return { reqRow, paid };
    }

    // 1. Baseline end-to-end Core flows (v1 triggers only)
    const baseTransferTimes = [];
    const baseQrTimes = [];
    const N = 25;
    for (let i = 0; i < N; i += 1) {
      const t0 = performance.now();
      await runAppTransfer();
      baseTransferTimes.push(performance.now() - t0);

      const t1 = performance.now();
      await runMerchantQrPayment(25000);
      baseQrTimes.push(performance.now() - t1);
    }

    // 2. Attach Trigger v2 alongside Trigger v1 (Step 5B production coexistence state)
    await pool.query(
      fs.readFileSync(path.join(__dirname, "../migrations/20261129_additive_schema_v2_rollup.sql"), "utf8")
    );
    await pool.query(`
      UPDATE public.aggregation_rollup_state
      SET rollup_until = DATE_TRUNC('hour', NOW() - INTERVAL '1 hour')
      WHERE domain = 'dashboard';
      UPDATE public.aggregation_rollup_state
      SET rollup_until = DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'
      WHERE domain = 'report_merchant';
    `);

    const coexTransferTimes = [];
    const coexQrTimes = [];
    for (let i = 0; i < N; i += 1) {
      const t0 = performance.now();
      await runAppTransfer();
      coexTransferTimes.push(performance.now() - t0);

      const t1 = performance.now();
      await runMerchantQrPayment(25000);
      coexQrTimes.push(performance.now() - t1);
    }

    // 3. Concurrent burst writes + simultaneous emergency disable & reconcile check
    await Promise.all([
      runAppTransfer(),
      runAppTransfer(),
      runMerchantQrPayment(30000),
      runMerchantQrPayment(30000),
    ]);

    // Verify exact wallet balances, ledger entries, and payment_request states
    const balRes = await pool.query(
      `SELECT id, balance::bigint AS bal FROM public.users WHERE id = ANY($1::uuid[])`,
      [[payerId, receiverId, merchantId, "00000000-0000-7000-8000-000000000001"]]
    );
    const balMap = Object.fromEntries(balRes.rows.map((r) => [r.id, Number(r.bal)]));
    const feeCountRes = await pool.query(
      `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(amount), 0)::bigint AS sum_fee FROM public.fee_ledger_entries WHERE fee_type = 'QR_FEE'`
    );
    const prPaidRes = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM public.payment_requests WHERE status = 'PAID' OR status = 'SUCCESS'`
    );

    const totalTransfers = N * 2 + 2; // 52 P2P transfers of 10,000
    const totalQrGross = N * 2 * 25000 + 2 * 30000; // 1,310,000
    assert.equal(balMap[receiverId], totalTransfers * 10000);
    assert.equal(balMap["00000000-0000-7000-8000-000000000001"], Number(feeCountRes.rows[0].sum_fee));
    assert.equal(balMap[merchantId], totalQrGross - Number(feeCountRes.rows[0].sum_fee));
    assert.equal(prPaidRes.rows[0].cnt, N * 2 + 2);

    // 4. Verify emergency trigger disable + re-enable never blocks/breaks subsequent App/Merchant writes
    await disableV2Triggers(pool);
    await runAppTransfer();
    await runMerchantQrPayment(15000);
    await enableV2TriggersAndReconcile(pool, { silent: true });
    await runAppTransfer();

    const baseP50 = percentile(baseQrTimes, 0.5);
    const coexP50 = percentile(coexQrTimes, 0.5);
    const baseTxP95 = percentile(baseTransferTimes, 0.95);
    const coexTxP95 = percentile(coexTransferTimes, 0.95);

    console.log("App/Merchant coexistence latency (ms):", {
      transferBaseP50: Number(percentile(baseTransferTimes, 0.5).toFixed(2)),
      transferCoexP50: Number(percentile(coexTransferTimes, 0.5).toFixed(2)),
      transferBaseP95: Number(baseTxP95.toFixed(2)),
      transferCoexP95: Number(coexTxP95.toFixed(2)),
      qrBaseP50: Number(baseP50.toFixed(2)),
      qrCoexP50: Number(coexP50.toFixed(2)),
      qrBaseP95: Number(percentile(baseQrTimes, 0.95).toFixed(2)),
      qrCoexP95: Number(percentile(coexQrTimes, 0.95).toFixed(2)),
    });

    assert.ok(coexP50 - baseP50 < 10, `Unexpected QR P50 regression: base=${baseP50}, coex=${coexP50}`);
    assert.ok(coexTxP95 - baseTxP95 < 15, `Unexpected Transfer P95 regression: base=${baseTxP95}, coex=${coexTxP95}`);
  } finally {
    await pool.end();
    await target.cleanup();
  }
});
