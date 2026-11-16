const bcrypt = require("bcrypt");
const pool = require("../config/database");
const { httpError } = require("./httpError");
const tokenUtil = require("./jwt");
const {
  isValidPasswordMerchant,
  isValidPasswordOrPin,
} = require("./validators");

const ROLE_PRESETS = {
  MERCHANT: {
    allowedRole: "MERCHANT",
    validatePassword: isValidPasswordMerchant,
    invalidPasswordMessage:
      "Mật khẩu phải từ 8 đến 15 ký tự, có ít nhất 1 chữ hoa, 1 chữ thường, 1 chữ số, 1 ký tự đặc biệt và không chứa khoảng trắng",
  },
  USER: {
    allowedRole: "USER",
    validatePassword: isValidPasswordOrPin,
    invalidPasswordMessage: "Mật khẩu mới phải có đúng 6 chữ số",
  },
};

function buildFirstLoginChallenge(user, options = {}) {
  const {
    purpose = "user_first_login_change",
    expiresIn = "10m",
  } = typeof options === "string" ? { purpose: options } : options;

  const changePasswordToken = tokenUtil.generateOtpToken(
    user,
    purpose,
    { pv: tokenUtil.credentialVersion(user.password_hash) },
    expiresIn,
  );
  return {
    must_change_password: true,
    change_password_token: changePasswordToken,
    user_info: {
      user_id: user.id,
      phone: user.phone,
      full_name: user.full_name,
    },
  };
}

async function changeFirstLoginPassword({
  userId,
  version,
  password,
  confirmPassword,
  allowedRole = "MERCHANT",
  validatePassword,
  invalidPasswordMessage,
}) {
  const preset = ROLE_PRESETS[allowedRole] || {};
  const targetRole = preset.allowedRole || allowedRole;
  const validator =
    validatePassword || preset.validatePassword || isValidPasswordMerchant;
  const invalidMessage =
    invalidPasswordMessage ||
    preset.invalidPasswordMessage ||
    "Mật khẩu không đúng định dạng yêu cầu";

  if (!userId) {
    throw httpError(400, "Thiếu thông tin người dùng");
  }
  if (!password) {
    throw httpError(400, "Thiếu mật khẩu mới");
  }
  if (!confirmPassword) {
    throw httpError(400, "Vui lòng xác nhận lại mật khẩu");
  }
  if (password !== confirmPassword) {
    throw httpError(400, "Mật khẩu xác nhận không khớp");
  }
  if (!validator(password)) {
    throw httpError(400, invalidMessage);
  }

  const found = await pool.query(
    `SELECT id, role, status, password_hash, must_change_password
     FROM public.users
     WHERE id = $1
     LIMIT 1`,
    [userId],
  );
  const user = found.rows[0];
  if (!user) {
    throw httpError(404, "Không tìm thấy tài khoản");
  }
  if ((targetRole && user.role !== targetRole) || user.status !== "ACTIVE") {
    throw httpError(403, "Tài khoản không hợp lệ hoặc đã bị khóa");
  }
  if (user.must_change_password !== true) {
    throw httpError(
      409,
      "Tài khoản không ở trạng thái bắt buộc đổi mật khẩu lần đầu",
    );
  }
  if (tokenUtil.credentialVersion(user.password_hash) !== version) {
    throw httpError(
      401,
      "Phiên đổi mật khẩu đã hết hiệu lực, vui lòng đăng nhập lại",
    );
  }

  if (user.password_hash) {
    const isSameAsTemp = await bcrypt.compare(password, user.password_hash);
    if (isSameAsTemp) {
      throw httpError(
        400,
        "Mật khẩu mới không được trùng với mật khẩu tạm thời",
      );
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const updated = await pool.query(
    `UPDATE public.users
     SET password_hash = $1,
         must_change_password = FALSE,
         refresh_token = NULL,
         failed_login_attempts = 0,
         locked_until = NULL,
         updated_at = NOW()
     WHERE id = $2
       AND must_change_password = TRUE
       AND password_hash IS NOT DISTINCT FROM $3
     RETURNING id, must_change_password`,
    [passwordHash, userId, user.password_hash],
  );

  if (!updated.rows[0]) {
    throw httpError(
      409,
      "Trạng thái tài khoản đã thay đổi, vui lòng đăng nhập lại",
    );
  }

  return {
    must_change_password: false,
    require_relogin: true,
  };
}

module.exports = {
  buildFirstLoginChallenge,
  changeFirstLoginPassword,
};
