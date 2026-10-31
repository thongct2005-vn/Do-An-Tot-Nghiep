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

module.exports = { sendOtpEmail };
