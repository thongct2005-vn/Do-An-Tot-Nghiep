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
const DATETIME_FMT = "dd/mm/yyyy hh:mm:ss";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// created_at là thời điểm UTC; cộng 7 giờ để ô Excel hiển thị đúng giờ Việt Nam
const toVnDate = (value) => new Date(new Date(value).getTime() + VN_OFFSET_MS);

const formatDay = (ymd) => ymd.split("-").reverse().join("/");

function formatVnNow() {
  const d = new Date(Date.now() + VN_OFFSET_MS).toISOString(); // 2026-11-04T10:15:00.000Z
  return `${formatDay(d.slice(0, 10))} ${d.slice(11, 16)}`;
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
  return {
    isIn,
    isSuccess: row.status === "SUCCESS",
    amount,
    fee: num(row.fee),
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
      num(row.fee),
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
    if (it.isIn) totalIn += it.amount;
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

module.exports = { buildTransactionsXlsx, buildExportFileName, sendXlsx };