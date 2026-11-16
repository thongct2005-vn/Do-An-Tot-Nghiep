const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { createTestDatabase } = require('./merchant_test_database');
const cases = require('./fixtures/merchant_fee_reference.json');

test('invoice policy deployment and config restore preserve history and unrelated fees', async () => {
  const target = await createTestDatabase(); const db = new Client(target.config);
  try {
    await db.connect();
    const calculate = require('../src/modules/fee/feeCalculator').calculateMerchantInvoiceFeeDetails;
    const migration = fs.readFileSync(path.join(__dirname, '../migrations/20261120_merchant_invoice_fee_config.sql'), 'utf8');
    const oldRows = (await db.query('SELECT * FROM system_configs ORDER BY key')).rows;
    const old = oldRows.find(r => r.key === 'MERCHANT_FEE_CONFIG');
    await db.query("INSERT INTO transactions(id,transaction_type,amount,merchant_fee,status) VALUES ('historical','PAYMENT',500000,5000,'SUCCESS')");
    const historic = (await db.query("SELECT * FROM transactions WHERE id='historical'")).rows[0];
    await db.query(migration); await db.query(migration);
    const current = (await db.query("SELECT value FROM system_configs WHERE key='MERCHANT_FEE_CONFIG'")).rows[0].value;
    for (const c of cases) assert.equal(calculate(c.amount, current).fee_amount, c.fee);
    for (const key of Object.keys(old.value).filter(k => !['rate_bps','tiers','min_fee','max_fee','free_threshold_amount'].includes(k))) assert.deepEqual(current[key], old.value[key]);
    assert.deepEqual((await db.query("SELECT * FROM system_configs WHERE key<>'MERCHANT_FEE_CONFIG' ORDER BY key")).rows, oldRows.filter(r => r.key !== old.key));
    await db.query('BEGIN');
    await db.query('UPDATE system_configs SET value=$1,description=$2,updated_by=$3,updated_at=$4 WHERE key=$5', [JSON.stringify(old.value), old.description, old.updated_by, old.updated_at, old.key]);
    await db.query('COMMIT');
    assert.deepEqual((await db.query('SELECT * FROM system_configs ORDER BY key')).rows, oldRows);
    assert.deepEqual((await db.query("SELECT * FROM transactions WHERE id='historical'")).rows[0], historic);
  } finally { await db.end(); await target.cleanup(); }
});
