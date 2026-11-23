// kyc.service.js: Nghiệp vụ xác thực lần đầu, kiểm tra trạng thái và cập nhật hồ sơ định danh eKYC.
const kycRepository = require("./kyc.repository");
const { httpError } = require("../../utils/common/http");
const { removeTempFiles } = require("../../utils/files/imageStorage");
const {
  analyzeDocuments,
  assertFaceMatchesApprovedKyc,
  safeUnlinkFiles,
} = require("./kyc.helpers");

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

      return await kycRepository.saveKYCResult({
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
    } catch (e) {
      removeTempFiles([frontPath, backPath, facePath]);
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

      await assertFaceMatchesApprovedKyc({ approved, facePath });

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
      const filesToDelete = saved
        ? oldFiles.filter((p) => p && !newFiles.includes(p))
        : newFiles;
      safeUnlinkFiles(filesToDelete);
    }
  },
};

module.exports = kycService;
