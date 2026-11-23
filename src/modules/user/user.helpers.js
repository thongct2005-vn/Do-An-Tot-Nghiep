// user.helpers.js: Các hàm hỗ trợ kiểm tra trạng thái tài khoản, xác thực PIN/mật khẩu và luồng quên thông tin bảo mật.
const bcrypt = require("bcrypt");
const userRepository = require("./user.repository");
const { httpError } = require("../../utils/common/http");
const { isValidPasswordOrPin } = require("../../utils/common/validators");

const FORGOT_TYPES = ["password", "pin"];

async function getResettableUser(userId) {
  const user = await userRepository.getCredentialState(userId);
  if (!user || user.status !== "ACTIVE" || user.role !== "USER") {
    throw httpError(403, "Tài khoản không hợp lệ hoặc đã bị khóa");
  }
  return user;
}

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

async function getForgotOtpUser({ userId, phone }) {
  const user = await userRepository.findAccountByPhone(phone);
  if (!user || user.id !== userId) {
    throw httpError(401, "Phiên xác thực không hợp lệ");
  }
  assertForgotUsable(user);
  return user;
}

async function verifyCredentialChallenge({
  userId,
  value,
  emptyMessage,
  invalidFormatMessage,
  hashField,
  attemptsField,
  missingMessage,
  lockedMessage,
  claimAttemptFn,
  getStateFn,
  resetFailedFn,
  maxAttempts,
  lockMinutes,
}) {
  if (!userId || !value) {
    throw httpError(400, emptyMessage);
  }
  if (!isValidPasswordOrPin(value)) {
    throw httpError(400, invalidFormatMessage);
  }

  const user = await getResettableUser(userId);
  if (!user[hashField]) {
    throw httpError(404, missingMessage);
  }

  const claimed = await claimAttemptFn({
    userId,
    maxAttempts,
    lockMinutes,
  });

  if (!claimed) {
    const state = await getStateFn(userId);
    if (state?.is_locked) {
      throw httpError(423, lockedMessage);
    }
    throw httpError(404, missingMessage);
  }

  const isValid = await bcrypt.compare(value, claimed[hashField]);
  if (!isValid) {
    if (claimed[attemptsField] >= maxAttempts) {
      throw httpError(423, lockedMessage);
    }
    return {
      is_correct: false,
      remaining_attempts: maxAttempts - claimed[attemptsField],
    };
  }

  await resetFailedFn(userId);
  return { is_correct: true };
}

module.exports = {
  FORGOT_TYPES,
  getResettableUser,
  assertForgotType,
  assertForgotUsable,
  getForgotOtpUser,
  verifyCredentialChallenge,
};

