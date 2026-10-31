const crypto = require("crypto");
const transactionRepository = require("../modules/transaction/transaction.repository");

// Hash gồm method + path để cùng key + cùng body nhưng khác endpoint
// (vd /transfer và /topup) không bị coi là một request.
function hashRequestBody(req) {
  return crypto
    .createHash("sha256")
    .update(
      `${req.method.toUpperCase()}\n${String(req.originalUrl).split("?")[0]}\n${JSON.stringify(req.body || {})}`,
    )
    .digest("hex");
}

// Ghi 1 dòng log API vào audit_outbox (không lưu body/response để khỏi lộ dữ liệu nhạy cảm).
// outcome: SUCCESS | FAILED | REPLAYED (trả lại kết quả cũ) | REJECTED (bị chặn ở middleware)
function auditApi(req, { outcome, statusCode, reason = null, startedAt }) {
  const actor = req.user ?? req.merchant;
  transactionRepository.recordAuditSafe({
    eventType: "API_REQUEST",
    payload: {
      method: req.method,
      path: String(req.originalUrl).split("?")[0],
      actor_id: actor?.user_id ?? actor?.id ?? null,
      actor_type: actor?.type ?? actor?.role ?? null,
      idempotency_key: req.headers["idempotency-key"] ?? null,
      outcome,
      status_code: statusCode,
      reason,
      ip: req.ip,
      duration_ms: Date.now() - startedAt,
    },
  });
}

const idempotencyMiddleware = {
  async checkIdempotencyKey(req, res, next) {
    const startedAt = Date.now();
    try {
      const idempotencyKey = req.headers["idempotency-key"];
      if (!idempotencyKey) {
        const err = new Error("Thiếu mã xác thực duy nhất");
        err.statusCode = 400;
        throw err;
      }

      const requestHash = hashRequestBody(req);
      const actor = req.user ?? req.merchant;
      const actorId = actor?.user_id ?? actor?.id;
      const existing =
        await transactionRepository.checkIdempotencyKey(idempotencyKey);

      if (existing) {
        if (String(existing.actor_id) !== String(actorId)) {
          const err = new Error("Mã đã được sử dụng");
          err.statusCode = 422;
          throw err;
        }
        if (existing.request_hash !== requestHash) {
          const err = new Error("Mã đã được sử dụng với dữ liệu khác");
          err.statusCode = 422;
          throw err;
        }

        if (existing.status === "SUCCESS") {
          auditApi(req, {
            outcome: "REPLAYED",
            statusCode: existing.response_status_code || 200,
            startedAt,
          });
          return res
            .status(existing.response_status_code || 200)
            .json(existing.response_body);
        }

        const reclaimed = await transactionRepository.reclaimIdempotencyKey({
          idempotencyKey,
        });
        if (!reclaimed) {
          const err = new Error("Yêu cầu đang được xử lý");
          err.statusCode = 409;
          throw err;
        }
      } else {
        try {
          await transactionRepository.createIdempotencyKey({
            idempotencyKey,
            actorId,
            actorType: actor.type ?? actor.role,
            requestPath: req.originalUrl,
            requestHash,
          });
        } catch (insertErr) {
          if (insertErr.code === "23505") {
            const err = new Error("Yêu cầu đang được xử lý");
            err.statusCode = 409;
            throw err;
          }
          throw insertErr;
        }
      }

      req.idempotencyKey = idempotencyKey;
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        const status =
          res.statusCode >= 200 && res.statusCode < 300 ? "SUCCESS" : "FAILED";
        auditApi(req, {
          outcome: status,
          statusCode: res.statusCode,
          reason: status === "FAILED" ? (body?.message ?? null) : null,
          startedAt,
        });
        transactionRepository
          .updateIdempotencyKey({
            idempotencyKey,
            status,
            responseBody: body,
            responseStatusCode: res.statusCode,
          })
          .catch((updateErr) => {
            console.error(
              "Cập nhật idempotency key thất bại:",
              updateErr.message,
            );
          });
        return originalJson(body);
      };
      next();
    } catch (e) {
      auditApi(req, {
        outcome: "REJECTED",
        statusCode: e.statusCode || 500,
        reason: e.message,
        startedAt,
      });
      next(e);
    }
  },
};

module.exports = idempotencyMiddleware;
