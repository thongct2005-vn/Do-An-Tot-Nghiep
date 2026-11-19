const test=require('node:test');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const { createReportCharts,chartData }=require('../src/admin/reports/reportCharts');
test('charts render Vietnamese labels and escaped merchant names offline',async()=>{
  const images=await createReportCharts({system_series:[{bucket:'2026-11-01',revenue:12000}],merchant:{merchants:[{merchant_id:'m1',merchant_name:'Cửa hàng <A> & "B"',revenue:12000}]}});
  for(const buffer of Object.values(images)) {
    const info=await sharp(buffer).metadata();
    assert.equal(info.format,'png'); assert.equal(info.width,1000); assert.equal(info.height,520);
  }
});
test('top ten comes from the full cohort; empty charts remain real PNGs',async()=>{
  const data={system_series:[],merchant:{merchants:Array.from({length:107},(_,i)=>({merchant_id:String(i).padStart(3,'0'),merchant_name:`Merchant ${i}`,revenue:i}))}};
  assert.deepEqual(chartData(data).merchants.map(r=>r.value),[106,105,104,103,102,101,100,99,98,97]);
  const images=await createReportCharts({system_series:[],merchant:{merchants:[]}});
  assert.equal((await sharp(images.fees).metadata()).format,'png');
});
