const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { createTestDatabase } = require('./merchant_test_database');

test('snapshot migration is additive, repeatable, constrained and safely reversible before use', async () => {
  const target = await createTestDatabase();
  const db = new Client(target.config);
  const up = fs.readFileSync(path.join(__dirname, '../migrations/20261119_payment_request_merchant_fee_snapshot.sql'), 'utf8');
  const down = fs.readFileSync(path.join(__dirname, '../migrations/rollback/20261119_payment_request_merchant_fee_snapshot.sql'), 'utf8');
  try {
    await db.connect();
    await db.query(down);
    const id = randomUUID();
    await db.query("INSERT INTO payment_requests(id,amount,status) VALUES ($1,500000,'SUCCESS')", [id]);
    await db.query("INSERT INTO transactions(id,amount,transaction_type,status,merchant_fee) VALUES ('old-fee',500000,'PAYMENT','SUCCESS',5000)");
    const old = (await db.query('SELECT * FROM payment_requests WHERE id=$1', [id])).rows[0];
    const oldTx = (await db.query("SELECT * FROM transactions WHERE id='old-fee'")).rows[0];
    await db.query(up);
    await db.query(up);
    await db.query('ALTER TABLE payment_requests VALIDATE CONSTRAINT payment_requests_merchant_fee_snapshot_check');
    const row = (await db.query('SELECT * FROM payment_requests WHERE id=$1', [id])).rows[0];
    assert.deepEqual(row, { ...old, merchant_fee_amount_snapshot: null, merchant_fee_rule_snapshot: null });
    for (const [fee, rule] of [[-1, {}], [500001, {}], [100, null], [null, {}], [100, []], [100, 'bad']]) {
      await assert.rejects(db.query('UPDATE payment_requests SET merchant_fee_amount_snapshot=$2,merchant_fee_rule_snapshot=$3 WHERE id=$1',
        [id, fee, rule === null ? null : JSON.stringify(rule)]), { code: '23514' });
    }
    await db.query(down);
    assert.deepEqual((await db.query('SELECT * FROM payment_requests WHERE id=$1', [id])).rows[0], old);
    assert.deepEqual((await db.query("SELECT * FROM transactions WHERE id='old-fee'")).rows[0], oldTx);
    await db.query(up);
    await db.query("UPDATE payment_requests SET merchant_fee_amount_snapshot=6000,merchant_fee_rule_snapshot='{}' WHERE id=$1", [id]);
    await assert.rejects(db.query(down), /Fee snapshots exist/);
    await db.query('ROLLBACK');
    assert.equal((await db.query('SELECT merchant_fee_amount_snapshot FROM payment_requests WHERE id=$1', [id])).rows[0].merchant_fee_amount_snapshot, '6000');
  } finally {
    await db.end();
    await target.cleanup();
  }
});
