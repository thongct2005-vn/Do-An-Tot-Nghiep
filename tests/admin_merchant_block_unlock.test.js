const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { createTestDatabase } = require('./merchant_test_database');

describe('ADMIN Merchant block/unlock HTTP / PostgreSQL', {
  skip: process.env.MERCHANT_INTEGRATION_TEST !== '1',
}, () => {
  let database, pool, server, baseUrl, tokenUtil, tokens, otherAdminTokens;
  const adminId = crypto.randomUUID(), otherAdminId = crypto.randomUUID(), userId = crypto.randomUUID();
  const reason = 'Đã kiểm tra và xác nhận yêu cầu quản trị';
  const events = [];
  let socketFailure = false;

  async function merchant(status = 'ACTIVE') {
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO users(id,role,status,full_name,phone,email,refresh_token,fcm_token,
      api_key,secret_key,balance,failed_login_attempts,locked_until,call_back_url)
      VALUES($1,'MERCHANT',$2,'Merchant status test',$3,$4,'refresh-fixture','fcm-fixture',
      'api-fixture','secret-fixture',123456,4,NOW()+interval '30 minutes','https://example.test/callback')`,
    [id,status,id,`${id}@example.test`]);
    return id;
  }
  async function read(id) { return (await pool.query('SELECT * FROM users WHERE id=$1', [id])).rows[0]; }
  async function audits(id) { return (await pool.query('SELECT * FROM admin_user_change_history WHERE user_id=$1 ORDER BY created_at,id', [id])).rows; }
  async function patch(id, body, token = tokens.accessToken) {
    const res = await fetch(`${baseUrl}/${id}/status`, {
      method: 'PATCH', headers: { 'Content-Type':'application/json', ...(token ? { Authorization:`Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status:res.status, body:await res.json() };
  }
  const block = { status:'BLOCKED',expected_status:'ACTIVE',reason };
  const unblock = { status:'ACTIVE',expected_status:'BLOCKED',reason };

  before(async () => {
    database = await createTestDatabase();
    pool = require('../src/config/database');
    tokenUtil = require('../src/utils/jwt');
    mock.method(require('../src/utils/socket'), 'emitToUser', async (id,event,payload) => {
      if (socketFailure) throw new Error('Socket delivery failed');
      // Read through another pool connection to prove the update and audit committed.
      events.push({id,event,payload,merchant:await read(id),audits:await audits(id)});
    });
    await pool.query("INSERT INTO users(id,role,status) VALUES($1,'ADMIN','ACTIVE'),($2,'ADMIN','ACTIVE'),($3,'USER','ACTIVE')", [adminId,otherAdminId,userId]);
    tokens = tokenUtil.generateAuthTokens({ id:adminId,role:'ADMIN' });
    otherAdminTokens = tokenUtil.generateAuthTokens({ id:otherAdminId,role:'ADMIN' });
    for (const [id,session] of [[adminId,tokens],[otherAdminId,otherAdminTokens]]) {
      await pool.query('UPDATE users SET refresh_token=$1 WHERE id=$2', [session.refreshToken,id]);
    }
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use(require('../src/middlewares/sanitize.middleware'));
    app.use('/api/v2/admin/merchants', require('../src/admin/merchants/merchants.routes'));
    app.use(require('../src/middlewares/errorHandler'));
    server = app.listen(0,'127.0.0.1');
    await once(server,'listening');
    baseUrl = `http://127.0.0.1:${server.address().port}/api/v2/admin/merchants`;
  });
  after(async () => {
    mock.restoreAll();
    try { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
    finally { try { if (pool) await pool.end(); } finally { if (database) await database.cleanup(); } }
  });

  it('TC05: enforces access token, role, active ADMIN and current session before writing', async () => {
    const id = await merchant(), previous = await read(id);
    const jwt = require('jsonwebtoken');
    const expired = jwt.sign({user_id:adminId,type:'ADMIN'},process.env.ACCESS_SECRET,{expiresIn:-1});
    const noSid = jwt.sign({user_id:adminId,type:'ADMIN'},process.env.ACCESS_SECRET);
    const userToken = tokenUtil.generateAuthTokens({id:userId,role:'USER'}).accessToken;
    const merchantToken = tokenUtil.generateAuthTokens({id,role:'MERCHANT'}).accessToken;
    for (const [token,status] of [[null,401],['invalid',401],[expired,401],[noSid,401],[userToken,403],[merchantToken,403]]) {
      assert.equal((await patch(id,block,token)).status,status);
    }
    try {
      await pool.query("UPDATE users SET status='BLOCKED' WHERE id=$1", [adminId]);
      assert.equal((await patch(id,block)).status,403);
      await pool.query("UPDATE users SET status='ACTIVE',refresh_token='replaced' WHERE id=$1", [adminId]);
      assert.equal((await patch(id,block)).status,401);
    } finally {
      await pool.query("UPDATE users SET status='ACTIVE',refresh_token=$1 WHERE id=$2", [tokens.refreshToken,adminId]);
    }
    assert.deepEqual(await read(id),previous);
    assert.equal((await audits(id)).length,0);
  });

  it('TC06: validates UUID, strict state values, required expectation, reason boundaries and protected fields', async () => {
    const id = await merchant(), previous = await read(id);
    assert.equal((await patch('bad-id',block)).status,400);
    for (const target of [crypto.randomUUID(),userId,adminId]) assert.equal((await patch(target,block)).status,404);
    const invalid = [null,[],{}, {status:'BLOCKED',reason}, {expected_status:'ACTIVE',reason},
      {...block,reason:undefined},{...block,reason:null},{...block,reason:123},{...block,reason:[]},
      {...block,reason:'    '},{...block,reason:'four'},{...block,reason:'x'.repeat(501)},
      {...block,reason:'a\0bcde'}];
    for (const value of ['SUSPENDED','UNKNOWN','blocked',' BLOCKED ',null,1,{},[]]) invalid.push({...block,status:value});
    for (const value of ['SUSPENDED','UNKNOWN','active',null,1,{},[]]) invalid.push({...block,expected_status:value});
    for (const field of ['role','balance','api_key','refresh_token','__proto__']) invalid.push({...block,[field]:'forbidden'});
    for (const body of invalid) assert.equal((await patch(id,body)).status,400,JSON.stringify(body));
    assert.deepEqual(await read(id),previous);
    assert.equal((await audits(id)).length,0);
    assert.equal((await patch(id,{...block,reason:'  abcde  '})).status,200);
    assert.equal((await audits(id))[0].reason,'abcde');
    assert.equal((await patch(id,{...unblock,reason:'x'.repeat(500)})).status,200);
  });

  it('TC01/TC02: commits transitions and audits, revokes refresh only on block, preserves other fields', async () => {
    const id = await merchant(), previous = await read(id);
    const result = await patch(id,block);
    assert.equal(result.status,200);
    const blocked = await read(id);
    assert.equal(blocked.status,'BLOCKED');
    assert.equal(blocked.refresh_token,null);
    for (const field of Object.keys(previous).filter(key => !['status','refresh_token','updated_at'].includes(key))) {
      assert.deepEqual(blocked[field],previous[field],field);
    }
    const [audit] = await audits(id);
    assert.equal(audit.action,'MERCHANT_BLOCKED');
    assert.equal(audit.admin_id,adminId);
    assert.equal(audit.reason,reason);
    assert.deepEqual(audit.old_values,{status:'ACTIVE'});
    assert.deepEqual(audit.new_values,{status:'BLOCKED'});
    assert.equal((await patch(id,unblock)).status,200);
    const active = await read(id);
    assert.equal(active.status,'ACTIVE');
    assert.equal(active.refresh_token,null);
    assert.equal((await audits(id))[1].action,'MERCHANT_UNBLOCKED');
    for (const field of Object.keys(previous).filter(key => !['status','refresh_token','updated_at'].includes(key))) assert.deepEqual(active[field],previous[field],field);
  });

  it('TC03/TC04: duplicate transitions and unsupported stored states return 409 without audit', async () => {
    for (const [status,body] of [['ACTIVE',{...unblock,expected_status:'ACTIVE'}],['BLOCKED',{...block,expected_status:'BLOCKED'}],['SUSPENDED',unblock],['UNKNOWN',unblock]]) {
      const id = await merchant(status), previous = await read(id);
      assert.equal((await patch(id,body)).status,409);
      assert.deepEqual(await read(id),previous);
      assert.equal((await audits(id)).length,0);
    }
  });

  it('TC09: simultaneous ADMIN blocks serialize; only one commits and the stale request gets 409', async () => {
    const id = await merchant();
    const results = await Promise.all([patch(id,block),patch(id,block,otherAdminTokens.accessToken)]);
    assert.deepEqual(results.map(r => r.status).sort(),[200,409]);
    assert.equal((await read(id)).status,'BLOCKED');
    assert.equal((await audits(id)).length,1);
    assert.equal((await patch(id,{...unblock,expected_status:'ACTIVE'})).status,409);
    assert.equal((await audits(id)).length,1);
  });

  it('TC10: actual audit INSERT failure rolls back status, refresh and updated_at', async () => {
    const id = await merchant(), previous = await read(id);
    const eventCount = events.length;
    await pool.query(`CREATE SEQUENCE audit_failure_seen;
      CREATE FUNCTION reject_status_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.reason='force audit failure' THEN
        PERFORM nextval('audit_failure_seen'); RAISE EXCEPTION 'Audit failure fixture';
      END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_status_audit BEFORE INSERT ON admin_user_change_history
      FOR EACH ROW EXECUTE FUNCTION reject_status_audit()`);
    try {
      assert.equal((await patch(id,{...block,reason:'force audit failure'})).status,500);
      assert.equal((await pool.query('SELECT is_called FROM audit_failure_seen')).rows[0].is_called,true);
      assert.deepEqual(await read(id),previous);
      assert.equal((await audits(id)).length,0);
      assert.equal(events.length,eventCount);
    } finally {
      await pool.query('DROP TRIGGER reject_status_audit ON admin_user_change_history; DROP FUNCTION reject_status_audit(); DROP SEQUENCE audit_failure_seen');
    }
  });

  it('emits only after a committed block; socket failure does not undo or misreport a committed update', async () => {
    const id = await merchant(), eventCount = events.length;
    assert.equal((await patch(id,block)).status,200);
    assert.equal(events.length,eventCount+1);
    const event = events.at(-1);
    assert.equal(event.id,id);
    assert.equal(event.event,'force_logout');
    assert.equal(event.merchant.status,'BLOCKED');
    assert.equal(event.merchant.refresh_token,null);
    assert.equal(event.audits[0].action,'MERCHANT_BLOCKED');
    assert.equal((await patch(id,block)).status,409);
    assert.equal((await patch(id,unblock)).status,200);
    assert.equal(events.length,eventCount+1);
    socketFailure = true;
    try {
      assert.equal((await patch(id,block)).status,200);
      assert.equal((await read(id)).status,'BLOCKED');
      assert.equal((await audits(id)).length,3);
    } finally { socketFailure = false; }
  });

  it('returns only safe status/audit fields and GET reflects the committed status', async () => {
    const id = await merchant();
    const result = await patch(id,block);
    assert.equal(result.status,200);
    assert.deepEqual(Object.keys(result.body.data).sort(),['audit','merchant']);
    assert.deepEqual(Object.keys(result.body.data.merchant).sort(),['id','status','updated_at']);
    assert.deepEqual(Object.keys(result.body.data.audit).sort(),['action','created_at','id','reason']);
    assert.equal(result.body.data.merchant.id,id);
    assert.equal(result.body.data.merchant.status,'BLOCKED');
    assert.equal(result.body.data.audit.id,(await audits(id))[0].id);
    for (const value of ['refresh-fixture','api-fixture','secret-fixture','fcm-fixture']) assert.equal(JSON.stringify(result.body).includes(value),false);
    const response = await fetch(`${baseUrl}/${id}`,{headers:{Authorization:`Bearer ${tokens.accessToken}`}});
    assert.equal(response.status,200);
    const detail = (await response.json()).data;
    assert.equal(detail.raw_user_status,'BLOCKED');
    assert.equal(detail.operational_status,'SUSPENDED');
    assert.equal(detail.api_status,'LOCKED');
  });
});
