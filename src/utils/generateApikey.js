const crypto = require("crypto");
const { httpError } = require("./httpError");
const authMerchantRepository = require("../../src/admin/merchant/auth/auth.repository");
function generateMerchantKeys() {
  const apiKey = "mio_" + crypto.randomBytes(32).toString("hex");
  return apiKey;
}

async function generateUniqueMerchantKeys(client, maxRetries = 5) {
  let attempts = 0;

  while (attempts < maxRetries) {
    attempts++;
    const apiKey = generateMerchantKeys();

    const checkResult = await authMerchantRepository.findMerchantApiKey(apiKey);

    if (!checkResult) {
      return apiKey;
    }
  }

  throw httpError(500, "Lỗi tại api key sau nhiều lần thử");
}

module.exports = {
  generateUniqueMerchantKeys,
};
