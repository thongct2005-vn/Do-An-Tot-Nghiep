const ExcelJS=require('exceljs');
const {sum,percentChange,exactInteger}=require('./financialReport.data');
const {createReportCharts}=require('./reportCharts');
const MONEY='#,##0 "₫";[Red]-#,##0 "₫";0 "₫"';
const NUMBER='#,##0';
const PERCENT='0.0000%';
const feeNames={QR_FEE_PAYMENT:'Phí Merchant — Thanh toán',QR_FEE_TRANSFER:'Phí Merchant — Chuyển tiền',USER_FEE:'Phí người dùng',WITHDRAW_FEE:'Phí rút tiền',MONTHLY_PLAN_FEE:'Phí gói dịch vụ',POSTPAID_SERVICE_FEE:'Phí dịch vụ Ví trả sau',POSTPAID_LATE_FEE:'Phí trễ hạn Ví trả sau'};
const typeNames={TOPUP:'Nạp tiền',WITHDRAW:'Rút tiền',TRANSFER:'Chuyển tiền',TRANSFER_REVERSAL:'Hoàn tiền P2P',PAYMENT:'Thanh toán'};
const ratio=(a,b)=>b?a/b:null;
const day=s=>new Date(`${s}T00:00:00Z`);
const stamp=s=>new Date(s).toISOString();
async function buildWorkbook(data,{charts=createReportCharts}={}) {
  const book=new ExcelJS.Workbook();
  book.creator=data.metadata.admin_name || 'Quản trị viên';
  book.created=new Date(data.metadata.generated_at);
  book.views=[{activeTab:0}];
  const period=`${data.period.start_date} đến ${data.period.end_date} · Asia/Ho_Chi_Minh · VND`;
  const merchantScope=`Merchant: ${data.filters.merchant_id || 'Tất cả'} · Loại: ${data.filters.transaction_type}`;
  function sheet(name,title,scope='Toàn hệ thống',widths=[36,22,22,22,20,20]) {
    const s=book.addWorksheet(name,{properties:{defaultRowHeight:22},views:[{showGridLines:false}],pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0}});
    s.columns=widths.map(width=>({width}));
    s._reportColumns=widths.length;
    const end=s.getColumn(widths.length).letter;
    s.mergeCells(`A1:${end}2`); s.getCell('A1').value=title;
    s.getCell('A1').font={name:'Calibri',size:21,bold:true,color:{argb:'FFFFFFFF'}};
    s.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17365D'}};
    for(const [row,text] of [[3,period],[4,scope],[5,`Mã báo cáo: ${data.metadata.report_id}`]]) {
      s.mergeCells(`A${row}:${end}${row}`); s.getCell(`A${row}`).value=text;
      s.getCell(`A${row}`).alignment={wrapText:true,vertical:'middle'};
      s.getRow(row).height=30;
    }
    s.headerFooter.oddFooter=`&L${data.metadata.report_id}&RTrang &P / &N`;
    return s;
  }
  function table(s,title,headers,rows,formats={},totalKeys=[]) {
    if(s.rowCount+rows.length+5>1048576) throw new Error('Báo cáo vượt số dòng Excel; vui lòng thu hẹp kỳ báo cáo.');
    const section=s.addRow([title]); s.mergeCells(section.number,1,section.number,s._reportColumns); section.font={bold:true,color:{argb:'FF087F8C'},size:13}; section.height=32;
    const header=s.addRow(headers); header.font={bold:true,color:{argb:'FFFFFFFF'}};
    header.eachCell(c=>{c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17365D'}};c.alignment={wrapText:true,vertical:'middle'};});
    header.height=34;
    const first=header.number+1;
    for(const values of rows) {
      const row=s.addRow(values.map(v=>v==null?'Chưa đủ dữ liệu':v));
      row.eachCell((c,i)=>{
        c.font={name:'Calibri',size:11}; c.alignment={vertical:'middle',wrapText:typeof c.value==='string'};
        if(formats[i]) c.numFmt=formats[i];
        if(row.number%2===0) c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF3F6FA'}};
        if(['Khớp','Cần kiểm tra','Không khả dụng'].includes(c.value)) c.fill={type:'pattern',pattern:'solid',fgColor:{argb:c.value==='Khớp'?'FFE2F0D9':'FFFFF2CC'}};
      });
      row.height=Math.max(24,...values.map((v,i)=>typeof v==='string'?Math.ceil(v.length/Math.max(8,s.getColumn(i+1).width-2))*16:24));
    }
    const last=s.rowCount;
    if(!s.autoFilter) {
      s.autoFilter={from:{row:header.number,column:1},to:{row:Math.max(last,header.number),column:headers.length}};
      s.views=[{state:'frozen',ySplit:header.number,showGridLines:false}];
      s.pageSetup.printTitlesRow=`${header.number}:${header.number}`;
    }
    if(totalKeys.length) {
      const total=s.addRow(['TỔNG']); total.font={bold:true};
      for(const i of totalKeys) {
        const result=exactInteger(rows.reduce((acc,row)=>acc+(typeof row[i-1]==='number'?BigInt(exactInteger(row[i-1])):0n),0n));
        total.getCell(i).value=rows.length?{formula:`SUM(${s.getColumn(i).letter}${first}:${s.getColumn(i).letter}${last})`,result}:0;
        total.getCell(i).numFmt=formats[i] || NUMBER;
      }
    }
    s.addRow([]);
  }
  const m=data.merchant, current=data.fees.filter(r=>r.eligible), previous=data.previous_fees.filter(r=>r.eligible);
  const totalFees=sum(current,'revenue');
  const feeCategories=[...new Set([...Object.keys(feeNames),...current.map(r=>r.category),...previous.map(r=>r.category)])];
  const feeRows=feeCategories.map(category=>{
    const now=current.find(r=>r.category===category)?.revenue || 0;
    const prev=previous.find(r=>r.category===category)?.revenue || 0;
    return [feeNames[category] || `Phí khác: ${category}`,now,prev,exactInteger(BigInt(now)-BigInt(prev)),percentChange(now,prev),ratio(now,totalFees)];
  });
  const moneyByType=type=>data.cashflow.find(r=>r.type===type)?.gross || 0;
  const summary=sheet('01_Tong_quan','BÁO CÁO TỔNG HỢP TÀI CHÍNH',`Toàn hệ thống; phân tích ${merchantScope}`,[30,2,23,2,23,2,23,2,18,2,18,2]);
  summary.mergeCells('A6:L6'); summary.getCell('A6').value=`Người xuất: ${data.metadata.admin_name} · Tạo: ${stamp(data.metadata.generated_at)}`;
  summary.mergeCells('A7:L7'); summary.getCell('A7').value=`Snapshot PostgreSQL: ${stamp(data.metadata.financial_snapshot_at)}`;
  const kpis=[['Tổng phí thực thu',totalFees,MONEY],['Nạp thành công',moneyByType('TOPUP'),MONEY],['Rút thành công',moneyByType('WITHDRAW'),MONEY],['Chênh lệch nạp − rút',moneyByType('TOPUP')-moneyByType('WITHDRAW'),MONEY],['Giao dịch thành công',sum(data.cashflow,'success'),NUMBER],['Phí Merchant',m.overview.revenue,MONEY]];
  kpis.forEach(([label,value,format],i)=>{
    const row=8+Math.floor(i/3)*5,col=1+(i%3)*4;
    summary.mergeCells(row,col,row,col+3); summary.mergeCells(row+1,col,row+2,col+3); summary.mergeCells(row+3,col,row+3,col+3);
    const title=summary.getCell(row,col); title.value=label; title.font={bold:true,size:11,color:{argb:'FF17365D'}};
    const cell=summary.getCell(row+1,col); cell.value=exactInteger(value); cell.numFmt=format; cell.font={bold:true,size:22,color:{argb:'FF087F8C'}};
    const caption=summary.getCell(row+3,col); caption.value=i===5?'Merchant theo bộ lọc':'Toàn hệ thống'; caption.font={size:10};
    for(let r=row;r<=row+3;r++) for(let c=col;c<=col+3;c++) {summary.getCell(r,c).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF3F6FA'}};summary.getCell(r,c).alignment={vertical:'middle',wrapText:true};}
  });
  summary.getRow(18).getCell(1).value=`Merchant: ${m.overview.transactions.toLocaleString('vi-VN')} GD · Giá trị: ${m.overview.gross.toLocaleString('vi-VN')} ₫`;
  summary.mergeCells('A18:L18');
  table(summary,'Phí thực thu và so sánh kỳ trước',['Nhóm phí','Kỳ này','Kỳ trước','Chênh lệch','Tăng trưởng','Tỷ trọng'],feeRows,{2:MONEY,3:MONEY,4:MONEY,5:PERCENT,6:PERCENT},[2,3,4]);
  // Spacer columns keep the table across A:L without merging any data cells.
  for(let r=20;r<summary.rowCount;r++) {
    const values=Array.from({length:6},(_,i)=>summary.getCell(r,i+1).value);
    const styles=Array.from({length:6},(_,i)=>structuredClone(summary.getCell(r,i+1).style));
    for(let c=1;c<=12;c++) {summary.getCell(r,c).value=null;summary.getCell(r,c).style={};}
    values.forEach((v,i)=>{const c=i*2+1;summary.getCell(r,c).value=v;summary.getCell(r,c).style=styles[i];});
  }
  for(const [c,source] of [[3,1],[5,2],[7,3]]) {
    const cell=summary.getCell(summary.rowCount-1,c);
    if(cell.value?.formula) cell.value={formula:`SUM(${summary.getColumn(c).letter}21:${summary.getColumn(c).letter}${20+feeRows.length})`,result:sum(feeRows.map(r=>({v:r[source]})),'v')};
  }
  summary.autoFilter=undefined; summary.views=[{showGridLines:false}];
  const images=await charts(data);
  const imageStart=summary.rowCount+1;
  for(const [i,buffer] of Object.values(images).entries()) {
    summary.addImage(book.addImage({buffer,extension:'png'}),{tl:{col:i*6,row:imageStart},ext:{width:480,height:250},editAs:'oneCell'});
  }
  for(let r=imageStart+1;r<=imageStart+13;r++) summary.getRow(r).height=15;
  while(summary.rowCount<imageStart+14) summary.addRow([]);
  const qualityStart=summary.rowCount+1;
  table(summary,'Tình trạng báo cáo',['Nội dung','Kết quả'],[
    ['Đối soát nội bộ',data.reconciliation.some(r=>r.status!=='Khớp')?'Cần kiểm tra':'Khớp'],
    ['Đăng nhập App',data.logins.available?'Có dữ liệu':'Không khả dụng'],
    ...data.reconciliation.filter(r=>r.status==='Cần kiểm tra').map(r=>[r.name,r.status]),
  ]);
  for(let r=qualityStart+1;r<summary.rowCount;r++) {
    const source=summary.getCell(r,2),target=summary.getCell(r,5);
    target.value=source.value;target.style=structuredClone(source.style);source.value=null;source.style={};
  }
  const note=summary.addRow(['Chênh lệch nạp − rút không phải lợi nhuận. Đối soát nội bộ không thay thế quyết toán ngân hàng.']);
  summary.mergeCells(note.number,1,note.number,12);note.height=36;note.getCell(1).alignment={wrapText:true};
  summary.autoFilter=undefined;summary.views=[{showGridLines:false}];
  delete summary.pageSetup.printTitlesRow;
  // Excel ignores manual breaks in fit-to-page mode. Use a fixed dashboard
  // scale and a break before the images; data sheets retain fitToWidth=1.
  summary.pageSetup.fitToPage=false;summary.pageSetup.scale=70;
  summary.pageSetup.fitToHeight=0;summary.getRow(imageStart).addPageBreak();
  const cash=sheet('02_Dong_tien','DÒNG TIỀN VÀ GIAO DỊCH','Toàn hệ thống',[30,19,19,19,19,19,25]);
  table(cash,'Phân tích nghiệp vụ',['Nghiệp vụ','Phát sinh','Thành công','Đang chờ','Thất bại','Khác','Giá trị thành công'],data.cashflow.map(r=>[typeNames[r.type] || r.type,r.total,r.success,r.pending,r.failed,r.other,r.gross]),{2:NUMBER,3:NUMBER,4:NUMBER,5:NUMBER,6:NUMBER,7:MONEY},[2,3,4,5,6,7]);
  cash.addRow(['Chênh lệch nạp − rút',moneyByType('TOPUP')-moneyByType('WITHDRAW')]).getCell(2).numFmt=MONEY;
  cash.addRow(['Chỉ tiêu này không phải lợi nhuận hoặc biến động số dư ví.']);
  const prevType=type=>data.previous_cashflow.find(r=>r.type===type)?.gross || 0;
  table(cash,'So sánh kỳ trước cùng số ngày',['Chỉ tiêu','Kỳ này','Kỳ trước','Chênh lệch','Tăng trưởng'],[
    ['Nạp thành công',moneyByType('TOPUP'),prevType('TOPUP')],['Rút thành công',moneyByType('WITHDRAW'),prevType('WITHDRAW')],
    ['Chênh lệch nạp − rút',moneyByType('TOPUP')-moneyByType('WITHDRAW'),prevType('TOPUP')-prevType('WITHDRAW')],
  ].map(([label,now,prev])=>[label,now,prev,exactInteger(BigInt(now)-BigInt(prev)),percentChange(now,prev)]),{2:MONEY,3:MONEY,4:MONEY,5:PERCENT});
  const fees=sheet('03_Doanh_thu_phi','DOANH THU PHÍ THỰC THU');
  table(fees,'Các nguồn phí',['Nhóm phí','Kỳ này','Kỳ trước','Chênh lệch','Tăng trưởng','Tỷ trọng'],feeRows,{2:MONEY,3:MONEY,4:MONEY,5:PERCENT,6:PERCENT},[2,3,4]);
  table(fees,'Ngoại lệ sổ cái cần kiểm tra',['Mã phí','Số bút toán','Giá trị','Lý do'],data.fees.filter(r=>!r.eligible).map(r=>[r.category,r.entries,r.revenue,'Không đáp ứng điều kiện giao dịch hoàn tất / nguồn Merchant / phí gói không transaction']),{2:NUMBER,3:MONEY});
  const time=sheet('04_Theo_thoi_gian','PHÂN TÍCH THEO THỜI GIAN',`Nhóm: ${data.period.group_by}`,[18,22,22,22,22,22,22,22,22,20]);
  table(time,'Toàn hệ thống',['Mốc','Nạp','Rút','Nạp − rút','Thanh toán','Chuyển tiền','Phí QR','Phí khác','Tổng phí','Số GD thành công'],data.system_series.map(r=>[day(r.bucket),r.topup,r.withdraw,r.topup-r.withdraw,r.payment,r.transfer,r.qr_fee,r.revenue-r.qr_fee,r.revenue,r.transactions]),{1:'dd/mm/yyyy',2:MONEY,3:MONEY,4:MONEY,5:MONEY,6:MONEY,7:MONEY,8:MONEY,9:MONEY,10:NUMBER},[2,3,4,5,6,7,8,9,10]);
  table(time,merchantScope,['Mốc','Phí PAYMENT','Phí TRANSFER','Tổng phí','Giá trị','Số giao dịch','Tỷ lệ phí'],m.timeseries.map(r=>{const f=data.merchant_fee_series.find(f=>f.bucket===r.bucket);return [day(r.bucket),f?.payment_fee || 0,f?.transfer_fee || 0,r.revenue,r.gross,r.transactions,ratio(r.revenue,r.gross)];}),{1:'dd/mm/yyyy',2:MONEY,3:MONEY,4:MONEY,5:MONEY,6:NUMBER,7:PERCENT},[2,3,4,5,6]);
  // Different tables have different columns; repeat report context, never the
  // system table's headers over a continuation of the Merchant table.
  for(const s of [cash,fees,time]) s.pageSetup.printTitlesRow='1:5';
  const merchants=sheet('05_Merchant','PHÂN TÍCH MERCHANT',merchantScope,[9,39,32,20,25,25,18,18]);
  merchants.getColumn(2).width=39; merchants.getColumn(3).width=32;
  table(merchants,'Toàn bộ Merchant phù hợp bộ lọc',['STT','Mã Merchant','Tên Merchant','Số giao dịch','Giá trị','Phí','Tỷ lệ phí','Tỷ trọng'],m.merchants.map((r,i)=>[i+1,r.merchant_id,r.merchant_name,r.transactions,r.gross,r.revenue,ratio(r.revenue,r.gross),ratio(r.revenue,m.overview.revenue)]),{4:NUMBER,5:MONEY,6:MONEY,7:PERCENT,8:PERCENT},[4,5,6]);
  const gateway=sheet('06_Cong_thanh_toan','CỔNG THANH TOÁN',`Yêu cầu có mã đơn hàng; Merchant: ${data.filters.merchant_id || 'Tất cả'}`);
  const g=m.gateway, resolved=g.success+g.expired+g.failed+g.cancelled;
  table(gateway,'Yêu cầu tạo trong kỳ',['Chỉ tiêu','Số lượng'],[['Tổng',g.total],['Thành công',g.success],['Đang chờ',g.pending],['Hết hạn',g.expired],['Thất bại',g.failed],['Đã hủy',g.cancelled],['Trạng thái khác',g.total-resolved-g.pending],['Đã kết thúc',resolved]],{2:NUMBER});
  const rate=gateway.addRow(['Tỷ lệ thành công',ratio(g.success,resolved) ?? 'Chưa đủ dữ liệu']); rate.getCell(2).numFmt=PERCENT;
  gateway.addRow(['Tỷ lệ làm tròn; mẫu số chỉ gồm yêu cầu đã kết thúc.']);
  const operations=sheet('07_Van_hanh','TĂNG TRƯỞNG VÀ HOẠT ĐỘNG');
  table(operations,`Tài khoản · Vai trò ${data.filters.role}`,['Vai trò','Đăng ký kỳ này','Kỳ trước','Tổng cuối kỳ','Tăng trưởng'],data.growth.accounts.map(r=>[r.role,r.current,r.previous,r.total,r.growth]),{2:NUMBER,3:NUMBER,4:NUMBER,5:PERCENT});
  const v=data.growth.transactions;
  table(operations,`Tăng trưởng giao dịch · ${merchantScope}`,['Chỉ tiêu','Kỳ này','Kỳ trước','Tăng trưởng'],[['Số giao dịch',v.current_count,v.previous_count,percentChange(v.current_count,v.previous_count)],['Giá trị',v.current_gross,v.previous_gross,percentChange(v.current_gross,v.previous_gross)]],{2:NUMBER,3:NUMBER,4:PERCENT});
  for(const col of [2,3]) operations.getCell(operations.rowCount-1,col).numFmt=MONEY;
  table(operations,'Đăng nhập App · Toàn hệ thống',['Chỉ tiêu','Giá trị'],data.logins.available?[['Tổng lượt',data.logins.summary.total_logins],['Người dùng duy nhất',data.logins.summary.unique_users]]:[['Nguồn dữ liệu','Không khả dụng']]);
  operations.pageSetup.printTitlesRow='1:5';
  const checks=sheet('08_Doi_soat','ĐỐI SOÁT NỘI BỘ','Các phép kiểm cùng snapshot; không phải quyết toán ngân hàng',[38,25,23,23,23,24,15,45]);
  table(checks,'Kiểm tra số liệu',['Phép kiểm','Phạm vi','Giá trị gốc','Đối chiếu','Chênh lệch','Kết quả','Đơn vị','Nguồn / ghi chú'],data.reconciliation.map(r=>[r.name,r.scope,r.source,r.actual,r.difference,r.status,r.unit,r.note]),{3:NUMBER,4:NUMBER,5:NUMBER});
  const notes=sheet('09_Thuyet_minh','THUYẾT MINH BÁO CÁO','Định nghĩa và phạm vi',[30,110]);
  table(notes,'Thông tin và cách đọc',['Nội dung','Giải thích'],[
    ['Người xuất',data.metadata.admin_name],['Snapshot tài chính',stamp(data.metadata.financial_snapshot_at)],
    ['Thời điểm tạo file',stamp(data.metadata.generated_at)],
    ['Đọc MongoDB',`${stamp(data.logins.read_started_at)} → ${stamp(data.logins.read_completed_at)}`],
    ['Kỳ trước',`${stamp(data.previous_period.start)} → ${stamp(data.previous_period.end_exclusive)} (không gồm mốc cuối)`],
    ['Phí thực thu','Theo thời điểm sổ cái; loại trừ phí mới ghi nợ chưa thu.'],
    ['Giá trị/số giao dịch','Theo thời điểm tạo giao dịch SUCCESS/COMPLETED; có thể khác kỳ ghi phí.'],
    ['Phạm vi tài chính','Các chỉ tiêu toàn hệ thống không lọc Merchant/loại/role.'],
    ['Phạm vi Merchant',merchantScope],['Gateway','Theo Merchant và ngày tạo yêu cầu có order_id; không lọc loại giao dịch.'],
    ['Vai trò',`Chỉ lọc tài khoản: ${data.filters.role}`],['Đăng nhập','Toàn hệ thống; unique toàn kỳ, không cộng unique từng ngày.'],
    ['Hai nguồn dữ liệu','PostgreSQL và MongoDB có thời điểm đọc riêng, không có snapshot xuyên DB.'],
    ['Tỷ lệ phí','Tỷ số tổng hợp trong kỳ, không phải mức biểu phí từng giao dịch.'],
    ['Đối soát','Kiểm tra nội bộ, không thay thế quyết toán ngân hàng.'],
    ['Biểu đồ','Ảnh nhúng tại thời điểm xuất, không tự cập nhật khi sửa ô Excel.'],
    ['Tổng bảng','Tổng toàn bộ tập đã xuất, không thay đổi theo thao tác lọc của người nhận.'],
    ['Dữ liệu đến muộn','Snapshot phản ánh dữ liệu nhìn thấy khi đọc; không khẳng định đã chốt sổ hết kỳ.'],
    ['Tình trạng nguồn login',data.logins.available?'Có dữ liệu':'Không khả dụng; không được hiểu là 0 lượt.'],
    ['Danh sách sheet',book.worksheets.map(s=>s.name).join('; ')],
  ]);
  notes.getColumn(1).width=30;notes.getColumn(2).width=95;
  for(const s of book.worksheets) {
    let last=1;s.eachRow(row=>{last=row.number;});
    s.pageSetup.printArea=`A1:${s.getColumn(s._reportColumns).letter}${last}`;
  }
  return book;
}
module.exports={buildWorkbook};

