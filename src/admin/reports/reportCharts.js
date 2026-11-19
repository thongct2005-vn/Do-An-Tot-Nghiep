const sharp = require('sharp');
const escapeXml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

async function chart(title, rows, horizontal) {
  const width=1000, height=520, max=rows.reduce((value,row)=>Math.max(value,row.value),1);
  const text=(x,y,value,size=18)=>`<text x="${x}" y="${y}" font-size="${size}" fill="#17365D">${escapeXml(value)}</text>`;
  let body=text(24,40,title,25)+text(24,68,'Đơn vị: VND',16);
  if (!rows.some(r=>r.value)) body+=text(340,260,'Không phát sinh',25);
  else if(horizontal) {
    rows.forEach((r,i)=>{
      const y=100+i*39;
      body+=text(20,y+21,r.label.length>27?r.label.slice(0,26)+'…':r.label,16);
      body+=`<rect x="270" y="${y}" width="${r.value/max*530}" height="25" fill="#087F8C"/>`;
      body+=text(815,y+20,new Intl.NumberFormat('vi-VN').format(r.value),15);
    });
  } else {
    const step=880/Math.max(1,rows.length-1);
    const points=rows.map((r,i)=>`${65+i*step},${420-r.value/max*300}`).join(' ');
    body+=`<polyline points="${points}" fill="none" stroke="#087F8C" stroke-width="3"/>`;
    body+=text(20,105,new Intl.NumberFormat('vi-VN').format(max),16);
    const stride=Math.max(1,Math.ceil(rows.length/6));
    rows.forEach((r,i)=> {if(i%stride===0 || i===rows.length-1) body+=text(40+i*step,455,r.label,14);});
  }
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><g font-family="Arial, sans-serif">${body}</g></svg>`)).png().toBuffer();
}
function chartData(data) {
  const merchants=[...data.merchant.merchants].sort((a,b)=>b.revenue-a.revenue || a.merchant_id.localeCompare(b.merchant_id)).slice(0,10);
  return {fees:data.system_series.map(r=>({label:r.bucket,value:r.revenue})),merchants:merchants.map(r=>({label:r.merchant_name || r.merchant_id,value:r.revenue}))};
}
async function createReportCharts(data) {
  const rows=chartData(data);
  return {
    fees:await chart('Tổng phí toàn hệ thống theo thời gian',rows.fees,false),
    merchants:await chart('Top 10 Merchant theo bộ lọc',rows.merchants,true),
  };
}
module.exports={ createReportCharts, chartData };
