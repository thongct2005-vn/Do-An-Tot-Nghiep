const webhookWorker = require("./webhookWorker");
const paymentExpiry = require("./paymentExpiry.job");

function startBackgroundJobs() {
  webhookWorker.start();
  paymentExpiry.start();
}

function stopBackgroundJobs() {
  webhookWorker.stop();
  paymentExpiry.stop();
}

module.exports = { startBackgroundJobs, stopBackgroundJobs };