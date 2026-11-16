const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { createTestDatabase } = require('./merchant_test_database');
const cases = require('./fixtures/merchant_fee_reference.json');

test('Merchant fee HTTP and PostgreSQL settlement', async t => {
  const target = await createTestDatabase();
  Object.assign(process.env, { SYSTEM_FEE_WALLET_ID: '00000000-0000-7000-8000-000000000001', SYSTEM_FEE_WALLET_PHONE: 'SYS_FEE_01' });
  const pool = require('../src/config/database');
  const gateway = require('../src/modules/merchant/shared/paymentRequest/paymentRequest.repository');
  const tx = require('../src/modules/transaction/transaction.repository');
  const fees = require('../src/modules/merchant/production/fee/fee.service');
  const limits = require('../src/utils/limitsDb');
  const calculator = require('../src/modules/fee/feeCalculator');
  const jwt = require('../src/utils/jwt');
  let server;
  const merchant = randomUUID(), payer = randomUUID(), admin = randomUUID();
  const tiers = [{ from_amount: 0, rate_bps: 150 }, { from_amount: 200001, rate_bps: 120 }, { from_amount: 1000001, rate_bps: 100 }];
  let baseline;
  async function setConfig(config) {
    await pool.query("UPDATE system_configs SET value=$1 WHERE key='MERCHANT_FEE_CONFIG'", [JSON.stringify(config)]);
  }
  async function order(extra = {}) {
    return gateway.insertMerchantPaymentRequest({ id: randomUUID(), referenceCode: randomUUID(), destinationUserId: merchant,
      amount: 500000, orderId: randomUUID(), credentialsRevision: '0', ...extra });
  }
  async function row(id) { return (await pool.query('SELECT * FROM payment_requests WHERE id=$1', [id])).rows[0]; }
  async function balances() { return (await pool.query('SELECT id,balance FROM users ORDER BY id')).rows; }
  async function settle(p) { return tx.processQRPayment({ sourceUserId: payer, referenceCode: p.reference_code, transactionType: 'PAYMENT', idempotencyKey: randomUUID() }); }
  async function direct(idempotencyKey = randomUUID()) {
    const c = await pool.connect();
    try { await c.query('BEGIN'); const result = await tx.executeTransfer(c, { sourceUserId: payer, destinationUserId: merchant, amount: 500000, idempotencyKey }); await c.query('COMMIT'); return result; }
    catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  async function request(path, { token, method = 'GET', body } = {}) {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json() };
  }
  try {
    await pool.query("INSERT INTO users(id,role,balance,api_key,secret_key) VALUES ($1,'MERCHANT',0,'test-api','test-secret'),($2,'USER',50000000,NULL,NULL),($3,'ADMIN',0,NULL,NULL)", [merchant, payer, admin]);
    await pool.query('CREATE UNIQUE INDEX fee_test_idempotency ON transactions(idempotency_key)');
    await pool.query("INSERT INTO system_configs(key,value) VALUES ('WALLET_CAPACITY_CONFIG',$1) ON CONFLICT(key) DO NOTHING", [JSON.stringify({
      USER: { min_capacity: 1000000, default_capacity: 100000000, max_capacity: 1000000000 },
      MERCHANT: { min_capacity: 1000000, default_capacity: 100000000, max_capacity: 1000000000 },
    })]);
    await pool.query('CREATE TABLE payment_request_items(id uuid PRIMARY KEY,payment_request_id uuid REFERENCES payment_requests(id),product_id text,name text,quantity int,unit_price bigint,description text)');
    baseline = { ...(await pool.query("SELECT value FROM system_configs WHERE key='MERCHANT_FEE_CONFIG'")).rows[0].value, rate_bps: 150, tiers };
    await setConfig(baseline);
    const adminTokens = jwt.generateAuthTokens({ id: admin, role: 'ADMIN' });
    await pool.query('UPDATE users SET refresh_token=$1 WHERE id=$2', [adminTokens.refreshToken, admin]);
    const merchantToken = jwt.generateAuthTokens({ id: merchant, role: 'MERCHANT' }).accessToken;
    const userToken = jwt.generateAuthTokens({ id: payer, role: 'USER' }).accessToken;
    const express = require('express'), app = express(); app.use(express.json());
    app.use('/admin/merchants', require('../src/admin/merchants/merchants.routes'));
    app.use('/requests', require('../src/modules/paymentRequest/paymentRequest.routes'));
    app.use('/reports', require('../src/admin/reports/reports.routes'));
    app.use('/dashboard', require('../src/admin/dashboard/dashboard.routes'));
    app.use((e, req, res, next) => res.status(e.statusCode || 500).json({ message: e.message }));
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');

    await t.test('Admin preview equals calculator, preserves outbound and withdraw, denies non-admin', async () => {
      const path = '/admin/merchants/fee-config/default/preview';
      for (const token of [undefined, userToken, merchantToken]) {
        const r = await request(path, { method: 'POST', token, body: { config: {}, sample_amounts: [500000] } });
        assert.ok([401, 403].includes(r.status), JSON.stringify(r));
      }
      const r = await request(path, { method: 'POST', token: adminTokens.accessToken, body: { config: {}, sample_amounts: cases.map(c => c.amount) } });
      assert.equal(r.status, 200, JSON.stringify(r));
      for (const [i, item] of r.body.data.simulation.entries()) {
        assert.equal(item.qr_payment.new_fee, cases[i].fee);
        assert.equal(item.qr_payment.new_net, cases[i].net);
        assert.equal(item.transfer_outbound.new_fee, calculator.calculateMerchantTransferFeeDetails(item.amount, baseline).fee_amount);
        assert.equal(item.withdraw.new_fee, calculator.calculateWithdrawFeeDetails(item.amount, baseline).fee_amount);
      }
    });

    await t.test('Admin validates tier order/rates and audits concurrent updates atomically', async () => {
      const path = '/admin/merchants/fee-config/default';
      for (const config of [{ tiers: [...tiers].reverse() }, { tiers: [{ from_amount: 0, rate_bps: 10001 }] }, { tiers: [tiers[0], tiers[0]] }]) {
        const before = (await pool.query("SELECT value FROM system_configs WHERE key='MERCHANT_FEE_CONFIG'")).rows[0].value;
        assert.equal((await request(path, { method: 'PUT', token: adminTokens.accessToken, body: { config, reason: 'Invalid policy test' } })).status, 400);
        assert.deepEqual((await pool.query("SELECT value FROM system_configs WHERE key='MERCHANT_FEE_CONFIG'")).rows[0].value, before);
      }
      const admin2 = randomUUID();
      await pool.query("INSERT INTO users(id,role) VALUES ($1,'ADMIN')", [admin2]);
      const tokens2 = jwt.generateAuthTokens({ id: admin2, role: 'ADMIN' });
      await pool.query('UPDATE users SET refresh_token=$1 WHERE id=$2', [tokens2.refreshToken, admin2]);
      const results = await Promise.all([adminTokens.accessToken, tokens2.accessToken].map((token, i) => request(path,
        { token, method: 'PUT', body: { config: { min_fee: 201 + i }, reason: `Concurrent Admin ${i}` } })));
      assert.ok(results.every(r => r.status === 200), JSON.stringify(results));
      const first = results.find(r => r.body.data.old_config.min_fee === 200);
      const second = results.find(r => r !== first);
      assert.equal(second.body.data.old_config.min_fee, first.body.data.new_config.min_fee);
      const history = await request('/admin/merchants/fee-config/history', { token: adminTokens.accessToken });
      assert.equal(history.status, 200); assert.equal(history.body.data.items.length, 2);
      assert.deepEqual(new Set(history.body.data.items.map(r => r.admin.id)), new Set([admin, admin2]));
      for (const r of history.body.data.items) { assert.match(r.reason, /Concurrent Admin/); assert.ok(r.old_values.config); assert.ok(r.new_values.config); }
      for (const token of [userToken, merchantToken]) assert.equal((await request('/admin/merchants/fee-config/history', { token })).status, 403);
      await setConfig(baseline);
      await pool.query("CREATE FUNCTION fee_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit test fault'; END $$");
      await pool.query('CREATE TRIGGER fee_audit_fault BEFORE INSERT ON admin_user_change_history FOR EACH ROW EXECUTE FUNCTION fee_audit_fault()');
      try {
        assert.equal((await request(path, { method: 'PUT', token: adminTokens.accessToken, body: { config: { min_fee: 999 }, reason: 'Rollback audit test' } })).status, 500);
        assert.deepEqual((await pool.query("SELECT value FROM system_configs WHERE key='MERCHANT_FEE_CONFIG'")).rows[0].value, baseline);
      } finally { await pool.query('DROP TRIGGER fee_audit_fault ON admin_user_change_history'); await pool.query('DROP FUNCTION fee_audit_fault()'); }
    });

    await t.test('App dynamic QR snapshots Merchant only and ignores client fees', async () => {
      for (const [token, isMerchant] of [[merchantToken, true], [userToken, false]]) {
        const r = await request('/requests/qr/dynamic', { method: 'POST', token,
          body: { amount: 500000, merchant_fee_amount_snapshot: 0, merchant_fee_rule_snapshot: { rate_bps: 0 } } });
        assert.equal(r.status, 200, JSON.stringify(r));
        const saved = await row(r.body.data.id);
        assert.equal(saved.merchant_fee_amount_snapshot, isMerchant ? '6000' : null);
        assert.equal(saved.merchant_fee_rule_snapshot?.merchant_user_id ?? null, isMerchant ? merchant : null);
      }
    });

    await t.test('Gateway snapshot, items and audit are atomic; invalid/missing config fails closed', async () => {
      const item = { id: randomUUID(), productId: 'p', name: 'Product', quantity: 1, unitPrice: 500000 };
      const p = await order({ items: [item], merchant_fee_amount_snapshot: 0 });
      assert.equal((await row(p.id)).merchant_fee_amount_snapshot, '6000');
      assert.equal((await pool.query('SELECT count(*)::int n FROM payment_request_items WHERE payment_request_id=$1', [p.id])).rows[0].n, 1);
      for (const config of [{}, { ...baseline, min_fee: -1 }, { ...baseline, tiers: [...tiers].reverse() }, null]) {
        if (config === null) await pool.query("DELETE FROM system_configs WHERE key='MERCHANT_FEE_CONFIG'"); else await setConfig(config);
        const id = randomUUID();
        await assert.rejects(order({ id, items: [{ ...item, id: randomUUID() }] }), { statusCode: 500 });
        assert.equal(await row(id), undefined);
        assert.equal((await pool.query('SELECT count(*)::int n FROM audit_outbox WHERE payload->>\'payment_id\'=$1', [id])).rows[0].n, 0);
        await pool.query("INSERT INTO system_configs(key,value) VALUES ('MERCHANT_FEE_CONFIG',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [JSON.stringify(baseline)]);
      }
      const before = (await pool.query('SELECT count(*)::int n FROM payment_requests')).rows[0].n;
      await assert.rejects(order({ items: [item] }), { code: '23505' });
      assert.equal((await pool.query('SELECT count(*)::int n FROM payment_requests')).rows[0].n, before);
    });

    await t.test('stale RAM config does not affect QR, direct transfer or preview', async () => {
      await limits.getSystemConfig('MERCHANT_FEE_CONFIG');
      await setConfig({ ...baseline, tiers: [], rate_bps: 200 });
      assert.equal((await limits.getSystemConfig('MERCHANT_FEE_CONFIG')).rate_bps, 150);
      assert.equal((await row((await order()).id)).merchant_fee_amount_snapshot, '10000');
      const p = await fees.previewTransactionFee({ transactionType: 'PAYMENT', amount: 500000, merchantUserId: merchant });
      assert.equal(p.fee_amount, 10000);
      const result = await direct();
      assert.equal(Number(result.merchantFee), 10000);
      await setConfig(baseline);
    });

    await t.test('Admin update leaves pending snapshot unchanged; retry and concurrent payment collect once', async () => {
      const p = await order();
      const r = await request('/admin/merchants/fee-config/default', { method: 'PUT', token: adminTokens.accessToken,
        body: { config: { tiers: [], rate_bps: 200 }, reason: 'Test policy update' } });
      assert.equal(r.status, 200, JSON.stringify(r));
      assert.equal((await row((await order()).id)).merchant_fee_amount_snapshot, '10000');
      const before = await balances();
      const results = await Promise.allSettled([settle(p), settle(p)]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(results.find(r => r.status === 'rejected').reason.statusCode, 409);
      const saved = await row(p.id);
      const recorded = (await pool.query('SELECT * FROM transactions WHERE id=$1', [saved.transaction_id])).rows[0];
      assert.equal(recorded.merchant_fee, '6000'); assert.equal(recorded.net_amount, '494000');
      assert.deepEqual(recorded.fee_rate_snapshot, saved.merchant_fee_rule_snapshot);
      const after = await balances();
      const delta = id => Number(after.find(r => r.id === id).balance) - Number(before.find(r => r.id === id).balance);
      assert.equal(delta(payer), -500000); assert.equal(delta(merchant), 494000); assert.equal(delta(process.env.SYSTEM_FEE_WALLET_ID), 6000);
      assert.equal((await pool.query('SELECT count(*)::int n FROM fee_ledger_entries WHERE transaction_id=$1', [saved.transaction_id])).rows[0].n, 1);
      await assert.rejects(settle(p), { statusCode: 409 }); assert.deepEqual(await balances(), after);
      await setConfig(baseline);
    });

    await t.test('legacy and invalid snapshots reject without moving money', async () => {
      const p = await order(); const before = await balances();
      await pool.query('UPDATE payment_requests SET merchant_fee_amount_snapshot=NULL,merchant_fee_rule_snapshot=NULL WHERE id=$1', [p.id]);
      await assert.rejects(settle(p), /tạo mã QR mới/);
      assert.deepEqual(await balances(), before);
      const invalid = await order();
      await pool.query("UPDATE payment_requests SET merchant_fee_rule_snapshot=jsonb_set(merchant_fee_rule_snapshot,'{amount}','1') WHERE id=$1", [invalid.id]);
      await assert.rejects(settle(invalid), { statusCode: 409 });
      assert.deepEqual(await balances(), before);
    });

    await t.test('direct transfer uses same inbound fee, separate sender fee and unique idempotency', async () => {
      await pool.query("UPDATE system_configs SET value=jsonb_set(value,'{rate_bps}','100') WHERE key='USER_FEE_CONFIG'"); limits.invalidateLimitsCache();
      const key = randomUUID(); const result = await direct(key);
      const recorded = (await pool.query('SELECT * FROM transactions WHERE id=$1', [result.transactionId])).rows[0];
      assert.equal(recorded.merchant_fee, '6000'); assert.equal(recorded.fee, '5000');
      assert.equal(recorded.fee_rate_snapshot.pricing_model, 'MERCHANT_INVOICE_BOUNDARY_V1');
      const rows = (await pool.query('SELECT fee_type,amount FROM fee_ledger_entries WHERE transaction_id=$1 ORDER BY fee_type', [result.transactionId])).rows;
      assert.deepEqual(rows, [{ fee_type: 'QR_FEE', amount: '6000' }, { fee_type: 'USER_FEE', amount: '5000' }]);
      const before = await balances(); await assert.rejects(direct(key), { code: '23505' }); assert.deepEqual(await balances(), before);
      await pool.query("UPDATE system_configs SET value=jsonb_set(value,'{rate_bps}','0') WHERE key='USER_FEE_CONFIG'"); limits.invalidateLimitsCache();
    });

    await t.test('zero fee succeeds with no fee ledger entry', async () => {
      await setConfig({ ...baseline, tiers: [], rate_bps: 0, min_fee: 0 });
      const p = await order(); await settle(p);
      const saved = await row(p.id);
      assert.equal((await pool.query('SELECT merchant_fee,net_amount FROM transactions WHERE id=$1', [saved.transaction_id])).rows[0].net_amount, '500000');
      assert.equal((await pool.query('SELECT count(*)::int n FROM fee_ledger_entries WHERE transaction_id=$1', [saved.transaction_id])).rows[0].n, 0);
      await setConfig(baseline);
    });

    await t.test('fault at each persistence step rolls back balances, ledger, request and outboxes', async () => {
      for (const [table, event, condition] of [
        ['users', 'UPDATE', `NEW.id='${payer}'`], ['users', 'UPDATE', `NEW.id='${merchant}'`],
        ['transactions', 'INSERT', 'true'], ['fee_ledger_entries', 'INSERT', 'true'],
        ['users', 'UPDATE', `NEW.id='${process.env.SYSTEM_FEE_WALLET_ID}'`],
        ['payment_requests', 'UPDATE', "NEW.status='SUCCESS'"], ['webhook_deliveries', 'INSERT', 'true'], ['audit_outbox', 'INSERT', 'true'],
      ]) {
        const p = await order(); const before = await balances();
        const counts = async () => (await pool.query('SELECT (SELECT count(*) FROM transactions)::int tx,(SELECT count(*) FROM fee_ledger_entries)::int ledger,(SELECT count(*) FROM webhook_deliveries)::int webhook,(SELECT count(*) FROM audit_outbox)::int audit')).rows[0];
        const beforeCounts = await counts();
        await pool.query(`CREATE FUNCTION fee_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'fee test fault'; END IF; RETURN NEW; END $$`);
        await pool.query(`CREATE TRIGGER fee_fault BEFORE ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION fee_fault()`);
        try { await assert.rejects(settle(p), /fee test fault/); }
        finally { await pool.query(`DROP TRIGGER fee_fault ON ${table}`); await pool.query('DROP FUNCTION fee_fault()'); }
        assert.deepEqual(await balances(), before, table); assert.deepEqual(await counts(), beforeCounts, table);
        assert.equal((await row(p.id)).status, 'PENDING');
      }
    });
    await t.test('Admin policy to QR settlement to Dashboard, report and Excel reconcile against SQL', async () => {
      const range = require('../src/utils/adminDateRange').getCurrentMonthBoundsInVietnam();
      const query = new URLSearchParams({start_date:range.startDate,end_date:range.endDate,merchant_id:merchant});
      const r = await request(`/reports/overview?${query}`,{token:adminTokens.accessToken});
      assert.equal(r.status,200,JSON.stringify(r));
      const sql = (await pool.query("SELECT coalesce(sum(l.amount),0)::bigint revenue FROM fee_ledger_entries l JOIN transactions t ON t.id=l.transaction_id WHERE t.destination_user_id=$1 AND t.status='SUCCESS' AND l.fee_type='QR_FEE'",[merchant])).rows[0];
      assert.equal(r.body.data.overview.revenue,Number(sql.revenue));
      const volume=(await pool.query("SELECT count(*)::int n,sum(amount)::bigint gross FROM transactions WHERE destination_user_id=$1 AND status='SUCCESS'",[merchant])).rows[0];
      assert.equal(r.body.data.overview.transactions,volume.n);
      assert.equal(r.body.data.overview.gross,Number(volume.gross));
      const dash = await request(`/dashboard/overview?${query}`,{token:adminTokens.accessToken});
      assert.equal(dash.status,200,JSON.stringify(dash));
      assert.equal(Object.keys(dash.body.data.kpis).length,5);
      const qrGross=(await pool.query("SELECT sum(amount)::bigint n FROM transactions WHERE status='SUCCESS' AND transaction_type='PAYMENT'")).rows[0].n;
      assert.equal(dash.body.data.kpis.total_qr_payment,Number(qrGross));
      // The Dashboard fee card reads this same reports endpoint independently of its five cashflow KPIs.
      const buf=await require('../src/admin/reports/reports.service').exportReport(Object.fromEntries(query));
      const book=new (require('exceljs').Workbook)();await book.xlsx.load(buf);
      assert.equal(book.getWorksheet('Tong hop').getCell('B7').value,Number(sql.revenue));
      assert.equal(book.getWorksheet('Tong hop').getCell('B8').value,Number(volume.gross));
      const empty=await request('/reports/overview?start_date=2025-01-01&end_date=2025-01-01',{token:adminTokens.accessToken});
      assert.deepEqual(empty.body.data.overview,{revenue:0,gross:0,transactions:0});
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end(); await target.cleanup();
  }
});
