const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
require("dotenv").config();

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
      if (data.code !== 1) {
        const err = new Error(data.vi_message);
        err.statusCode = 400;
        throw err;
      }
      return data;
    } catch (error) {
      if (error.statusCode) throw error;
      console.error("Lỗi kiểm tra giấy tờ giả mạo:", error.message);
      const err = new Error("Không kiểm tra được giấy tờ, vui lòng thử lại sau");
      err.statusCode = 502;
      throw err;
    }
  },

  async extractOcr({ fontImagePath }) {
    const form = new FormData();
    form.append("token", process.env.VIETTEL_AI_TOKEN);
    form.append("image_front", fs.createReadStream(fontImagePath));

    const response = await axios.post(
      "https://viettelai.vn/ekyc/id_card",
      form,
      { headers: { ...form.getHeaders() }, timeout: 20000 },
    );
    const data = response.data;
    if (data.code !== 1) {
      const err = new Error(data.vi_message);
      err.statusCode = 400;
      throw err;
    }
    return {
      data:
        typeof data.information === "string"
          ? JSON.parse(data.information)
          : data.information,
    };
  },

  async checkLiveness(faceImagePath) {
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
    if (data.code === 1) {
      return {
        isLive: String(data.verify_result).toLowerCase() === "true",
        score: parseFloat(data.score),
      };
    }
    return { isLive: false, score: 0 };
  },

  async verifyFaceMatch(frontImagePath, faceImagePath) {
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
    if (data.code === 1) {
      const rawScore = parseFloat(data.score);
      const normalizedScore = rawScore <= 1 ? rawScore * 100 : rawScore;
      return {
        faceFound: true,
        isMatch: data.verify_result === true || normalizedScore > 80,
        score: parseFloat(normalizedScore.toFixed(2)),
      };
    }
    return { faceFound: false, isMatch: false, score: 0 };
  },
};

module.exports = viettelAIService;