const kycRepository = require("./kyc.repository");
const { httpError } = require("../../utils/httpError");

const MESSAGES = {
  sender: "Tài khoản chưa xác thực danh tính",
  recipient: "Người nhận chưa xác thực danh tính",
};

async function assertKyc(userId, role = "sender") {
  const { is_kyc } = await kycRepository.checkUserKYC(userId);
  if (!is_kyc) throw httpError(403, MESSAGES[role]);
}

async function assertKycBoth(senderId, recipientId) {
  const [sender, recipient] = await Promise.all([
    kycRepository.checkUserKYC(senderId),
    kycRepository.checkUserKYC(recipientId),
  ]);
  if (!sender.is_kyc) throw httpError(403, MESSAGES.sender);
  if (!recipient.is_kyc) throw httpError(403, MESSAGES.recipient);
}

module.exports = { assertKyc, assertKycBoth };