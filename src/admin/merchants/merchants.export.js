const ExcelJS = require("exceljs");
const { sanitizeExcelString } = require("../transaction/transaction.export");

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const MONEY_FMT = "#,##0";
const DATETIME_FMT = "dd/mm/yyyy hh:mm:ss";

const APPROVAL_LABEL = {
  APPROVED: "Đã xác thực eKYC",
  PENDING: "Chờ xác thực",
  REJECTED: "Từ chối",
};

const OPERATIONAL_LABEL = {
  ACTIVE: "Đang hoạt động",
  SUSPENDED: "Đã khóa",
  UNKNOWN: "Không xác định",
};

const API_LABEL = {
  LINKED: "Đã kết nối",
  PENDING_KEY: "Chờ cấp khóa",
  NOT_CONNECTED: "Chưa cấu hình",
  LOCKED: "Đã khóa API",
};

const COLUMNS = [
  { header: "STT", width: 8 },
  { header: "Mã Merchant", width: 16 },
  { header: "Tên thương hiệu / Pháp nhân", width: 32 },
  { header: "Mã số thuế", width: 18 },
  { header: "Chủ sở hữu", width: 24 },
  { header: "Số điện thoại", width: 16 },
  { header: "Email liên hệ", width: 28 },
  { header: "Hồ sơ eKYC", width: 20 },
  { header: "Trạng thái tài khoản", width: 20 },
  { header: "Tình trạng API", width: 18 },
  { header: "Số dư ví (VND)", width: 18 },
  { header: "Callback URL", width: 36 },
  { header: "Địa chỉ", width: 34 },
  { header: "Ngày đăng ký (UTC+7)", width: 22 },
];

function toVnDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + VN_OFFSET_MS);
}

function formatVnNow() {
  const d = new Date(Date.now() + VN_OFFSET_MS).toISOString();
  return `${d.slice(0, 10).split("-").reverse().join("/")} ${d.slice(11, 19)}`;
}

async function buildMerchantsAdminXlsx({
  rows = [],
  adminName = "Quản trị viên",
  filterSummary = "",
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Mio E-Wallet System";
  wb.created = new Date();

  const ws = wb.addWorksheet("Danh sách Merchant", {
    views: [{ state: "frozen", ySplit: 6 }],
  });

  const lastCol = COLUMNS.length;
  COLUMNS.forEach((c, idx) => {
    ws.getColumn(idx + 1).width = c.width;
  });

  ws.mergeCells(1, 1, 1, lastCol);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = "DANH SÁCH ĐỐI TÁC MERCHANT - VÍ ĐIỆN TỬ MIO";
  titleCell.font = { bold: true, size: 15, color: { argb: "FF1F4E79" } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(1).height = 26;

  ws.getCell(2, 1).value = `Người xuất báo cáo: ${sanitizeExcelString(adminName)}`;
  ws.getCell(2, 1).font = { bold: true };
  ws.getCell(2, 6).value = `Thời điểm xuất: ${formatVnNow()} (giờ Việt Nam UTC+7)`;

  ws.getCell(3, 1).value = filterSummary
    ? `Bộ lọc áp dụng: ${sanitizeExcelString(filterSummary)}`
    : "Bộ lọc áp dụng: Tất cả đối tác Merchant";
  ws.getCell(3, 1).font = { italic: true };

  ws.getCell(4, 1).value = `Tổng số đối tác trong tệp: ${rows.length}`;
  ws.getCell(4, 1).font = { bold: true, color: { argb: "FF0F172A" } };

  const headerRowIdx = 6;
  const headerRow = ws.getRow(headerRowIdx);
  headerRow.height = 24;
  COLUMNS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0052CC" },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: i === 0 || i === 10 ? "right" : "left",
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FFCBD5E1" } },
      bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
      left: { style: "thin", color: { argb: "FFCBD5E1" } },
      right: { style: "thin", color: { argb: "FFCBD5E1" } },
    };
  });

  rows.forEach((row, index) => {
    const excelRow = ws.getRow(headerRowIdx + 1 + index);
    excelRow.getCell(1).value = index + 1;
    excelRow.getCell(2).value = sanitizeExcelString(row.merchant_code || "");
    excelRow.getCell(3).value = sanitizeExcelString(row.store_name || "");
    excelRow.getCell(4).value = sanitizeExcelString(row.tax_code || "Chưa cập nhật");
    excelRow.getCell(5).value = sanitizeExcelString(row.owner_name || "");
    excelRow.getCell(6).value = sanitizeExcelString(row.phone || "");
    excelRow.getCell(7).value = sanitizeExcelString(row.email || "—");
    excelRow.getCell(8).value = sanitizeExcelString(
      APPROVAL_LABEL[row.approval_status] || row.approval_status || "",
    );
    excelRow.getCell(9).value = sanitizeExcelString(
      OPERATIONAL_LABEL[row.operational_status] || row.operational_status || "",
    );
    excelRow.getCell(10).value = sanitizeExcelString(
      API_LABEL[row.api_status] || row.api_status || "",
    );
    const balanceCell = excelRow.getCell(11);
    balanceCell.value = Number(row.balance || 0);
    balanceCell.numFmt = MONEY_FMT;
    balanceCell.alignment = { horizontal: "right" };
    excelRow.getCell(12).value = sanitizeExcelString(row.call_back_url || "—");
    excelRow.getCell(13).value = sanitizeExcelString(row.address || "—");

    const dateCell = excelRow.getCell(14);
    const vnDate = toVnDate(row.created_at);
    dateCell.value = vnDate || "—";
    if (vnDate) dateCell.numFmt = DATETIME_FMT;

    for (let col = 1; col <= lastCol; col++) {
      excelRow.getCell(col).border = {
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
    }
  });

  if (rows.length > 0) {
    ws.autoFilter = {
      from: { row: headerRowIdx, column: 1 },
      to: { row: headerRowIdx + rows.length, column: lastCol },
    };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function buildMerchantExportFileName(startDate, endDate) {
  if (startDate && endDate) {
    const s = String(startDate).split("T")[0].replace(/-/g, "");
    const e = String(endDate).split("T")[0].replace(/-/g, "");
    return `danh-sach-merchant_${s}_${e}.xlsx`;
  }
  const shifted = new Date(Date.now() + VN_OFFSET_MS).toISOString();
  const ymd = shifted.slice(0, 10).replace(/-/g, "");
  const hm = shifted.slice(11, 16).replace(":", "");
  return `danh-sach-merchant_${ymd}_${hm}.xlsx`;
}

module.exports = {
  buildMerchantsAdminXlsx,
  buildMerchantExportFileName,
};
