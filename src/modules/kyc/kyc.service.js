const kycRepository = require("./kyc.repository");
const viettelAIService = require("../../services/viettelAI.service");
const fs = require("fs");
const kycService = {
  async checkUserKYC(userId) {
    if (!userId) {
      const err = new Error("Thiếu thông tin để xác thực danh tính");
      err.statusCode = 400;
      throw err;
    }
    return await kycRepository.checkUserKYC(userId);
  },
  async verifyAndSaveKYC({ userId, frontPath, backPath, facePath }) {
    try {
      if (!frontPath || !backPath || !facePath) {
        const err = new Error(
          "Thiếu ảnh mặt trước, mặt sau hoặc ảnh khuôn mặt",
        );
        err.statusCode = 400;
        throw err;
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
        const err = new Error("Không xác thực được khuôn mặt thật");
        err.statusCode = 422;
        throw err;
      }
      const matchResult = await viettelAIService.verifyFaceMatch(
        frontPath,
        facePath,
      );
      if (!matchResult.isMatch) {
        const err = new Error("Khuôn mặt không khớp với ảnh trên giấy tờ");
        err.statusCode = 422;
        throw err;
      }

      const existsResult = await kycRepository.checkIdExists(ocrInfo.id);
      if (existsResult.is_exists) {
        const err = new Error("Thông tin định danh đã được đăng ký trước đó");
        err.statusCode = 400;
        throw err;
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

  async saveKYCResult({
    userId,
    data,
    fontImageUrl,
    backImageUrl,
    faceImageUrl,
    status,
    matchScore,
  }) {
    if (
      !userId ||
      !data ||
      !fontImageUrl ||
      !backImageUrl ||
      faceImageUrl ||
      !matchScore
    ) {
      const err = new Error("Thiếu thông tin để xác thực danh tính");
      err.statusCode = 400;
      throw err;
    }
    const result = await kycRepository.checkIdExists(data.id_number);
    if (result.is_exists) {
      const err = new Error("Thông tin định danh đã được đăng ký trước đó");
      err.statusCode = 400;
      throw err;
    }

    await kycRepository.saveKYCResult({
      userId,
      data,
      fontImageUrl,
      backImageUrl,
      faceImageUrl,
      status,
      matchScore,
    });
  },
};
module.exports = kycService;
