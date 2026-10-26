const userRepository = require("./user.repository");
const bcrypt = require("bcrypt");
const {
  isValidPasswordOrPin,
  isValidPhone,
} = require("../../utils/validators");
const { httpError } = require("../../utils/httpError");
const { maskPhone } = require("../../utils/maskPhoneAndEmail");
const { isValidPhonesHash } = require("../../utils/validators");
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

    if (phones.length > 500) {
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
  async updatePin({ userId, pin }) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }
    if (!pin) {
      throw httpError(400, "Thiếu mã pin");
    }
    const salt = await bcrypt.genSalt(10);
    const pinHash = await bcrypt.hash(pin, salt);
    await userRepository.updatePin({ userId, pinHash });
  },

  async updatePassWord({ userId, password }) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }
    if (!password) {
      throw httpError(400, "Thiếu mật khẩu");
    }
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    await userRepository.updatePassWord({ userId, passwordHash });
  },
};

module.exports = userService;
