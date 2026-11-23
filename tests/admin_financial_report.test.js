const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { createTestDatabase } = require('./merchant_test_database');
const { exactInteger, sum, previousRange } = require('../src/admin/reports/financialReport.data');
const { resolveAdminDateRange } = require('../src/utils/common/dateRange');

test('Excel integer precision is checked before conversion and summation', () => {
  assert.equal(exactInteger('11806391000'), 11806391000);
  assert.equal(exactInteger('999999999999999'), 999999999999999);
  for (const value of ['1000000000000000', '9007199254740993', 9007199254740992]) {
    assert.throws(() => exactInteger(value), e => e.code === 'EXPORT_AMOUNT_PRECISION_EXCEEDED');
  }
  assert.throws(() => sum([{ value:999999999999999 },{ value:1 }], 'value'), /độ chính xác/);
});

test('financial aggregates preserve scope, source fees, boundaries and comparison period', async t => {
  const target = await createTestDatabase();
  require('dotenv').config({ quiet: true });
  const repo = require('../src/admin/reports/financialReport.repository');
  const db = new Client(target.config);
  await db.connect();
  const merchant=randomUUID(), customer=randomUUID(), wallet=process.env.SYSTEM_FEE_WALLET_ID;
  const f = { ...resolveAdminDateRange('2026-10-31','2026-11-01'), group:'day', merchant:null, type:null };
  async function tx(type, amount, status='SUCCESS', at='2026-11-01T12:00:00+07:00') {
    const id=randomUUID();
    await db.query('INSERT INTO transactions(id,transaction_type,amount,status,source_user_id,destination_user_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,type,amount,status,customer,merchant,at]);
    return id;
  }
  async function fee(id, type, amount, at='2026-11-01T12:00:00+07:00') {
    await db.query('INSERT INTO fee_ledger_entries(id,transaction_id,fee_type,amount,fee_wallet_user_id,fee_wallet_balance_before,fee_wallet_balance_after,created_at) VALUES($1,$2,$3,$4,$5,0,$4,$6)',[randomUUID(),id,type,amount,wallet,at]);
  }
  try {
    await db.query("INSERT INTO users(id,role,full_name) VALUES($1,'MERCHANT','Merchant'),($2,'USER','Customer')",[merchant,customer]);
    await tx('TOPUP',1000000);
    await tx('WITHDRAW',200000);
    const payment=await tx('PAYMENT',300000);
    const transfer=await tx('TRANSFER',500000);
    await tx('PAYMENT',100000,'PENDING');
    const failed=await tx('PAYMENT',100000,'FAILED');
    await tx('PAYMENT',100000,'CANCELLED');
    await fee(payment,'QR_FEE',6000);
    await fee(transfer,'QR_FEE',3000);
    await fee(transfer,'USER_FEE',1000);
    await fee(payment,'POSTPAID_SERVICE_FEE',2000);
    await fee(null,'MONTHLY_PLAN_FEE',500);
    await fee(failed,'QR_FEE',70);
    await tx('PAYMENT',40000,'COMPLETED','2026-11-01T23:59:59.999+07:00');
    const old=await tx('PAYMENT',900000,'SUCCESS','2026-10-30T23:59:59+07:00');
    await fee(old,'QR_FEE',100,'2026-10-31T00:00:00+07:00');
    await fee(payment,'WITHDRAW_FEE',999,'2026-11-02T00:00:00+07:00');

    await t.test('cashflow counts each status once and internal movement is not topup', async () => {
      const rows=await repo.cashflow(db,f);
      assert.equal(sum(rows,'total'),8);
      assert.equal(sum(rows,'success'),5);
      const topup=rows.find(r=>r.type==='TOPUP').gross;
      const withdraw=rows.find(r=>r.type==='WITHDRAW').gross;
      assert.equal(topup-withdraw,800000);
      const payments=rows.find(r=>r.type==='PAYMENT');
      assert.deepEqual([payments.success,payments.pending,payments.failed,payments.other,payments.gross],[2,1,1,1,340000]);
      const prev=await repo.cashflow(db,previousRange(f));
      assert.equal(sum(prev,'gross'),900000);
    });
    await t.test('fees include unlinked subscription but reject failed transaction fees', async () => {
      const rows=await repo.fees(db,f);
      assert.equal(sum(rows.filter(r=>r.eligible),'revenue'),12600);
      assert.equal(sum(rows.filter(r=>!r.eligible),'revenue'),70);
      assert.equal(rows.find(r=>r.category==='MONTHLY_PLAN_FEE').revenue,500);
      const control=await repo.controls(db,f);
      assert.deepEqual(control,{revenue:12600,transactions:8,qr_fee:9100});
    });
    await t.test('all time groups keep totals; empty buckets and Vietnam bounds', async () => {
      for(const group of ['day','week','month','quarter','year']) {
        const rows=await repo.systemSeries(db,{...f,group});
        assert.equal(sum(rows,'revenue'),12600,group);
        assert.equal(sum(rows,'topup'),1000000,group);
        assert.equal(sum(rows,'transactions'),5,group);
      }
      const empty=await repo.systemSeries(db,{...f,...resolveAdminDateRange('2025-12-31','2026-01-02')});
      assert.deepEqual(empty.map(r=>r.bucket),['2025-12-31','2026-01-01','2026-01-02']);
      assert.ok(empty.every(r=>r.revenue===0));
    });
    await t.test('merchant scope shares existing query but does not filter system data', async () => {
      const data=await repo.readFinancialData(db,{...f,merchant,type:'TRANSFER'});
      assert.equal(data.merchant.overview.revenue,3000);
      assert.equal(data.merchant.overview.transactions,1);
      assert.equal(sum(data.fees.filter(r=>r.eligible),'revenue'),12600);
      const split=new Date('2026-11-01T00:00:00+07:00');
      const fallbackMerchant=await repo.merchantReport(db,f,split);
      assert.equal(fallbackMerchant.overview.revenue,9100);
      const rawFeeSeries=await repo.merchantFeeSeries(db,f,null);
      const fallbackFeeSeries=await repo.merchantFeeSeries(db,f,split);
      assert.deepEqual(fallbackFeeSeries,rawFeeSeries);
    });
    await t.test('unknown fee categories remain visible rather than disappearing', async () => {
      await db.query('ALTER TABLE fee_ledger_entries DROP CONSTRAINT fee_ledger_entries_fee_type_check');
      await fee(payment,'FUTURE_FEE',50);
      const rows=await repo.fees(db,f);
      assert.equal(rows.find(r=>r.category==='FUTURE_FEE').revenue,50);
      assert.equal(sum(rows.filter(r=>r.eligible),'revenue'),12650);
    });
    await t.test('hybrid QR_FEE ledger proof reuses rollup when clean and falls back when ineligible QR_FEE exists', async () => {
      await db.query(`
        CREATE TABLE public.report_merchant_fee_hourly (
          bucket_hour TIMESTAMPTZ NOT NULL,
          merchant_id UUID NOT NULL,
          transaction_type TEXT NOT NULL,
          fee_amount NUMERIC(22, 0) NOT NULL DEFAULT 0,
          fee_tx_count BIGINT NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (bucket_hour, merchant_id, transaction_type)
        )
      `);
      try {
        await db.query(`
          INSERT INTO public.report_merchant_fee_hourly (bucket_hour, merchant_id, transaction_type, fee_amount, fee_tx_count)
          SELECT date_trunc('hour', l.created_at), u.id, t.transaction_type::text, SUM(l.amount), COUNT(*)
          FROM public.fee_ledger_entries l
          JOIN public.transactions t ON t.id = l.transaction_id
          JOIN public.users u ON u.id = t.destination_user_id AND u.role = 'MERCHANT'
          WHERE l.fee_type = 'QR_FEE' AND t.status IN ('SUCCESS', 'COMPLETED')
            AND t.transaction_type IN ('PAYMENT', 'TRANSFER')
          GROUP BY 1, 2, 3
        `);
        const baseline = await repo.readFinancialData(db, f);
        // Split at 2026-11-01T00:00:00+07:00: [10-31, 11-01) has only 1 eligible QR_FEE (100 VND), so proof passes!
        const cleanSplit = new Date('2026-11-01T00:00:00+07:00');
        assert.equal(await repo.verifyQrFeeRollupWindow(db, f.startInstant, cleanSplit), true);
        const hybridClean = await repo.readFinancialData(db, f, { rollupUntil: cleanSplit });
        assert.deepEqual(hybridClean.fees, baseline.fees);
        assert.deepEqual(hybridClean.system_series, baseline.system_series);
        assert.deepEqual(hybridClean.controls, baseline.controls);
        assert.deepEqual(hybridClean.merchant_fee_series, baseline.merchant_fee_series);

        // Split at 2026-11-02T00:00:00+07:00: includes the 70 VND failed transaction QR_FEE on 11-01, so proof detects mismatch and falls back!
        const dirtySplit = new Date('2026-11-02T00:00:00+07:00');
        assert.equal(await repo.verifyQrFeeRollupWindow(db, f.startInstant, dirtySplit), false);
        const hybridFallback = await repo.readFinancialData(db, f, { rollupUntil: dirtySplit });
        assert.deepEqual(hybridFallback.fees, baseline.fees);
        assert.deepEqual(hybridFallback.system_series, baseline.system_series);
        assert.deepEqual(hybridFallback.controls, baseline.controls);
      } finally {
        await db.query('DROP TABLE public.report_merchant_fee_hourly');
      }
    });
    await t.test('snapshot excludes a concurrent commit from every financial section', async () => {
      const { Pool }=require('pg');
      const pool=new Pool(target.config);
      const { readSnapshot }=require('../src/admin/reports/financialReport.service');
      let released=false;
      try {
        const wrapper={ async connect() {
          const client=await pool.connect();
          let first=true;
          return {
            async query(sql,params) {
              const result=await client.query(sql,params);
              if(first && sql.includes('clock_timestamp()')) {
                first=false;
                const concurrent=await tx('PAYMENT',800000);
                await fee(concurrent,'QR_FEE',8000);
              }
              return result;
            },
            release(){ released=true; client.release(); }
          };
        }};
        const data=await readSnapshot(wrapper,{...f,role:'ALL'},customer);
        assert.equal(sum(data.fees.filter(r=>r.eligible),'revenue'),12650);
        assert.equal(data.controls.revenue,12650);
        assert.equal(sum(data.system_series,'revenue'),12650);
        assert.equal(data.growth.transactions.current_count,5);
        assert.equal(released,true);
        assert.equal((await repo.controls(db,f)).revenue,20650);
      } finally {await pool.end();}
    });
    await t.test('query failure rolls back and releases without replacing missing finance with zero',async()=>{
      const {readSnapshot}=require('../src/admin/reports/financialReport.service');
      const calls=[];let released=false;
      const pool={connect:async()=>({query:async sql=>{calls.push(sql);if(sql.startsWith('SELECT')) throw new Error('missing ledger');return {rows:[]};},release:()=>{released=true;}})};
      await assert.rejects(readSnapshot(pool,f,customer),/missing ledger/);
      assert.equal(released,true);assert.equal(calls.at(-1),'ROLLBACK');
    });
    await t.test('export releases snapshot before rendering, audits only completed files, and tolerates Mongo failure',async()=>{
      const {Pool}=require('pg'); const pool=new Pool(target.config);
      const {exportFinancialReport}=require('../src/admin/reports/financialReport.service');
      const {buildWorkbook}=require('../src/admin/reports/financialReport.export');
      const {reconcile}=require('../src/admin/reports/financialReport.reconciliation');
      let released=false,audit;
      const wrapper={connect:async()=>{const c=await pool.connect();return {query:(...args)=>c.query(...args),release:()=>{released=true;c.release();}};},query:async(sql,args)=>{audit=JSON.parse(args[2]);return pool.query(sql,args);}};
      const input={start_date:'2026-10-31',end_date:'2026-11-01',role:'MERCHANT',admin_name:'FAKE',page:'2',limit:'20'};
      let dto;
      const options={pool:wrapper,readLogins:async()=>{throw Error('offline');},renderer:async data=>{assert.equal(released,true);dto=data;return buildWorkbook(data);}};
      try {
        const result=await exportFinancialReport(input,customer,options);
        assert.equal(dto.logins.available,false);assert.ok(!('summary' in dto.logins));
        assert.equal(dto.growth.accounts.length,1);assert.equal(dto.growth.accounts[0].role,'MERCHANT');
        assert.ok(new Date(dto.metadata.generated_at)>=new Date(dto.metadata.financial_snapshot_at));
        assert.equal(audit.report_id,result.reportId);assert.equal(audit.admin_id,customer);assert.equal(audit.logins_available,false);
        assert.equal(audit.filters.role,'MERCHANT');assert.ok(!JSON.stringify(audit).includes('FAKE'));
        const book=new (require('exceljs').Workbook)();await book.xlsx.load(result.buffer);
        assert.deepEqual(book.worksheets.map(s=>s.name),['01_Tong_quan','02_Dong_tien','03_Doanh_thu_phi','04_Theo_thoi_gian','05_Merchant','06_Cong_thanh_toan','07_Van_hanh','08_Doi_soat','09_Thuyet_minh']);
        assert.equal(book.creator,'Customer');assert.equal(book.getWorksheet('01_Tong_quan').getCell('A9').value,20650);
        assert.equal(book.getWorksheet('01_Tong_quan').getCell('E9').value,1000000);
        assert.equal(book.getWorksheet('01_Tong_quan').getCell('I9').value,200000);
        assert.equal(book.getWorksheet('01_Tong_quan').getCell('A14').value,800000);
        assert.notEqual(book.getWorksheet('01_Tong_quan').getCell('I14').value,20650);
        assert.equal(book.getWorksheet('01_Tong_quan').getImages().length,2);
        assert.equal(book.model.media.length,2);assert.ok(book.model.media.every(m=>m.buffer.subarray(1,4).toString()==='PNG'));
        assert.ok(book.getWorksheet('04_Theo_thoi_gian').getCell('A8').value instanceof Date);
        const merchants=book.getWorksheet('05_Merchant');assert.equal(merchants.getCell('B8').value,merchant);
        assert.equal(merchants.getCell('F9').value.result,dto.merchant.overview.revenue);
        assert.equal(merchants.pageSetup.printTitlesRow,'7:7');assert.equal(merchants.pageSetup.fitToHeight,0);
        assert.ok(dto.reconciliation.some(c=>c.status==='Cần kiểm tra'));assert.ok(dto.reconciliation.some(c=>c.status==='Không khả dụng'));
        const changed=structuredClone(dto);changed.merchant.merchants[0].revenue+=1;
        assert.equal(reconcile(changed).find(r=>r.name==='Phí theo Merchant').difference,1);
        assert.equal(dto.merchant.merchants[0].revenue,changed.merchant.merchants[0].revenue-1);
        const scoped=await require('../src/admin/reports/financialReport.service').readSnapshot(pool,{...f,merchant,type:'TRANSFER',period:{start_date:'2026-10-31',end_date:'2026-11-01',group_by:'day'}},customer);
        scoped.logins={available:true};
        assert.ok(reconcile(scoped).filter(r=>r.scope==='Merchant theo bộ lọc').every(r=>r.status==='Khớp'));
        dto.merchant.merchants[0].merchant_name='=HYPERLINK("https://invalid","not executed")';
        const safe=await buildWorkbook(dto);assert.equal(safe.getWorksheet('05_Merchant').getCell('C8').type,require('exceljs').ValueType.String);
        const near=structuredClone(dto);near.merchant.gateway={total:1000000,success:999998,failed:2,expired:0,cancelled:0,pending:0};
        near.merchant.merchants[0].merchant_name='Cửa hàng tiếng Việt rất dài & <tên> '.repeat(8);
        const nearBook=await buildWorkbook(near);
        const gateway=nearBook.getWorksheet('06_Cong_thanh_toan');let rate;
        gateway.eachRow(row=>{if(row.getCell(1).value==='Tỷ lệ thành công') rate=row.getCell(2).value;});
        assert.equal(rate,0.999998);
        const overview=nearBook.worksheets[0];const imageBottom=overview.getImages()[0].range.tl.nativeRow+13;
        let qualityHeader;overview.eachRow(row=>{if(row.getCell(1).value==='Tình trạng báo cáo')qualityHeader=row.number;});
        assert.ok(qualityHeader>imageBottom);
        await assert.rejects(buildWorkbook(dto,{charts:async()=>{throw Error('render failed');}}),/render failed/);
        audit=undefined;
        await assert.rejects(exportFinancialReport(input,customer,{...options,renderer:async()=>{assert.equal(released,true);throw Error('render failure');}}),/render failure/);
        assert.equal(audit,undefined);
        await assert.rejects(exportFinancialReport(input,customer,{...options,pool:{...wrapper,query:async()=>{throw Error('audit unavailable');}},renderer:async()=>({xlsx:{writeBuffer:async()=>Buffer.from('test')}})}),/audit unavailable/);
        const empty=await exportFinancialReport({...input,start_date:'2020-01-01',end_date:'2020-01-03'},customer,{...options,readLogins:async()=>({summary:{total_logins:0,unique_users:0}})});
        const emptyBook=new (require('exceljs').Workbook)();await emptyBook.xlsx.load(empty.buffer);
        assert.equal(emptyBook.worksheets.length,9);assert.equal(emptyBook.getWorksheet('01_Tong_quan').getCell('A9').value,0);
        assert.equal(dto.merchant.merchants.length,0);assert.ok(dto.reconciliation.every(r=>r.status==='Khớp'));

        // Reversal transactions (operation_type = 'REVERSAL') must be categorized as PAYMENT_REVERSAL,
        // labeled 'Hoàn tiền thanh toán Merchant' in Excel, excluded from TRANSFER and Merchant revenue/gross, and reconcile with difference = 0.
        const revId = randomUUID();
        await db.query(
          `INSERT INTO transactions(id,transaction_type,amount,status,source_user_id,destination_user_id,fee_rate_snapshot,created_at)
           VALUES($1,'TRANSFER',300000,'SUCCESS',$2,$3,$4::jsonb,'2026-11-01T14:00:00+07:00')`,
          [revId, merchant, merchant, JSON.stringify({ operation_type: 'REVERSAL', reversal_of_transaction_id: payment, original_funding_source: 'MAIN_WALLET' })],
        );
        const revData = await repo.readFinancialData(db, f);
        const payRevRow = revData.cashflow.find(r => r.type === 'PAYMENT_REVERSAL');
        assert.ok(payRevRow);
        assert.equal(payRevRow.gross, 300000);
        assert.equal(revData.cashflow.some(r => r.type === 'TRANSFER_REVERSAL'), false);
        assert.equal(revData.cashflow.find(r => r.type === 'TRANSFER').gross, 500000);
        assert.equal(sum(revData.system_series, 'payment_reversal'), 300000);
        assert.equal(revData.merchant.overview.gross, 1640000);
        const revChecks = reconcile({ ...revData, filters: { merchant_id: null, transaction_type: 'ALL' }, logins: { available: false } });
        assert.equal(revChecks.find(c => c.name === 'Số giao dịch theo nghiệp vụ').difference, 0);
        const revBook = await buildWorkbook({ ...revData, period: f.period, filters: { merchant_id: null, transaction_type: 'ALL', role: 'ALL' }, growth: dto.growth, logins: dto.logins, metadata: dto.metadata, previous_period: dto.previous_period, reconciliation: revChecks });
        let foundMerchantRevLabel = false;
        revBook.getWorksheet('02_Dong_tien').eachRow(row => {
          if (row.getCell(1).value === 'Hoàn tiền thanh toán Merchant') foundMerchantRevLabel = true;
        });
        assert.equal(foundMerchantRevLabel, true);

        // New REFUND transactions (transaction_type = 'REFUND') must also be categorized as PAYMENT_REVERSAL,
        // excluded from TRANSFER and Merchant revenue/gross, and reconcile cleanly.
        const refundTxId = randomUUID();
        await db.query(
          `INSERT INTO transactions(id,transaction_type,amount,status,source_user_id,destination_user_id,fee_rate_snapshot,created_at)
           VALUES($1,'REFUND',200000,'SUCCESS',$2,$3,$4::jsonb,'2026-11-01T15:00:00+07:00')`,
          [refundTxId, merchant, customer, JSON.stringify({ operation_type: 'REVERSAL', reversal_of_transaction_id: payment, original_funding_source: 'MAIN_WALLET' })],
        );
        const refundData = await repo.readFinancialData(db, f);
        const payRefundRow = refundData.cashflow.find(r => r.type === 'PAYMENT_REVERSAL');
        assert.ok(payRefundRow);
        assert.equal(payRefundRow.gross, 500000);
        assert.equal(refundData.cashflow.find(r => r.type === 'TRANSFER').gross, 500000);
        assert.equal(sum(refundData.system_series, 'payment_reversal'), 500000);
        assert.equal(refundData.merchant.overview.gross, 1640000);
        const refundChecks = reconcile({ ...refundData, filters: { merchant_id: null, transaction_type: 'ALL' }, logins: { available: false } });
        assert.equal(refundChecks.find(c => c.name === 'Số giao dịch theo nghiệp vụ').difference, 0);

        await db.query('ALTER TABLE fee_ledger_entries RENAME TO missing_ledger_fixture');
        try { await assert.rejects(exportFinancialReport(input,customer,options),e=>e.code==='42P01'); }
        finally {await db.query('ALTER TABLE missing_ledger_fixture RENAME TO fee_ledger_entries');}
      }finally{await pool.end();}
    });
  } finally { await db.end(); await require('../src/config/database').end(); await target.cleanup(); }
});
