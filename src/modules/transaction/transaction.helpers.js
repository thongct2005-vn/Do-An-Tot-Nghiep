// transaction.helpers.js: Hằng số bộ lọc và hàm chuẩn hóa vai trò người dùng cho dịch vụ giao dịch.
const pool = require("../../config/database");
const { resolveRole } = require("../../utils/limits/dailyLimit");

const TRANSACTION_TYPES = ["TRANSFER", "TOPUP", "WITHDRAW", "PAYMENT", "REFUND"];
const TRANSACTION_DIRECTIONS = ["IN", "OUT"];
const USER_FUNDING_ALIAS_MAP = {
  LUMAPAY: "LUMAPAY",
  MAIN_WALLET: "LUMAPAY",
  WALLET: "LUMAPAY",
  POSTPAID: "POSTPAID",
};

async function resolveActorRole(userId, explicitRole = null) {
  if (explicitRole) return explicitRole;
  return (await resolveRole(pool, userId)) || "USER";
}

module.exports = {
  TRANSACTION_TYPES,
  TRANSACTION_DIRECTIONS,
  USER_FUNDING_ALIAS_MAP,
  resolveActorRole,
};

