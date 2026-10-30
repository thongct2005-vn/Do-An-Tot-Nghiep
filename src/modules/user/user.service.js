const fs = require("fs");
const userRepository = require("./user.repository");
const kycRepository = require("../kyc/kyc.repository");
const kycService = require("../kyc/kyc.service");
const otpService = require("../otp/otp.service");
const viettelAIService = require("../../services/viettelAI.service");
const bcrypt = require("bcrypt");
const {
  isValidPasswordOrPin,
  isValidPhone,
  isValidPhonesHash
} = require("../../utils/validators");
const { httpError } = require("../../utils/httpError");
const tokenUtil = require("../../utils/jwt");
const { emitToUser } = require("../../utils/socket");
const { maskPhone, maskEmail } = require("../../utils/mask");
const { CONTACT_CHECK_MAX_PHONES } = require("../../config/limits");

async function getResettableUser(userId) {
  const user = await userRepository.getCredentialState(userId);
  if (!user || user.status !== "ACTIVE" || user.role !== "USER") {
    throw httpError(403, "Tài khoản không hợp lệ hoặc đã bị khóa");
  }
  return user;
}

const FORGOT_TYPES = ["password", "pin"];

function assertForgotType(type) {
  if (!FORGOT_TYPES.includes(type)) {
    throw httpError(400, "Loại yêu cầu không hợp lệ");
  }
}

function assertForgotUsable(user) {
  if (!user || user.role !== "USER") {
    throw httpError(404, "Số điện thoại chưa đăng ký tài khoản");
  }
  if (user.status !== "ACTIVE") {
    throw httpError(403, "Tài khoản bị khóa");
  }
  if (!user.email) {
    throw httpError(404, "Không tìm thấy email liên kết với số điện thoại");
  }
}

// Lấy user theo phone trong token OTP và đảm bảo đúng người
async function getForgotOtpUser({ userId, phone }) {
  const user = await userRepository.findAccountByPhone(phone);
  if (!user || user.id !== userId) {
    throw httpError(401, "Phiên xác thực không hợp lệ");
  }
  assertForgotUsable(user);
  return user;
}

function removeFiles(paths) {
  paths.forEach((p) => {
    try {
      if (p && fs.existsSync(p)) fs.unlinkSync(p);
    } catch (_) {}
  });
}

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

    if (phones.length > CONTACT_CHECK_MAX_PHONES) {
      throw httpError(413, "Danh bạ quá lớn, vui lòng đồng bộ từng phần");
    }

    if (phones.length === 0) {
      return [];
    }

    if (!isValidPhonesHash(phones)) {
      throw httpError(400, "Danh sách số điện thoại không hợp lệ");
    }

    const uniquePhone = [...new Set(phones)];
    const users = await userRepository.findUserByPhoneHashList(uniquePhone);
    return users || [];
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

  async updateFmcToken({ userId, fcmToken }) {
    if (!userId || !fcmToken) {
      throw httpError(400, "Thiếu thông tin để cập nhật fcm token");
    }

    await userRepository.updateFmcToken({ userId, fcmToken });
  },

  async getFcmToken(userId) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin để lấy dữ fcm token");
    }
    const result = await userRepository.getFcmToken(userId);
    return result;
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

    // Token chỉ dùng được một lần: PIN đã đổi thì dấu vân tay hash không còn khớp
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

    // Đã xoá refresh token trong DB; báo các thiết bị đang đăng nhập thoát ra
    emitToUser(userId, "force_logout", {
      reason: "Mật khẩu của tài khoản vừa được đặt lại. Vui lòng đăng nhập lại",
    });
  },

  // ===== Quên mật khẩu / quên mã PIN =====

  // Bước 1: nhập số điện thoại, gửi OTP về email
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

  // Bước 2: nhập OTP, nhận kyc_token
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

  // Bước 3. Đã KYC: số CCCD và khuôn mặt phải khớp dữ liệu cũ.
  // Chưa KYC: lưu KYC như bình thường (không có gì để so sánh).
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

        // So khuôn mặt vừa chụp với ảnh đã lưu khi KYC (ảnh khuôn mặt,
        // nếu mất thì dùng ảnh trên mặt trước CCCD cũ)
        const referencePath = [
          approved.face_image_url,
          approved.front_image_url,
        ].find((p) => p && fs.existsSync(p));
        if (!referencePath) {
          throw httpError(
            409,
            "Không tìm thấy dữ liệu khuôn mặt đã đăng ký, vui lòng liên hệ hỗ trợ",
          );
        }
        const sameFace = await viettelAIService.verifyFaceMatch(
          referencePath,
          facePath,
        );
        if (!sameFace.isMatch) {
          throw httpError(403, "Khuôn mặt không khớp với dữ liệu đã đăng ký");
        }
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
      if (!keepFiles) removeFiles(uploaded);
    }
  },
};

module.exports = userService;
