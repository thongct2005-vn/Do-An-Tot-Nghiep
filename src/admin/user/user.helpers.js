// user.helpers.js: Hằng số và hàm chuẩn hóa phản hồi cho nghiệp vụ quản trị người dùng Admin.
const { maskPhone } = require("../../utils/common/text");
const { UUID_REGEX } = require("../../utils/common/validators");

const MAX_ADMIN_AUTH_ATTEMPTS = 5;
const ADMIN_LOCK_MINUTES = 30;
const AUTH_REFERENCE_REGEX = /^[A-Za-z0-9_-]{5,100}$/;
const ADMIN_P2P_REQUEST_PATH = "POST /api/v2/admin/user/:id/operations/p2p";
const MIN_P2P_AMOUNT = 1000;
const MAX_P2P_AMOUNT = 50000000;
const ADMIN_TOPUP_REQUEST_PATH =
  "POST /api/v2/admin/user/:id/operations/topup";
const ADMIN_WITHDRAW_REQUEST_PATH =
  "POST /api/v2/admin/user/:id/operations/withdraw";
const MIN_BANK_OP_AMOUNT = 1000;
const MAX_BANK_OP_AMOUNT = 50000000;

function sanitizeP2PResponseData(raw) {
  if (!raw) return raw;
  const parsed = typeof raw === "string" ? JSON.parse(raw) : { ...raw };
  delete parsed.destBalanceAfter;
  delete parsed.dest_balance_after;
  delete parsed.destBalanceBefore;
  delete parsed.dest_balance_before;
  if (parsed.destination_phone && !parsed.destination_phone_masked) {
    parsed.destination_phone_masked = maskPhone(parsed.destination_phone);
  }
  delete parsed.destination_phone;
  delete parsed.destinationPhone;
  return parsed;
}

module.exports = {
  MAX_ADMIN_AUTH_ATTEMPTS,
  ADMIN_LOCK_MINUTES,
  AUTH_REFERENCE_REGEX,
  ADMIN_P2P_REQUEST_PATH,
  MIN_P2P_AMOUNT,
  MAX_P2P_AMOUNT,
  ADMIN_TOPUP_REQUEST_PATH,
  ADMIN_WITHDRAW_REQUEST_PATH,
  MIN_BANK_OP_AMOUNT,
  MAX_BANK_OP_AMOUNT,
  UUID_REGEX,
  sanitizeP2PResponseData,
};

