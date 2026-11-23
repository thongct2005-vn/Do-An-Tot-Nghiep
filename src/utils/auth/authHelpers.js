// authHelpers.js: Chính sách bảo mật, kiểm tra tài khoản/mật khẩu/TOTP và đổi mật khẩu lần đầu dùng chung cho Auth, Wallet và Admin.
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const pool = require("../../config/database");
const totpUtil = require("./totp");
const tokenUtil = require("./jwt");
const { httpError } = require("../common/http");
const {
  isValidOtp,
  isValidPasswordMerchant,
  isValidPasswordOrPin,
} = require("../common/validators");

const LOGIN_LOCKOUT_DEFAULTS = {
  MAX_ATTEMPTS: 5,
  LOCK_MINUTES: 30,
};

const TOTP_POLICY_DEFAULTS = {
  MAX_ATTEMPTS: 5,
  LOCK_MINUTES: 5,
  ISSUER: "LumaPay",
};

const PIN_POLICY_DEFAULTS = {
  MAX_ATTEMPTS: 5,
  LOCK_MINUTES: 15,
};

const FIRST_LOGIN_ROLE_PRESETS = {
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

function hashPhoneSha256(phone) {
  return crypto.createHash("sha256").update(phone).digest("hex");
}

function buildBasicUserInfo(user) {
  return {
    user_id: user.id,
    phone: user.phone,
    full_name: user.full_name,
  };
}

async function assertAccountBasicEligibility({
  user,
  expectedRole,
  requireEmail = true,
  notFoundMessage = "Số điện thoại chưa đăng ký tài khoản",
  wrongRoleMessage = "Tài khoản không hợp lệ",
  resetFailedLogin,
  identifier,
}) {
  if (!user) {
    throw httpError(404, notFoundMessage);
  }
  if (requireEmail && !user.email) {
    throw httpError(404, "Không tìm thấy email liên kết với số điện thoại");
  }
  if (user.status !== "ACTIVE") {
    throw httpError(403, "Tài khoản bị khóa");
  }
  if (expectedRole && user.role !== expectedRole) {
    throw httpError(403, wrongRoleMessage);
  }
  if (user.locked_until) {
    if (user.is_locked) {
      throw httpError(403, "Tài khoản bị tạm khóa");
    }
    if (resetFailedLogin) {
      await resetFailedLogin(identifier);
    }
    user.failed_login_attempts = 0;
    user.locked_until = null;
  }
  return user;
}

async function verifyPasswordWithLockout({
  user,
  password,
  registerFailedLogin,
  resetFailedLogin,
  identifier,
  policy = LOGIN_LOCKOUT_DEFAULTS,
  resetOnSuccess = true,
  detailedErrorMessage = true,
}) {
  const { MAX_ATTEMPTS, LOCK_MINUTES } = policy;
  const isCorrectPassword = await bcrypt.compare(password, user.password_hash);

  if (!isCorrectPassword) {
    const row = await registerFailedLogin();
    const attempts = Number(row?.failed_login_attempts ?? MAX_ATTEMPTS);
    const remainingAttempts = Math.max(MAX_ATTEMPTS - attempts, 0);
    const isLocked = attempts >= MAX_ATTEMPTS;

    let message;
    if (detailedErrorMessage) {
      message = isLocked
        ? `Bạn đã nhập sai mật khẩu ${MAX_ATTEMPTS} lần. Tài khoản bị tạm khóa ${LOCK_MINUTES} phút`
        : `Mật khẩu không chính xác. Bạn còn ${remainingAttempts} lần thử`;
    } else {
      message = isLocked ? "Tài khoản bị tạm khóa" : "Mật khẩu không chính xác";
    }

    const err = httpError(isLocked ? 403 : 400, message);
    err.remainingAttempts = remainingAttempts;
    throw err;
  }

  if (resetOnSuccess && resetFailedLogin) {
    await resetFailedLogin(identifier);
  }
  user.prior_failed_attempts = Number(user.failed_login_attempts || 0);
  return user;
}

function createTotpVerifier({
  repository,
  policy = TOTP_POLICY_DEFAULTS,
}) {
  const { MAX_ATTEMPTS, LOCK_MINUTES } = policy;

  return async function verifyTotpCode({ userId, code, requireEnabled }) {
    if (!isValidOtp(code)) {
      throw httpError(400, "Mã xác thực phải gồm 6 chữ số");
    }

    const state = await repository.getTotpState(userId);
    if (!state || !state.totp_secret || state.totp_enabled !== requireEnabled) {
      throw httpError(
        400,
        requireEnabled
          ? "Tài khoản chưa bật Google Authenticator"
          : "Chưa có mã QR để xác nhận, vui lòng quét lại mã QR",
      );
    }
    if (state.is_totp_locked) {
      throw httpError(
        403,
        `Bạn đã nhập sai quá nhiều lần. Vui lòng thử lại sau ${LOCK_MINUTES} phút`,
      );
    }

    const secret = totpUtil.decryptSecret(state.totp_secret);
    const lastStep =
      state.totp_last_step === null ? null : Number(state.totp_last_step);
    const step = totpUtil.verifyCode(secret, code, { lastStep });

    if (step === null) {
      const row = await repository.registerTotpFailure({
        userId,
        maxAttempts: MAX_ATTEMPTS,
        lockMinutes: LOCK_MINUTES,
      });
      const attempts = Number(row?.totp_failed_attempts ?? MAX_ATTEMPTS);
      if (attempts >= MAX_ATTEMPTS) {
        throw httpError(
          403,
          `Bạn đã nhập sai ${MAX_ATTEMPTS} lần. Tạm khóa ${LOCK_MINUTES} phút`,
        );
      }
      throw httpError(
        400,
        `Mã không chính xác hoặc đã được sử dụng. Bạn còn ${MAX_ATTEMPTS - attempts} lần thử`,
      );
    }

    const consumed = await repository.consumeTotpStep({ userId, step });
    if (!consumed) {
      throw httpError(400, "Mã đã được sử dụng, vui lòng đợi mã mới");
    }
  };
}

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
    user_info: buildBasicUserInfo(user),
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
  const preset = FIRST_LOGIN_ROLE_PRESETS[allowedRole] || {};
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
  LOGIN_LOCKOUT_DEFAULTS,
  TOTP_POLICY_DEFAULTS,
  PIN_POLICY_DEFAULTS,
  hashPhoneSha256,
  buildBasicUserInfo,
  assertAccountBasicEligibility,
  verifyPasswordWithLockout,
  createTotpVerifier,
  buildFirstLoginChallenge,
  changeFirstLoginPassword,
};

