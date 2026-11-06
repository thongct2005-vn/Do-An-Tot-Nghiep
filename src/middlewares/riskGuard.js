const { risk } = require("../utils/risk");
const { maskPhone } = require("../utils/mask");

// Kiểm tra chế độ "chỉ log, không chặn" từ biến môi trường (RISK_DRY_RUN=true hoặc 1)
function isEnvDryRun() {
  const val = String(process.env.RISK_DRY_RUN ?? "")
    .trim()
    .toLowerCase();
  return val === "true" || val === "1";
}

/**
 * Middleware đánh giá điểm rủi ro của request (Risk Scoring Guard).
 *
 * @param {Object} options
 * @param {number} [options.challenge=40]  Ngưỡng bật cờ req.risk.challenge = true (yêu cầu xác thực bổ sung)
 * @param {number} [options.block=70]      Ngưỡng chặn thẳng với mã lỗi HTTP 429
 * @param {boolean} [options.dryRun]       Ghi đè chế độ chỉ log không chặn (mặc định đọc từ process.env.RISK_DRY_RUN)
 */
function riskGuard({ challenge = 40, block = 70, dryRun } = {}) {
  return (req, res, next) => {
    const isDryRun = dryRun !== undefined ? Boolean(dryRun) : isEnvDryRun();

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

      console.warn(
        JSON.stringify({
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
        }),
      );
    }

    if (shouldBlock && !isDryRun) {
      const err = new Error(
        "Bạn thao tác quá nhiều lần hoặc có dấu hiệu bất thường, vui lòng thử lại sau",
      );
      err.statusCode = 429;
      return next(err);
    }

    return next();
  };
}

module.exports = { riskGuard };
