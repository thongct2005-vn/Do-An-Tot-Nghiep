const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { createTestDatabase } = require('./merchant_test_database');

describe('Merchant status audit migration / isolated PostgreSQL', {
  skip: process.env.MERCHANT_INTEGRATION_TEST !== '1',
}, () => {
  let database, db;
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/20261111_merchant_status_audit_actions.sql'), 'utf8');
  before(async () => {
    database = await createTestDatabase();
    db = new Client(database.config);
    await db.connect();
  });
  after(async () => {
    try { if (db) await db.end(); }
    finally { if (database) await database.cleanup(); }
  });
  async function insert(action) {
    await db.query('INSERT INTO admin_user_change_history(action,reason) VALUES($1,$2)', [action, 'Test audit action']);
  }
  it('fresh test schema accepts both Merchant actions and all legacy actions', async () => {
    for (const action of ['MERCHANT_BLOCKED','MERCHANT_UNBLOCKED','USER_PROFILE_UPDATED','USER_BLOCKED',
      'USER_UNBLOCKED','USER_LOGIN_UNLOCKED','USER_SESSIONS_REVOKED','USER_QR_REGENERATED',
      'ADMIN_OP_P2P','ADMIN_OP_TOPUP','ADMIN_OP_WITHDRAW','DISPUTE_OPENED','DISPUTE_UPDATED','DISPUTE_RESOLVED']) {
      await insert(action);
    }
    await assert.rejects(insert('UNKNOWN_ACTION'), { code: '23514' });
  });
  it('extends a restrictive deployed constraint, preserves extra actions, and is repeatable', async () => {
    await db.query('TRUNCATE admin_user_change_history');
    await db.query('ALTER TABLE admin_user_change_history DROP CONSTRAINT chk_admin_change_action');
    await db.query("ALTER TABLE admin_user_change_history ADD CONSTRAINT chk_admin_change_action CHECK (action IN ('USER_BLOCKED','USER_UNBLOCKED','USER_PROFILE_UPDATED','CUSTOM_EXISTING_ACTION'))");
    await assert.rejects(insert('MERCHANT_BLOCKED'), { code: '23514' });
    await db.query(migration);
    for (const action of ['MERCHANT_BLOCKED','MERCHANT_UNBLOCKED','USER_BLOCKED','USER_UNBLOCKED','USER_PROFILE_UPDATED','CUSTOM_EXISTING_ACTION']) await insert(action);
    await assert.rejects(insert('UNKNOWN_ACTION'), { code: '23514' });
    const definition = await db.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='admin_user_change_history'::regclass AND conname='chk_admin_change_action'");
    await db.query(migration);
    assert.deepEqual((await db.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='admin_user_change_history'::regclass AND conname='chk_admin_change_action'")).rows, definition.rows);
  });
  it('leaves a schema without the action constraint unchanged', async () => {
    await db.query('ALTER TABLE admin_user_change_history DROP CONSTRAINT chk_admin_change_action');
    await db.query(migration);
    assert.equal((await db.query("SELECT 1 FROM pg_constraint WHERE conrelid='admin_user_change_history'::regclass AND conname='chk_admin_change_action'")).rowCount, 0);
  });
});
