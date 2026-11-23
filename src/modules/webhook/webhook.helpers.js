// webhook.helpers.js: Hằng số lịch thử lại, lease worker và ánh xạ trạng thái sự kiện webhook.
const WEBHOOK_RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200, 21600, 43200, 86400];
const WEBHOOK_LEASE_SECONDS = 120;

const WEBHOOK_EVENT_STATUS = Object.freeze({
  "payment.success": "success",
  "payment.failed": "failed",
});

module.exports = {
  WEBHOOK_RETRY_DELAYS_SECONDS,
  WEBHOOK_LEASE_SECONDS,
  WEBHOOK_EVENT_STATUS,
};

