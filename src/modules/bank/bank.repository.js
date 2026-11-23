// bank.repository.js: Truy vấn danh sách ngân hàng và liên kết tài khoản ngân hàng của người dùng.
const pool = require("../../config/database");
const { createSharedBankRepository } = require("./bank.helpers");

const bankRepository = createSharedBankRepository(pool);

module.exports = bankRepository;
