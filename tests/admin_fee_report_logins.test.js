const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');

test('report logins reuse actual Mongo events and Vietnam date bounds', async () => {
  assert.equal(process.env.NODE_ENV,'test');
  const source = require('dotenv').parse(fs.readFileSync('.env'));
  const uri = process.env.MERCHANT_TEST_MONGO_URI || source.MONGODB_URI;
  assert.ok(uri, 'MONGODB_URI or MERCHANT_TEST_MONGO_URI required for integration acceptance');
  const name = `merchant_test_login_${randomBytes(10).toString('hex')}`;
  let created = false;
  try {
    await mongoose.connect(uri, { dbName:name, serverSelectionTimeoutMS:7000 });
    assert.equal(mongoose.connection.db.databaseName,name);
    assert.equal((await mongoose.connection.db.listCollections().toArray()).length,0,'Never reuse an existing DB');
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
    assert.deepEqual((await service.logins({start_date:'2025-01-01',end_date:'2025-01-01'})).summary,{total_logins:0,unique_users:0});
  } finally {
    if(created){assert.match(mongoose.connection.db.databaseName,/^merchant_test_login_[a-f0-9]{20}$/);await mongoose.connection.db.dropDatabase();}
    await mongoose.disconnect();
    await require('../src/config/database').end();
  }
});
