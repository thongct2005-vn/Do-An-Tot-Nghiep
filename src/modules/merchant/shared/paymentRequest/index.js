const modes = require("../../modes");
const paymentMerchantRequestRepository = require("./paymentRequest.repository");
const createPaymentRequestService = require("./paymentRequest.service");
const createPaymentRequestController = require("./paymentRequest.controller");
const createPaymentRequestRoutes = require("./paymentRequest.routes");


module.exports = (mode) => {
  const options = modes[mode];
  if (!options) throw new Error(`Mode không hợp lệ: ${mode}`);

  const service = createPaymentRequestService({
    paymentMerchantRequestRepository,
    ...options,
  });
  const controller = createPaymentRequestController(service);
  return createPaymentRequestRoutes(controller);
};