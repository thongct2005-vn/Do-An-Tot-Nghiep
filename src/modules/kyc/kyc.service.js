const kycRepository = require("./kyc.repository");
const viettelAIService = require("../../services/viettelAI.service");
const fs = require("fs");
const { httpError } = require("../../utils/httpError");
const kycService = {
  async checkUserKYC(userId) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin để xác thực danh tính");
    }
    return await kycRepository.checkUserKYC(userId);
  },
  async verifyAndSaveKYC({ userId, frontPath, backPath, facePath }) {
    try {
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
};
module.exports = kycService;
