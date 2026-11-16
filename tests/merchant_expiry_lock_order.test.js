const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createTestDatabase } = require('./merchant_test_database');

test('expiry skips a locked Merchant before locking request or inserting webhook FK', async () => {
  const target = await createTestDatabase();
  const pool = require('../src/config/database');
  const webhook = require('../src/modules/webhook/webhook.repository');
  const merchant = randomUUID(), request = randomUUID();
  const holder = await pool.connect(), worker = await pool.connect();
  try {
    await pool.query("INSERT INTO users(id,role) VALUES ($1,'MERCHANT')", [merchant]);
    await pool.query("INSERT INTO payment_requests(id,destination_user_id,order_id,amount,expires_at) VALUES ($1,$2,'locked-order',500000,now()-interval '1 minute')", [request,merchant]);
    await holder.query('BEGIN'); await holder.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [merchant]);
    await worker.query('BEGIN'); await worker.query("SET LOCAL statement_timeout='1000ms'");
    assert.equal(await webhook.expireDuePayments(worker,{merchantId:merchant}),0);
    // Prior request-first query blocked on the webhook's users FK here and could deadlock rotation.
    await holder.query('SELECT id FROM payment_requests WHERE id=$1 FOR UPDATE NOWAIT',[request]);
    await worker.query('COMMIT'); await holder.query('COMMIT');
    assert.equal(await webhook.expireDuePayments(pool,{merchantId:merchant}),1);
    assert.equal((await pool.query('SELECT status FROM payment_requests WHERE id=$1',[request])).rows[0].status,'FAILED');
    assert.equal((await pool.query('SELECT count(*)::int n FROM webhook_deliveries WHERE payment_request_id=$1',[request])).rows[0].n,1);
  } finally {
    await holder.query('ROLLBACK'); await worker.query('ROLLBACK');
    holder.release();worker.release();await pool.end();await target.cleanup();
  }
});
