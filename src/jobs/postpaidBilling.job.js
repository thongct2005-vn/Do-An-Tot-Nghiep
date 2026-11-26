const postpaidRepository = require("../modules/postpaid/postpaid.repository");

const INTERVAL_MS = Number(process.env.POSTPAID_BILLING_POLL_MS);

let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const closeRes = await postpaidRepository.closeBillingCycle({ batchSize: 500 });
    if (closeRes.processed > 0) {
      console.log(
        `[postpaid] Đã chốt sao kê kỳ ${closeRes.cycleMonth} cho ${closeRes.processed} ví`,
      );
    }

    const overdueRes = await postpaidRepository.markOverdueAndApplyLateFees({
      batchSize: 500,
    });
    if (overdueRes.processed > 0) {
      console.log(
        `[postpaid] Đã chuyển quá hạn & tính phí trễ hạn cho ${overdueRes.processed} ví`,
      );
    }
  } catch (e) {
    if (e?.code !== "42P01") {
      console.error("[postpaid] Lỗi job chốt sao kê/quá hạn:", e.message);
    }
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  postpaidRepository.verifySystemPostpaidWallet().catch((e) => {
    if (e?.code !== "42P01") {
      console.error("[postpaid] Cảnh báo ví nguồn Ví trả sau:", e.message);
    }
  });
  timer = setInterval(tick, INTERVAL_MS);
  timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick };

