const { sum, exactInteger }=require('./financialReport.data');
function reconcile(data) {
  const checks=[];
  function check(name,scope,source,actual) {
    const difference=exactInteger(BigInt(actual)-BigInt(source));
    const unit=/Số giao dịch|Trạng thái|Bút toán/.test(name)?'Số lượng':'VND';
    checks.push({name,scope,source,actual,difference,unit,status:difference===0?'Khớp':'Cần kiểm tra',
      note:scope==='Sổ cái'?'Bút toán ngoài điều kiện thực thu':scope==='Toàn hệ thống'?'Aggregate bảng gốc PostgreSQL trong cùng snapshot':'Aggregate cùng bộ lọc Merchant; gateway không lọc loại'});
  }
  const m=data.merchant;
  check('Tổng phí theo nguồn','Toàn hệ thống',data.controls.revenue,sum(data.fees.filter(r=>r.eligible),'revenue'));
  check('Tổng phí theo thời gian','Toàn hệ thống',data.controls.revenue,sum(data.system_series,'revenue'));
  check('QR PAYMENT + TRANSFER','Toàn hệ thống',data.controls.qr_fee,sum(data.fees.filter(r=>r.eligible && ['QR_FEE_PAYMENT','QR_FEE_TRANSFER'].includes(r.category)),'revenue'));
  check('QR theo thời gian','Toàn hệ thống',data.controls.qr_fee,sum(data.system_series,'qr_fee'));
  check('Nạp trừ rút theo thời gian','Toàn hệ thống',
    (data.cashflow.find(r=>r.type==='TOPUP')?.gross || 0)-(data.cashflow.find(r=>r.type==='WITHDRAW')?.gross || 0),
    sum(data.system_series,'topup')-sum(data.system_series,'withdraw'));
  for(const key of ['revenue','gross','transactions']) {
    const label={revenue:'Phí',gross:'Giá trị',transactions:'Số giao dịch'}[key];
    for(const [source,rows] of [['Merchant',m.merchants],['thời gian',m.timeseries],['loại',m.breakdown]]) {
      check(`${label} theo ${source}`,'Merchant theo bộ lọc',m.overview[key],sum(rows,key));
    }
  }
  check('Số giao dịch theo nghiệp vụ','Toàn hệ thống',data.controls.transactions,sum(data.cashflow,'total'));
  for(const row of data.cashflow) check(`Trạng thái ${row.type}`,'Toàn hệ thống',row.total,row.success+row.pending+row.failed+row.other);
  const g=m.gateway;
  check('Trạng thái yêu cầu thanh toán','Merchant theo bộ lọc',g.total,g.success+g.pending+g.expired+g.failed+g.cancelled);
  const issues=data.fees.filter(r=>!r.eligible);
  if(issues.length) check('Phí không đủ điều kiện ghi nhận','Sổ cái',0,sum(issues,'revenue'));
  if(issues.length && !sum(issues,'revenue')) check('Bút toán không đủ điều kiện','Sổ cái',0,sum(issues,'entries'));
  for(const row of data.cashflow) if(row.other) check(`Trạng thái khác: ${row.type}`,'Toàn hệ thống',0,row.other);
  if(!data.logins.available) checks.push({name:'Nguồn đăng nhập App',scope:'Toàn hệ thống',source:null,actual:null,difference:null,status:'Không khả dụng',unit:'Lượt/người',note:'MongoDB đọc riêng; không thay bằng số 0'});
  return checks;
}
module.exports={reconcile};
