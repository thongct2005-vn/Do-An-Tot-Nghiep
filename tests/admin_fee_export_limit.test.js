const test = require('node:test');
const assert = require('node:assert/strict');
const repository = require('../src/admin/transaction/transaction.repository');
const service = require('../src/admin/transaction/transaction.service');

test('detailed Excel accepts 5000 rows and rejects 5001 without truncation', async () => {
  const original = repository.getTransactionsForExport;
  let size = 5001;
  repository.getTransactionsForExport = async params => {
    assert.equal(params.limit,5001);
    return Array.from({length:size},(_,i)=>({id:`limit-${i}`,transaction_type:'PAYMENT',status:'SUCCESS',amount:1000,fee:0,merchant_fee:200,source_balance_before:null,source_balance_after:null,dest_balance_before:null,dest_balance_after:null,created_at:new Date('2026-11-01T00:00:00+07:00')}));
  };
  const args={start_date:'2026-11-01',end_date:'2026-11-01',currentUser:{full_name:'Test Admin'}};
  try {
    await assert.rejects(service.exportTransactions(args),e=>e.statusCode===422 && e.code==='EXPORT_LIMIT_EXCEEDED' && e.message.includes('5.000'));
    size=5000;
    const result=await service.exportTransactions(args);
    assert.equal(result.totalRows,5000);
    const book=new (require('exceljs').Workbook)(); await book.xlsx.load(result.buffer);
    const sheet=book.getWorksheet('Báo cáo giao dịch');
    assert.equal(sheet.getCell('B5008').value,'limit-4999');
    assert.equal(sheet.getCell('B9').value,'limit-0');
  } finally {repository.getTransactionsForExport=original;await require('../src/config/database').end();}
});
