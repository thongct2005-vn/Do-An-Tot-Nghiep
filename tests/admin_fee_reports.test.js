const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { createTestDatabase } = require('./merchant_test_database');

test('fee reporting SQL, authenticated API, growth and Excel', async t => {
  const target = await createTestDatabase();
  const pool = require('../src/config/database');
  const reports = require('../src/admin/reports/reports.service');
  const jwt = require('../src/utils/jwt');
  const m1 = randomUUID(), m2 = randomUUID(), user = randomUUID(), admin = randomUUID();
  const range = { start_date: '2026-10-31', end_date: '2026-11-01' };
  const wallet = '00000000-0000-7000-8000-000000000001';
  let server;
  async function transaction({ merchant = m1, type = 'PAYMENT', status = 'SUCCESS', amount = 500000, fee = 6000,
    at = '2026-10-31T23:59:59+07:00', feeAt = at, feeType = 'QR_FEE' } = {}) {
    const id = randomUUID();
    await pool.query('INSERT INTO transactions(id,source_user_id,destination_user_id,transaction_type,status,amount,merchant_fee,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id,user,merchant,type,status,amount,fee,at]);
    if (fee) await pool.query('INSERT INTO fee_ledger_entries(id,transaction_id,merchant_user_id,fee_type,amount,fee_wallet_user_id,fee_wallet_balance_before,fee_wallet_balance_after,created_at) VALUES ($1,$2,$3,$4,$5,$6,0,$5,$7)', [randomUUID(),id,merchant,feeType,fee,wallet,feeAt]);
    return id;
  }
  try {
    await pool.query("INSERT INTO users(id,role,full_name,created_at,api_key,secret_key) VALUES ($1,'MERCHANT','M1','2026-10-31','private-api','private-secret'),($2,'MERCHANT','M2','2026-11-01',NULL,NULL),($3,'USER','User','2026-10-31',NULL,NULL),($4,'ADMIN','Admin','2026-10-31',NULL,NULL)", [m1,m2,user,admin]);
    const p = await transaction();
    await transaction({ type: 'TRANSFER', amount: 300000, fee: 3000, at: '2026-11-01T23:59:59.999+07:00' });
    await transaction({ amount: 100000, fee: 0, at: '2026-11-01T00:00:00+07:00' });
    await transaction({ status: 'PENDING', fee: 50 });
    await transaction({ status: 'FAILED', fee: 60 });
    await transaction({ type: 'WITHDRAW', feeType: 'WITHDRAW_FEE', fee: 1000 });
    await transaction({ merchant: user, fee: 1000 });
    await transaction({ merchant: m2, amount: 200000, fee: 2000 });
    await transaction({ fee: 999, at: '2026-10-31T00:00:00+07:00', feeAt: '2026-11-02T00:00:00+07:00' });
    await pool.query('INSERT INTO fee_ledger_entries(id,transaction_id,fee_type,amount,fee_wallet_user_id,fee_wallet_balance_before,fee_wallet_balance_after,created_at) VALUES ($1,$2,\'USER_FEE\',100,$3,0,100,\'2026-11-01T12:00:00+07:00\')', [randomUUID(),p,wallet]);
    for (const [i, status] of ['SUCCESS','SUCCESS','EXPIRED','CANCELLED','PENDING'].entries()) {
      await pool.query('INSERT INTO payment_requests(id,destination_user_id,status,order_id,created_at,transaction_id) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(),m1,status,`order-${i}`,'2026-11-01T00:00:00+07:00',i === 0 ? p : null]);
    }
    await pool.query("INSERT INTO payment_requests(id,destination_user_id,status,created_at) VALUES ($1,$2,'SUCCESS','2026-11-01')", [randomUUID(),m1]);
    await pool.query("INSERT INTO payment_requests(id,destination_user_id,status,order_id,created_at) VALUES ($1,$2,'PENDING','pending-only','2026-11-01')", [randomUUID(),m2]);

    await t.test('ledger revenue and GMV are separate; zero-fee transaction counts, no fee join duplicates', async () => {
      const r = await reports.report({ ...range, merchant_id: m1 });
      assert.deepEqual(r.overview, { revenue: 9000, gross: 1400000, transactions: 4 });
      assert.deepEqual(r.breakdown.map(b => [b.type,b.revenue]), [['PAYMENT',6000],['TRANSFER',3000]]);
      const sql = await pool.query("SELECT sum(l.amount)::int revenue FROM fee_ledger_entries l JOIN transactions t ON t.id=l.transaction_id WHERE l.fee_type='QR_FEE' AND t.status='SUCCESS' AND t.destination_user_id=$1 AND t.transaction_type IN ('PAYMENT','TRANSFER') AND l.created_at >= '2026-10-31T00:00:00+07:00' AND l.created_at < '2026-11-02T00:00:00+07:00'", [m1]);
      assert.equal(r.overview.revenue, sql.rows[0].revenue);
      assert.equal((await reports.report({ ...range, merchant_id: m1, transaction_type: 'TRANSFER' })).overview.revenue, 3000);
    });
    await t.test('Vietnam buckets include end-of-day, exclude next midnight and fill empty intervals', async () => {
      const r = await reports.report({ ...range, merchant_id: m1 });
      assert.deepEqual(r.timeseries.map(b => [b.bucket,b.revenue]), [['2026-10-31',6000],['2026-11-01',3000]]);
      for (const group_by of ['day','week','month','quarter','year']) {
        const r = await reports.report({ ...range, group_by, merchant_id: m1 });
        assert.equal(r.timeseries.reduce((s,b) => s+b.revenue,0), 9000);
      }
      const empty = await reports.report({ start_date: '2025-01-01', end_date: '2025-01-03' });
      assert.equal(empty.timeseries.length, 3); assert.ok(empty.timeseries.every(b => b.revenue === 0));
      assert.deepEqual(empty.overview, { revenue: 0, gross: 0, transactions: 0 });
    });
    await t.test('Gateway cohort uses order_id and resolved denominator, with null for pending-only', async () => {
      const r = await reports.report({ ...range, merchant_id: m1 });
      assert.deepEqual(r.gateway, { total:5,success:2,expired:1,cancelled:1,pending:1,failed:0,resolved:4,success_rate:50 });
      assert.equal((await reports.report({ ...range, merchant_id: m2 })).gateway.success_rate, null);
    });
    await t.test('growth excludes admin/system/pending and handles previous zero', async () => {
      const r = await reports.growth(range);
      assert.deepEqual(r.accounts.map(a => [a.role,a.current,a.previous,a.growth_percent]), [['USER',1,0,null],['MERCHANT',2,0,null]]);
      assert.equal(r.transactions.current_count, 7);
      assert.equal(r.transactions.previous_count, 0); assert.equal(r.transactions.count_growth_percent, null);
      assert.equal((await reports.growth({ ...range, role: 'MERCHANT' })).accounts.length, 1);
    });
    const tokens = jwt.generateAuthTokens({ id: admin, role: 'ADMIN' });
    await pool.query('UPDATE users SET refresh_token=$1 WHERE id=$2', [tokens.refreshToken,admin]);
    const express = require('express'), app = express();
    app.use('/reports', require('../src/admin/reports/reports.routes'));
    app.use((e,req,res,next) => res.status(e.statusCode || 500).json({ message:e.message }));
    server = app.listen(0,'127.0.0.1'); await once(server,'listening');
    const url = `http://127.0.0.1:${server.address().port}/reports`;
    const headers = { Authorization:`Bearer ${tokens.accessToken}` };
    await t.test('all report APIs enforce ADMIN session and validate filters', async () => {
      for (const endpoint of ['overview','timeseries','breakdown','payment-requests','growth','logins','export']) {
        assert.equal((await fetch(`${url}/${endpoint}`)).status,401);
        const token = jwt.generateAuthTokens({ id:user,role:'USER' }).accessToken;
        assert.equal((await fetch(`${url}/${endpoint}`, { headers:{Authorization:`Bearer ${token}`} })).status,403);
      }
      for (const filter of ['start_date=bad','group_by=hour','merchant_id=bad','transaction_type=WITHDRAW','page=0','limit=101']) {
        assert.equal((await fetch(`${url}/overview?${filter}`, {headers})).status,400,filter);
      }
      assert.equal((await fetch(`${url}/overview?${new URLSearchParams(range)}`, {headers})).status,200);
    });
    await t.test('more than 100 merchants aggregate in DB; pagination does not truncate Excel', async () => {
      await pool.query("INSERT INTO users(id,role,full_name,created_at) SELECT gen_random_uuid(),'MERCHANT','Large '||n,'2026-10-31' FROM generate_series(1,105) n");
      await pool.query("INSERT INTO transactions(id,transaction_type,destination_user_id,amount,status,created_at) SELECT 'bulk-'||id,'PAYMENT',id,1000,'SUCCESS','2026-11-01' FROM users WHERE full_name LIKE 'Large %'");
      const r = await reports.report({ ...range, limit:'1',page:'2' });
      assert.equal(r.merchants.length,1); assert.equal(r.total_merchants,107); assert.equal(r.overview.transactions,110);
      const exported = await fetch(`${url}/export?${new URLSearchParams({...range,limit:'1',page:'2'})}`, {headers});
      assert.equal(exported.status,200);
      const book = new (require('exceljs').Workbook)(); await book.xlsx.load(Buffer.from(await exported.arrayBuffer()));
      assert.equal(book.getWorksheet('Merchant').rowCount,108);
      assert.equal(book.getWorksheet('Tong hop').getCell('B7').value,r.overview.revenue);
      let text=''; book.eachSheet(s => s.eachRow(row => {text+=JSON.stringify(row.values);}));
      assert.ok(!text.includes('private-secret') && !text.includes('private-api') && !text.includes(tokens.accessToken));
      const f = reports.filters(range);
      const plan = await pool.query('EXPLAIN (ANALYZE, FORMAT JSON) '+reports.REPORT_SQL,[f.startInstant,f.nextDayInstant,null,null,'day',20,0]);
      assert.ok(plan.rows[0]['QUERY PLAN'][0]['Execution Time'] < 10000);
    });
  } finally { if(server) await new Promise(r=>server.close(r)); await pool.end(); await target.cleanup(); }
});
