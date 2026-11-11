const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const dns = require('node:dns');
const { createTestDatabase } = require('./merchant_test_database');

describe('ADMIN Merchant profile HTTP / PostgreSQL', {
  skip: process.env.MERCHANT_INTEGRATION_TEST !== '1',
}, () => {
  let database, pool, server, baseUrl, tokens, tokenUtil, socket;
  let serial = 0;
  const adminId = crypto.randomUUID(), userId = crypto.randomUUID();
  const reason = 'Cập nhật theo hồ sơ đã xác nhận';
  const events = [];

  async function merchant(extra = {}) {
    const n = ++serial;
    const row = { id: crypto.randomUUID(), full_name: `Merchant ${n}`, phone: `091${String(n).padStart(7, '0')}`,
      email: `merchant-${n}@example.test`, call_back_url: 'https://8.8.8.8/callback', ...extra };
    await pool.query(`INSERT INTO users(id,role,full_name,phone,phone_hash,email,call_back_url,
      refresh_token,fcm_token,password_hash,pin_hash,api_key,secret_key)
      VALUES($1,'MERCHANT',$2,$3,$4,$5,$6,'refresh-fixture','fcm-fixture',
        'password-fixture','pin-fixture','api-fixture','secret-fixture')`,
    [row.id,row.full_name,row.phone,crypto.createHash('sha256').update(row.phone).digest('hex'),row.email,row.call_back_url]);
    return row;
  }
  async function read(id) {
    return (await pool.query('SELECT * FROM users WHERE id=$1', [id])).rows[0];
  }
  async function audits(id) {
    return (await pool.query('SELECT * FROM admin_user_change_history WHERE user_id=$1 ORDER BY created_at,id', [id])).rows;
  }
  async function patch(id, body, token = tokens.accessToken) {
    const response = await fetch(`${baseUrl}/${id}/profile`, { method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  function safe(result) {
    assert.deepEqual(Object.keys(result.body.data).sort(), ['audit','merchant']);
    assert.deepEqual(Object.keys(result.body.data.merchant).sort(),
      ['id','full_name','store_name','phone','email','call_back_url','updated_at'].sort());
    assert.deepEqual(Object.keys(result.body.data.audit).sort(), ['id','action','reason','created_at'].sort());
    for (const secret of ['refresh-fixture','fcm-fixture','password-fixture','pin-fixture','api-fixture','secret-fixture']) {
      assert.equal(JSON.stringify(result.body).includes(secret), false, secret);
    }
  }
  before(async () => {
    database = await createTestDatabase();
    pool = require('../src/config/database');
    tokenUtil = require('../src/utils/jwt');
    socket = require('../src/utils/socket');
    await pool.query("INSERT INTO users(id,role,status) VALUES($1,'ADMIN','ACTIVE'),($2,'USER','ACTIVE')", [adminId,userId]);
    tokens = tokenUtil.generateAuthTokens({ id: adminId, role: 'ADMIN' });
    await pool.query('UPDATE users SET refresh_token=$1 WHERE id=$2', [tokens.refreshToken,adminId]);
    mock.method(socket, 'emitToUser', (id, event, payload) => {
      // A separate pool connection must already observe the committed update.
      events.push({ id, event, payload, committed: read(id) });
    });
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use(require('../src/middlewares/sanitize.middleware'));
    app.use('/api/v2/admin/merchants', require('../src/admin/merchants/merchants.routes'));
    app.use(require('../src/middlewares/errorHandler'));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${server.address().port}/api/v2/admin/merchants`;
  });
  after(async () => {
    mock.restoreAll();
    try {
      if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    } finally {
      try { if (pool) await pool.end(); }
      finally { if (database) await database.cleanup(); }
    }
  });

  it('enforces real access token, role, active ADMIN and current session', async () => {
    const target = await merchant();
    const jwt = require('jsonwebtoken');
    const userToken = tokenUtil.generateAuthTokens({ id: userId, role: 'USER' }).accessToken;
    const merchantToken = tokenUtil.generateAuthTokens({ id: target.id, role: 'MERCHANT' }).accessToken;
    const expired = jwt.sign({ user_id: adminId, type: 'ADMIN' }, process.env.ACCESS_SECRET, { expiresIn: -1 });
    const missingSid = jwt.sign({ user_id: adminId, type: 'ADMIN' }, process.env.ACCESS_SECRET);
    for (const [token,status] of [[null,401],['invalid',401],[expired,401],[missingSid,401],[userToken,403],[merchantToken,403]]) {
      assert.equal((await patch(target.id, { full_name: 'Forbidden change', reason }, token)).status,status);
    }
    try {
      await pool.query("UPDATE users SET status='BLOCKED' WHERE id=$1", [adminId]);
      assert.equal((await patch(target.id, { full_name: 'Blocked admin', reason })).status,403);
      await pool.query("UPDATE users SET status='ACTIVE',refresh_token='replaced' WHERE id=$1", [adminId]);
      assert.equal((await patch(target.id, { full_name: 'Old session', reason })).status,401);
    } finally {
      await pool.query("UPDATE users SET status='ACTIVE',refresh_token=$1 WHERE id=$2", [tokens.refreshToken,adminId]);
    }
    assert.equal((await read(target.id)).full_name,target.full_name);
    assert.equal((await audits(target.id)).length,0);
  });

  it('validates identifiers, all field types, limits, aliases and allowlist before writing', async () => {
    const target = await merchant();
    assert.equal((await patch('bad-uuid', { full_name: 'Valid name',reason })).status,400);
    for (const id of [crypto.randomUUID(),userId,adminId]) {
      assert.equal((await patch(id, { email: target.email,reason })).status,404);
    }
    const invalid = [null, [], {}, { reason }, {full_name:'X',reason}, {full_name:'x'.repeat(51),reason},
      {full_name:123,reason}, {full_name:null,reason}, {full_name:'Bad\0Name',reason},
      {full_name:'Name',store_name:'Different',reason}, {store_name:[],reason},
      {full_name:'Name'}, {full_name:'Name',reason:null}, {full_name:'Name',reason:500},
      {full_name:'Name',reason:'    '}, {full_name:'Name',reason:'four'}, {full_name:'Name',reason:'x'.repeat(501)},
      {phone:1234567890,reason}, {phone:null,reason}, {phone:[],reason}, {phone:'0201234567',reason},
      {phone:'09112345678',reason}, {phone:'abc0911234567',reason}, {phone:'091 1234567',reason},
      {email:null,reason}, {email:123,reason}, {email:[],reason}, {email:'',reason},
      {email:'not-an-email',reason}, {email:'bad space@example.test',reason},
      {email:`${'x'.repeat(90)}@example.test`,reason}, {call_back_url:[],reason}, {call_back_url:42,reason}];
    for (const field of ['status','balance','role','address','kyc','api_key','secret_key','password','password_hash',
      'pin_hash','totp_secret','id','created_at','phone_hash','refresh_token','fcm_token','unexpected','__proto__']) {
      invalid.push({ full_name:'Changed name',reason,[field]:'attempt' });
    }
    const before = await read(target.id);
    for (const body of invalid) {
      assert.equal((await patch(target.id,body)).status,400,JSON.stringify(body));
    }
    assert.deepEqual(await read(target.id),before);
    assert.equal((await audits(target.id)).length,0);
  });

  it('normalizes aliases and records only changed fields with safe profile/audit response', async () => {
    const target = await merchant();
    const beforeEvents = events.length;
    const response = await patch(target.id,{full_name:'  Cửa hàng mới  ',store_name:'Cửa hàng mới',reason:` ${reason} `});
    assert.equal(response.status,200);
    safe(response);
    assert.equal(response.body.data.merchant.full_name,'Cửa hàng mới');
    assert.equal(response.body.data.merchant.store_name,'Cửa hàng mới');
    const [audit] = await audits(target.id);
    assert.equal(audit.id,response.body.data.audit.id);
    assert.equal(audit.admin_id,adminId);
    assert.equal(audit.user_id,target.id);
    assert.equal(audit.action,'USER_PROFILE_UPDATED');
    assert.equal(audit.reason,reason);
    assert.deepEqual(audit.old_values,{full_name:target.full_name});
    assert.deepEqual(audit.new_values,{full_name:'Cửa hàng mới'});
    assert.equal((await read(target.id)).refresh_token,'refresh-fixture');
    assert.equal((await read(target.id)).fcm_token,'fcm-fixture');
    assert.equal(events.length,beforeEvents);
    const detail = await fetch(`${baseUrl}/${target.id}`,{headers:{Authorization:`Bearer ${tokens.accessToken}`}});
    assert.equal(detail.status,200);
    assert.equal((await detail.json()).data.store_name,'Cửa hàng mới');
    assert.equal((await patch(target.id,{store_name:'  Cửa hàng mới ',reason})).status,400);
    assert.equal((await audits(target.id)).length,1);
    for (const [name,why] of [['AB','12345'],['Đ'.repeat(50),'r'.repeat(500)]]) {
      assert.equal((await patch(target.id,{full_name:name,reason:why})).status,200);
    }
  });

  it('rejects normalized no-ops including legacy mixed-case email and cleared callback', async () => {
    const target = await merchant({email:'Legacy.Email@Example.Test',call_back_url:null});
    for (const body of [{full_name:` ${target.full_name} `},{email:'legacy.email@example.test'},
      {phone:` ${target.phone} `},{call_back_url:''},{call_back_url:null}]) {
      assert.equal((await patch(target.id,{...body,reason})).status,400);
    }
    assert.equal((await audits(target.id)).length,0);
  });

  it('changes phone/hash and email, revokes persisted sessions, and emits only after commit', async () => {
    const target = await merchant();
    const issued = tokenUtil.generateAuthTokens({id:target.id,role:'MERCHANT'});
    for (const body of [{phone:' 0981234567 '},{email:'  NEW.IDENTITY@Example.Test  '}]) {
      await pool.query("UPDATE users SET refresh_token='refresh-fixture',fcm_token='fcm-fixture' WHERE id=$1",[target.id]);
      const beforeEvents = events.length;
      const response = await patch(target.id.toUpperCase(),{...body,reason});
      assert.equal(response.status,200);
      safe(response);
      assert.equal(events.length,beforeEvents+1);
      const event = events.at(-1);
      assert.equal(event.id,target.id);
      assert.equal(event.event,'force_logout');
      const committed = await event.committed;
      assert.equal(committed.refresh_token,null);
      assert.equal(committed.fcm_token,null);
      const field = Object.keys(body)[0];
      const expected = field === 'email' ? body[field].trim().toLowerCase() : body[field].trim();
      assert.equal(committed[field],expected);
      assert.equal(committed.phone_hash,crypto.createHash('sha256').update(committed.phone).digest('hex'));
    }
    assert.equal(tokenUtil.verifyAccessToken(issued.accessToken).user_id,target.id);
    const records = await audits(target.id);
    assert.deepEqual(records.map(record=>Object.keys(record.new_values)),[['phone'],['email']]);
    assert.equal(JSON.stringify(records).includes('phone_hash'),false);
  });

  it('returns 409 for phone/email already owned by any other role without partial updates', async () => {
    const target = await merchant();
    await pool.query('UPDATE users SET email=$1,phone=$2 WHERE id=$3',['Taken@Example.Test','0977654321',userId]);
    const before = await read(target.id), beforeEvents = events.length;
    for (const field of [{phone:'0977654321'},{email:'taken@example.test'}]) {
      assert.equal((await patch(target.id,{...field,full_name:'Should roll back',reason})).status,409);
      assert.deepEqual(await read(target.id),before);
    }
    assert.equal((await audits(target.id)).length,0);
    assert.equal(events.length,beforeEvents);
  });

  it('applies production callback policy, DNS protection and explicit clearing without session revocation', async () => {
    const target = await merchant();
    const mode = process.env.NODE_ENV, privateFlag = process.env.ALLOW_PRIVATE_CALLBACKS;
    const beforeEvents = events.length;
    try {
      process.env.NODE_ENV='production';
      process.env.ALLOW_PRIVATE_CALLBACKS='true';
      for (const url of ['http://8.8.8.8/hook','https://127.0.0.1/hook','https://10.0.0.1/hook',
        'https://[::ffff:127.0.0.1]/hook','https://localhost/hook','https://host.internal/hook',
        'ftp://8.8.8.8/hook','https://user:pass@8.8.8.8/hook','https://8.8.8.8/ho\0ok',
        'not a url',`https://8.8.8.8/${'a'.repeat(500)}`]) {
        assert.equal((await patch(target.id,{call_back_url:url,reason})).status,400,url);
      }
      const lookup = mock.method(dns.promises,'lookup',async()=>[{address:'127.0.0.1',family:4}]);
      assert.equal((await patch(target.id,{call_back_url:'https://callback.example.test/hook',reason})).status,400);
      lookup.mock.mockImplementation(async()=>[{address:'8.8.8.8',family:4}]);
      assert.equal((await patch(target.id,{call_back_url:'https://callback.example.test/hook',reason})).status,200);
      lookup.mock.mockImplementation(async()=>{throw Object.assign(new Error('lookup fixture'),{code:'EAI_AGAIN',syscall:'getaddrinfo'});});
      assert.equal((await patch(target.id,{call_back_url:'https://temporary.example.test/hook',reason})).status,503);
      lookup.mock.restore();
      for (const url of ['', 'https://8.8.8.8/new', null]) {
        const response = await patch(target.id,{call_back_url:url,reason});
        assert.equal(response.status,200);
        assert.equal(response.body.data.merchant.call_back_url,url||null);
      }
      const prefix='https://8.8.8.8/';
      assert.equal((await patch(target.id,{call_back_url:prefix+'a'.repeat(500-prefix.length),reason})).status,200);
    } finally {
      process.env.NODE_ENV=mode;
      if (privateFlag === undefined) delete process.env.ALLOW_PRIVATE_CALLBACKS;
      else process.env.ALLOW_PRIVATE_CALLBACKS=privateFlag;
    }
    assert.equal((await read(target.id)).refresh_token,'refresh-fixture');
    assert.equal(events.length,beforeEvents);
  });

  it('rolls back profile, phone hash and sessions when the audit insert fails', async () => {
    const target = await merchant(), before = await read(target.id), beforeEvents = events.length;
    await pool.query("ALTER TABLE admin_user_change_history ADD CONSTRAINT fixture_audit_failure CHECK(reason <> 'Rollback fixture')");
    try {
      const response = await patch(target.id,{full_name:'Rollback Name',phone:'0981111111',
        email:'rollback@example.test',reason:'Rollback fixture'});
      assert.equal(response.status,500);
      assert.deepEqual(await read(target.id),before);
      assert.equal((await audits(target.id)).length,0);
      assert.equal(events.length,beforeEvents);
    } finally {
      await pool.query('ALTER TABLE admin_user_change_history DROP CONSTRAINT fixture_audit_failure');
    }
  });

  it('retains a committed response if socket delivery fails', async () => {
    const target = await merchant();
    const previous = socket.emitToUser;
    socket.emitToUser=()=>{throw new Error('fixture socket unavailable');};
    try {
      const response = await patch(target.id,{email:'socket-failed@example.test',reason});
      assert.equal(response.status,200);
      assert.equal((await read(target.id)).email,'socket-failed@example.test');
      assert.equal((await audits(target.id)).length,1);
    } finally { socket.emitToUser=previous; }
  });

  it('serializes concurrent changes on one Merchant and rejects simultaneous phone/email claims', async () => {
    const a = await merchant(), b = await merchant();
    const same = await Promise.all([patch(a.id,{full_name:'Concurrent name',reason}),patch(a.id,{full_name:'Concurrent name',reason})]);
    assert.deepEqual(same.map(r=>r.status).sort(),[200,400]);
    assert.equal((await audits(a.id)).length,1);
    const phones = await Promise.all([patch(a.id,{phone:'0969999999',reason}),patch(b.id,{phone:'0969999999',reason})]);
    assert.deepEqual(phones.map(r=>r.status).sort(),[200,409]);
    const register = require('../src/modules/auth/auth.repository');
    const email = 'profile-registration-race@example.test';
    const results = await Promise.all([
      patch(a.id,{email,reason}).then(r=>r.status),
      register.addUser({userId:crypto.randomUUID(),phone:'0968888888',phoneHash:'hash-fixture',
        email:email.toUpperCase(),passwordHash:'password-fixture'}).then(()=>200,error=>error.statusCode),
    ]);
    assert.deepEqual(results.sort(),[200,409]);
    assert.equal((await pool.query('SELECT id FROM users WHERE LOWER(email)=$1',[email])).rowCount,1);
  });
});
