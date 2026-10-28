(function () {
  "use strict";

  var API = "/api/v2/pay/";
  var POLL_MS = 2500;
  var REDIRECT_SECONDS = 3;

  // URL dạng /pay/<reference_code>
  var parts = location.pathname.split("/").filter(Boolean);
  var referenceCode = decodeURIComponent(parts[parts.length - 1] || "");

  function $(id) {
    return document.getElementById(id);
  }

  var STATES = ["loading", "pending", "success", "failed", "error"];
  function showState(name) {
    STATES.forEach(function (s) {
      $("state-" + s).hidden = s !== name;
    });
  }

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }
  function formatClock(totalSeconds) {
    return pad(Math.floor(totalSeconds / 60)) + ":" + pad(totalSeconds % 60);
  }
  function formatMoney(n) {
    try {
      return new Intl.NumberFormat("vi-VN").format(n) + " đ";
    } catch (e) {
      return n + " đ";
    }
  }

  // Ghép order_id + status vào return_url. Chỉ cho http/https.
  // Lưu ý: trạng thái trên URL chỉ để hiển thị, merchant phải xác nhận bằng webhook hoặc API tra cứu.
  function buildReturnUrl(returnUrl, orderId, status) {
    try {
      var u = new URL(returnUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      u.searchParams.set("order_id", orderId);
      u.searchParams.set("status", status);
      return u.toString();
    } catch (e) {
      return null;
    }
  }

  var pollTimer = null;
  var countdownTimer = null;
  var deadline = 0;
  var qrLoaded = false;
  var finished = false;
  var expiredPolled = false;

  function fillSummary(data) {
    $("merchant-name").textContent = data.merchant_name || "cửa hàng";
    $("amount").textContent = formatMoney(data.amount);
    $("order-id").textContent = data.order_id;
    if (data.description) {
      $("description").textContent = data.description;
      $("description-row").hidden = false;
    } else {
      $("description-row").hidden = true;
    }
    $("summary").hidden = false;
  }

  function showError(title, text, canRetry) {
    stopTimers();
    $("summary").hidden = true;
    $("error-title").textContent = title;
    $("error-text").textContent = text || "";
    $("retry-btn").hidden = !canRetry;
    showState("error");
  }

  function stopTimers() {
    if (pollTimer) clearTimeout(pollTimer);
    if (countdownTimer) clearInterval(countdownTimer);
    pollTimer = null;
    countdownTimer = null;
  }

  function schedulePoll(ms) {
    if (finished) return;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, ms);
  }

  function startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    expiredPolled = false;
    function tick() {
      var left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      $("countdown").textContent = formatClock(left);
      if (left === 0 && !expiredPolled) {
        // Hết giờ: hỏi server ngay để nhận trạng thái "failed"
        expiredPolled = true;
        schedulePoll(300);
      }
    }
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function finish(data) {
    finished = true;
    stopTimers();
    fillSummary(data);
    showState(data.status === "success" ? "success" : "failed");

    var target = data.return_url
      ? buildReturnUrl(data.return_url, data.order_id, data.status)
      : null;
    var area = $("return-area");
    if (!target) {
      $("redirect-note").textContent = "Bạn có thể đóng trang này.";
      $("return-link").hidden = true;
      area.hidden = false;
      return;
    }

    $("return-link").hidden = false;
    $("return-link").href = target;
    area.hidden = false;

    var left = REDIRECT_SECONDS;
    function render() {
      $("redirect-note").textContent =
        "Tự động quay lại cửa hàng sau " + left + " giây...";
    }
    render();
    var t = setInterval(function () {
      left -= 1;
      if (left <= 0) {
        clearInterval(t);
        location.replace(target);
        return;
      }
      render();
    }, 1000);
  }

  function handle(data) {
    if (data.status === "pending") {
      fillSummary(data);
      if (
        data.qr_image &&
        data.qr_image.indexOf("data:image/png;base64,") === 0
      ) {
        $("qr").src = data.qr_image;
        qrLoaded = true;
      }
      deadline = Date.now() + data.seconds_left * 1000;
      showState("pending");
      startCountdown();
      schedulePoll(POLL_MS);
    } else {
      finish(data);
    }
  }

  function request(withQr) {
    var url = API + encodeURIComponent(referenceCode) + (withQr ? "?qr=1" : "");
    return fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (json) {
          if (!res.ok) {
            var err = new Error(json.message || "Lỗi " + res.status);
            err.status = res.status;
            throw err;
          }
          return json.data;
        });
    });
  }

  var firstLoad = true;
  function poll() {
    request(!qrLoaded)
      .then(function (data) {
        firstLoad = false;
        handle(data);
      })
      .catch(function (err) {
        if (err.status === 404) {
          showError(
            "Không tìm thấy đơn thanh toán",
            "Liên kết không đúng hoặc đơn hàng không tồn tại.",
            false,
          );
          return;
        }
        if (firstLoad) {
          showError(
            "Không tải được thông tin",
            err.message || "Vui lòng kiểm tra kết nối mạng rồi thử lại.",
            true,
          );
          return;
        }
        // Mất mạng thoáng qua lúc đang chờ: giữ nguyên màn hình, thử lại sau
        schedulePoll(POLL_MS * 2);
      });
  }

  $("retry-btn").addEventListener("click", function () {
    firstLoad = true;
    showState("loading");
    poll();
  });

  showState("loading");
  poll();
})();
