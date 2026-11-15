const webhookWorker = require("./webhookWorker");
const paymentExpiry = require("./paymentExpiry.job");
const dashboardRollup = require("./dashboardRollup.job");
const postpaidBilling = require("./postpaidBilling.job");
const merchantFeeService = require("../modules/merchant/production/fee/fee.service");

function startBackgroundJobs() {
  webhookWorker.start();
  paymentExpiry.start();
  dashboardRollup.start();
  postpaidBilling.start();
  merchantFeeService.verifySystemFeeWallet().catch((e) => {
    if (e?.code !== "42P01") {
      console.error("[fee] Cảnh báo ví thu phí hệ thống:", e.message);
    }
  });
}

function stopBackgroundJobs() {
  webhookWorker.stop();
  paymentExpiry.stop();
  dashboardRollup.stop();
  postpaidBilling.stop();
}

module.exports = { startBackgroundJobs, stopBackgroundJobs };