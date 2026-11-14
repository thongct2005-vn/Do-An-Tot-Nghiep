const webhookWorker = require("./webhookWorker");
const paymentExpiry = require("./paymentExpiry.job");
const dashboardRollup = require("./dashboardRollup.job");

function startBackgroundJobs() {
  webhookWorker.start();
  paymentExpiry.start();
  dashboardRollup.start();
}

function stopBackgroundJobs() {
  webhookWorker.stop();
  paymentExpiry.stop();
  dashboardRollup.stop();
}

module.exports = { startBackgroundJobs, stopBackgroundJobs };