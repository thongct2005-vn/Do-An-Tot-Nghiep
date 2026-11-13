const ExcelJS = require("exceljs");

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const TYPE_LABEL = {
  TRANSFER: "Chuyển tiền P2P",
  TOPUP: "Nạp tiền ví",
  WITHDRAW: "Rút tiền về NH",
  PAYMENT: "Thanh toán QR",
};

const STATUS_LABEL = {
  SUCCESS: "Thành công",
  PENDING: "Đang xử lý",
  FAILED: "Thất bại",
};

const INITIATOR_LABEL = {
  ADMIN: "Admin can thiệp",
  USER: "Người dùng",
  SYSTEM: "Hệ thống tự động",
};

const MONEY_FMT = "#,##0";
const DATETIME_FMT = "dd/mm/yyyy hh:mm:ss";

function sanitizeExcelString(val) {
  if (val === null || val === undefined) return "";
  const rawStr = String(val);
  const trimmed = rawStr.trim();
  if (/^[=+@\-]/.test(trimmed) || /^[\t\r=+@\-]/.test(rawStr)) {
    return "'" + rawStr;
  }
  return trimmed;
}

function maskAccountNumber(acc) {
  if (!acc) return "";
  const str = String(acc).trim();
  if (str.length <= 4) return str;
  return "******" + str.slice(-4);
}

function toVnDate(value) {
  if (!value) return null;
  return new Date(new Date(value).getTime() + VN_OFFSET_MS);
}

function formatDay(dateObj) {
  if (!dateObj) return "Toàn thời gian";
  if (typeof dateObj === "string") {
    return dateObj.split("T")[0].split("-").reverse().join("/");
  }
  const d = new Date(new Date(dateObj).getTime() + VN_OFFSET_MS).toISOString();
  return d.slice(0, 10).split("-").reverse().join("/");
}

function formatVnNow() {
  const d = new Date(Date.now() + VN_OFFSET_MS).toISOString();
  const datePart = d.slice(0, 10).split("-").reverse().join("/");
  const timePart = d.slice(11, 19);
  return `${datePart} ${timePart}`;
}

const COLUMNS = [
  { header: "STT", width: 8 },
  { header: "Mã giao dịch (TxID)", width: 22 },
  { header: "Thời gian", width: 22 },
  { header: "Loại giao dịch", width: 20 },
  { header: "Nguồn thực hiện", width: 18 },
  { header: "Chi tiết Admin can thiệp", width: 32 },
  { header: "Người gửi / Ví nguồn", width: 26 },
  { header: "Người nhận / Ví đích", width: 26 },
  { header: "Ngân hàng liên kết", width: 26 },
  { header: "Mã đơn hàng / Đối soát", width: 24 },
  { header: "Số tiền (VND)", width: 18 },
  { header: "Phí dịch vụ (VND)", width: 18 },
  { header: "Phí merchant (VND)", width: 18 },
  { header: "Biến động ví nguồn", width: 28 },
  { header: "Biến động ví đích", width: 28 },
  { header: "Trạng thái", width: 16 },
  { header: "Nội dung / Ghi chú", width: 36 },
];

/**
 * Xây dựng Buffer file Excel báo cáo toàn hệ thống với ExcelJS
 */
async function buildTransactionsAdminXlsx({
  rows = [],
  adminName = "Quản trị viên",
  filterSummary = "",
  startDate = null,
  endDate = null,
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Mio E-Wallet System";
  wb.created = new Date();

  const ws = wb.addWorksheet("Báo cáo giao dịch", {
    views: [{ state: "frozen", ySplit: 8 }],
  });

  const lastCol = COLUMNS.length;
  COLUMNS.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });

  // 1. Tiêu đề lớn
  ws.mergeCells(1, 1, 1, lastCol);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = "BÁO CÁO GIAO DỊCH TOÀN HỆ THỐNG - VÍ ĐIỆN TỬ MIO";
  titleCell.font = { bold: true, size: 16, color: { argb: "FF1F4E79" } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(1).height = 28;

  // 2. Metadata: Người xuất, Thời gian xuất
  ws.getCell(2, 1).value = `Người xuất báo cáo: ${sanitizeExcelString(adminName)}`;
  ws.getCell(2, 1).font = { bold: true };
  ws.getCell(2, 6).value = `Thời điểm xuất: ${formatVnNow()} (giờ Việt Nam GMT+7)`;

  // 3. Metadata: Khoảng thời gian, Bộ lọc áp dụng
  let periodText = `Khoảng thời gian: ${formatDay(startDate)} - ${formatDay(endDate)}`;
  if (filterSummary) {
    periodText += `  |  Bộ lọc: ${filterSummary}`;
  }
  ws.getCell(3, 1).value = periodText;
  ws.getCell(3, 1).font = { italic: true };

  // 4. Ghi chú thống kê tài chính
  ws.getCell(4, 1).value =
    "* Thống kê trên các giao dịch được xuất trong báo cáo này (chỉ cộng dồn các giao dịch THÀNH CÔNG):";
  ws.getCell(4, 1).font = { size: 10, italic: true, color: { argb: "FF555555" } };

  // 5. Tính toán 4 KPI độc lập (Tránh Double Counting)
  let totalTopup = 0;
  let totalWithdraw = 0;
  let totalTransfer = 0;
  let totalPayment = 0;
  let totalFee = 0;

  for (const r of rows) {
    const amt = Number(r.amount) || 0;
    const f = Number(r.fee) || 0;
    const mf = Number(r.merchant_fee) || 0;
    totalFee += f + mf;
    if (r.status === "SUCCESS") {
      if (r.transaction_type === "TOPUP") totalTopup += amt;
      else if (r.transaction_type === "WITHDRAW") totalWithdraw += amt;
      else if (r.transaction_type === "TRANSFER") totalTransfer += amt;
      else if (r.transaction_type === "PAYMENT") totalPayment += amt;
    }
  }

  // Khối KPI dòng 5 & 6
  ws.getCell(5, 1).value = "Tổng số giao dịch xuất:";
  ws.getCell(5, 1).font = { bold: true };
  ws.getCell(5, 2).value = rows.length;
  ws.getCell(5, 2).numFmt = "#,##0";
  ws.getCell(5, 2).font = { bold: true };

  ws.getCell(5, 4).value = "Tổng nạp thành công (TOPUP):";
  ws.getCell(5, 4).font = { bold: true };
  ws.getCell(5, 5).value = totalTopup;
  ws.getCell(5, 5).numFmt = MONEY_FMT;
  ws.getCell(5, 5).font = { bold: true };

  ws.getCell(5, 7).value = "Tổng chuyển P2P (TRANSFER):";
  ws.getCell(5, 7).font = { bold: true };
  ws.getCell(5, 8).value = totalTransfer;
  ws.getCell(5, 8).numFmt = MONEY_FMT;
  ws.getCell(5, 8).font = { bold: true };

  ws.getCell(6, 1).value = "Tổng phí hệ thống ghi nhận:";
  ws.getCell(6, 1).font = { bold: true };
  ws.getCell(6, 2).value = totalFee;
  ws.getCell(6, 2).numFmt = MONEY_FMT;
  ws.getCell(6, 2).font = { bold: true };

  ws.getCell(6, 4).value = "Tổng rút thành công (WITHDRAW):";
  ws.getCell(6, 4).font = { bold: true };
  ws.getCell(6, 5).value = totalWithdraw;
  ws.getCell(6, 5).numFmt = MONEY_FMT;
  ws.getCell(6, 5).font = { bold: true };

  ws.getCell(6, 7).value = "Tổng thanh toán QR (PAYMENT):";
  ws.getCell(6, 7).font = { bold: true };
  ws.getCell(6, 8).value = totalPayment;
  ws.getCell(6, 8).numFmt = MONEY_FMT;
  ws.getCell(6, 8).font = { bold: true };

  // 6. Header Table tại Dòng 8
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
    cell.border = {
      top: { style: "thin", color: { argb: "FF103050" } },
      bottom: { style: "medium", color: { argb: "FF103050" } },
      left: { style: "thin", color: { argb: "FF4F81BD" } },
      right: { style: "thin", color: { argb: "FF4F81BD" } },
    };
  });
  headerRow.height = 26;

  // 7. Ghi từng dòng dữ liệu từ Dòng 9
  rows.forEach((r, idx) => {
    const rowNum = 9 + idx;
    const excelRow = ws.getRow(rowNum);

    // Xử lý thông tin người gửi
    let sourceText = "";
    if (r.source_user_name || r.source_user_phone) {
      sourceText = `${r.source_user_name || "Chưa cập nhật"} (${r.source_user_phone || "N/A"})`;
    }

    // Xử lý thông tin người nhận
    let destText = "";
    if (r.destination_user_name || r.destination_user_phone) {
      destText = `${r.destination_user_name || "Chưa cập nhật"} (${r.destination_user_phone || "N/A"})`;
    }

    // Xử lý thông tin ngân hàng
    let bankText = "";
    if (r.bank_name || r.bank_account_number) {
      const maskedAcc = maskAccountNumber(r.bank_account_number);
      bankText = `${r.bank_name || "Ngân hàng liên kết"}${maskedAcc ? ` - ${maskedAcc}` : ""}`;
    }

    // Xử lý mã đơn hàng / đối soát
    let orderRefText = "";
    if (r.order_id || r.reference_code) {
      orderRefText = [r.order_id && `ĐH: ${r.order_id}`, r.reference_code && `Ref: ${r.reference_code}`]
        .filter(Boolean)
        .join(" | ");
    }

    // Xử lý thông tin admin can thiệp
    let adminDetail = "";
    if (r.initiator_role === "ADMIN") {
      const parts = [];
      if (r.admin_name) parts.push(`Admin: ${r.admin_name}`);
      if (r.admin_action) parts.push(`Lệnh: ${r.admin_action}`);
      if (r.admin_reason) parts.push(`Lý do: ${r.admin_reason}`);
      if (r.admin_auth_ref) parts.push(`Số ủy quyền: ${r.admin_auth_ref}`);
      adminDetail = parts.join(" | ");
    }

    // Biến động số dư ví nguồn
    let sourceBalanceDelta = "N/A";
    if (r.source_balance_before !== null && r.source_balance_after !== null) {
      sourceBalanceDelta = `${Number(r.source_balance_before).toLocaleString("vi-VN")} -> ${Number(r.source_balance_after).toLocaleString("vi-VN")}`;
    }

    // Biến động số dư ví đích
    let destBalanceDelta = "N/A";
    if (r.dest_balance_before !== null && r.dest_balance_after !== null) {
      destBalanceDelta = `${Number(r.dest_balance_before).toLocaleString("vi-VN")} -> ${Number(r.dest_balance_after).toLocaleString("vi-VN")}`;
    }

    const cells = [
      idx + 1, // 1. STT
      sanitizeExcelString(r.id), // 2. Mã giao dịch
      toVnDate(r.created_at), // 3. Thời gian
      TYPE_LABEL[r.transaction_type] || r.transaction_type, // 4. Loại giao dịch
      INITIATOR_LABEL[r.initiator_role] || r.initiator_role, // 5. Nguồn thực hiện
      sanitizeExcelString(adminDetail), // 6. Chi tiết Admin can thiệp
      sanitizeExcelString(sourceText), // 7. Người gửi / Ví nguồn
      sanitizeExcelString(destText), // 8. Người nhận / Ví đích
      sanitizeExcelString(bankText), // 9. Ngân hàng liên kết
      sanitizeExcelString(orderRefText), // 10. Mã đơn hàng / Đối soát
      Number(r.amount) || 0, // 11. Số tiền
      Number(r.fee) || 0, // 12. Phí dịch vụ
      Number(r.merchant_fee) || 0, // 13. Phí merchant
      sanitizeExcelString(sourceBalanceDelta), // 14. Biến động ví nguồn
      sanitizeExcelString(destBalanceDelta), // 15. Biến động ví đích
      STATUS_LABEL[r.status] || r.status, // 16. Trạng thái
      sanitizeExcelString(r.description || ""), // 17. Nội dung
    ];

    cells.forEach((val, i) => {
      excelRow.getCell(i + 1).value = val;
    });

    // Formatting ô
    excelRow.getCell(1).alignment = { horizontal: "center" };
    excelRow.getCell(2).numFmt = "@";
    excelRow.getCell(3).numFmt = DATETIME_FMT;
    excelRow.getCell(3).alignment = { horizontal: "center" };
    excelRow.getCell(11).numFmt = MONEY_FMT;
    excelRow.getCell(12).numFmt = MONEY_FMT;
    excelRow.getCell(13).numFmt = MONEY_FMT;

    // Màu trạng thái
    const statusCell = excelRow.getCell(16);
    statusCell.alignment = { horizontal: "center" };
    if (r.status === "SUCCESS") {
      statusCell.font = { color: { argb: "FF0E7036" }, bold: true };
    } else if (r.status === "PENDING") {
      statusCell.font = { color: { argb: "FFB25E00" }, bold: true };
    } else if (r.status === "FAILED") {
      statusCell.font = { color: { argb: "FFC51616" }, bold: true };
    }

    excelRow.border = {
      bottom: { style: "thin", color: { argb: "FFE0E0E0" } },
      left: { style: "thin", color: { argb: "FFE0E0E0" } },
      right: { style: "thin", color: { argb: "FFE0E0E0" } },
    };
  });

  if (rows.length > 0) {
    ws.autoFilter = {
      from: { row: 8, column: 1 },
      to: { row: 8 + rows.length, column: lastCol },
    };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function buildExportFileName(startDate, endDate) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");

  let rangeTag = "";
  if (startDate && endDate) {
    const s = String(startDate).split("T")[0].replace(/-/g, "");
    const e = String(endDate).split("T")[0].replace(/-/g, "");
    rangeTag = `_${s}_${e}`;
  } else {
    rangeTag = `_${yyyy}${mm}${dd}_${hh}${min}`;
  }

  return `bao-cao-giao-dich${rangeTag}.xlsx`;
}

function sendXlsxResponse(res, { buffer, fileName }) {
  res.setHeader("Content-Type", XLSX_MIME);
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Content-Length", buffer.length);
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(buffer);
}

module.exports = {
  buildTransactionsAdminXlsx,
  buildExportFileName,
  sendXlsxResponse,
  sanitizeExcelString,
  maskAccountNumber,
};

