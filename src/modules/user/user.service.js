// user.service.js: Nghiệp vụ tra cứu người dùng, PIN, mật khẩu, hạn mức giao dịch và khôi phục tài khoản qua eKYC.
const bcrypt = require("bcrypt");
const userRepository = require("./user.repository");
const kycRepository = require("../kyc/kyc.repository");
const kycService = require("../kyc/kyc.service");
const otpService = require("../otp/otp.service");
const tokenUtil = require("../../utils/auth/jwt");
const { httpError } = require("../../utils/common/http");
const { emitToUser } = require("../../utils/notifications/socket");
const { maskPhone, maskEmail } = require("../../utils/common/text");
const {
  isValidPasswordOrPin,
  isValidPhone,
  isValidPhonesHash,
} = require("../../utils/common/validators");
const { getPositiveIntConfig } = require("../../utils/limits/limitsDb");
const {
  fetchTransactionLimits,
  updateUserTransactionLimit,
  resetUserTransactionLimit,
} = require("../../utils/limits/userLimitsService");
const {
  PIN_POLICY_DEFAULTS,
  LOGIN_LOCKOUT_DEFAULTS,
} = require("../../utils/auth/authHelpers");
const {
  assertFaceMatchesApprovedKyc,
  safeUnlinkFiles,
} = require("../kyc/kyc.helpers");
const {
  getResettableUser,
  assertForgotType,
  assertForgotUsable,
  getForgotOtpUser,
  verifyCredentialChallenge,
} = require("./user.helpers");

const userService = {
  async findUserByPhone({ userId, phone }) {
    if (!phone) {
      throw httpError(400, "Thiếu số điện thoại");
    }
    if (!isValidPhone(phone)) {
      throw httpError(400, "Số điện thoại không hợp lệ");
    }

    const user = await userRepository.findUserByPhone(phone);
    if (!user) {
      throw httpError(404, "Không tìm thấy người dùng này");
    }
    if (user.id === userId) {
      throw httpError(400, "Không thể chuyển tiền cho chính mình");
    }

    return {
      user_info: {
        user_id: user.id,
        phone: maskPhone(user.phone),
        full_name: user.full_name,
      },
    };
  },

  async findUserByPhoneHashList(phones) {
    if (!phones || !Array.isArray(phones)) {
      throw httpError(400, "Danh sách số điện thoại không hợp lệ");
    }

    const maxPhones = await getPositiveIntConfig("CONTACT_CHECK_MAX_PHONES");
    if (phones.length > maxPhones) {
      throw httpError(413, "Danh bạ quá lớn, vui lòng đồng bộ từng phần");
    }
    if (phones.length === 0) {
      return [];
    }
    if (!isValidPhonesHash(phones)) {
      throw httpError(400, "Danh sách số điện thoại không hợp lệ");
    }

    const uniquePhone = [...new Set(phones)];
    return (await userRepository.findUserByPhoneHashList(uniquePhone)) || [];
  },

  async checkPinStatus(userId) {
    if (!userId) {
      throw httpError(
        400,
        "Thiếu thông tin người dùng để kiểm tra trạng thái pin",
      );
    }
    const result = await userRepository.checkPinStatus(userId);
    return {
      has_pin: !!result?.pin_hash,
    };
  },

  async createPin({ userId, pin }) {
    if (!userId || !pin) {
      throw httpError(400, "Thiếu thông tin để tạo pin");
    }
    if (!isValidPasswordOrPin(pin)) {
      throw httpError(400, "Mã PIN phải gồm đúng 6 chữ số");
    }

    const salt = await bcrypt.genSalt(10);
    const pinHash = await bcrypt.hash(pin, salt);

    const updated = await userRepository.createPin({ userId, pinHash });
    if (!updated) {
      throw httpError(409, "Bạn đã có mã PIN, vui lòng dùng chức năng đổi PIN");
    }
  },

  async verifyCurrentPin({ userId, oldPin }) {
    return verifyCredentialChallenge({
      userId,
      value: oldPin,
      emptyMessage: "Vui lòng nhập mã PIN hiện tại",
      invalidFormatMessage: "Mã PIN phải gồm đúng 6 chữ số",
      hashField: "pin_hash",
      attemptsField: "pin_failed_attempts",
      missingMessage: "Bạn chưa thiết lập mã PIN",
      lockedMessage: `Bạn đã nhập sai PIN quá ${PIN_POLICY_DEFAULTS.MAX_ATTEMPTS} lần. Tài khoản bị khóa giao dịch trong ${PIN_POLICY_DEFAULTS.LOCK_MINUTES} phút`,
      claimAttemptFn: (args) => userRepository.claimPinAttempt(args),
      getStateFn: (id) => userRepository.getPinState(id),
      resetFailedFn: (id) => userRepository.resetFailedPin(id),
      maxAttempts: PIN_POLICY_DEFAULTS.MAX_ATTEMPTS,
      lockMinutes: PIN_POLICY_DEFAULTS.LOCK_MINUTES,
    });
  },

  async changePin({ userId, oldPin, newPin }) {
    if (!userId || !oldPin || !newPin) {
      throw httpError(400, "Thiếu thông tin mã PIN");
    }
    if (!isValidPasswordOrPin(oldPin) || !isValidPasswordOrPin(newPin)) {
      throw httpError(400, "Mã PIN phải gồm đúng 6 chữ số");
    }

    const user = await getResettableUser(userId);
    if (!user.pin_hash) {
      throw httpError(404, "Bạn chưa thiết lập mã PIN");
    }

    const verifyResult = await this.verifyCurrentPin({ userId, oldPin });
    if (!verifyResult.is_correct) {
      throw httpError(
        400,
        `Mã PIN hiện tại không đúng. Còn ${verifyResult.remaining_attempts} lần thử`,
      );
    }

    if (oldPin === newPin || (await bcrypt.compare(newPin, user.pin_hash))) {
      throw httpError(400, "Mã PIN mới không được trùng mã PIN hiện tại");
    }
    if (
      user.password_hash &&
      (await bcrypt.compare(newPin, user.password_hash))
    ) {
      throw httpError(400, "Mã PIN không được trùng mật khẩu đăng nhập");
    }

    const salt = await bcrypt.genSalt(10);
    const pinHash = await bcrypt.hash(newPin, salt);
    const updated = await userRepository.resetPin({
      userId,
      pinHash,
      oldPinHash: user.pin_hash,
    });
    if (!updated) {
      throw httpError(409, "Không thể cập nhật mã PIN, vui lòng thử lại");
    }
  },

  async verifyCurrentPassword({ userId, oldPassword }) {
    return verifyCredentialChallenge({
      userId,
      value: oldPassword,
      emptyMessage: "Vui lòng nhập mật khẩu hiện tại",
      invalidFormatMessage: "Mật khẩu phải gồm đúng 6 chữ số",
      hashField: "password_hash",
      attemptsField: "failed_login_attempts",
      missingMessage: "Không tìm thấy thông tin mật khẩu",
      lockedMessage: `Bạn đã nhập sai mật khẩu quá ${LOGIN_LOCKOUT_DEFAULTS.MAX_ATTEMPTS} lần. Tài khoản tạm khóa trong ${LOGIN_LOCKOUT_DEFAULTS.LOCK_MINUTES} phút`,
      claimAttemptFn: (args) => userRepository.claimPasswordAttempt(args),
      getStateFn: (id) => userRepository.getPasswordState(id),
      resetFailedFn: (id) => userRepository.resetFailedPassword(id),
      maxAttempts: LOGIN_LOCKOUT_DEFAULTS.MAX_ATTEMPTS,
      lockMinutes: LOGIN_LOCKOUT_DEFAULTS.LOCK_MINUTES,
    });
  },

  async changePassword({ userId, oldPassword, newPassword }) {
    if (!userId || !oldPassword || !newPassword) {
      throw httpError(400, "Thiếu thông tin mật khẩu");
    }
    if (
      !isValidPasswordOrPin(oldPassword) ||
      !isValidPasswordOrPin(newPassword)
    ) {
      throw httpError(400, "Mật khẩu phải gồm đúng 6 chữ số");
    }

    const user = await getResettableUser(userId);
    if (!user.password_hash) {
      throw httpError(404, "Không tìm thấy thông tin mật khẩu");
    }

    const verifyResult = await this.verifyCurrentPassword({
      userId,
      oldPassword,
    });
    if (!verifyResult.is_correct) {
      throw httpError(
        400,
        `Mật khẩu hiện tại không đúng. Còn ${verifyResult.remaining_attempts} lần thử`,
      );
    }

    if (
      oldPassword === newPassword ||
      (await bcrypt.compare(newPassword, user.password_hash))
    ) {
      throw httpError(400, "Mật khẩu mới không được trùng mật khẩu hiện tại");
    }
    if (user.pin_hash && (await bcrypt.compare(newPassword, user.pin_hash))) {
      throw httpError(400, "Mật khẩu không được trùng mã PIN");
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);
    const updated = await userRepository.changePassword({
      userId,
      passwordHash,
      oldPasswordHash: user.password_hash,
    });
    if (!updated) {
      throw httpError(409, "Không thể cập nhật mật khẩu, vui lòng thử lại");
    }
  },

  async getTransactionLimits(userId) {
    return fetchTransactionLimits({
      userId,
      role: "USER",
      userRepository,
      includeSummary: false,
    });
  },

  async updateTransactionLimit({
    userId,
    transactionType,
    maxAmount,
    dailyLimit,
  }) {
    return updateUserTransactionLimit({
      userId,
      transactionType,
      maxAmount,
      dailyLimit,
      role: "USER",
      userRepository,
      validateActiveRole: true,
      includeSummary: false,
    });
  },

  async resetTransactionLimit({ userId, transactionType }) {
    return resetUserTransactionLimit({
      userId,
      transactionType,
      role: "USER",
      userRepository,
      validateActiveRole: true,
      includeSummary: false,
    });
  },

  async updateFmcToken({ userId, fcmToken }) {
    if (!userId || !fcmToken) {
      throw httpError(400, "Thiếu thông tin để cập nhật mã thông báo đẩy");
    }
    await userRepository.updateFmcToken({ userId, fcmToken });
  },

  async getFcmToken(userId) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin để lấy mã thông báo đẩy");
    }
    return await userRepository.getFcmToken(userId);
  },

  async resetPin({ userId, version, pin }) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }
    if (!pin) {
      throw httpError(400, "Thiếu mã PIN");
    }
    if (!isValidPasswordOrPin(pin)) {
      throw httpError(400, "Mã PIN phải gồm đúng 6 chữ số");
    }

    const user = await getResettableUser(userId);

    if (tokenUtil.credentialVersion(user.pin_hash) !== version) {
      throw httpError(
        401,
        "Phiên đặt lại mã PIN đã hết hiệu lực, vui lòng thực hiện lại",
      );
    }

    if (user.pin_hash && (await bcrypt.compare(pin, user.pin_hash))) {
      throw httpError(400, "Mã PIN mới không được trùng mã PIN hiện tại");
    }
    if (user.password_hash && (await bcrypt.compare(pin, user.password_hash))) {
      throw httpError(400, "Mã PIN không được trùng mật khẩu đăng nhập");
    }

    const salt = await bcrypt.genSalt(10);
    const pinHash = await bcrypt.hash(pin, salt);
    const updated = await userRepository.resetPin({
      userId,
      pinHash,
      oldPinHash: user.pin_hash,
    });
    if (!updated) {
      throw httpError(
        401,
        "Phiên đặt lại mã PIN đã hết hiệu lực, vui lòng thực hiện lại",
      );
    }
  },

  async resetPassword({ userId, version, password }) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }
    if (!password) {
      throw httpError(400, "Thiếu mật khẩu");
    }
    if (!isValidPasswordOrPin(password)) {
      throw httpError(400, "Mật khẩu phải gồm đúng 6 chữ số");
    }

    const user = await getResettableUser(userId);

    if (tokenUtil.credentialVersion(user.password_hash) !== version) {
      throw httpError(
        401,
        "Phiên đặt lại mật khẩu đã hết hiệu lực, vui lòng thực hiện lại",
      );
    }

    if (
      user.password_hash &&
      (await bcrypt.compare(password, user.password_hash))
    ) {
      throw httpError(400, "Mật khẩu mới không được trùng mật khẩu hiện tại");
    }
    if (user.pin_hash && (await bcrypt.compare(password, user.pin_hash))) {
      throw httpError(400, "Mật khẩu không được trùng mã PIN");
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const updated = await userRepository.resetPassword({
      userId,
      passwordHash,
      oldPasswordHash: user.password_hash,
    });
    if (!updated) {
      throw httpError(
        401,
        "Phiên đặt lại mật khẩu đã hết hiệu lực, vui lòng thực hiện lại",
      );
    }

    emitToUser(userId, "force_logout", {
      reason: "Mật khẩu của tài khoản vừa được đặt lại. Vui lòng đăng nhập lại",
    });
  },

  async forgotRequest({ phone, type }) {
    if (!phone) {
      throw httpError(400, "Thiếu số điện thoại");
    }
    if (!isValidPhone(phone)) {
      throw httpError(400, "Số điện thoại không hợp lệ");
    }
    assertForgotType(type);

    const user = await userRepository.findAccountByPhone(phone);
    assertForgotUsable(user);

    try {
      await otpService.generateAndSaveOtp({ email: user.email });
    } catch (e) {
      if (e.statusCode !== 429) throw e;
    }

    return {
      otp_token: tokenUtil.generateOtpToken(user, "forgot_otp", { type }),
      masked_email: maskEmail(user.email),
    };
  },

  async forgotResendOtp({ userId, phone }) {
    const user = await getForgotOtpUser({ userId, phone });
    await otpService.generateAndSaveOtp({ email: user.email });
    return { masked_email: maskEmail(user.email) };
  },

  async forgotVerifyOtp({ userId, phone, type, otp }) {
    assertForgotType(type);
    const user = await getForgotOtpUser({ userId, phone });
    await otpService.verifyOtp({ email: user.email, otp });

    const { is_kyc: hasKyc } = await kycRepository.checkUserKYC(userId);
    return {
      kyc_token: tokenUtil.generateForgotKycToken({ userId, type }),
      has_kyc: hasKyc,
    };
  },

  async forgotVerifyKyc({ userId, type, frontPath, backPath, facePath }) {
    const uploaded = [frontPath, backPath, facePath];
    let keepFiles = false;
    try {
      assertForgotType(type);
      if (!frontPath || !backPath || !facePath) {
        throw httpError(400, "Thiếu ảnh mặt trước, mặt sau hoặc ảnh khuôn mặt");
      }

      const user = await userRepository.getCredentialState(userId);
      if (!user || user.role !== "USER" || user.status !== "ACTIVE") {
        throw httpError(403, "Tài khoản không hợp lệ hoặc đã bị khóa");
      }

      const { ocrInfo, matchResult } = await kycService.analyzeDocuments({
        frontPath,
        backPath,
        facePath,
      });

      const approved = await kycRepository.findApprovedKycByUserId(userId);

      if (approved) {
        if (String(ocrInfo.id) !== String(approved.id)) {
          throw httpError(403, "Giấy tờ không khớp với tài khoản đã định danh");
        }
        await assertFaceMatchesApprovedKyc({ approved, facePath });
      } else {
        const exists = await kycRepository.checkIdExists(ocrInfo.id);
        if (exists.is_exists) {
          throw httpError(
            400,
            "Thông tin định danh đã được đăng ký cho tài khoản khác",
          );
        }
        await kycRepository.saveKYCResult({
          idNumber: ocrInfo.id,
          userId,
          fullName: ocrInfo.name,
          dob: ocrInfo.birth_day,
          gender: ocrInfo.gender,
          address: ocrInfo.recent_place,
          frontImageUrl: frontPath,
          backImageUrl: backPath,
          faceImageUrl: facePath,
          status: "APPROVED",
          matchScore: matchResult.score,
        });
        keepFiles = true;
      }

      const fresh = await userRepository.getCredentialState(userId);
      const hash = type === "pin" ? fresh.pin_hash : fresh.password_hash;
      return {
        reset_token: tokenUtil.generateResetToken({
          userId,
          purpose: `reset_${type}`,
          version: tokenUtil.credentialVersion(hash),
        }),
        type,
      };
    } finally {
      if (!keepFiles) safeUnlinkFiles(uploaded);
    }
  },
};

module.exports = userService;
