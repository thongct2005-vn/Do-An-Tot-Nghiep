const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
require("dotenv").config();

function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

const viettelAIService = {
  async checkPackSpoof({ fontImagePath, backImagePath }) {
    try {
      const form = new FormData();
      form.append("token", process.env.VIETTEL_AI_TOKEN);
      form.append("image", fs.createReadStream(fontImagePath));
      form.append("image_other", fs.createReadStream(backImagePath));

      const response = await axios.post(
        "https://viettelai.vn/ekyc/id_pack_spoof_check",
        form,
        { headers: { ...form.getHeaders() }, timeout: 20000 },
      );
      const data = response.data;
      if (data?.code !== 1) {
        console.error("ViettelAI checkPackSpoof trả về lỗi:", data);
        throw createHttpError(
          400,
          data?.vi_message || "Giấy tờ không hợp lệ, vui lòng chụp lại",
        );
      }
      return data;
    } catch (error) {
      if (error.statusCode) throw error;
      console.error(
        "Lỗi gọi ViettelAI kiểm tra giấy tờ giả mạo:",
        error.response?.data || error.message,
      );
      throw createHttpError(
        502,
        "Không kiểm tra được giấy tờ, vui lòng thử lại sau",
      );
    }
  },

  async extractOcr({ fontImagePath }) {
    try {
      const form = new FormData();
      form.append("token", process.env.VIETTEL_AI_TOKEN);
      form.append("image_front", fs.createReadStream(fontImagePath));

      const response = await axios.post(
        "https://viettelai.vn/ekyc/id_card",
        form,
        { headers: { ...form.getHeaders() }, timeout: 20000 },
      );
      const data = response.data;
      if (data?.code !== 1) {
        console.error("ViettelAI extractOcr trả về lỗi:", data);
        throw createHttpError(
          400,
          data?.vi_message ||
            "Không đọc được thông tin trên giấy tờ, vui lòng chụp lại",
        );
      }
      return {
        data:
          typeof data.information === "string"
            ? JSON.parse(data.information)
            : data.information,
      };
    } catch (error) {
      if (error.statusCode) throw error;
      console.error(
        "Lỗi gọi ViettelAI đọc thông tin giấy tờ (OCR):",
        error.response?.data || error.message,
      );
      throw createHttpError(
        502,
        "Không đọc được thông tin giấy tờ, vui lòng thử lại sau",
      );
    }
  },

  async checkLiveness(faceImagePath) {
    try {
      const form = new FormData();
      form.append("token", process.env.VIETTEL_AI_TOKEN);
      form.append("file", fs.createReadStream(faceImagePath));
      form.append("label_pose", "Portrait");

      const response = await axios.post(
        "https://viettelai.vn/ekyc/face_liveness",
        form,
        { headers: { ...form.getHeaders() }, timeout: 20000 },
      );
      const data = response.data;
      if (data?.code !== 1) {
        console.error("ViettelAI checkLiveness trả về lỗi:", data);
        throw createHttpError(
          400,
          data?.vi_message ||
            "Không xác thực được khuôn mặt thật, vui lòng chụp lại",
        );
      }
      return {
        isLive: String(data.verify_result).toLowerCase() === "true",
        score: parseFloat(data.score),
      };
    } catch (error) {
      if (error.statusCode) throw error;
      console.error(
        "Lỗi gọi ViettelAI kiểm tra khuôn mặt thật:",
        error.response?.data || error.message,
      );
      throw createHttpError(
        502,
        "Không kiểm tra được khuôn mặt thật, vui lòng thử lại sau",
      );
    }
  },

  async verifyFaceMatch(frontImagePath, faceImagePath) {
    try {
      const form = new FormData();
      form.append("token", process.env.VIETTEL_AI_TOKEN);
      form.append("image_cmt", fs.createReadStream(frontImagePath));
      form.append("image_live", fs.createReadStream(faceImagePath));
      form.append("ref_score", "0.8");

      const response = await axios.post(
        "https://viettelai.vn/ekyc/face_matching",
        form,
        { headers: { ...form.getHeaders() }, timeout: 20000 },
      );
      const data = response.data;
      if (data?.code !== 1) {
        console.error("ViettelAI verifyFaceMatch trả về lỗi:", data);
        throw createHttpError(
          400,
          data?.vi_message ||
            "Không đối chiếu được khuôn mặt với giấy tờ, vui lòng chụp lại",
        );
      }
      const rawScore = parseFloat(data.score);
      const normalizedScore = rawScore <= 1 ? rawScore * 100 : rawScore;
      return {
        faceFound: true,
        isMatch: data.verify_result === true || normalizedScore > 80,
        score: parseFloat(normalizedScore.toFixed(2)),
      };
    } catch (error) {
      if (error.statusCode) throw error;
      console.error(
        "Lỗi gọi ViettelAI đối chiếu khuôn mặt:",
        error.response?.data || error.message,
      );
      throw createHttpError(
        502,
        "Không đối chiếu được khuôn mặt với giấy tờ, vui lòng thử lại sau",
      );
    }
  },
};

module.exports = viettelAIService;
