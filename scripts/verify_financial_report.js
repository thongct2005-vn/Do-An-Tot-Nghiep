// Reproducible acceptance fixture. Creates/drops a new isolated test database only.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createTestDatabase}=require('../tests/merchant_test_database');
async function main(){
  assert.equal(process.env.NODE_ENV,'test');
  const target=await createTestDatabase();
  const pool=require('../src/config/database');
  const reports=require('../src/admin/reports/reports.service');
  const {exportFinancialReport}=require('../src/admin/reports/financialReport.service');
  const admin=randomUUID(),customer=randomUUID();
  const out=path.resolve(__dirname,'../docs/samples');
  try{
    await pool.query("INSERT INTO users(id,role,full_name) VALUES($1,'ADMIN','Quản trị viên kiểm thử'),($2,'USER','Tài khoản kiểm thử')",[admin,customer]);
    // Use a dedicated connection because TEMP tables are connection scoped.
    const c=await pool.connect();
    try{
      await c.query('CREATE TEMP TABLE IF NOT EXISTS fixture_merchants AS SELECT n, gen_random_uuid() id FROM generate_series(1,107) n');
      await c.query("INSERT INTO users(id,role,full_name) SELECT id,'MERCHANT','Cửa hàng mẫu '||lpad(n::text,3,'0') FROM fixture_merchants");
      await c.query(`INSERT INTO transactions(id,source_user_id,destination_user_id,transaction_type,status,amount,created_at)
        SELECT 'sample-'||s.n,$1,m.id,(CASE WHEN s.n<=31439 THEN 'PAYMENT' ELSE 'TRANSFER' END)::transaction_type_enum,'SUCCESS',
          296851 + CASE WHEN s.n<=33028 THEN 1 ELSE 0 END,
          '2026-11-01T00:00:00+07:00'::timestamptz + ((s.n-1)%18)*interval '1 day'
        FROM generate_series(1,39772) s(n) JOIN fixture_merchants m ON m.n=(s.n-1)%107+1`,[customer]);
      // Assign the exact target total independently of transaction amount.
      await c.query(`INSERT INTO fee_ledger_entries(id,transaction_id,fee_type,amount,fee_wallet_user_id,fee_wallet_balance_before,fee_wallet_balance_after,created_at)
        SELECT gen_random_uuid(),id,'QR_FEE',2728+CASE WHEN substring(id from 8)::int<=26642 THEN 1 ELSE 0 END,
          '00000000-0000-7000-8000-000000000001',0,1,created_at FROM transactions WHERE id LIKE 'sample-%'`);
    }finally{c.release();}
    const range={start_date:'2026-11-01',end_date:'2026-11-18',page:'2',limit:'20'};
    const sql=(await pool.query("SELECT count(*)::int n,sum(amount)::text gross FROM transactions WHERE id LIKE 'sample-%'")).rows[0];
    assert.equal(sql.n,39772);assert.equal(Number(sql.gross),11806391000);
    const api=await reports.report(range);
    assert.deepEqual(api.overview,{revenue:108524658,gross:11806391000,transactions:39772});
    const opts={pool,readLogins:async()=>({summary:{total_logins:500,unique_users:123}})};
    await fs.mkdir(out,{recursive:true});
    const first=await exportFinancialReport(range,admin,opts);
    await fs.writeFile(path.join(out,'bao-cao-mau-theo-anh.xlsx'),first.buffer);
    await pool.query(`INSERT INTO fee_ledger_entries(id,transaction_id,fee_type,amount,fee_wallet_user_id,fee_wallet_balance_before,fee_wallet_balance_after,created_at)
      VALUES(gen_random_uuid(),'sample-1','USER_FEE',500000,'00000000-0000-7000-8000-000000000001',0,500000,'2026-11-02'),
      (gen_random_uuid(),'sample-1','POSTPAID_SERVICE_FEE',250000,'00000000-0000-7000-8000-000000000001',0,250000,'2026-11-02'),
      (gen_random_uuid(),NULL,'MONTHLY_PLAN_FEE',50000,'00000000-0000-7000-8000-000000000001',0,50000,'2026-11-02')`);
    const queries=[];
    const tracedPool={query:(...args)=>pool.query(...args),connect:async()=>{const client=await pool.connect();return {
      query:async(sql,params)=>{const start=performance.now();const result=await client.query(sql,params);
        if(/^\s*(SELECT|WITH)/i.test(sql)) queries.push({sql,params,rows:result.rowCount,elapsed_ms:performance.now()-start});return result;},
      release:()=>client.release(),
    };}};
    const before=process.memoryUsage().rss,started=performance.now();
    const second=await exportFinancialReport({...range,start_date:'2026-01-01',group_by:'day'},admin,{...opts,pool:tracedPool});
    const elapsed=performance.now()-started,after=process.memoryUsage().rss;
    await fs.writeFile(path.join(out,'bao-cao-mau-them-phi-he-thong.xlsx'),second.buffer);
    const book=new(require('exceljs').Workbook)();await book.xlsx.load(second.buffer);
    assert.equal(book.getWorksheet('01_Tong_quan').getCell('A9').value,109324658);
    assert.equal(book.getWorksheet('01_Tong_quan').getCell('I14').value,108524658);
    const f=reports.filters(range);
    const plan=(await pool.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+reports.REPORT_SQL,[f.startInstant,f.nextDayInstant,null,null,'day',20,0])).rows[0]['QUERY PLAN'];
    const financialPlans=[];
    for(const query of queries){
      const result=await pool.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query.sql,query.params);
      financialPlans.push({returned_rows:query.rows,observed_query_ms:query.elapsed_ms,plan:result.rows[0]['QUERY PLAN']});
    }
    const catalog=(await pool.query("SELECT tablename,indexname FROM pg_indexes WHERE schemaname='public' AND tablename IN ('transactions','fee_ledger_entries','payment_requests') ORDER BY tablename,indexname")).rows;
    const audit=(await pool.query("SELECT count(*)::int n FROM audit_outbox WHERE event_type='ADMIN_FINANCIAL_REPORT_GENERATED'")).rows[0].n;
    assert.equal(audit,2);
    const evidence={generated_at:new Date().toISOString(),fixture:{merchants:107,transactions:39772,merchant_revenue:108524658,merchant_gross:11806391000,additional_system_fees:800000},benchmark:{days:322,export_ms:Math.round(elapsed),rss_before:before,rss_after:after,rss_delta:after-before,xlsx_bytes:second.buffer.length,note:'RSS before/after, not peak; local fixture, not production SLA'},plan,financial_plans:financialPlans,catalog,audit_events:audit};
    await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(evidence,null,2));
    console.log(JSON.stringify({output:out,benchmark:evidence.benchmark,audit_events:audit}));
  }finally{await pool.end();await target.cleanup();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
