const { describe, it, before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { Client } = require('pg');
const { assertTestTarget, createTestDatabase } = require('./merchant_test_database');

test('database guard rejects production, ambiguous names and non-test mode before connecting', () => {
  for (const name of ['wallet', 'postgres', 'template1', 'merchant_test_production', 'merchant_test_a;DROP DATABASE x']) {
    assert.throws(() => assertTestTarget(name, ['wallet', 'merchant_test_production'], 'test'), /Refusing/);
  }
  assert.throws(() => assertTestTarget('merchant_test_valid', [], 'production'), /Refusing/);
  assert.doesNotThrow(() => assertTestTarget('merchant_test_valid', ['wallet'], 'test'));
});

test('database setup entrypoint refuses the actual application database before any write', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const production = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env'))).DB_NAME;
  const previous = process.env.MERCHANT_TEST_DATABASE;
  process.env.MERCHANT_TEST_DATABASE = production;
  try { await assert.rejects(createTestDatabase(), /Refusing database writes/); }
  finally {
    if (previous === undefined) delete process.env.MERCHANT_TEST_DATABASE;
    else process.env.MERCHANT_TEST_DATABASE = previous;
  }
});

describe('Admin Merchant real HTTP / PostgreSQL integration', {
  skip: process.env.MERCHANT_INTEGRATION_TEST !== '1',
}, () => {
  let database, pool, server, baseUrl, tokens, tokenUtil;
  const merchants = [];
  const adminId = '10000000-0000-4000-8000-000000000001';
  const userId = '10000000-0000-4000-8000-000000000002';
  const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
  const apiPath = '/api/v2/admin/merchants';

  async function addMerchant(status, kyc, extra = {}) {
    const number = merchants.length + 1;
    const row = { id: uuid(number), status, kyc, full_name: `Fixture Store ${number}`,
      phone: `090${String(number).padStart(7, '0')}`, email: `fixture${number}@example.test`,
      api_key: `public-${number}`, secret_key: `secret-fixture-${number}`,
      call_back_url: 'https://example.test/callback', created_at: '2026-11-10 12:00:00', ...extra };
    await pool.query(`INSERT INTO users (id,role,full_name,phone,email,status,api_key,secret_key,
      call_back_url,created_at,updated_at,password_hash,pin_hash) VALUES
      ($1,'MERCHANT',$2,$3,$4,$5,$6,$7,$8,$9,$9,'password-fixture','pin-fixture')`,
    [row.id, row.full_name, row.phone, row.email, row.status, row.api_key, row.secret_key, row.call_back_url, row.created_at]);
    if (kyc !== undefined) await pool.query(`INSERT INTO user_kyc
      (id,user_id,status,created_at,updated_at) VALUES ($1,$2,$3,'2026-01-01','2026-01-01')`,
    [`tax-${String(number).padStart(4, '0')}`, row.id, kyc]);
    merchants.push(row);
    return row;
  }

  async function request(suffix = '', token = tokens.accessToken) {
    const response = await fetch(baseUrl + suffix, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const body = await response.json();
    return { status: response.status, body, data: body.data };
  }

  function safe(body) {
    const serialized = JSON.stringify(body);
    for (const secret of ['secret-fixture', 'password-fixture', 'pin-fixture', tokens.refreshToken]) {
      assert.equal(serialized.includes(secret), false);
    }
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        assert.equal(['secret_key', 'password_hash', 'pin_hash', 'refresh_token'].includes(key), false, key);
        visit(child);
      }
    }
    visit(body);
  }

  before(async () => {
    database = await createTestDatabase();
    pool = require('../src/config/database');
    tokenUtil = require('../src/utils/jwt');
    await pool.query(`INSERT INTO users (id,role,status,full_name) VALUES
      ($1,'ADMIN','ACTIVE','Test Admin'),($2,'USER','ACTIVE','Test User')`, [adminId, userId]);
    tokens = tokenUtil.generateAuthTokens({ id: adminId, role: 'ADMIN', full_name: 'Test Admin' });
    await pool.query('UPDATE users SET refresh_token=$1 WHERE id=$2', [tokens.refreshToken, adminId]);
    for (const state of ['ACTIVE', 'BLOCKED', 'SUSPENDED', null, 'OTHER']) {
      for (const kyc of ['APPROVED', 'APPPROVED', 'PENDING', 'REJECTED', undefined]) await addMerchant(state, kyc);
    }
    await addMerchant('ACTIVE', 'REJECTED', { api_key: null });
    await addMerchant('ACTIVE', 'PENDING', { secret_key: null });
    await addMerchant('BLOCKED', 'PENDING', { api_key: null, secret_key: null });
    const multi = await addMerchant('ACTIVE', 'APPROVED');
    await pool.query(`INSERT INTO user_kyc (id,user_id,status,created_at,updated_at)
      VALUES ('tax-newer',$1,'REJECTED','2026-02-01','2026-02-01')`, [multi.id]);
    multi.kyc = 'REJECTED';
    for (const callback of [null, '', '   ']) await addMerchant('ACTIVE', 'APPROVED', { call_back_url: callback });
    for (const date of ['2026-11-09 23:59:59.999999', '2026-11-10 00:00:00',
      '2026-11-10 23:59:59.999999', '2026-11-11 00:00:00']) {
      await addMerchant('ACTIVE', 'APPROVED', { full_name: 'Calendar Boundary', created_at: date });
    }
    const express = require('express');
    const app = express();
    app.use(apiPath, require('../src/admin/merchants/merchants.routes'));
    app.use(require('../src/middlewares/errorHandler'));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${server.address().port}${apiPath}`;
  });

  after(async () => {
    try {
      if (server) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
    } finally {
      try { if (pool) await pool.end(); }
      finally { if (database) await database.cleanup(); }
    }
  });

  it('uses a separate database, Vietnam timezone and correct timestamp type', async () => {
    const info = await pool.query(`SELECT current_database() AS db, current_setting('TimeZone') AS tz`);
    assert.equal(info.rows[0].db, database.name);
    assert.equal(info.rows[0].tz, 'Asia/Ho_Chi_Minh');
    const type = await pool.query(`SELECT data_type FROM information_schema.columns
      WHERE table_name='users' AND column_name='created_at'`);
    assert.equal(type.rows[0].data_type, 'timestamp without time zone');
  });

  it('enforces real token, role and current ADMIN session on list and detail', async () => {
    const jwt = require('jsonwebtoken');
    const expired = jwt.sign({ user_id: adminId, type: 'ADMIN', sid: tokenUtil.getSessionId(tokens.refreshToken) },
      process.env.ACCESS_SECRET, { expiresIn: -1 });
    const user = tokenUtil.generateAuthTokens({ id: userId, role: 'USER' }).accessToken;
    const missingSid = jwt.sign({ user_id: adminId, type: 'ADMIN' }, process.env.ACCESS_SECRET);
    for (const suffix of ['', `/${merchants[0].id}`]) {
      for (const [token, expected] of [[null, 401], ['invalid', 401], [expired, 401], [user, 403], [missingSid, 401]]) {
        const result = await request(suffix, token);
        assert.equal(result.status, expected);
        safe(result.body);
      }
      const success = await request(suffix);
      assert.equal(success.status, 200);
      safe(success.body);
    }
    try {
      await pool.query('UPDATE users SET refresh_token=$1 WHERE id=$2', ['replaced-test-session', adminId]);
      for (const suffix of ['', `/${merchants[0].id}`]) assert.equal((await request(suffix)).status, 401);
      await pool.query("UPDATE users SET refresh_token=$1,status='BLOCKED' WHERE id=$2", [tokens.refreshToken, adminId]);
      assert.equal((await request()).status, 403);
    } finally {
      await pool.query("UPDATE users SET refresh_token=$1,status='ACTIVE' WHERE id=$2", [tokens.refreshToken, adminId]);
    }
  });

  it('matches all list/detail status combinations without duplicate/missing KYC rows or secrets', async () => {
    const list = await request('?limit=100');
    assert.equal(list.status, 200);
    assert.equal(list.data.items.length, 36);
    assert.equal(new Set(list.data.items.map(row => row.id)).size, 36);
    safe(list.body);
    for (const fixture of merchants) {
      const row = list.data.items.find(item => item.id === fixture.id);
      const detail = await request(`/${fixture.id}`);
      assert.equal(detail.status, 200);
      const suspended = ['BLOCKED', 'SUSPENDED'].includes(fixture.status);
      const active = fixture.status === 'ACTIVE';
      const expected = {
        approval_status: ['APPROVED', 'APPPROVED'].includes(fixture.kyc) ? 'APPROVED' : fixture.kyc ?? 'PENDING',
        operational_status: suspended ? 'SUSPENDED' : active ? 'ACTIVE' : 'UNKNOWN',
        api_status: suspended ? 'LOCKED' : !active ? 'NOT_CONNECTED'
          : !fixture.api_key || !fixture.secret_key ? 'PENDING_KEY'
          : !fixture.call_back_url?.trim() ? 'NOT_CONNECTED' : 'LINKED',
      };
      for (const [field, value] of Object.entries(expected)) {
        assert.equal(row[field], value, `${fixture.id}:${field}`);
        assert.equal(detail.data[field], value);
      }
      assert.equal(detail.data.integration.api_status, row.api_status);
      assert.equal(detail.data.review_decision.operational_status, row.operational_status);
      safe(detail.body);
    }
    assert.equal((await request('/bad-id')).status, 400);
    assert.equal((await request(`/${uuid(9999)}`)).status, 404);
    assert.equal((await request(`/${userId}`)).status, 404);
  });

  it('matches KPI and every tab with an independent SQL aggregate', async () => {
    // DISTINCT ON is intentionally independent of the repository lateral join.
    const result = await pool.query(`WITH latest AS (
      SELECT DISTINCT ON (user_id) user_id,status FROM user_kyc
      ORDER BY user_id,updated_at DESC NULLS LAST,created_at DESC NULLS LAST
    ), facts AS (
      SELECT u.*, k.status AS kyc FROM users u LEFT JOIN latest k ON k.user_id=u.id WHERE u.role='MERCHANT'
    ) SELECT count(*)::int AS total_merchants,
      count(*) FILTER (WHERE status='ACTIVE' AND api_key IS NOT NULL AND secret_key IS NOT NULL
        AND length(trim(coalesce(call_back_url,'')))>0)::int AS linked_merchants,
      count(*) FILTER (WHERE status='ACTIVE' AND (api_key IS NULL OR secret_key IS NULL
        OR length(trim(coalesce(call_back_url,'')))=0))::int AS unconfigured_merchants,
      count(*) FILTER (WHERE status IN ('BLOCKED','SUSPENDED'))::int AS suspended_merchants,
      count(*) FILTER (WHERE kyc IS NULL OR kyc NOT IN ('APPROVED','APPPROVED','REJECTED'))::int AS pending_merchants
      FROM facts`);
    const stats = result.rows[0];
    assert.deepEqual(stats, { total_merchants: 36, linked_merchants: 10, unconfigured_merchants: 5,
      suspended_merchants: 11, pending_merchants: 12 });
    for (const [tab, field] of [['ALL', 'total_merchants'], ['LINKED', 'linked_merchants'],
      ['UNCONFIGURED', 'unconfigured_merchants'], ['SUSPENDED', 'suspended_merchants'], ['PENDING', 'pending_merchants']]) {
      const { status, data } = await request(`?tab=${tab}&limit=100`);
      assert.equal(status, 200);
      assert.deepEqual(data.stats, stats);
      assert.equal(data.pagination.total_items, stats[field]);
      assert.equal(data.items.length, stats[field]);
    }
    const overlap = await request('?tab=PENDING&status=SUSPENDED');
    assert.equal(overlap.data.pagination.total_items, 5);
  });

  it('supports searches, combined filters, aliases, deterministic pagination and empty pages', async () => {
    const { data: all } = await request('?limit=100');
    const sql = await pool.query("SELECT id FROM users WHERE role='MERCHANT' ORDER BY created_at DESC,id DESC");
    assert.deepEqual(all.items.map(row => row.id), sql.rows.map(row => row.id));
    const paged = [];
    for (let page = 1; page <= 6; page++) {
      const { data } = await request(`?limit=7&page=${page}`);
      assert.equal(data.pagination.total_pages, 6);
      paged.push(...data.items.map(row => row.id));
    }
    assert.deepEqual(paged, sql.rows.map(row => row.id));
    const first = all.items.find(row => row.id === merchants[0].id);
    for (const search of [first.id, first.merchant_code, first.phone, first.email, first.tax_code]) {
      const { data } = await request(`?search=${encodeURIComponent(search)}`);
      assert.equal(data.pagination.total_items, 1, search);
      assert.equal(data.items[0].id, first.id);
      assert.deepEqual(data.stats, all.stats);
    }
    const combined = await request('?search=fixture%20store&tab=LINKED&status=ACTIVE&approval_status=APPROVED&api_status=LINKED&limit=1&page=2');
    assert.equal(combined.status, 200);
    assert.equal(combined.data.pagination.total_items, 2);
    assert.equal(combined.data.items.length, 1);
    assert.deepEqual(combined.data.stats, all.stats);
    for (const [parameter, field, values] of [
      ['status', 'operational_status', ['ACTIVE', 'SUSPENDED', 'UNKNOWN']],
      ['approval_status', 'approval_status', ['APPROVED', 'PENDING', 'REJECTED']],
      ['api_status', 'api_status', ['LINKED', 'PENDING_KEY', 'NOT_CONNECTED', 'LOCKED']],
    ]) {
      for (const value of values) {
        const { data } = await request(`?${parameter}=${value}&limit=100`);
        assert.deepEqual(data.items.map(row => row.id), all.items.filter(row => row[field] === value).map(row => row.id));
      }
    }
    for (const [alias, target] of [['BLOCKED', 'status=SUSPENDED'], ['PENDING_ACTIVATION', 'approval_status=PENDING'], ['DISABLED', 'approval_status=REJECTED']]) {
      assert.deepEqual((await request(`?status=${alias}&limit=100`)).data.items, (await request(`?${target}&limit=100`)).data.items);
    }
    const beyond = await request('?page=999');
    assert.equal(beyond.status, 200);
    assert.deepEqual(beyond.data.items, []);
    assert.equal(beyond.data.pagination.total_items, 36);
    assert.equal(beyond.data.pagination.current_page, 999);
    const empty = await request('?search=no-such-merchant');
    assert.equal(empty.data.pagination.total_pages, 0);
    assert.deepEqual(empty.data.stats, all.stats);
    assert.equal((await request('?search=%27%20OR%201%3D1--')).data.items.length, 0);
  });

  it('includes the entire end date and excludes adjacent midnight boundaries', async () => {
    const { data } = await request('?search=Calendar&start_date=2026-11-10&end_date=2026-11-10&period=MONTH');
    assert.equal(data.pagination.total_items, 2);
    assert.deepEqual(data.items.map(row => row.id), [uuid(35), uuid(34)]);
    assert.equal((await request('?search=Calendar&end_date=2026-11-09')).data.pagination.total_items, 1);
    assert.equal((await request('?search=Calendar&start_date=2026-11-11')).data.pagination.total_items, 1);
  });

  it('applies TODAY/WEEK/MONTH and aliases against independent SQL calendar boundaries', async () => {
    const ids = [101, 102, 103, 104].map(uuid);
    for (const [period, alias, unit, interval] of [['TODAY', 'DAY', 'day', '1 day'],
      ['THIS_WEEK', 'WEEK', 'week', '7 days'], ['THIS_MONTH', 'MONTH', 'month', '1 month']]) {
      try {
        await pool.query(`INSERT INTO users(id,role,status,full_name,created_at)
          SELECT id,'MERCHANT','ACTIVE','Period Fixture', moment FROM
          (SELECT date_trunc($1, CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh') AS start) bounds,
          LATERAL (VALUES ($3::uuid,start-interval '1 microsecond'),($4::uuid,start),
            ($5::uuid,start+$2::interval-interval '1 microsecond'),($6::uuid,start+$2::interval)) v(id,moment)`,
        [unit, interval, ...ids]);
        const { data } = await request(`?search=Period%20Fixture&period=${period}`);
        assert.equal(data.pagination.total_items, 2);
        assert.deepEqual(data.items.map(row => row.id), [ids[2], ids[1]]);
        assert.deepEqual((await request(`?search=Period%20Fixture&period=${alias}`)).data.items, data.items);
      } finally { await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]); }
    }
  });

  it('returns HTTP 400 for invalid parameters and defaults only when absent', async () => {
    for (const query of ['page=', 'page=0', 'page=1.5', 'page=1abc', 'page=9007199254740992',
      'page=9007199254740991&limit=100', 'limit=', 'limit=101', 'limit=-1', 'page=1&page=2',
      'tab=', 'tab=BAD', 'status=BAD', 'approval_status=BAD', 'api_status=BAD', 'period=BAD',
      'start_date=', 'end_date=2026-02-30', 'start_date=2026-11-11&end_date=2026-11-10',
      'start_date=2026-11-10&period=BAD', `search=${'x'.repeat(201)}`]) {
      const result = await request(`?${query}`);
      assert.equal(result.status, 400, query);
      assert.match(result.body.message, /Tham số/);
      safe(result.body);
    }
    const { data } = await request();
    assert.equal(data.pagination.current_page, 1);
    assert.equal(data.pagination.limit, 10);
    assert.equal(data.items.length, 10);
  });

  it('keeps stats/count/items in one read-only snapshot across concurrent commit', async () => {
    const repository = require('../src/admin/merchants/merchants.repository');
    const writer = new Client(database.config);
    await writer.connect();
    const connect = pool.connect.bind(pool);
    let injected = false;
    const newId = uuid(999);
    pool.connect = async () => {
      const client = await connect();
      const query = client.query.bind(client);
      const release = client.release.bind(client);
      client.query = async (sql, params) => {
        const result = await query(sql, params);
        if (sql.startsWith('BEGIN')) {
          assert.equal((await query('SHOW transaction_isolation')).rows[0].transaction_isolation, 'repeatable read');
          assert.equal((await query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'on');
        }
        if (sql.includes('AS total_merchants') && !injected) {
          injected = true;
          await writer.query(`INSERT INTO users(id,role,status,full_name,created_at)
            VALUES ($1,'MERCHANT','ACTIVE','Concurrent Fixture','2026-12-01')`, [newId]);
        }
        return result;
      };
      client.release = () => { client.query = query; client.release = release; release(); };
      return client;
    };
    try {
      const result = await repository.getMerchantListSnapshot({ limit: 100 });
      assert.equal(injected, true);
      assert.equal(result.stats.total_merchants, 36);
      assert.equal(result.total, 36);
      assert.equal(result.items.length, 36);
      assert.equal(result.items.some(row => row.id === newId), false);
      pool.connect = connect;
      assert.equal((await repository.getMerchantListSnapshot({ limit: 100 })).total, 37);
    } finally {
      pool.connect = connect;
      await writer.query('DELETE FROM users WHERE id=$1', [newId]);
      await writer.end();
    }
  });

  it('rolls back and releases the snapshot connection when a query fails', async () => {
    const repository = require('../src/admin/merchants/merchants.repository');
    const connect = pool.connect.bind(pool);
    const statements = [];
    let released = false;
    pool.connect = async () => {
      const client = await connect();
      const query = client.query.bind(client);
      const release = client.release.bind(client);
      client.query = async (sql, params) => {
        statements.push(sql);
        if (sql.includes('AS total_merchants')) return query('SELECT 1/0');
        return query(sql, params);
      };
      client.release = () => { released = true; client.query = query; client.release = release; release(); };
      return client;
    };
    try {
      await assert.rejects(repository.getMerchantListSnapshot({ limit: 10 }), { code: '22012' });
      assert.equal(statements.includes('ROLLBACK'), true);
      assert.equal(statements.includes('COMMIT'), false);
      assert.equal(released, true);
    } finally { pool.connect = connect; }
    assert.equal((await repository.getMerchantListSnapshot({ limit: 100 })).total, 36);
  });
});
