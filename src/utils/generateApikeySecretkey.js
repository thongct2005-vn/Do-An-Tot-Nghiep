const crypto = require("crypto");
const { httpError } = require("./httpError");
const authMerchantRepository = require("../admin/merchant/production/auth/auth.repository");
function generateMerchantApiKey() {
  const apiKey = "pk_" + crypto.randomBytes(16).toString("hex");
  return apiKey;
}

function generateMerchantSecretKey() {
  return "sk_" + crypto.randomBytes(32).toString("hex");
}

async function generateUniqueMerchantApiKey(maxRetries = 5) {
  let attempts = 0;

  while (attempts < maxRetries) {
    attempts++;
    const apiKey = generateMerchantApiKey();

    const checkResult = await authMerchantRepository.findMerchantApiKey(apiKey);

    if (!checkResult) {
      return apiKey;
    }
  }

  throw httpError(500, "Lỗi tại api key sau nhiều lần thử");
}

async function generateUniqueMerchantSecretKey() {
  return generateMerchantSecretKey();
}

module.exports = {
  generateUniqueMerchantApiKey,
  generateUniqueMerchantSecretKey,
};