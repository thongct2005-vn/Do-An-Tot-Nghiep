// auth.helpers.js: Các hàm kiểm tra đăng nhập, TOTP, điều kiện quên mật khẩu và đổi email cho Merchant Production.
const otpService = require("../../../otp/otp.service");
const tokenUtil = require("../../../../utils/auth/jwt");
const { httpError } = require("../../../../utils/common/http");
const {
  isValidPhone,
  isValidEmail,
  isValidOtp,
} = require("../../../../utils/common/validators");
const { maskEmail } = require("../../../../utils/common/text");
const {
  LOGIN_LOCKOUT_DEFAULTS,
  TOTP_POLICY_DEFAULTS,
} = require("../../../../utils/auth/authHelpers");
const {
  assertAccountBasicEligibility,
  verifyPasswordWithLockout,
  createTotpVerifier,
} = require("../../../../utils/auth/authHelpers");

const MAX_MERCHANT_EMAIL_LENGTH = 100;
const TOTP_ISSUER = process.env.TOTP_MERCHANT_ISSUER;

function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

function buildChangeEmailTokenMeta(user) {
  return {
    pv: tokenUtil.credentialVersion(user.password_hash),
    ev: tokenUtil.credentialVersion(user.email),
  };
}

function assertChangeEmailTokenFresh(user, { emailVersion, passwordVersion }) {
  const current = buildChangeEmailTokenMeta(user);
  if (
    !emailVersion ||
    !passwordVersion ||
    emailVersion !== current.ev ||
    passwordVersion !== current.pv
  ) {
    throw httpError(
      403,
      "Phiên đổi email đã hết hiệu lực, vui lòng thực hiện lại",
    );
  }
}

function assertActiveMerchantUser(user) {
  if (!user) {
    throw httpError(404, "Không tìm thấy tài khoản");
  }
  if (user.role !== "MERCHANT" || user.status !== "ACTIVE") {
    throw httpError(403, "Tài khoản không hợp lệ hoặc đã bị khóa");
  }
}

function assertMerchantForgotEligible(user) {
  if (!user) {
    throw httpError(404, "Số điện thoại chưa đăng ký tài khoản");
  }
  if (user.role !== "MERCHANT") {
    throw httpError(403, "Tài khoản không hợp lệ");
  }
  if (user.status !== "ACTIVE") {
    throw httpError(403, "Tài khoản bị khóa");
  }
  if (!user.email) {
    throw httpError(404, "Không tìm thấy email liên kết với số điện thoại");
  }
  if (!user.tax_code) {
    throw httpError(
      403,
      "Tài khoản chưa có mã số thuế định danh (KYC), vui lòng liên hệ hỗ trợ",
    );
  }
}

function createMerchantAuthHelpers(merchantAuthRepository) {
  const verifyTotpCode = createTotpVerifier({
    repository: merchantAuthRepository,
    policy: TOTP_POLICY_DEFAULTS,
  });

  async function checkCredentials(phone, password) {
    if (!phone || !password) {
      throw httpError(400, "Thiếu số điện thoại hoặc mật khẩu");
    }
    if (!isValidPhone(phone)) {
      throw httpError(400, "Số điện thoại không hợp lệ");
    }

    const user = await merchantAuthRepository.findMerchantByPhone(phone);
    await assertAccountBasicEligibility({
      user,
      expectedRole: "MERCHANT",
      resetFailedLogin: (id) => merchantAuthRepository.resetFailedLogin(id),
      identifier: phone,
    });

    if (!user.password_hash) {
      throw httpError(
        403,
        "Tài khoản chưa thiết lập mật khẩu. Vui lòng sử dụng chức năng Quên mật khẩu để kích hoạt tài khoản",
      );
    }

    return verifyPasswordWithLockout({
      user,
      password,
      identifier: phone,
      registerFailedLogin: () =>
        merchantAuthRepository.registerFailedLogin({
          phone,
          maxAttempts: LOGIN_LOCKOUT_DEFAULTS.MAX_ATTEMPTS,
          lockMinutes: LOGIN_LOCKOUT_DEFAULTS.LOCK_MINUTES,
        }),
      resetOnSuccess: false,
      detailedErrorMessage: true,
    });
  }

  async function getOtpMerchant({ userId, phone }) {
    const user = await merchantAuthRepository.findMerchantByPhone(phone);
    if (
      !user ||
      user.id !== userId ||
      user.status !== "ACTIVE" ||
      user.role !== "MERCHANT"
    ) {
      throw httpError(401, "Phiên xác thực không hợp lệ");
    }
    if (!user.email) {
      throw httpError(404, "Không tìm thấy email liên kết với số điện thoại");
    }
    return user;
  }

  async function assertAvailableNewEmail(user, newEmail) {
    const normalized = normalizeEmail(newEmail);
    if (!normalized) {
      throw httpError(400, "Vui lòng nhập email mới");
    }
    if (normalized.length > MAX_MERCHANT_EMAIL_LENGTH) {
      throw httpError(
        400,
        `Email mới không được vượt quá ${MAX_MERCHANT_EMAIL_LENGTH} ký tự`,
      );
    }
    if (!isValidEmail(normalized)) {
      throw httpError(400, "Email mới không hợp lệ");
    }
    if (normalized === normalizeEmail(user.email)) {
      throw httpError(400, "Email mới phải khác email hiện tại");
    }
    const claimed = await merchantAuthRepository.isEmailClaimedByOther(
      normalized,
      user.id,
    );
    if (claimed) {
      throw httpError(409, "Địa chỉ email đã được liên kết với tài khoản khác");
    }
    return normalized;
  }

  async function issueNewEmailConfirmOtp({
    userId,
    newEmail,
    emailVersion,
    passwordVersion,
    ignoreCooldown,
  }) {
    const user = await merchantAuthRepository.findMerchantById(userId);
    assertActiveMerchantUser(user);
    assertChangeEmailTokenFresh(user, { emailVersion, passwordVersion });

    const normalizedNewEmail = await assertAvailableNewEmail(user, newEmail);

    try {
      await otpService.generateAndSaveOtp({ email: normalizedNewEmail });
    } catch (e) {
      if (!ignoreCooldown || e.statusCode !== 429) throw e;
    }

    return {
      otp_token: tokenUtil.generateOtpToken(
        user,
        "merchant_change_email_confirm_otp",
        {
          ...buildChangeEmailTokenMeta(user),
          new_email: normalizedNewEmail,
        },
      ),
      masked_new_email: maskEmail(normalizedNewEmail),
    };
  }

  async function verifyMerchantOtpOrTotp(user, otp) {
    const code = String(otp ?? "").trim();
    if (!code) {
      throw httpError(400, "Vui lòng nhập mã xác thực");
    }
    if (!isValidOtp(code)) {
      throw httpError(400, "Mã xác thực phải gồm 6 chữ số");
    }
    if (user.totp_enabled) {
      await verifyTotpCode({
        userId: user.id,
        code,
        requireEnabled: true,
      });
      return;
    }
    if (!user.email) {
      throw httpError(404, "Không tìm thấy email liên kết với tài khoản");
    }
    await otpService.verifyOtp({ email: user.email, otp: code });
  }

  return {
    checkCredentials,
    verifyTotpCode,
    getOtpMerchant,
    assertMerchantForgotEligible,
    normalizeEmail,
    buildChangeEmailTokenMeta,
    assertChangeEmailTokenFresh,
    assertAvailableNewEmail,
    issueNewEmailConfirmOtp,
    assertActiveMerchantUser,
    verifyMerchantOtpOrTotp,
  };
}

module.exports = {
  MAX_MERCHANT_EMAIL_LENGTH,
  TOTP_ISSUER,
  normalizeEmail,
  buildChangeEmailTokenMeta,
  assertChangeEmailTokenFresh,
  assertActiveMerchantUser,
  assertMerchantForgotEligible,
  createMerchantAuthHelpers,
};
