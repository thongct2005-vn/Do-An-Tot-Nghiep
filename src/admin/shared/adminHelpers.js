// adminHelpers.js: Các hàm dùng chung cho tầng service/controller Admin (validate id/reason, phân trang, idempotency, thông báo an toàn).
const { httpError } = require("../../utils/common/http");

function assertValidAdminId(adminId, message = "Thiếu định danh quản trị viên") {
  if (!adminId) {
    throw httpError(401, message);
  }
}

function assertValidReason(
  reason,
  {
    min = 5,
    max = 500,
    requiredMessage = "Vui lòng nhập lý do thay đổi",
    lengthMessage = `Lý do thay đổi phải có độ dài từ ${min} đến ${max} ký tự`,
  } = {},
) {
  if (typeof reason !== "string" || !reason.trim()) {
    throw httpError(400, requiredMessage);
  }
  const trimmed = reason.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw httpError(400, lengthMessage);
  }
  return trimmed;
}

function parseAdminPagination(
  page = 1,
  limit = 10,
  { defaultLimit = 10, maxLimit = 100 } = {},
) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(
    1,
    Math.min(maxLimit, parseInt(limit, 10) || defaultLimit),
  );
  const offset = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, offset };
}

function extractAdminIdempotencyKey(req) {
  return (
    req?.headers?.["idempotency-key"] ||
    req?.headers?.["Idempotency-Key"] ||
    req?.idempotencyKey
  );
}

function validateAdminIdempotencyKey(
  idempotencyKey,
  message = "Header Idempotency-Key là bắt buộc và tối đa 100 ký tự",
) {
  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey.trim().length === 0 ||
    idempotencyKey.trim().length > 100
  ) {
    throw httpError(400, message);
  }
  return idempotencyKey.trim();
}

async function executeWithAdminIdempotency({
  repo,
  idempotencyKey,
  actorId,
  requestPath,
  requestHash,
  busyMessage = "Yêu cầu đang được xử lý",
  duplicateBusyMessage = "Yêu cầu đang được xử lý, vui lòng không gửi trùng lặp",
  mismatchMessage = "Mã Idempotency-Key đã được sử dụng với dữ liệu khác",
  sanitizeResponse = (data) => data,
  execute,
}) {
  const inserted = await repo.tryInsertIdempotencyKey({
    idempotencyKey,
    actorId,
    actorType: "ADMIN",
    requestPath,
    requestHash,
  });

  if (!inserted) {
    const existingKey = await repo.getIdempotencyKey(idempotencyKey);
    if (!existingKey) {
      throw httpError(409, busyMessage);
    }

    if (
      String(existingKey.actor_id) !== String(actorId) ||
      existingKey.request_path !== requestPath ||
      existingKey.request_hash !== requestHash
    ) {
      throw httpError(422, mismatchMessage);
    }

    if (existingKey.status === "SUCCESS" && existingKey.response_body) {
      return {
        replayed: true,
        data: sanitizeResponse(existingKey.response_body),
        notificationContext: null,
      };
    }

    const reclaimed = await repo.reclaimIdempotencyKey({
      idempotencyKey,
      actorId,
      requestPath,
      requestHash,
    });

    if (!reclaimed) {
      const latestKey = await repo.getIdempotencyKey(idempotencyKey);
      if (
        latestKey &&
        latestKey.status === "SUCCESS" &&
        latestKey.response_body &&
        latestKey.request_hash === requestHash
      ) {
        return {
          replayed: true,
          data: sanitizeResponse(latestKey.response_body),
          notificationContext: null,
        };
      }
      throw httpError(409, duplicateBusyMessage);
    }
  }

  try {
    const txResult = await execute();
    return {
      replayed: Boolean(txResult.replayed),
      data: sanitizeResponse(txResult.responseBody),
      notificationContext: txResult.notificationContext || null,
    };
  } catch (err) {
    try {
      await repo.markIdempotencyKeyFailed(idempotencyKey);
    } catch (markErr) {
      console.error("markIdempotencyKeyFailed error:", markErr.message);
    }
    throw err;
  }
}

async function emitSocketSafe(emitter, label = "socket") {
  try {
    await emitter();
  } catch (err) {
    console.error(`Emit ${label} error:`, err?.message || err);
  }
}

async function sendPushSafe(sender, label = "push") {
  try {
    await sender();
  } catch (err) {
    console.error(`Push notification (${label}) error:`, err?.message || err);
  }
}

module.exports = {
  assertValidAdminId,
  assertValidReason,
  parseAdminPagination,
  extractAdminIdempotencyKey,
  validateAdminIdempotencyKey,
  executeWithAdminIdempotency,
  emitSocketSafe,
  sendPushSafe,
};

