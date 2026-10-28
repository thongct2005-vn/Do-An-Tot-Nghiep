const crypto = require("crypto");
const transactionRepository = require("../modules/transaction/transaction.repository");

function hashResquestBody(body) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(body || {}))
    .digest("hex");
}

const idempotencyMiddleware = {
  async checkIdempotencyKey(req, res, next) {
    try {
      const idempotencyKey = req.headers["idempotency-key"];
      if (!idempotencyKey) {
        const err = new Error("Thiếu mã xác thực duy nhất");
        err.statusCode = 400;
        throw err;
      }

      const requestHash = hashResquestBody(req.body);
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
          const err = new Error(
            "Mã đã được sử dụng với dữ liệu khác",
          );
          err.statusCode = 422;
          throw err;
        }

        if (existing.status === "SUCCESS") {
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
        transactionRepository
          .updateIdempotencyKey({
            idempotencyKey,
            status,
            responseBody: body,
            responseStatusCode: res.statusCode,
          })
          .catch((updateErr) => {
            console.error("Cập nhật idempotency key thất bại:", updateErr.message);
          });
        return originalJson(body);
      };
      next();
    } catch (e) {
      next(e);
    }
  },
};

module.exports = idempotencyMiddleware;