const userRepository = require('./user.repository');

const userService = {
  async findUserByPhone(phone) {
    if (!phone) {
      const err = new Error('Thiếu số điện thoại');
      err.statusCode = 400;
      throw err;
    }

    const user = await userRepository.findUserByPhone(phone);

    if (!user) {
      const err = new Error('Không tìm thấy người dùng này');
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

  async findUserByPhoneList(phones){
    if(!phones || !Array.isArray(phones) || !phones.length === 0){
        const err = new Error('Danh sách số điện thoại không hợp lệ');
        err.statusCode = 400;
        throw err; 
    }

    const uniquePhone = [...new Set(phones)];
    const users = await userRepository.findUserByPhoneList(uniquePhone);
    if(!users) return [];
    return users;
  }
};

module.exports = userService;
