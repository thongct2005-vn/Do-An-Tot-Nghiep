const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { httpError } = require("../utils/httpError");

const transporter = nodemailer.createTransport({
  service: "gmail",
  pool: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

async function sendOtpEmail({ to, otp, expiresInMinutes = 5 }) {
  if (!to || !otp) {
    throw httpError(400, "Thiếu thông tin để gửi OTP");
  }

  try {
    await transporter.sendMail({
      from: `"Mio" <${process.env.GMAIL_USER}>`,
      to,
      subject: "Mã xác thực OTP của bạn",
      text: `Mã OTP của bạn là ${otp}. Mã có hiệu lực trong ${expiresInMinutes} phút. Không chia sẻ mã này với bất kỳ ai.`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:420px">
          <p>Mã OTP của bạn là:</p>
          <p style="font-size:32px;font-weight:bold;letter-spacing:6px">${otp}</p>
          <p>Mã có hiệu lực trong ${expiresInMinutes} phút.<br/>
          Không chia sẻ mã này với bất kỳ ai.</p>
        </div>`,
    });
  } catch (err) {
    throw httpError(502, "Không thể gửi OTP, vui lòng thử lại");
  }
}

// Gửi file Excel lịch sử giao dịch (đính kèm) đến email đã đăng ký
async function sendTransactionExportEmail({
  to,
  buffer,
  fileName,
  startDate,
  endDate,
  rowCount,
}) {
  if (!to || !buffer || !fileName) {
    throw httpError(400, "Thiếu thông tin để gửi file Excel");
  }

  const toVn = (ymd) => ymd.split("-").reverse().join("/");
  const period = `${toVn(startDate)} - ${toVn(endDate)}`;

  try {
    await transporter.sendMail({
      from: `"Mio" <${process.env.GMAIL_USER}>`,
      to,
      subject: `Lịch sử giao dịch Mio (${period})`,
      text: `Đính kèm là file Excel lịch sử giao dịch từ ${toVn(startDate)} đến ${toVn(endDate)} (${rowCount} giao dịch). Nếu bạn không thực hiện yêu cầu này, hãy đổi mật khẩu và liên hệ hỗ trợ ngay.`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px">
          <p>Đính kèm là file Excel lịch sử giao dịch của bạn.</p>
          <p><b>Khoảng thời gian:</b> ${period}<br/>
          <b>Số giao dịch:</b> ${rowCount}</p>
          <p style="color:#777;font-size:12px">Nếu bạn không thực hiện yêu cầu này, hãy đổi mật khẩu và liên hệ hỗ trợ ngay.</p>
        </div>`,
      attachments: [
        {
          filename: fileName,
          content: buffer,
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      ],
    });
  } catch (err) {
    throw httpError(502, "Không thể gửi email, vui lòng thử lại sau");
  }
}

const LOWER_CHARS = "abcdefghijkmnpqrstuvwxyz";
const UPPER_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGIT_CHARS = "23456789";
const SPECIAL_CHARS = "@#$%&*!?";
const ALL_PASSWORD_CHARS = LOWER_CHARS + UPPER_CHARS + DIGIT_CHARS + SPECIAL_CHARS;

function pickRandomChar(charset) {
  return charset[crypto.randomInt(0, charset.length)];
}

function generateTemporaryPassword(length = 12) {
  const targetLength = Math.max(8, Math.min(15, Number(length) || 12));
  const chars = [
    pickRandomChar(UPPER_CHARS),
    pickRandomChar(LOWER_CHARS),
    pickRandomChar(DIGIT_CHARS),
    pickRandomChar(SPECIAL_CHARS),
  ];
  while (chars.length < targetLength) {
    chars.push(pickRandomChar(ALL_PASSWORD_CHARS));
  }
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }
  return chars.join("");
}

function escapeHtmlText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendMerchantAccountCreatedEmail({ to, fullName, phone, tempPassword }) {
  const safeName = escapeHtmlText(fullName || "Đối tác Merchant");
  const safePhone = escapeHtmlText(phone || "");
  const safePassword = escapeHtmlText(tempPassword || "");
  const subject = "[E-Wallet] Thông tin kích hoạt tài khoản Merchant";
  const text = [
    `Xin chào ${fullName || "Đối tác Merchant"},`,
    "",
    "Tài khoản Merchant của bạn đã được khởi tạo trên hệ thống E-Wallet.",
    `Số điện thoại đăng nhập: ${phone || ""}`,
    `Mật khẩu tạm thời: ${tempPassword || ""}`,
    "",
    "Lưu ý bảo mật: Vui lòng đăng nhập và đổi mật khẩu ngay trong lần đăng nhập đầu tiên.",
    "Sau khi đổi mật khẩu và đăng nhập lại Dashboard, bạn có thể tự tạo API Key và Secret Key.",
  ].join("\n");
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
      <h2 style="color: #0f4c81; margin-bottom: 12px;">Thông tin kích hoạt tài khoản Merchant</h2>
      <p>Xin chào <strong>${safeName}</strong>,</p>
      <p>Tài khoản Merchant của bạn đã được khởi tạo trên hệ thống E-Wallet.</p>
      <div style="background: #f3f6fa; border: 1px solid #dbe3ec; border-radius: 8px; padding: 14px 16px; margin: 16px 0;">
        <p style="margin: 4px 0;"><strong>Số điện thoại đăng nhập:</strong> <code>${safePhone}</code></p>
        <p style="margin: 4px 0;"><strong>Mật khẩu tạm thời:</strong> <code>${safePassword}</code></p>
      </div>
      <p><strong>Lưu ý bắt buộc:</strong> Hệ thống yêu cầu bạn đổi mật khẩu ở lần đăng nhập đầu tiên, sau đó đăng nhập lại bằng mật khẩu mới để truy cập Dashboard và tự tạo API Key / Secret Key.</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"E-Wallet System" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      text,
      html,
    });
  } catch (err) {
    throw httpError(502, `Không thể gửi email kích hoạt tài khoản Merchant: ${err.message}`);
  }
}

function isWeakUserTemporaryPassword(code) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return true;
  if (/^(\d)\1{5}$/.test(code)) return true;
  const diffs = [];
  for (let i = 1; i < code.length; i += 1) {
    diffs.push(Number(code[i]) - Number(code[i - 1]));
  }
  if (diffs.every((d) => d === 1) || diffs.every((d) => d === -1)) {
    return true;
  }
  return false;
}

function generateUserTemporaryPassword() {
  let code = "";
  do {
    code = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
  } while (isWeakUserTemporaryPassword(code));
  return code;
}

async function sendUserAccountCreatedEmail({ to, fullName, phone, tempPassword }) {
  const safeName = escapeHtmlText(fullName || "Quý khách");
  const safePhone = escapeHtmlText(phone || "");
  const safePassword = escapeHtmlText(tempPassword || "");
  const subject = "[E-Wallet] Thông tin kích hoạt tài khoản ví điện tử";
  const text = [
    `Xin chào ${fullName || "Quý khách"},`,
    "",
    "Tài khoản ví điện tử E-Wallet của bạn đã được quản trị viên khởi tạo.",
    `Số điện thoại đăng nhập: ${phone || ""}`,
    `Mật khẩu tạm thời (6 chữ số): ${tempPassword || ""}`,
    "",
    "Lưu ý bảo mật: Vui lòng mở ứng dụng E-Wallet, đăng nhập bằng số điện thoại và mật khẩu tạm thời ở trên.",
    "Hệ thống bắt buộc bạn phải đổi sang mật khẩu 6 chữ số mới ngay trong lần đăng nhập đầu tiên trước khi sử dụng ví.",
  ].join("\n");
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
      <h2 style="color: #0f4c81; margin-bottom: 12px;">Thông tin kích hoạt tài khoản ví điện tử</h2>
      <p>Xin chào <strong>${safeName}</strong>,</p>
      <p>Tài khoản ví điện tử E-Wallet của bạn đã được quản trị viên khởi tạo.</p>
      <div style="background: #f3f6fa; border: 1px solid #dbe3ec; border-radius: 8px; padding: 14px 16px; margin: 16px 0;">
        <p style="margin: 4px 0;"><strong>Số điện thoại đăng nhập:</strong> <code>${safePhone}</code></p>
        <p style="margin: 4px 0;"><strong>Mật khẩu tạm thời (6 chữ số):</strong> <code>${safePassword}</code></p>
      </div>
      <p><strong>Lưu ý bắt buộc:</strong> Vui lòng đăng nhập trên ứng dụng E-Wallet bằng mật khẩu tạm thời này; hệ thống sẽ yêu cầu bạn đổi sang mật khẩu 6 chữ số mới và đăng nhập lại ngay ở lần đầu tiên.</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"E-Wallet System" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      text,
      html,
    });
  } catch (err) {
    throw httpError(502, `Không thể gửi email kích hoạt tài khoản người dùng: ${err.message}`);
  }
}

module.exports = {
  sendOtpEmail,
  sendTransactionExportEmail,
  generateTemporaryPassword,
  sendMerchantAccountCreatedEmail,
  isWeakUserTemporaryPassword,
  generateUserTemporaryPassword,
  sendUserAccountCreatedEmail,
};