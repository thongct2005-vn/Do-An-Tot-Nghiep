const { risk, blockAccountByPhone } = require("../utils/risk");
const { maskPhone } = require("../utils/mask");
const { resolveRiskThreshold } = require("../utils/limitsDb");

// Kiểm tra chế độ "chỉ log, không chặn" từ biến môi trường (RISK_DRY_RUN=true hoặc 1)
function isEnvDryRun() {
  const val = String(process.env.RISK_DRY_RUN ?? "")
    .trim()
    .toLowerCase();
  return val === "true" || val === "1";
}

/**
 * Middleware đánh giá điểm rủi ro của request (Risk Scoring Guard).
 * Ngưỡng challenge/block được đọc từ `system_configs["RISK_THRESHOLDS"]` trong DB.
 *
 * @param {string|{ key?: string, dryRun?: boolean }} [options] - Tên luồng ("LOGIN", ...) hoặc object cấu hình `{ key, dryRun }`
 */
function riskGuard(options = {}) {
  const dryRun =
    options && typeof options === "object" ? options.dryRun : undefined;
  return async (req, res, next) => {
    try {
      const isDryRun = dryRun !== undefined ? Boolean(dryRun) : isEnvDryRun();
      const { challenge, block } = await resolveRiskThreshold(options);

      const { score, reasons, metrics } = risk(req);
      const shouldChallenge = score >= challenge;
      const shouldBlock = score >= block;

      // Gắn kết quả vào req để controller/service phía sau có thể kiểm tra req.risk.challenge
      req.risk = {
        score,
        reasons,
        challenge: shouldChallenge,
      };

      // Chỉ ghi log ở phía server khi chạm ngưỡng challenge hoặc block (KHÔNG trả reasons về client)
      if (shouldBlock || shouldChallenge) {
        const action = shouldBlock
          ? isDryRun
            ? "DRY_RUN_WOULD_BLOCK"
            : "BLOCK"
          : "CHALLENGE";

        const divider = "-".repeat(60);
        console.warn(
          `\n${divider}\n` +
            JSON.stringify(
              {
                tag: "RISK_GUARD",
                action,
                method: req.method,
                path: req.originalUrl || req.url,
                ip: metrics?.ip,
                phone: maskPhone(metrics?.phone),
                userId: req.user?.user_id ?? null,
                score,
                threshold: { challenge, block },
                reasons,
              },
              null,
              2,
            ) +
            `\n${divider}`,
        );
      }

      if (shouldBlock && !isDryRun) {
        req.risk.blocked = true;
        // Chỉ khóa tài khoản trong DB (status = 'BLOCKED') khi đã đăng nhập (có req.user)
        // để tránh kẻ xấu bên ngoài truyền SĐT người khác vào API công khai làm khóa oan.
        if (req.user?.phone) {
          await blockAccountByPhone(req.user.phone);
        }
        const err = new Error(
          "Bạn thao tác quá nhiều lần hoặc có dấu hiệu bất thường, vui lòng thử lại sau",
        );
        err.statusCode = 429;
        return next(err);
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { riskGuard };
