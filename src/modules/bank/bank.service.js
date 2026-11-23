// bank.service.js: Nghiệp vụ liên kết, hủy liên kết và bật/ẩn số dư tài khoản ngân hàng của người dùng.
const bankRepository = require("./bank.repository");
const userRepository = require("../user/user.repository");
const { createSharedBankService } = require("./bank.helpers");

const bankService = createSharedBankService({
  bankRepository,
  userRepository,
});

module.exports = bankService;
