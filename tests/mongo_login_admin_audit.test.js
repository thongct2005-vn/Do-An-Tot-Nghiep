const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomBytes, createHash } = require("node:crypto");
const express = require("express");
const mongoose = require("mongoose");
const { UserLoginEvent, recordSuccessfulUserLogin } = require("../src/models/mongo/userLoginEvent.model");
const { AdminActionLog } = require("../src/models/mongo/adminActionLog.model");
const adminAudit = require("../src/middlewares/adminAudit.middleware");
const {
  resolveTestMongoUri,
  connectTestMongo,
  reconnectTestMongo,
  cleanupTestMongo,
} = require("./mongo_test_database");

const dbName = `login_audit_test_${randomBytes(8).toString("hex")}`;
const { uri, protectedNames } = resolveTestMongoUri({ fallbackLocal: true });
let created = false;
let sqlPool;

before(async () => {
  await connectTestMongo({
    uri,
    dbName,
    serverSelectionTimeoutMS: 3000,
    requireEmpty: true,
    protectedNames,
  });
  created = true;
});

after(async () => {
  await cleanupTestMongo({ uri, dbName, created, protectedNames });
  const dbModulePath = require.resolve("../src/config/database");
  if (sqlPool) {
    await sqlPool.end();
  } else if (require.cache[dbModulePath]) {
    await require(dbModulePath).end();
  }
});

test("MongoDB login events aggregate by Vietnam day and exclude FAILED", async () => {
  for (const userId of ["u1", "u1", "u2"]) {
    assert.ok(await recordSuccessfulUserLogin({ userId, loggedInAt: new Date("2026-11-01T00:00:00+07:00") }));
  }
  await UserLoginEvent.create({ user_id: "u3", status: "FAILED", logged_in_at: new Date("2026-11-01T12:00:00+07:00") });
  for (const at of ["2026-10-31T23:59:59.999+07:00", "2026-11-02T00:00:00+07:00"]) {
    await recordSuccessfulUserLogin({ userId: "outside-period", loggedInAt: new Date(at) });
  }
  const rows = await UserLoginEvent.aggregate([
    { $match: { status: "SUCCESS", logged_in_at: { $gte: new Date("2026-10-31T17:00:00Z"), $lt: new Date("2026-11-01T17:00:00Z") } } },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$logged_in_at", timezone: "Asia/Ho_Chi_Minh" } }, total: { $sum: 1 }, users: { $addToSet: "$user_id" } } },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total, 3);
  assert.deepEqual(rows[0].users.sort(), ["u1", "u2"]);
});

test("admin GET and login audit omit secrets and preserve route template", async () => {
  await AdminActionLog.createIndexes();
  assert.ok((await AdminActionLog.collection.indexes()).some(i => i.key.admin_id === 1 && i.key.occurred_at === -1));
  const app = express();
  app.use(express.json());
  app.use("/api/v2/admin", adminAudit);
  app.get("/api/v2/admin/user/:id", (req, res) => {
    req.user = { user_id: "admin-1", type: "ADMIN" };
    res.json({ ok: true });
  });
  app.post("/api/v2/admin/auth/login", (req, res) => {
    if (req.body.password === "bad") return res.status(401).json({ error: "bad password" });
    res.locals.auditAdminId = "admin-1";
    res.json({ token: "secret-token" });
  });
  app.patch('/api/v2/admin/user/:id', (req, res) => {
    req.user = {user_id:'admin-1', type:'ADMIN'};
    res.status(200).json({updated:true});
  });
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await fetch(`${base}/api/v2/admin/user/u1?secret=private`);
    await fetch(`${base}/api/v2/admin/user/u1`, {method:'PATCH'});
    await fetch(`${base}/api/v2/admin/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ADMIN@example.com", password: "secret-password" }),
    });
    await fetch(`${base}/api/v2/admin/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ADMIN@example.com", password: "bad" }),
    });
    let docs = [];
    for (let i = 0; i < 30; i++) {
      docs = await AdminActionLog.find({}).lean();
      if (docs.length === 4) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(docs.length, 4);
    assert.ok(docs.some(d => d.method === 'PATCH' && d.outcome === 'SUCCESS'));
    assert.ok(docs.some((d) => d.method === "GET" && d.route === "/api/v2/admin/user/:id" && d.target_id === "u1"));
    assert.ok(docs.some((d) => d.method === "POST" && d.route.endsWith("/auth/login") && d.email_hash === createHash("sha256").update("admin@example.com").digest("hex")));
    assert.ok(docs.some((d) => d.status_code === 401 && d.outcome === "FAILED" && d.admin_id == null));
    const serialized = JSON.stringify(docs);
    for (const secret of ["private", "secret-password", "secret-token", "ADMIN@example.com"]) {
      assert.ok(!serialized.includes(secret));
    }
    await mongoose.disconnect();
    assert.equal((await fetch(`${base}/api/v2/admin/user/u1`, {method:'PATCH'})).status, 200);
  } finally {
    await reconnectTestMongo({ uri, dbName, serverSelectionTimeoutMS: 3000, protectedNames });
    await new Promise((resolve) => server.close(resolve));
  }
});

test("login returns tokens while Mongo write is pending and tolerates write rejection", async () => {
  const auth = require('../src/modules/auth/auth.service');
  const repo = require('../src/modules/auth/auth.repository');
  const otp = require('../src/modules/otp/otp.service');
  sqlPool = require('../src/config/database');
  const original = { find: repo.findUserByPhone, save: repo.updateRefeshToken, verify: otp.verifyOtp, create: UserLoginEvent.create };
  repo.findUserByPhone = async () => ({ id:'audit-user', phone:'0912000111', email:'test@example.invalid', role:'USER', status:'ACTIVE', totp_enabled:false, must_change_password:false });
  repo.updateRefeshToken = async () => {};
  otp.verifyOtp = async () => true;
  let release;
  let called = 0;
  UserLoginEvent.create = () => { called++; return new Promise(resolve => { release = resolve; }); };
  try {
    let deadline;
    const result = await Promise.race([
      auth.verifyLoginOtp({ userId:'audit-user', phone:'0912000111', otp:'123456' }),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('login waited for MongoDB')), 1000); }),
    ]).finally(() => clearTimeout(deadline));
    assert.ok(result.token.access_token);
    assert.equal(called, 1);
    release(null);
    UserLoginEvent.create = async () => { throw new Error('sensitive-error-details'); };
    assert.ok((await auth.verifyLoginOtp({ userId:'audit-user', phone:'0912000111', otp:'123456' })).token.access_token);
    await mongoose.disconnect();
    assert.ok((await auth.verifyLoginOtp({ userId:'audit-user', phone:'0912000111', otp:'123456' })).token.access_token);
  } finally {
    await reconnectTestMongo({ uri, dbName, serverSelectionTimeoutMS: 3000, protectedNames });
    release?.(null);
    repo.findUserByPhone = original.find;
    repo.updateRefeshToken = original.save;
    otp.verifyOtp = original.verify;
    UserLoginEvent.create = original.create;
  }
});

test("stats HTTP distinguishes an empty period from disconnected MongoDB", async () => {
  const controller = require('../src/admin/user/user.controller');
  sqlPool = require('../src/config/database');
  const app = express();
  app.get('/stats', controller.getLoginStats);
  app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ message:err.message }));
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/stats?start_date=2020-01-01&end_date=2020-01-02`;
  try {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.summary.total_logins, 0);
    assert.equal(body.data.buckets.length, 2);
    await mongoose.disconnect();
    assert.equal((await fetch(url)).status, 503);
    assert.equal(await recordSuccessfulUserLogin({userId:'offline-user'}), null);
  } finally {
    await reconnectTestMongo({ uri, dbName, serverSelectionTimeoutMS: 3000, protectedNames });
    await new Promise(resolve => server.close(resolve));
  }
});

test('OTP and TOTP auth paths persist one event each, rejected/challenge paths persist none', async () => {
  const auth = require('../src/modules/auth/auth.service');
  const repo = require('../src/modules/auth/auth.repository');
  const otpRepo = require('../src/modules/otp/otp.repository');
  const totp = require('../src/utils/totp');
  const bcrypt = require('bcrypt');
  const {createHmac} = require('node:crypto');
  const user = {id:'event-user',phone:'0912000111',email:'fixture@example.invalid',role:'USER',status:'ACTIVE',totp_enabled:false,must_change_password:false,password_hash:'fixture'};
  const saved = [];
  const stub = (obj, key, value) => { saved.push(() => {obj[key] = value.original;}); obj[key] = value.replacement; };
  const replace = (obj,key,replacement) => stub(obj,key,{original:obj[key],replacement});
  const hash = await bcrypt.hash('123456',4);
  replace(repo,'findUserByPhone',async()=>user);
  replace(repo,'updateRefeshToken',async()=>{});
  replace(otpRepo,'findOtp',async()=>({otp_hash:hash,expired_at:new Date(Date.now()+60000)}));
  replace(otpRepo,'consumeOtp',async()=>true);
  replace(otpRepo,'registerFailedAttempt',async()=>({failed_attempts:1}));
  replace(repo,'getTotpState',async()=>({totp_enabled:true,totp_secret:totp.encryptSecret('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'),totp_last_step:null}));
  replace(repo,'consumeTotpStep',async()=>true);
  const login = otp => auth.verifyLoginOtp({userId:user.id,phone:user.phone,otp});
  try {
    assert.ok((await login('123456')).token.access_token);
    await assert.rejects(login('654321'));
    user.must_change_password = true;
    assert.equal((await login('123456')).must_change_password,true);
    user.must_change_password = false;
    user.totp_enabled = true;
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(totp.currentStep()));
    const digest = createHmac('sha1','12345678901234567890').update(counter).digest();
    const offset = digest[digest.length-1] & 15;
    const code = ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6,'0');
    assert.ok((await login(code)).token.access_token);
    await assert.rejects(login('invalid'));
    let rows;
    for (let i=0;i<30;i++) {
      rows = await UserLoginEvent.find({user_id:user.id}).lean();
      if(rows.length===2) break;
      await new Promise(r=>setTimeout(r,20));
    }
    assert.equal(rows.length,2);
    assert.ok(rows.every(r=>r.status==='SUCCESS' && r.logged_in_at instanceof Date));
  } finally { saved.reverse().forEach(restore=>restore()); }
});

test('login stats routes authorize ADMIN and agree across production/sandbox prefixes', async () => {
  const previousAuditIds = await AdminActionLog.distinct('_id');
  const jwt = require('../src/utils/jwt');
  const adminRepo = require('../src/admin/auth/auth.repository');
  const original = adminRepo.findAdminSessionById;
  const admin = jwt.generateAuthTokens({id:'admin-test',role:'ADMIN'});
  const user = jwt.generateAuthTokens({id:'user-test',role:'USER'});
  adminRepo.findAdminSessionById = async()=>({status:'ACTIVE',refresh_token:admin.refreshToken});
  const app = express();
  const routes = require('../src/admin/user/user.routes');
  app.use('/api/v2/admin', adminAudit);
  app.use('/sb/api/v2/admin', adminAudit);
  app.use('/api/v2/admin/user',routes);
  app.use('/sb/api/v2/admin/user',routes);
  app.use((err,req,res,next)=>res.status(err.statusCode||500).json({message:err.message}));
  const server = app.listen(0);
  try {
    for(const prefix of ['/api/v2','/sb/api/v2']) {
      const url = `http://127.0.0.1:${server.address().port}${prefix}/admin/user/login-stats?start_date=2026-11-01&end_date=2026-11-01`;
      assert.equal((await fetch(url)).status,401);
      assert.equal((await fetch(url,{headers:{authorization:`Bearer ${user.accessToken}`}})).status,403);
      const result = await fetch(url,{headers:{authorization:`Bearer ${admin.accessToken}`}});
      assert.equal(result.status,200);
      const body = await result.json();
      assert.deepEqual(body.data.summary,{total_logins:3,unique_users:2});
      assert.equal(body.data.buckets.length,24);
      assert.equal(body.data.buckets[0].total_logins,3);
    }
    // Denied USER requests must never be attributed to an admin identity.
    let logs = [];
    for (let i = 0; i < 30; i++) {
      logs = await AdminActionLog.find({ _id: { $nin: previousAuditIds } }).lean();
      if (logs.length === 6) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(logs.length, 6);
    assert.equal(logs.filter(row => row.status_code === 403).length, 2);
    assert.ok(logs.filter(row => row.status_code === 403).every(row => row.admin_id == null));
    assert.equal(logs.filter(row => row.status_code === 200 && row.admin_id === 'admin-test').length, 2);
  } finally {
    adminRepo.findAdminSessionById=original;
    await new Promise(r=>server.close(r));
  }
});
