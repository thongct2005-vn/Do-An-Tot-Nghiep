// bank.controller.js: Controller xử lý HTTP cho liên kết ngân hàng và hiển thị số dư của người dùng.
const bankService = require("./bank.service");
const { createSharedBankController } = require("./bank.helpers");

const bankController = createSharedBankController(bankService);

module.exports = bankController;
