const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { createTestDatabase } = require('./merchant_test_database');

describe('Blocked Merchant access HTTP / PostgreSQL', {
  skip: process.env.MERCHANT_INTEGRATION_TEST !== '1',
}, () => {
  let database, pool, server, baseUrl, tokenUtil, encryption, adminTokens;
  const adminId = crypto.randomUUID();
  const dashboardPaths = ['/api/v2/merchant/dashboard','/sb/api/v2/merchant/sandbox/dashboard'];
  const paymentPaths = ['/api/v2/merchant/payments','/sb/api/v2/merchant/sandbox/payments'];
  const reason = 'Kiểm tra hiệu lực khóa Merchant';

  async function merchant(role = 'MERCHANT') {
    const id = crypto.randomUUID(), secret = `sk_test_${crypto.randomBytes(16).toString('hex')}`;
    const apiKey = `pk_test_${crypto.randomBytes(16).toString('hex')}`;
    const tokens = tokenUtil.generateAuthTokens({ id,role,full_name:'Merchant access test' });
    await pool.query(`INSERT INTO users(id,role,status,full_name,phone,email,api_key,secret_key,refresh_token,call_back_url)
      VALUES($1,$2,'ACTIVE','Merchant access test',$3,$4,$5,$6,$7,'https://8.8.8.8/callback')`,
    [id,role,id,`${id}@example.test`,apiKey,encryption.encryptSecretKey(secret),tokenUtil.hashToken(tokens.refreshToken)]);
    return {id,secret,apiKey,...tokens};
  }
  async function read(id) { return (await pool.query('SELECT * FROM users WHERE id=$1',[id])).rows[0]; }
  async function request(path, {method='GET',token,body,headers={}} = {}) {
    const res = await fetch(`${baseUrl}${path}`,{
      method, headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
    return {status:res.status,body:await res.json(),headers:res.headers};
  }
  async function changeStatus(target, status='BLOCKED') {
    const result = await request(`/api/v2/admin/merchants/${target.id}/status`,{
      method:'PATCH',token:adminTokens.accessToken,
      body:{status,expected_status:status==='BLOCKED'?'ACTIVE':'BLOCKED',reason},
    });
    assert.equal(result.status,200,JSON.stringify(result.body));
  }
  async function signed(target, path, body, method='POST') {
    const timestamp=String(Math.floor(Date.now()/1000)), key=crypto.randomUUID();
    const signature=encryption.computeSignature(target.secret,timestamp,[method,path,key,body===undefined?'':JSON.stringify(body)].join('\n'));
    return request(path,{method,body,headers:{'x-api-key':target.apiKey,'x-timestamp':timestamp,'x-signature':signature,'Idempotency-Key':key}});
  }

  before(async () => {
    database = await createTestDatabase();
    process.env.SECRET_KEY_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    process.env.DASHBOARD_ORIGINS = 'https://merchant.example.test';
    pool = require('../src/config/database');
    tokenUtil = require('../src/utils/jwt');
    encryption = require('../src/utils/hashSecretKey');
    adminTokens = tokenUtil.generateAuthTokens({id:adminId,role:'ADMIN'});
    await pool.query("INSERT INTO users(id,role,status,refresh_token) VALUES($1,'ADMIN','ACTIVE',$2)",[adminId,adminTokens.refreshToken]);
    const express = require('express');
    const app = express();
    app.use(express.json({verify:(req,res,buf)=>{req.rawBody=buf.toString('utf8');}}));
    app.use(require('../src/middlewares/sanitize.middleware'));
    app.use('/api/v2/admin/merchants',require('../src/admin/merchants/merchants.routes'));
    const dashboard = require('../src/admin/merchant/shared/dashboard');
    app.use(dashboardPaths[0],dashboard('production'));
    app.use(dashboardPaths[1],dashboard('sandbox'));
    app.use('/api/v2/merchant/auth',require('../src/admin/merchant/production/auth/auth.routes'));
    const payments = require('../src/admin/merchant/shared/paymentRequest');
    app.use('/api/v2/merchant',payments('production'));
    app.use('/sb/api/v2/merchant/sandbox',payments('sandbox'));
    app.use('/api/v2/payment',require('../src/modules/paymentRequest/paymentRequest.routes'));
    app.use(require('../src/middlewares/errorHandler'));
    server = app.listen(0,'127.0.0.1');
    await once(server,'listening');
    baseUrl=`http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    mock.restoreAll();
    try { if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));} }
    finally {try{if(pool)await pool.end();}finally{if(database)await database.cleanup();}}
  });

  it('TC08/TC11: active Dashboard operations work, then the same JWT is denied on all four routes after block', async () => {
    for (const base of dashboardPaths) {
      const target=await merchant();
      const routes=[['GET','/info'],['PATCH','/callback',{call_back_url:'https://8.8.4.4/callback'}],['POST','/reset-apikey',{}],['POST','/reset-secretkey',{}]];
      for(const [method,path,body] of routes){
        const response=await request(base+path,{method,body,token:target.accessToken});
        assert.equal(response.status,200,`${base}${path}: ${response.body.message}`);
      }
      const active=await read(target.id);
      assert.equal(active.call_back_url,'https://8.8.4.4/callback');
      assert.notEqual(active.api_key,target.apiKey);
      assert.notEqual(encryption.decryptSecretKey(active.secret_key),target.secret);
      await changeStatus(target);
      const blocked=await read(target.id);
      for(const [method,path,body] of routes) {
        assert.equal((await request(base+path,{method,body,token:target.accessToken})).status,403,base+path);
      }
      assert.deepEqual(await read(target.id),blocked);
      await changeStatus(target,'ACTIVE');
      assert.equal((await request(base+'/info',{token:target.accessToken})).status,200);
    }
  });

  it('Dashboard guard rejects a missing account, changed database role, and any non-ACTIVE state', async () => {
    const target=await merchant();
    for(const state of ['BLOCKED','SUSPENDED','UNKNOWN']) {
      await pool.query('UPDATE users SET status=$1 WHERE id=$2',[state,target.id]);
      assert.equal((await request(dashboardPaths[0]+'/info',{token:target.accessToken})).status,403);
    }
    await pool.query("UPDATE users SET status='ACTIVE',role='USER' WHERE id=$1",[target.id]);
    assert.equal((await request(dashboardPaths[0]+'/info',{token:target.accessToken})).status,403);
    await pool.query('DELETE FROM users WHERE id=$1',[target.id]);
    assert.equal((await request(dashboardPaths[0]+'/info',{token:target.accessToken})).status,403);
    assert.equal((await request(dashboardPaths[0]+'/info')).status,401);
  });

  it('refresh uses the persisted session and rejects the old refresh cookie after blocking and unblocking', async () => {
    const target=await merchant();
    const refresh=token=>request('/api/v2/merchant/auth/refresh-token',{
      method:'POST',body:{},headers:{Origin:process.env.DASHBOARD_ORIGINS,Cookie:`${tokenUtil.MERCHANT_REFRESH_COOKIE}=${encodeURIComponent(token)}`},
    });
    const active=await refresh(target.refreshToken);
    assert.equal(active.status,200);
    assert.ok(active.body.data.token.access_token);
    const cookie=active.headers.get('set-cookie');
    const currentToken=decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('='));
    await changeStatus(target);
    const blocked=await refresh(currentToken);
    assert.equal(blocked.status,401);
    assert.equal(blocked.body.data?.token,undefined);
    assert.equal((await read(target.id)).refresh_token,null);
    await changeStatus(target,'ACTIVE');
    assert.equal((await refresh(currentToken)).status,401);
  });

  it('TC07: signed payment routes create while ACTIVE, then reject new requests and lookup after block commit', async () => {
    for(const path of paymentPaths) {
      const target=await merchant();
      const body={amount:10000,order_id:crypto.randomUUID(),description:'Thanh toan test'};
      const active=await signed(target,path,body);
      assert.equal(active.status,200,JSON.stringify(active.body));
      assert.ok(active.body.data.id);
      await changeStatus(target);
      const before=(await pool.query('SELECT * FROM payment_requests WHERE destination_user_id=$1 ORDER BY id',[target.id])).rows;
      assert.equal((await signed(target,path,{...body,order_id:crypto.randomUUID()})).status,403);
      assert.equal((await signed(target,`${path}/${body.order_id}`,undefined,'GET')).status,403);
      assert.deepEqual((await pool.query('SELECT * FROM payment_requests WHERE destination_user_id=$1 ORDER BY id',[target.id])).rows,before);
      await changeStatus(target,'ACTIVE');
      assert.equal((await signed(target,path,{...body,order_id:crypto.randomUUID()})).status,200);
    }
  });

  it('JWT dynamic QR creation denies blocked Merchant; active Merchant and existing USER flow still work', async () => {
    const target=await merchant(), user=await merchant('USER');
    const path='/api/v2/payment/qr/dynamic', body={amount:10000,description:'QR test'};
    assert.equal((await request(path,{method:'POST',body,token:target.accessToken})).status,200);
    assert.equal((await request(path,{method:'POST',body,token:user.accessToken})).status,200);
    await changeStatus(target);
    const before=(await pool.query('SELECT * FROM payment_requests WHERE destination_user_id=$1',[target.id])).rows;
    assert.equal((await request(path,{method:'POST',body,token:target.accessToken})).status,403);
    assert.deepEqual((await pool.query('SELECT * FROM payment_requests WHERE destination_user_id=$1',[target.id])).rows,before);
  });

  it('an already admitted payment can finish after block commit without cancelling existing data', {timeout:10000}, async () => {
    const target=await merchant();
    const repository=require('../src/admin/merchant/shared/paymentRequest/paymentRequest.repository');
    const original=repository.insertMerchantPaymentRequest.bind(repository);
    let signalAdmitted, release;
    const admitted=new Promise(resolve=>{signalAdmitted=resolve;});
    const gate=new Promise(resolve=>{release=resolve;});
    const intercept=mock.method(repository,'insertMerchantPaymentRequest',async args=>{
      if(args.destinationUserId===target.id){signalAdmitted();await gate;}
      return original(args);
    });
    const pending=signed(target,paymentPaths[0],{amount:10000,order_id:crypto.randomUUID()});
    try {
      await admitted;
      await changeStatus(target);
      release();
      const result=await pending;
      assert.equal(result.status,200,JSON.stringify(result.body));
      assert.equal((await read(target.id)).status,'BLOCKED');
      assert.equal((await pool.query('SELECT 1 FROM payment_requests WHERE id=$1',[result.body.data.id])).rowCount,1);
    } finally { release(); intercept.mock.restore(); await pending; }
  });

  it('TC12: block/unblock preserves completed payments, webhooks, balances, login locks and absent credentials', async () => {
    const target=await merchant();
    const payment=await signed(target,paymentPaths[0],{amount:10000,order_id:crypto.randomUUID()});
    assert.equal(payment.status,200);
    await pool.query("UPDATE payment_requests SET status='SUCCESS',paid_at=NOW() WHERE id=$1",[payment.body.data.id]);
    await pool.query("INSERT INTO transactions(id,destination_user_id,amount,status,transaction_type,created_at) VALUES($1,$2,10000,'SUCCESS','PAYMENT',NOW())",[crypto.randomUUID(),target.id]);
    await pool.query('INSERT INTO webhook_deliveries(id,merchant_id,last_http_status,created_at) VALUES($1,$2,503,NOW())',[crypto.randomUUID(),target.id]);
    // Existing storage represents an independently absent/revoked pair by missing keys.
    // Credential version/revocation metadata is a later feature, not fabricated here.
    await pool.query("UPDATE users SET api_key=NULL,secret_key=NULL,balance=777777,failed_login_attempts=4,locked_until=NOW()+interval '1 hour',fcm_token='keep-device-token' WHERE id=$1",[target.id]);
    const snapshot=async()=>({
      user:await read(target.id),
      payments:(await pool.query('SELECT * FROM payment_requests WHERE destination_user_id=$1 ORDER BY id',[target.id])).rows,
      transactions:(await pool.query('SELECT * FROM transactions WHERE destination_user_id=$1 ORDER BY id',[target.id])).rows,
      webhooks:(await pool.query('SELECT * FROM webhook_deliveries WHERE merchant_id=$1 ORDER BY id',[target.id])).rows,
    });
    const previous=await snapshot();
    for(const status of ['BLOCKED','ACTIVE']) {
      await changeStatus(target,status);
      const current=await snapshot();
      assert.equal(current.user.status,status);
      assert.equal(current.user.refresh_token,null);
      for(const field of Object.keys(previous.user).filter(key=>!['status','updated_at','refresh_token'].includes(key))) assert.deepEqual(current.user[field],previous.user[field],field);
      assert.deepEqual(current.payments,previous.payments);
      assert.deepEqual(current.transactions,previous.transactions);
      assert.deepEqual(current.webhooks,previous.webhooks);
    }
    assert.equal((await signed(target,paymentPaths[0],{amount:10000,order_id:crypto.randomUUID()})).status,401);
  });
});
