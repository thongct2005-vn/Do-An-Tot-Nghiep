// viettelAI.service.js: Tích hợp API ViettelAI eKYC (kiểm tra giả mạo, OCR CCCD, liveness và đối chiếu khuôn mặt).
require("dotenv").config();
const { postViettelForm } = require("./viettelAI.helpers");

const viettelAIService = {
  async checkPackSpoof({ fontImagePath, backImagePath }) {
    return postViettelForm({
      url: "https://viettelai.vn/ekyc/id_pack_spoof_check",
      files: { image: fontImagePath, image_other: backImagePath },
      methodName: "checkPackSpoof",
      invalidMessage: "Giấy tờ không hợp lệ, vui lòng chụp lại",
      fallbackLogLabel: "kiểm tra giấy tờ giả mạo",
      fallbackErrorMessage: "Không kiểm tra được giấy tờ, vui lòng thử lại sau",
    });
  },

  async extractOcr({ fontImagePath }) {
    const data = await postViettelForm({
      url: "https://viettelai.vn/ekyc/id_card",
      files: { image_front: fontImagePath },
      methodName: "extractOcr",
      invalidMessage: "Không đọc được thông tin trên giấy tờ, vui lòng chụp lại",
      fallbackLogLabel: "đọc thông tin giấy tờ (OCR)",
      fallbackErrorMessage: "Không đọc được thông tin giấy tờ, vui lòng thử lại sau",
    });
    return {
      data:
        typeof data.information === "string"
          ? JSON.parse(data.information)
          : data.information,
    };
  },

  async checkLiveness(faceImagePath) {
    const data = await postViettelForm({
      url: "https://viettelai.vn/ekyc/face_liveness",
      fields: { label_pose: "Portrait" },
      files: { file: faceImagePath },
      methodName: "checkLiveness",
      invalidMessage: "Không xác thực được khuôn mặt thật, vui lòng chụp lại",
      fallbackLogLabel: "kiểm tra khuôn mặt thật",
      fallbackErrorMessage: "Không kiểm tra được khuôn mặt thật, vui lòng thử lại sau",
    });
    return {
      isLive: String(data.verify_result).toLowerCase() === "true",
      score: parseFloat(data.score),
    };
  },

  async verifyFaceMatch(frontImagePath, faceImagePath) {
    const data = await postViettelForm({
      url: "https://viettelai.vn/ekyc/face_matching",
      fields: { ref_score: "0.8" },
      files: { image_cmt: frontImagePath, image_live: faceImagePath },
      methodName: "verifyFaceMatch",
      invalidMessage:
        "Không đối chiếu được khuôn mặt với giấy tờ, vui lòng chụp lại",
      fallbackLogLabel: "đối chiếu khuôn mặt",
      fallbackErrorMessage:
        "Không đối chiếu được khuôn mặt với giấy tờ, vui lòng thử lại sau",
    });
    const rawScore = parseFloat(data.score);
    const normalizedScore = rawScore <= 1 ? rawScore * 100 : rawScore;
    return {
      faceFound: true,
      isMatch: data.verify_result === true || normalizedScore > 80,
      score: parseFloat(normalizedScore.toFixed(2)),
    };
  },
};

module.exports = viettelAIService;
