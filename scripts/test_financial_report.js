// Give even unit-test modules that import the global pool an isolated database.
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const {createTestDatabase}=require('../tests/merchant_test_database');
async function main(){
  const target=await createTestDatabase();
  const extended=process.argv.includes('--extended');
  const tests=['admin_financial_report','admin_fee_reports','admin_report_hybrid','admin_fee_export_limit','admin_fee_report_logins','mongo_login_admin_audit','report_charts','admin_dashboard_service','admin_dashboard_postpaid_revenue','admin_dashboard_hybrid','dashboard_rollup_job'];
  if(extended) tests.push('merchant_fee_flow');
  try{
    let output='';
    const child=spawn(process.execPath,['--test',...tests.map(t=>`tests/${t}.test.js`)],{cwd:path.join(__dirname,'..'),env:process.env,windowsHide:true});
    for(const stream of [child.stdout,child.stderr]) stream.on('data',buffer=>{output+=buffer.toString();process.stdout.write(buffer);});
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    await fs.mkdir(path.join(__dirname,'../docs/samples'),{recursive:true});
    await fs.writeFile(path.join(__dirname,`../docs/samples/backend-${extended?'extended-':''}tests.log`),output);
    process.exitCode=code;
  }finally{await target.cleanup();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
