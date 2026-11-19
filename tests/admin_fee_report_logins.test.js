const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const {
  resolveTestMongoUri,
  connectTestMongo,
  cleanupTestMongo,
} = require('./mongo_test_database');

test('report logins reuse actual Mongo events and Vietnam date bounds', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
  const { uri, protectedNames } = resolveTestMongoUri();
  assert.ok(uri, 'MONGODB_URI or MERCHANT_TEST_MONGO_URI required for integration acceptance');
  const name = `merchant_test_login_${randomBytes(10).toString('hex')}`;
  let created = false;
  try {
    await connectTestMongo({ uri, dbName: name, serverSelectionTimeoutMS: 7000, protectedNames });
    created = true;
    const {recordSuccessfulUserLogin,UserLoginEvent} = require('../src/models/mongo/userLoginEvent.model');
    for (const at of ['2026-10-31T00:00:00+07:00','2026-10-31T12:00:00+07:00','2026-10-31T23:59:59.999+07:00']) {
      assert.ok(await recordSuccessfulUserLogin({userId:'one-user',loggedInAt:new Date(at)}));
    }
    await recordSuccessfulUserLogin({userId:'outside-user',loggedInAt:new Date('2026-11-01T00:00:00+07:00')});
    await UserLoginEvent.create({user_id:'failed-user',status:'FAILED',logged_in_at:new Date('2026-10-31T12:00:00+07:00')});
    const service=require('../src/admin/reports/reports.service');
    const r=await service.logins({start_date:'2026-10-31',end_date:'2026-10-31'});
    assert.deepEqual(r.summary,{total_logins:3,unique_users:1});
    assert.equal(r.buckets.reduce((n,b)=>n+b.total_logins,0),3);
    await recordSuccessfulUserLogin({userId:'one-user',loggedInAt:new Date('2026-11-01T12:00:00+07:00')});
    const {attachLogins}=require('../src/admin/reports/financialReport.service');
    const dto=await attachLogins({}, {start_date:'2026-10-31',end_date:'2026-11-01'},service.logins);
    assert.equal(dto.logins.available,true);
    assert.deepEqual(dto.logins.summary,{total_logins:5,unique_users:2});
    assert.ok(dto.logins.read_completed_at>=dto.logins.read_started_at);
    assert.deepEqual((await service.logins({start_date:'2025-01-01',end_date:'2025-01-01'})).summary,{total_logins:0,unique_users:0});
  } finally {
    await cleanupTestMongo({ uri, dbName: name, created, protectedNames });
    await require('../src/config/database').end();
  }
});
