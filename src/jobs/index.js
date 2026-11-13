const webhookWorker = require("./webhookWorker");
const paymentExpiry = require("./paymentExpiry.job");
const merchantFeeRollover = require("./merchantFeeRollover.job");

function startBackgroundJobs() {
  webhookWorker.start();
  paymentExpiry.start();
  merchantFeeRollover.start();
}

function stopBackgroundJobs() {
  webhookWorker.stop();
  paymentExpiry.stop();
  merchantFeeRollover.stop();
}

module.exports = { startBackgroundJobs, stopBackgroundJobs };