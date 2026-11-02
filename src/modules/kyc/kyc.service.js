const kycRepository = require("./kyc.repository");
const viettelAIService = require("../../services/viettelAI.service");
const fs = require("fs");
const { httpError } = require("../../utils/httpError");

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

const kycService = {
  analyzeDocuments,
  async checkUserKYC(userId) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin để xác thực danh tính");
    }
    return await kycRepository.checkUserKYC(userId);
  },
  async verifyAndSaveKYC({ userId, frontPath, backPath, facePath }) {
    try {
      const { ocrInfo, matchResult } = await analyzeDocuments({
        frontPath,
        backPath,
        facePath,
      });

      const existsResult = await kycRepository.checkIdExists(ocrInfo.id);
      if (existsResult.is_exists) {
        throw httpError(400, "Thông tin định danh đã được đăng ký trước đó");
      }

      const result = await kycRepository.saveKYCResult({
        idNumber: ocrInfo.id,
        userId,
        fullName: ocrInfo.name,
        dob: ocrInfo.birth_day,
        gender: ocrInfo.gender,
        address: ocrInfo.recent_place,
        frontImageUrl: frontPath,
        backImageUrl: backPath,
        faceImageUrl: facePath,
        status: "APPROVED",
        matchScore: matchResult.score,
      });

      return result;
    } catch (e) {
      [frontPath, backPath, facePath].forEach((p) => {
        if (p && fs.existsSync(p)) fs.unlinkSync(p);
      });
      throw e;
    }
  },

  async updateKYC({ userId, frontPath, backPath, facePath }) {
    const newFiles = [frontPath, backPath, facePath];
    let oldFiles = [];
    let saved = false;
    try {
      if (!frontPath || !backPath || !facePath) {
        throw httpError(400, "Thiếu ảnh mặt trước, mặt sau hoặc ảnh khuôn mặt");
      }

      const approved = await kycRepository.findApprovedKycByUserId(userId);
      if (!approved) {
        throw httpError(
          403,
          "Tài khoản chưa xác thực danh tính, vui lòng xác thực lần đầu",
        );
      }

      const { ocrInfo, matchResult } = await analyzeDocuments({
        frontPath,
        backPath,
        facePath,
      });

      if (String(ocrInfo.id).trim() !== String(approved.id).trim()) {
        throw httpError(403, "Số căn cước không khớp với thông tin đã đăng ký");
      }

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

      const result = await kycRepository.updateKYCResult({
        userId,
        idNumber: ocrInfo.id,
        fullName: ocrInfo.name,
        dob: ocrInfo.birth_day,
        gender: ocrInfo.gender,
        address: ocrInfo.recent_place,
        frontImageUrl: frontPath,
        backImageUrl: backPath,
        faceImageUrl: facePath,
        matchScore: matchResult.score,
      });
      saved = true;
      oldFiles = [
        approved.front_image_url,
        approved.back_image_url,
        approved.face_image_url,
      ];

      return { ...result.rows[0], full_name: ocrInfo.name };
    } finally {
      (saved ? oldFiles : newFiles).forEach((p) => {
        if (p && !(saved && newFiles.includes(p)) && fs.existsSync(p)) {
          try {
            fs.unlinkSync(p);
          } catch (_) {}
        }
      });
    }
  },
};
module.exports = kycService;