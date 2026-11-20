const fs = require("node:fs");
const path = require("node:path");
const PDFDocument = require("pdfkit");
const { httpError } = require("../../utils/httpError");
const { maskAccountNumber } = require("./transaction.export");

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const FONTS_DIR = path.resolve(__dirname, "../../../assets/fonts");
const REGULAR_FONT_PATH = path.join(FONTS_DIR, "Roboto-Regular.ttf");
const BOLD_FONT_PATH = path.join(FONTS_DIR, "Roboto-Bold.ttf");

const TYPE_LABEL = {
  TRANSFER: "Chuyển tiền P2P",
  TOPUP: "Nạp tiền vào ví",
  WITHDRAW: "Rút tiền về ngân hàng",
  PAYMENT: "Thanh toán QR Merchant",
};

const STATUS_LABEL = {
  SUCCESS: "Thành công",
  PENDING: "Đang xử lý",
  FAILED: "Thất bại",
};

function assertUnicodeFontsAvailable() {
  if (!fs.existsSync(REGULAR_FONT_PATH) || !fs.existsSync(BOLD_FONT_PATH)) {
    throw httpError(
      500,
      "Thiếu bộ font Unicode tiếng Việt để xuất biên nhận PDF",
    );
  }
}

function formatVnd(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0 ₫";
  return `${Math.round(num).toLocaleString("vi-VN")} ₫`;
}

function formatVnDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const shifted = new Date(date.getTime() + VN_OFFSET_MS).toISOString();
  const y = shifted.slice(0, 4);
  const m = shifted.slice(5, 7);
  const d = shifted.slice(8, 10);
  const hms = shifted.slice(11, 19);
  return `${d}/${m}/${y} ${hms} (UTC+7)`;
}

function drawKeyValueRow(doc, label, value, { boldValue = false } = {}) {
  const leftX = 48;
  const labelWidth = 175;
  const valueX = leftX + labelWidth + 8;
  const valueWidth = doc.page.width - 48 - valueX;
  const startY = doc.y;

  doc
    .font("Regular")
    .fontSize(10)
    .fillColor("#475569")
    .text(label, leftX, startY, { width: labelWidth });
  const labelEndY = doc.y;

  doc
    .font(boldValue ? "Bold" : "Regular")
    .fontSize(10)
    .fillColor("#0F172A")
    .text(String(value ?? "—"), valueX, startY, {
      width: valueWidth,
      align: "right",
    });
  const valueEndY = doc.y;

  doc.y = Math.max(labelEndY, valueEndY) + 5;
  doc
    .moveTo(leftX, doc.y)
    .lineTo(doc.page.width - 48, doc.y)
    .lineWidth(0.5)
    .strokeColor("#E2E8F0")
    .stroke();
  doc.y += 6;
}

function drawSectionHeading(doc, title) {
  if (doc.y > doc.page.height - 130) {
    doc.addPage();
  }
  doc.moveDown(0.35);
  doc
    .font("Bold")
    .fontSize(11)
    .fillColor("#0052CC")
    .text(title, 48, doc.y);
  doc.moveDown(0.35);
}

/**
 * Tạo Buffer biên nhận đối soát giao dịch chuẩn A4 định dạng PDF hỗ trợ Unicode tiếng Việt.
 */
async function buildTransactionReceiptPdf({
  detail,
  adminName = "Quản trị viên",
  printedAt = new Date(),
}) {
  if (!detail) {
    throw httpError(404, "Không tìm thấy thông tin giao dịch để in biên nhận");
  }
  assertUnicodeFontsAvailable();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: {
        Title: `Biên nhận giao dịch ${detail.id}`,
        Author: "Mio E-Wallet Admin",
        Subject: "Biên nhận đối soát giao dịch ví điện tử",
      },
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("Regular", REGULAR_FONT_PATH);
    doc.registerFont("Bold", BOLD_FONT_PATH);

    // Header banner
    doc
      .rect(48, 44, doc.page.width - 96, 68)
      .fillAndStroke("#EFF6FF", "#BFDBFE");

    doc
      .font("Bold")
      .fontSize(15)
      .fillColor("#0052CC")
      .text("MIO E-WALLET — BIÊN NHẬN ĐỐI SOÁT GIAO DỊCH", 64, 58);

    doc
      .font("Regular")
      .fontSize(9.5)
      .fillColor("#334155")
      .text(`Mã giao dịch (TxID): ${detail.id}`, 64, 80)
      .text(`Thời điểm xuất: ${formatVnDateTime(printedAt)}`, 64, 94);

    doc.y = 128;

    // 1. Tổng quan giao dịch
    drawSectionHeading(doc, "1. THÔNG TIN GIAO DỊCH");
    drawKeyValueRow(
      doc,
      "Loại giao dịch",
      TYPE_LABEL[detail.transaction_type] || detail.transaction_type,
      { boldValue: true },
    );
    drawKeyValueRow(
      doc,
      "Trạng thái",
      STATUS_LABEL[detail.status] || detail.status,
      { boldValue: true },
    );
    drawKeyValueRow(doc, "Thời gian phát sinh", formatVnDateTime(detail.created_at));
    drawKeyValueRow(doc, "Nội dung giao dịch", detail.description || "Không có mô tả");
    drawKeyValueRow(doc, "Idempotency-Key", detail.idempotency_key || "—");

    // 2. Chi tiết tài chính
    drawSectionHeading(doc, "2. CHI TIẾT TÀI CHÍNH");
    drawKeyValueRow(doc, "Giá trị giao dịch gốc", formatVnd(detail.amount), {
      boldValue: true,
    });
    drawKeyValueRow(doc, "Phí dịch vụ ví nguồn", formatVnd(detail.fee));
    if (Number(detail.merchant_fee || 0) > 0 || detail.transaction_type === "PAYMENT") {
      drawKeyValueRow(
        doc,
        "Phí chiết khấu sàn (Merchant)",
        formatVnd(detail.merchant_fee),
      );
    }
    drawKeyValueRow(
      doc,
      "Thực nhận ví đích",
      formatVnd(detail.net_amount ?? detail.amount),
      { boldValue: true },
    );

    // 3. Các bên tham gia
    drawSectionHeading(doc, "3. CÁC BÊN THAM GIA & KÊNH LIÊN KẾT");
    if (detail.transaction_type === "TRANSFER") {
      drawKeyValueRow(
        doc,
        "Người gửi",
        `${detail.sender?.full_name || "—"} (${detail.sender?.phone || "—"})`,
      );
      drawKeyValueRow(
        doc,
        "Người nhận",
        `${detail.receiver?.full_name || "—"} (${detail.receiver?.phone || "—"})`,
      );
    } else if (detail.transaction_type === "PAYMENT") {
      drawKeyValueRow(
        doc,
        "Người thanh toán",
        detail.postpaid_refund?.is_postpaid_payment
          ? `${detail.postpaid_refund.buyer_name || detail.payer?.full_name || "—"} (Ví trả sau)`
          : `${detail.payer?.full_name || "—"} (${detail.payer?.phone || "—"})`,
      );
      drawKeyValueRow(
        doc,
        "Merchant thụ hưởng",
        `${detail.merchant?.full_name || "—"} (${detail.merchant?.phone || "—"})`,
      );
      if (detail.payment_request?.order_id) {
        drawKeyValueRow(doc, "Mã đơn hàng (Order ID)", detail.payment_request.order_id);
      }
      if (detail.payment_request?.reference_code) {
        drawKeyValueRow(doc, "Mã đối soát QR", detail.payment_request.reference_code);
      }
    } else if (detail.transaction_type === "TOPUP" || detail.transaction_type === "WITHDRAW") {
      drawKeyValueRow(
        doc,
        "Chủ ví",
        `${detail.user?.full_name || "—"} (${detail.user?.phone || "—"})`,
      );
      drawKeyValueRow(
        doc,
        "Ngân hàng liên kết",
        `${detail.bank?.bank_name || "—"} (${maskAccountNumber(detail.bank?.account_number) || "—"})`,
      );
    }

    // 4. Đối soát & Can thiệp
    drawSectionHeading(doc, "4. ĐỐI SOÁT TOÀN VẸN & KIỂM TOÁN");
    const integrityText =
      detail.is_balance_consistent === true
        ? "Khớp toàn vẹn 100% với biến động số dư"
        : detail.is_balance_consistent === false
          ? "Cảnh báo: Phát hiện sai lệch số dư"
          : "Chưa đủ snapshot để đối soát số dư";
    drawKeyValueRow(doc, "Trạng thái đối soát", integrityText);

    if (detail.admin_intervention?.is_admin_operation) {
      drawKeyValueRow(
        doc,
        "Can thiệp quản trị",
        `${detail.admin_intervention.action} — ${detail.admin_intervention.admin?.full_name || "Admin"}`,
      );
      drawKeyValueRow(
        doc,
        "Lý do can thiệp",
        detail.admin_intervention.reason || "—",
      );
    }

    if (detail.reversal_info) {
      drawKeyValueRow(
        doc,
        "Liên kết hoàn tiền P2P",
        detail.reversal_info.direction === "IS_REVERSAL"
          ? `Giao dịch bù trừ cho GD gốc ${detail.reversal_info.original_transaction_id}`
          : `Đã hoàn toàn bộ qua GD ${detail.reversal_info.reversal_transaction_id}`,
      );
    }

    if (detail.postpaid_refund?.is_postpaid_payment) {
      drawKeyValueRow(
        doc,
        "Trạng thái Ví trả sau",
        `Đã hoàn ${formatVnd(detail.postpaid_refund.refunded_amount)} / ${formatVnd(detail.postpaid_refund.original_amount)} (Còn có thể hoàn: ${formatVnd(detail.postpaid_refund.remaining_refundable)})`,
      );
    }

    drawKeyValueRow(doc, "Quản trị viên xuất biên nhận", adminName);

    doc.moveDown(0.8);
    doc
      .font("Regular")
      .fontSize(8.5)
      .fillColor("#64748B")
      .text(
        "Tài liệu được trích xuất từ hệ thống quản trị Mio E-Wallet để phục vụ đối soát nội bộ.",
        48,
        doc.y,
        { align: "center", width: doc.page.width - 96 },
      );

    doc.end();
  });
}

function sendReceiptPdfResponse(res, { buffer, txId }) {
  const safeTxId = String(txId || "giao-dich").replace(/[^a-zA-Z0-9_-]/g, "");
  const fileName = `bien-nhan-${safeTxId}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Content-Length", buffer.length);
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(buffer);
}

module.exports = {
  buildTransactionReceiptPdf,
  sendReceiptPdfResponse,
  REGULAR_FONT_PATH,
  BOLD_FONT_PATH,
};
