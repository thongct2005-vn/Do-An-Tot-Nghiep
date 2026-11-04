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

module.exports = { sendOtpEmail, sendTransactionExportEmail };