const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { createTestDatabase } = require('./merchant_test_database');

describe('Shared email claims across real application writers', {
  skip: process.env.MERCHANT_INTEGRATION_TEST !== '1',
}, () => {
  let database, pool, writers, adminId, serial = 0;
  const input = email => ({ userId: crypto.randomUUID(), phone: `090${String(++serial).padStart(7, '0')}`,
    phoneHash: crypto.randomBytes(32).toString('hex'), email, passwordHash: 'test-hash',
    storeName: 'Test Merchant', taxCode: `tax-${serial}`, callbackUrl: null,
    apiKey: `test-public-${serial}`, secretKey: 'test-secret' });

  before(async () => {
    database = await createTestDatabase();
    process.env.SECRET_KEY_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    pool = require('../src/config/database');
    adminId = crypto.randomUUID();
    await pool.query("INSERT INTO users(id,role) VALUES($1,'ADMIN')", [adminId]);
    const user = require('../src/modules/auth/auth.repository');
    const merchant = require('../src/modules/merchant/production/auth/auth.repository');
    const sandboxMerchant = require('../src/modules/merchant/sandbox/auth/auth.repository');
    const sandboxUser = require('../src/modules/merchant/sandbox/user/auth/auth.repository');
    const adminUser = require('../src/admin/user/user.repository');
    writers = [
      ['USER registration', args => user.addUser(args)],
      ['production Merchant registration', args => merchant.addMerchant(args)],
      ['sandbox Merchant registration', args => sandboxMerchant.addMerchant(args)],
      ['sandbox USER registration', args => sandboxUser.createUserWithKyc(args)],
      ['ADMIN USER profile (legacy)', args => adminUser.updateUserProfile(args), true],
      ['ADMIN USER profile with audit', args => adminUser.updateUserProfileWithHistory({
        ...args, adminId, reason: 'Test update', oldValues: {}, newValues: { email: args.email.trim().toLowerCase() },
      }), true],
    ];
  });
  after(async () => {
    try { if (pool) await pool.end(); }
    finally { if (database) await database.cleanup(); }
  });

  async function prepare(writer, args) {
    if (writer[2]) await pool.query("INSERT INTO users(id,role,email) VALUES($1,'USER',$2)",
      [args.userId, `original-${args.userId}@example.test`]);
  }

  it('all six writers normalize email and reject existing mixed-case identities globally', async () => {
    for (const writer of writers) {
      const args = input(`  New-${serial}@Example.Test  `);
      await prepare(writer, args);
      await writer[1](args);
      assert.equal((await pool.query('SELECT email FROM users WHERE id=$1', [args.userId])).rows[0].email,
        args.email.trim().toLowerCase(), writer[0]);
      const conflicting = input(args.email.toUpperCase());
      await prepare(writer, conflicting);
      await assert.rejects(writer[1](conflicting), error => error.statusCode === 409, writer[0]);
      const row = (await pool.query('SELECT email FROM users WHERE id=$1', [conflicting.userId])).rows[0];
      assert.equal(row?.email ?? null, writer[2] ? `original-${conflicting.userId}@example.test` : null);
    }
    const mixed = input('  Existing.Mixed@Example.Test  ');
    await pool.query('INSERT INTO users(id,email) VALUES($1,$2)', [mixed.userId, mixed.email]);
    await assert.rejects(writers[0][1](input('existing.mixed@example.test')), error => error.statusCode === 409);
  });

  it('distinct registration/profile paths cannot concurrently claim the same normalized email', async () => {
    const { claimEmail } = require('../src/utils/emailClaim');
    for (const [leftIndex, rightIndex] of [[0, 1], [5, 3], [4, 2]]) {
      const email = `race-${leftIndex}-${rightIndex}@example.test`;
      const left = input(email.toUpperCase()), right = input(` ${email} `);
      await prepare(writers[leftIndex], left);
      await prepare(writers[rightIndex], right);
      const gate = await pool.connect();
      let pending;
      try {
        await gate.query('BEGIN');
        await claimEmail(gate, email);
        pending = Promise.allSettled([writers[leftIndex][1](left), writers[rightIndex][1](right)]);
        const deadline = Date.now() + 5000;
        let waiting = 0;
        while (Date.now() < deadline) {
          waiting = Number((await gate.query(`SELECT COUNT(*) FROM pg_locks
            WHERE locktype='advisory' AND NOT granted
              AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`)).rows[0].count);
          if (waiting >= 2) break;
          await delay(20);
        }
        assert.equal(waiting, 2, 'both writers must reach the shared lock before it is released');
      } finally {
        await gate.query('ROLLBACK');
        gate.release();
      }
      const results = await pending;
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(results.find(r => r.status === 'rejected').reason.statusCode, 409);
      assert.equal((await pool.query('SELECT id FROM users WHERE LOWER(BTRIM(email))=$1', [email])).rowCount, 1);
    }
  });

  it('audit fixture permits current actions and rejects unsupported Merchant-specific actions', async () => {
    await assert.rejects(pool.query(`INSERT INTO admin_user_change_history(admin_id,user_id,action)
      VALUES($1,$1,'MERCHANT_PROFILE_UPDATED')`, [adminId]), error => error.code === '23514');
    const result = await pool.query(`INSERT INTO admin_user_change_history(admin_id,user_id,action)
      VALUES($1,$1,'USER_PROFILE_UPDATED') RETURNING id`, [adminId]);
    assert.ok(result.rows[0].id);
  });
});
