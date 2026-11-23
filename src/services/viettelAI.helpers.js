// viettelAI.helpers.js: Tiện ích gửi request multipart và xử lý lỗi dùng chung khi gọi ViettelAI eKYC.
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
const { httpError } = require("../utils/common/http");

async function postViettelForm({
  url,
  fields = {},
  files = {},
  methodName,
  invalidMessage,
  fallbackLogLabel,
  fallbackErrorMessage,
}) {
  try {
    const form = new FormData();
    form.append("token", process.env.VIETTEL_AI_TOKEN);
    for (const [k, v] of Object.entries(fields)) {
      form.append(k, v);
    }
    for (const [k, filePath] of Object.entries(files)) {
      form.append(k, fs.createReadStream(filePath));
    }

    const response = await axios.post(url, form, {
      headers: { ...form.getHeaders() },
      timeout: 20000,
    });
    const data = response.data;
    if (data?.code !== 1) {
      console.error(`ViettelAI ${methodName} trả về lỗi:`, data);
      throw httpError(400, data?.vi_message || invalidMessage);
    }
    return data;
  } catch (error) {
    if (error.statusCode) throw error;
    console.error(
      `Lỗi gọi ViettelAI ${fallbackLogLabel}:`,
      error.response?.data || error.message,
    );
    throw httpError(502, fallbackErrorMessage);
  }
}

module.exports = {
  postViettelForm,
};

