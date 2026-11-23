// wallet.service.js: Nghiệp vụ số dư ví, kiểm tra điều kiện giao dịch và xác thực mã PIN + Step-Up OTP.
const userRepository = require("../user/user.repository");
const walletRepository = require("./wallet.repository");
const otpService = require("../otp/otp.service");
const authService = require("../auth/auth.service");
const bcrypt = require("bcrypt");
const tokenUtil = require("../../utils/auth/jwt");
const { httpError } = require("../../utils/common/http");
const { computePinBinding } = require("../../utils/security/pinBinding");
const { isValidPasswordOrPin } = require("../../utils/common/validators");
const { maskEmail } = require("../../utils/common/text");
const { PIN_POLICY_DEFAULTS } = require("../../utils/auth/authHelpers");
const { createWalletCoreService } = require("./wallet.helpers");

const walletService = {
  ...createWalletCoreService({ walletRepository }),

  async checkPin({
    userId,
    pin,
    idempotencyKey,
    action,
    params,
    riskChallenge = false,
  }) {
    if (!userId || !pin) {
      throw httpError(400, "Thiếu thông tin để kiểm tra mã pin");
    }
    if (!isValidPasswordOrPin(pin)) {
      throw httpError(400, "Mã PIN không hợp lệ");
    }
    if (!idempotencyKey) {
      throw httpError(400, "Thiếu mã chống trùng lặp giao dịch");
    }

    const { MAX_ATTEMPTS, LOCK_MINUTES } = PIN_POLICY_DEFAULTS;
    const binding = computePinBinding(action, params);

    const claimed = await userRepository.claimPinAttempt({
      userId,
      maxAttempts: MAX_ATTEMPTS,
      lockMinutes: LOCK_MINUTES,
    });

    if (!claimed) {
      const state = await userRepository.getPinState(userId);
      if (!state?.pin_hash) {
        throw httpError(400, "Người dùng chưa thiết lập mã pin");
      }
      throw httpError(
        403,
        `Bạn đã nhập sai PIN quá nhiều lần. Vui lòng thử lại sau ${LOCK_MINUTES} phút`,
      );
    }

    const attempts = Number(claimed.pin_failed_attempts);
    const isCorrectPin = await bcrypt.compare(pin, claimed.pin_hash);

    if (!isCorrectPin) {
      if (attempts >= MAX_ATTEMPTS) {
        throw httpError(
          403,
          `Bạn đã nhập sai PIN ${MAX_ATTEMPTS} lần. Tạm khóa ${LOCK_MINUTES} phút`,
        );
      }
      return {
        is_correct: false,
        remaining_attempts: MAX_ATTEMPTS - attempts,
      };
    }

    if (riskChallenge || attempts >= 3) {
      const heldAttempts = Math.min(
        Math.max(attempts - 1, 2),
        MAX_ATTEMPTS - 1,
      );
      await userRepository.holdPinChallengeAttempt({
        userId,
        attempts: heldAttempts,
      });

      if (!claimed.totp_enabled && claimed.email) {
        try {
          await otpService.generateAndSaveOtp({ email: claimed.email });
        } catch (e) {
          if (e.statusCode !== 429) throw e;
        }
      }

      const challengeToken = tokenUtil.generateOtpToken(
        { id: userId, phone: claimed.phone, email: claimed.email },
        "pin_challenge",
        {
          idempotency_key: idempotencyKey,
          action,
          binding,
          totp_enabled: Boolean(claimed.totp_enabled),
        },
      );

      return {
        is_correct: true,
        challenge_required: true,
        challenge_token: challengeToken,
        otp_method: claimed.totp_enabled ? "totp" : "email",
        masked_email: maskEmail(claimed.email || ""),
      };
    }

    await userRepository.resetFailedPin(userId);

    return {
      is_correct: true,
      pin_token: tokenUtil.generatePinToken({
        userId,
        idempotencyKey,
        action,
        binding,
      }),
    };
  },

  async verifyPinChallenge({ userId, otpUser, otp }) {
    if (!userId || !otpUser) {
      throw httpError(401, "Phiên xác thực bổ sung không hợp lệ");
    }

    if (otpUser.totp_enabled) {
      await authService.verifyTotpCode({
        userId,
        code: otp,
        requireEnabled: true,
      });
    } else {
      await otpService.verifyOtp({ email: otpUser.email, otp });
    }

    await userRepository.resetFailedPin(userId);

    return {
      is_correct: true,
      pin_token: tokenUtil.generatePinToken({
        userId,
        idempotencyKey: otpUser.idempotency_key,
        action: otpUser.action,
        binding: otpUser.binding,
      }),
    };
  },

  async resendPinChallenge({ userId, otpUser }) {
    if (!userId || !otpUser) {
      throw httpError(401, "Phiên xác thực bổ sung không hợp lệ");
    }
    if (otpUser.totp_enabled) {
      throw httpError(
        400,
        "Tài khoản đang dùng Google Authenticator, không có mã gửi qua email",
      );
    }
    await otpService.generateAndSaveOtp({ email: otpUser.email });
    return {
      masked_email: maskEmail(otpUser.email || ""),
    };
  },
};

module.exports = walletService;
