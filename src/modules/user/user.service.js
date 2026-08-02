const userRepository = require("./user.repository");
const bcrypt = require("bcrypt");
const userService = {
  async findUserByPhone(phone) {
    if (!phone) {
      const err = new Error("Thiếu số điện thoại");
      err.statusCode = 400;
      throw err;
    }

    const user = await userRepository.findUserByPhone(phone);

    if (!user) {
      const err = new Error("Không tìm thấy người dùng này");
      err.statusCode = 404;
      throw err;
    }

    return {
      user_info: {
        user_id: user.id,
        phone: user.phone,
        full_name: user.full_name,
      },
    };
  },

  async findUserByPhoneList(phones) {
    if (!phones || !Array.isArray(phones)) {
      const err = new Error("Danh sách số điện thoại không hợp lệ");
      err.statusCode = 400;
      throw err;
    }

    if (phones.length > 500) {
      const err = new Error("Danh bạ quá lớn, vui lòng đồng bộ từng phần");
      err.statusCode = 413;
      throw err;
    }

    if (phones.length === 0) {
      return [];
    }

    const uniquePhone = [...new Set(phones)];
    const users = await userRepository.findUserByPhoneList(uniquePhone);
    return users || [];
  },

  async checkPinStatus(userId) {
    if (!userId) {
      const err = new Error(
        "Thiếu thông tin người dùng để kiểm tra trạng thái pin",
      );
      err.statusCode = 400;
      throw err;
    }

    const result = await userRepository.checkPinStatus(userId);
    return {
      has_pin: !!result?.pin_hash,
    };
  },
  async createPin({userId, pin}) {
    if (!userId || !pin) {
      const err = new Error("Thiếu thông tin để tạo pin");
      err.statusCode = 400;
      throw err;
    }
    const salt = await bcrypt.genSalt(10);
    const pinHash = await bcrypt.hash(pin, salt);
    await userRepository.createPin({userId, pinHash});
    return;
  },
};

module.exports = userService;
