const ExcelJS = require("exceljs");

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const TYPE_LABEL = {
  TRANSFER: "Chuyển tiền",
  TOPUP: "Nạp tiền",
  WITHDRAW: "Rút tiền",
  PAYMENT: "Thanh toán QR",
};
const STATUS_LABEL = {
  SUCCESS: "Thành công",
  PENDING: "Đang xử lý",
  FAILED: "Thất bại",
};

const COLUMNS = [
  { header: "Mã giao dịch", width: 38 },
  { header: "Thời gian", width: 20 },
  { header: "Loại", width: 16 },
  { header: "Chiều", width: 11 },
  { header: "Đối tác", width: 28 },
  { header: "SĐT đối tác", width: 16 },
  { header: "Ngân hàng", width: 20 },
  { header: "Mã đơn hàng", width: 22 },
  { header: "Số tiền (VND)", width: 17 },
  { header: "Phí (VND)", width: 13 },
  { header: "Số dư trước (VND)", width: 19 },
  { header: "Số dư sau (VND)", width: 19 },
  { header: "Trạng thái", width: 14 },
  { header: "Mô tả", width: 42 },
];

const MONEY_FMT = "#,##0";
const SIGNED_MONEY_FMT = "+#,##0;[Red]-#,##0;0";
const DATETIME_FMT = "hh:mm - dd/mm/yyyy";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// created_at là thời điểm UTC; cộng 7 giờ để ô Excel hiển thị đúng giờ Việt Nam
const toVnDate = (value) => new Date(new Date(value).getTime() + VN_OFFSET_MS);

const formatDay = (ymd) => ymd.split("-").reverse().join("/");

function formatVnNow() {
  const d = new Date(Date.now() + VN_OFFSET_MS).toISOString(); // 2026-11-04T10:15:00.000Z
  return `${d.slice(11, 16)} - ${formatDay(d.slice(0, 10))}`;
}

/** Quy một dòng từ DB về các ô của file Excel (đứng từ góc nhìn của người xuất file). */
function toSheetRow(row) {
  const isBankType =
    row.transaction_type === "TOPUP" || row.transaction_type === "WITHDRAW";
  const isIn = row.direction === "IN";

  let partnerName = "";
  let partnerPhone = "";
  if (!isBankType) {
    partnerName = isIn ? row.source_display_name : row.destination_display_name;
    partnerPhone = isIn
      ? row.source_display_phone
      : row.destination_display_phone;
  }

  const amount = num(row.amount);
  const merchantFee = isIn ? num(row.merchant_fee) : 0;
  const displayFee = isIn ? merchantFee : num(row.fee);
  return {
    isIn,
    isSuccess: row.status === "SUCCESS",
    amount,
    fee: num(row.fee),
    merchantFee,
    cells: [
      String(row.id),
      toVnDate(row.created_at),
      TYPE_LABEL[row.transaction_type] || row.transaction_type,
      isIn ? "Tiền vào" : "Tiền ra",
      partnerName || "",
      partnerPhone || "",
      row.bank_name || "",
      row.order_id || "",
      isIn ? amount : -amount,
      displayFee,
      num(row.balance_before),
      num(row.balance_after),
      STATUS_LABEL[row.status] || row.status,
      row.description || "",
    ],
  };
}

/**
 * Tạo file Excel lịch sử giao dịch, trả về Buffer.
 * Ô chữ luôn được ghi dạng chuỗi (không phải công thức) nên nội dung bắt đầu bằng = + - @
 * vẫn không bị Excel thực thi.
 */
async function buildTransactionsXlsx({ rows, startDate, endDate, filters = [] }) {
  const items = rows.map(toSheetRow);

  let totalIn = 0;
  let totalOut = 0;
  for (const it of items) {
    if (!it.isSuccess) continue;
    if (it.isIn) totalIn += Math.max(0, it.amount - it.merchantFee);
    else totalOut += it.amount + it.fee;
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Mio Wallet";
  wb.created = new Date();
  const ws = wb.addWorksheet("Lịch sử giao dịch", {
    views: [{ state: "frozen", ySplit: 8 }],
  });
  const lastCol = COLUMNS.length;
  COLUMNS.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });

  // --- Phần đầu file ---
  ws.mergeCells(1, 1, 1, lastCol);
  const title = ws.getCell(1, 1);
  title.value = "LỊCH SỬ GIAO DỊCH";
  title.font = { bold: true, size: 16 };
  title.alignment = { vertical: "middle" };
  ws.getRow(1).height = 26;

  let periodText = `Khoảng thời gian: ${formatDay(startDate)} - ${formatDay(endDate)}`;
  if (filters.length) periodText += `  |  Bộ lọc: ${filters.join(", ")}`;
  ws.getCell(2, 1).value = periodText;
  ws.getCell(3, 1).value = `Ngày xuất: ${formatVnNow()} (giờ Việt Nam)`;

  const summary = [
    ["Số giao dịch", items.length, "0"],
    ["Tổng tiền vào (thành công)", totalIn, MONEY_FMT],
    ["Tổng tiền ra, gồm phí (thành công)", totalOut, MONEY_FMT],
  ];
  summary.forEach(([label, value, fmt], i) => {
    const r = 4 + i;
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 1).font = { bold: true };
    const c = ws.getCell(r, 2);
    c.value = value;
    c.numFmt = fmt;
    c.alignment = { horizontal: "right" };
  });

  // --- Dòng tiêu đề bảng (dòng 8) ---
  const headerRow = ws.getRow(8);
  COLUMNS.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F4E79" },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };
    cell.border = { bottom: { style: "thin", color: { argb: "FF999999" } } };
  });
  headerRow.height = 24;

  // --- Dữ liệu ---
  items.forEach((it, idx) => {
    const row = ws.getRow(9 + idx);
    it.cells.forEach((value, i) => {
      row.getCell(i + 1).value = value;
    });
    row.getCell(2).numFmt = DATETIME_FMT;
    row.getCell(9).numFmt = SIGNED_MONEY_FMT;
    row.getCell(10).numFmt = MONEY_FMT;
    row.getCell(11).numFmt = MONEY_FMT;
    row.getCell(12).numFmt = MONEY_FMT;
    row.getCell(6).alignment = { horizontal: "left" };
    row.getCell(14).alignment = { wrapText: true, vertical: "top" };
  });

  if (items.length > 0) {
    ws.autoFilter = {
      from: { row: 8, column: 1 },
      to: { row: 8 + items.length, column: lastCol },
    };
  } else {
    ws.getCell(9, 1).value = "Không có giao dịch nào trong khoảng thời gian này";
    ws.getCell(9, 1).font = { italic: true, color: { argb: "FF777777" } };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function buildExportFileName(startDate, endDate) {
  return `lich-su-giao-dich_${startDate.replace(/-/g, "")}_${endDate.replace(/-/g, "")}.xlsx`;
}

/** Gửi file xlsx về client. Tên file chỉ gồm ký tự ASCII nên header an toàn. */
function sendXlsx(res, { buffer, fileName }) {
  res.setHeader("Content-Type", XLSX_MIME);
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Content-Length", buffer.length);
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(buffer);
}

function styleReportHeader(sheet, { title, subtitle, columns, headerRowIdx = 4 }) {
  const lastCol = columns.length;
  sheet.columns = columns.map((c) => ({ width: c.width }));

  sheet.mergeCells(1, 1, 1, lastCol);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { size: 14, bold: true, color: { argb: "FF0F172A" } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  sheet.getRow(1).height = 26;

  sheet.mergeCells(2, 1, 2, lastCol);
  const subCell = sheet.getCell(2, 1);
  subCell.value = subtitle;
  subCell.font = { size: 10, italic: true, color: { argb: "FF475569" } };
  subCell.alignment = { vertical: "middle", horizontal: "left" };
  sheet.getRow(2).height = 18;

  const headerRow = sheet.getRow(headerRowIdx);
  headerRow.values = columns.map((c) => c.header);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E3A8A" },
    };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FF1E3A8A" } },
      bottom: { style: "thin", color: { argb: "FF1E3A8A" } },
      left: { style: "thin", color: { argb: "FF3B82F6" } },
      right: { style: "thin", color: { argb: "FF3B82F6" } },
    };
  });

  sheet.views = [{ state: "frozen", ySplit: headerRowIdx }];
  sheet.autoFilter = {
    from: { row: headerRowIdx, column: 1 },
    to: { row: headerRowIdx, column: lastCol },
  };
}

function styleReportDataRow(row, idx) {
  row.height = 20;
  row.eachCell((cell) => {
    if (idx % 2 === 1) {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF8FAFC" },
      };
    }
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
      left: { style: "thin", color: { argb: "FFF1F5F9" } },
      right: { style: "thin", color: { argb: "FFF1F5F9" } },
    };
    cell.alignment = { vertical: "middle" };
  });
}

function styleReportTotalRow(row) {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { bold: true, size: 11, color: { argb: "FF0F172A" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEFF6FF" },
    };
    cell.border = {
      top: { style: "medium", color: { argb: "FF93C5FD" } },
      bottom: { style: "double", color: { argb: "FF93C5FD" } },
    };
    cell.alignment = { vertical: "middle" };
  });
}

async function buildRevenueStatsXlsx({
  summary = {},
  dailyStats = [],
  startDate = null,
  endDate = null,
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Merchant Portal";
  wb.created = new Date();

  const sheet = wb.addWorksheet("Thống kê doanh thu");
  const columns = [
    { header: "Ngày giao dịch", width: 18 },
    { header: "Số lượng đơn", width: 16 },
    { header: "Doanh thu thực nhận (VND)", width: 24 },
    { header: "Giá trị TB / đơn (VND)", width: 24 },
  ];

  const rangeText =
    startDate && endDate
      ? `Từ ${formatDay(startDate)} đến ${formatDay(endDate)}`
      : startDate
        ? `Từ ${formatDay(startDate)}`
        : endDate
          ? `Đến ${formatDay(endDate)}`
          : "Tất cả thời gian";

  styleReportHeader(sheet, {
    title: "BÁO CÁO THỐNG KÊ DOANH THU",
    subtitle: `${rangeText} • Tổng doanh thu: ${num(summary.total_revenue).toLocaleString("vi-VN")} VND • Số đơn: ${num(summary.total_orders).toLocaleString("vi-VN")} • Xuất lúc ${formatVnNow()}`,
    columns,
  });

  const headerRowIdx = 4;
  dailyStats.forEach((item, idx) => {
    const orders = num(item.order_count);
    const revenue = num(item.revenue);
    const avg = orders > 0 ? Math.round(revenue / orders) : 0;

    const row = sheet.getRow(headerRowIdx + 1 + idx);
    row.values = [formatDay(item.date), orders, revenue, avg];
    styleReportDataRow(row, idx);
    row.getCell(1).alignment = { vertical: "middle", horizontal: "center" };
    row.getCell(2).numFmt = MONEY_FMT;
    row.getCell(2).alignment = { vertical: "middle", horizontal: "center" };
    row.getCell(3).numFmt = MONEY_FMT;
    row.getCell(3).alignment = { vertical: "middle", horizontal: "right" };
    row.getCell(3).font = { bold: true, color: { argb: "FF15803D" } };
    row.getCell(4).numFmt = MONEY_FMT;
    row.getCell(4).alignment = { vertical: "middle", horizontal: "right" };
  });

  const totalRow = sheet.getRow(headerRowIdx + 1 + dailyStats.length);
  totalRow.values = [
    "TỔNG CỘNG",
    num(summary.total_orders),
    num(summary.total_revenue),
    num(summary.avg_order_value),
  ];
  styleReportTotalRow(totalRow);
  totalRow.getCell(1).alignment = { vertical: "middle", horizontal: "center" };
  totalRow.getCell(2).numFmt = MONEY_FMT;
  totalRow.getCell(2).alignment = { vertical: "middle", horizontal: "center" };
  totalRow.getCell(3).numFmt = MONEY_FMT;
  totalRow.getCell(3).alignment = { vertical: "middle", horizontal: "right" };
  totalRow.getCell(4).numFmt = MONEY_FMT;
  totalRow.getCell(4).alignment = { vertical: "middle", horizontal: "right" };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function buildProductStatsXlsx({
  products = [],
  startDate = null,
  endDate = null,
  keyword = null,
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Merchant Portal";
  wb.created = new Date();

  const sheet = wb.addWorksheet("Thống kê sản phẩm");
  const columns = [
    { header: "STT", width: 8 },
    { header: "Mã sản phẩm", width: 18 },
    { header: "Tên sản phẩm", width: 38 },
    { header: "Số lượng bán", width: 16 },
    { header: "Phí giao dịch (VND)", width: 20 },
    { header: "Tổng doanh thu (VND)", width: 24 },
  ];

  const rangeText =
    startDate && endDate
      ? `Từ ${formatDay(startDate)} đến ${formatDay(endDate)}`
      : "Tất cả thời gian";
  const kwText = keyword ? ` • Từ khóa: "${keyword}"` : "";

  styleReportHeader(sheet, {
    title: "BÁO CÁO THỐNG KÊ SẢN PHẨM BÁN CHẠY",
    subtitle: `${rangeText}${kwText} • Số sản phẩm: ${products.length.toLocaleString("vi-VN")} • Xuất lúc ${formatVnNow()}`,
    columns,
  });

  const headerRowIdx = 4;
  let totalQty = 0;
  let totalFee = 0;
  let totalRevenue = 0;

  products.forEach((p, idx) => {
    const qty = num(p.total_quantity_sold);
    const fee = num(p.total_merchant_fee);
    const rev = num(p.total_revenue);
    totalQty += qty;
    totalFee += fee;
    totalRevenue += rev;

    const row = sheet.getRow(headerRowIdx + 1 + idx);
    row.values = [idx + 1, String(p.product_id || ""), String(p.product_name || ""), qty, fee, rev];
    styleReportDataRow(row, idx);
    row.getCell(1).alignment = { vertical: "middle", horizontal: "center" };
    row.getCell(2).alignment = { vertical: "middle", horizontal: "left" };
    row.getCell(3).alignment = { vertical: "middle", horizontal: "left" };
    row.getCell(4).numFmt = MONEY_FMT;
    row.getCell(4).alignment = { vertical: "middle", horizontal: "center" };
    row.getCell(5).numFmt = MONEY_FMT;
    row.getCell(5).alignment = { vertical: "middle", horizontal: "right" };
    row.getCell(5).font = { color: { argb: "FFEA580C" } };
    row.getCell(6).numFmt = MONEY_FMT;
    row.getCell(6).alignment = { vertical: "middle", horizontal: "right" };
    row.getCell(6).font = { bold: true, color: { argb: "FF15803D" } };
  });

  const totalRow = sheet.getRow(headerRowIdx + 1 + products.length);
  totalRow.values = ["", "TỔNG CỘNG", `${products.length} sản phẩm`, totalQty, totalFee, totalRevenue];
  styleReportTotalRow(totalRow);
  totalRow.getCell(4).numFmt = MONEY_FMT;
  totalRow.getCell(4).alignment = { vertical: "middle", horizontal: "center" };
  totalRow.getCell(5).numFmt = MONEY_FMT;
  totalRow.getCell(5).alignment = { vertical: "middle", horizontal: "right" };
  totalRow.getCell(6).numFmt = MONEY_FMT;
  totalRow.getCell(6).alignment = { vertical: "middle", horizontal: "right" };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = {
  buildTransactionsXlsx,
  buildRevenueStatsXlsx,
  buildProductStatsXlsx,
  buildExportFileName,
  sendXlsx,
};