const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {fork,execFileSync}=require('node:child_process');
const {once}=require('node:events');
const {randomUUID,createHash}=require('node:crypto');
const {createTestDatabase}=require('../tests/merchant_test_database');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function main(){
  const root=path.resolve(__dirname,'..'),workspace=path.resolve(root,'..');
  const beforeFront=path.join(workspace,'web-admin/build/report-release-before'),afterFront=path.join(workspace,'web-admin/build/web');
  const beforeHash=hash(await fs.readFile(path.join(beforeFront,'main.dart.js'))),afterHash=hash(await fs.readFile(path.join(afterFront,'main.dart.js')));
  assert.notEqual(beforeHash,afterHash,'Build new Web Admin before rollout acceptance');
  const baseline='9675112',baselineDir=path.join(workspace,'web-admin/build/report-backend-before');
  await fs.mkdir(baselineDir,{recursive:true});
  for(const file of ['reports.routes.js','reports.service.js']){
    const source=execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'-C',root,'show',`${baseline}:src/admin/reports/${file}`],{windowsHide:true});
    await fs.writeFile(path.join(baselineDir,file),source);
  }
  const target=await createTestDatabase();const pool=require('../src/config/database');
  let host;
  async function stop(){if(host){const closed=once(host,'exit');host.send('stop');await closed;host=null;}}
  async function start(version,frontend){
    await stop();
    host=fork(path.join(__dirname,'report_release_host.js'),[],{env:{...process.env,REPORT_RELEASE:version,REPORT_FRONTEND_DIR:frontend,REPORT_BASELINE_DIR:baselineDir},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
    host.stderr.on('data',b=>process.stderr.write(b));
    const result=await Promise.race([once(host,'message').then(([m])=>m),once(host,'exit').then(([code])=>{throw Error(`Release host exited ${code}`);})]);
    return `http://127.0.0.1:${result.port}`;
  }
  const phases=[];
  try{
    const admin=randomUUID(),merchant=randomUUID(),customer=randomUUID();
    await pool.query("INSERT INTO users(id,role,full_name) VALUES($1,'ADMIN','Local release test'),($2,'MERCHANT','Test Merchant'),($3,'USER','Test Customer')",[admin,merchant,customer]);
    const tokens=require('../src/utils/auth/jwt').generateAuthTokens({id:admin,role:'ADMIN'});
    await pool.query('UPDATE users SET refresh_token=$1 WHERE id=$2',[tokens.refreshToken,admin]);
    await pool.query("INSERT INTO transactions(id,source_user_id,destination_user_id,transaction_type,status,amount,created_at) VALUES('rollout-fixture',$1,$2,'PAYMENT','SUCCESS',100000,'2026-11-01')",[customer,merchant]);
    await pool.query("INSERT INTO fee_ledger_entries(id,transaction_id,fee_type,amount,fee_wallet_user_id,fee_wallet_balance_before,fee_wallet_balance_after,created_at) VALUES($1,'rollout-fixture','QR_FEE',1000,$2,0,1000,'2026-11-01')",[randomUUID(),process.env.SYSTEM_FEE_WALLET_ID]);
    const fingerprint=async()=>(await pool.query("SELECT (SELECT sum(amount)::text FROM transactions) tx,(SELECT sum(amount)::text FROM fee_ledger_entries) fee,(SELECT jsonb_agg(jsonb_build_array(id,balance) ORDER BY id)::text FROM users) balances")).rows[0];
    const original=await fingerprint();
    for(const [name,version,frontend,expectedSheets,expectedHash] of [
      ['baseline','before',beforeFront,4,beforeHash],
      ['backend first, existing frontend','after',beforeFront,9,beforeHash],
      ['frontend upgraded','after',afterFront,9,afterHash],
      ['rollback both artifacts','before',beforeFront,4,beforeHash],
    ]){
      const url=await start(version,frontend);
      assert.equal((await fetch(url)).status,200);
      assert.equal(hash(Buffer.from(await (await fetch(`${url}/main.dart.js`)).arrayBuffer())),expectedHash);
      const response=await fetch(`${url}/api/v2/admin/reports/export?start_date=2026-11-01&end_date=2026-11-18&page=2&limit=20`,{headers:{Authorization:`Bearer ${tokens.accessToken}`}});
      assert.equal(response.status,200);
      const book=new(require('exceljs').Workbook)();await book.xlsx.load(Buffer.from(await response.arrayBuffer()));
      assert.equal(book.worksheets.length,expectedSheets);
      assert.deepEqual(await fingerprint(),original);
      const audit=(await pool.query("SELECT count(*)::int n FROM audit_outbox WHERE event_type='ADMIN_FINANCIAL_REPORT_GENERATED'")).rows[0].n;
      phases.push({name,backend:version,sheets:expectedSheets,frontend_sha256:expectedHash,audit_events:audit,money_unchanged:true});
    }
    assert.deepEqual(phases.map(p=>p.audit_events),[0,1,2,2]);
    await fs.writeFile(path.join(root,'docs/samples/local-rollout.json'),JSON.stringify({tested_at:new Date().toISOString(),environment:'Windows local; isolated PostgreSQL; report-only HTTP host and actual Flutter build artifacts',baseline_backend_commit:baseline,node:process.version,sharp:require('sharp').versions,phases,limitations:'No production deployment; served assets verified by SHA256, UI interactions covered by widget tests.'},null,2));
    console.log('PASS: baseline -> backend -> frontend -> rollback; two audit events retained; financial data unchanged.');
  }finally{await stop();await pool.end();await target.cleanup();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
