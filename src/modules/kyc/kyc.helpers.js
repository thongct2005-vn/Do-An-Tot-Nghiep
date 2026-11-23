// kyc.helpers.js: Hàm phân tích bộ ảnh định danh eKYC, đối chiếu khuôn mặt đã duyệt và dọn tệp ảnh tạm.
const fs = require("fs");
const viettelAIService = require("../../services/viettelAI.service");
const { httpError } = require("../../utils/common/http");

async function analyzeDocuments({ frontPath, backPath, facePath }) {
  if (!frontPath || !backPath || !facePath) {
    throw httpError(400, "Thiếu ảnh mặt trước, mặt sau hoặc ảnh khuôn mặt");
  }
  await viettelAIService.checkPackSpoof({
    fontImagePath: frontPath,
    backImagePath: backPath,
  });

  const { data: ocrInfo } = await viettelAIService.extractOcr({
    fontImagePath: frontPath,
  });
  if (!ocrInfo?.id) {
    throw httpError(422, "Không đọc được số căn cước, vui lòng chụp lại");
  }

  const livenessResult = await viettelAIService.checkLiveness(facePath);
  if (!livenessResult.isLive) {
    throw httpError(422, "Không xác thực được khuôn mặt thật");
  }
  const matchResult = await viettelAIService.verifyFaceMatch(
    frontPath,
    facePath,
  );
  if (!matchResult.isMatch) {
    throw httpError(422, "Khuôn mặt không khớp với ảnh trên giấy tờ");
  }
  return { ocrInfo, matchResult };
}

async function assertFaceMatchesApprovedKyc({ approved, facePath }) {
  const referencePath = [
    approved.face_image_url,
    approved.front_image_url,
  ].find((p) => p && fs.existsSync(p));
  if (!referencePath) {
    throw httpError(
      409,
      "Không tìm thấy dữ liệu khuôn mặt đã đăng ký, vui lòng liên hệ hỗ trợ",
    );
  }
  const sameFace = await viettelAIService.verifyFaceMatch(
    referencePath,
    facePath,
  );
  if (!sameFace.isMatch) {
    throw httpError(403, "Khuôn mặt không khớp với dữ liệu đã đăng ký");
  }
}

function safeUnlinkFiles(paths) {
  for (const p of paths) {
    if (p && fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch (_) {}
    }
  }
}

module.exports = {
  analyzeDocuments,
  assertFaceMatchesApprovedKyc,
  safeUnlinkFiles,
};
