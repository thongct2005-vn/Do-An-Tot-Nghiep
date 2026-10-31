/* =====================================================================
 * dashboard/overview.js - Tab "Tổng quan"
 * Số dư, tổng thu/chi tháng này, API Key, Secret Key, Callback URL
 * ===================================================================== */

registerTab("overview", {
  html: `
                    <section class="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <!-- Khung Số dư (Nhấn vào chuyển tab Lịch sử giao dịch) -->
                        <div onclick="switchTab('transactions')" class="bg-white rounded-2xl shadow p-6 cursor-pointer hover:shadow-lg transition group border border-transparent hover:border-blue-200">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-sm text-gray-500 mb-1 flex items-center gap-2">
                                        <span>Số dư ví</span>
                                        <i class="fa-solid fa-chevron-right text-xs text-gray-400 group-hover:translate-x-1 transition-transform"></i>
                                    </p>
                                    <p id="balance" class="text-3xl font-bold text-blue-600">---</p>
                                </div>
                                <div class="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-xl group-hover:bg-blue-600 group-hover:text-white transition duration-200">
                                    <i class="fa-solid fa-wallet"></i>
                                </div>
                            </div>
                        </div>

                        <!-- Khung Tổng thu (Tháng này - Nhấn vào chuyển tab Lịch sử giao dịch) -->
                        <div onclick="switchTab('history')" class="bg-white rounded-2xl shadow p-6 cursor-pointer hover:shadow-lg transition group border border-transparent hover:border-green-200">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-sm text-gray-500 mb-1 flex items-center gap-2">
                                        <span>Tổng thu (Tháng này)</span>
                                        <i class="fa-solid fa-chevron-right text-xs text-gray-400 group-hover:translate-x-1 transition-transform"></i>
                                    </p>
                                    <p id="total-income" class="text-3xl font-bold text-green-600">---</p>
                                </div>
                                <div class="w-12 h-12 rounded-xl bg-green-50 text-green-600 flex items-center justify-center text-xl group-hover:bg-green-600 group-hover:text-white transition duration-200">
                                    <i class="fa-solid fa-arrow-down-left"></i>
                                </div>
                            </div>
                        </div>

                        <!-- Khung Tổng chi (Tháng này - Nhấn vào chuyển tab Lịch sử giao dịch) -->
                        <div onclick="switchTab('history')" class="bg-white rounded-2xl shadow p-6 cursor-pointer hover:shadow-lg transition group border border-transparent hover:border-red-200">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-sm text-gray-500 mb-1 flex items-center gap-2">
                                        <span>Tổng chi (Tháng này)</span>
                                        <i class="fa-solid fa-chevron-right text-xs text-gray-400 group-hover:translate-x-1 transition-transform"></i>
                                    </p>
                                    <p id="total-expense" class="text-3xl font-bold text-red-600">---</p>
                                </div>
                                <div class="w-12 h-12 rounded-xl bg-red-50 text-red-600 flex items-center justify-center text-xl group-hover:bg-red-600 group-hover:text-white transition duration-200">
                                    <i class="fa-solid fa-arrow-up-right"></i>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section class="bg-white rounded-2xl shadow p-6 space-y-6">
                        <div>
                            <h2 class="text-base font-bold">Thông tin tích hợp</h2>
                            <p class="text-sm text-gray-500">Dùng API Key, Secret Key và Callback URL bên dưới để kết nối hệ thống của bạn với cổng thanh toán. Xem cách làm ở tab
                                <button type="button" onclick="switchTab('guide')" class="text-blue-600 font-semibold hover:underline">Hướng dẫn tích hợp</button>.
                            </p>
                        </div>

                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">API Key</label>
                            <div class="flex gap-2">
                                <div class="relative flex-1">
                                    <input type="password" id="api-key" readonly
                                        class="w-full px-4 py-2 border rounded-lg bg-gray-50 font-mono text-sm pr-10 focus:outline-none" />
                                    <button type="button" onclick="toggleKey('api-key', 'eye-icon')"
                                        class="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-700 focus:outline-none">
                                        <i id="eye-icon" class="fa-solid fa-eye-slash"></i>
                                    </button>
                                </div>
                                <button type="button" id="copy-btn" onclick="copyKey('api-key', 'copy-btn')"
                                    class="bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition duration-200 whitespace-nowrap">
                                    <i class="fa-regular fa-copy mr-1"></i> Copy
                                </button>
                                <button type="button" onclick="openResetModal('apiKey')"
                                    class="bg-amber-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-amber-700 transition duration-200 whitespace-nowrap">
                                    <i class="fa-solid fa-rotate mr-1"></i> Reset
                                </button>
                            </div>
                            <p class="text-xs text-gray-500 mt-2">Dùng để định danh merchant, gửi trong header <code>X-API-Key</code> mỗi request. Không đưa vào code chạy trên trình duyệt hay app của khách hàng.</p>
                        </div>

                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">Secret Key</label>
                            <div class="flex gap-2">
                                <div class="relative flex-1">
                                    <input type="password" id="secret-key" readonly
                                        class="w-full px-4 py-2 border rounded-lg bg-gray-50 font-mono text-sm pr-10 focus:outline-none" />
                                    <button type="button" onclick="toggleKey('secret-key', 'secret-eye-icon')"
                                        class="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-700 focus:outline-none">
                                        <i id="secret-eye-icon" class="fa-solid fa-eye-slash"></i>
                                    </button>
                                </div>
                                <button type="button" id="secret-copy-btn" onclick="copyKey('secret-key', 'secret-copy-btn')"
                                    class="bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition duration-200 whitespace-nowrap">
                                    <i class="fa-regular fa-copy mr-1"></i> Copy
                                </button>
                                <button type="button" onclick="openResetModal('secretKey')"
                                    class="bg-amber-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-amber-700 transition duration-200 whitespace-nowrap">
                                    <i class="fa-solid fa-rotate mr-1"></i> Reset
                                </button>
                            </div>
                            <p class="text-xs text-gray-500 mt-2">Dùng để ký request và xác minh callback. <b>Không bao giờ gửi đi</b> trong request, chỉ lưu trong biến môi trường trên server của bạn.</p>
                        </div>

                        <hr class="border-gray-200">

                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">Callback URL (Webhook)</label>
                            <div class="flex gap-2">
                                <input type="url" id="callback-url" maxlength="100"
                                    placeholder="https://yourdomain.com/api/payment/callback"
                                    class="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                <button type="button" id="update-btn" onclick="handleUpdateCallback()"
                                    class="bg-green-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-green-700 transition duration-200 whitespace-nowrap disabled:opacity-60">
                                    Cập nhật
                                </button>
                            </div>
                            <p class="text-xs text-gray-500 mt-2">Cổng thanh toán gửi kết quả giao dịch (thành công / thất bại) về địa chỉ này.</p>
                        </div>
                    </section>
    `,
  modals: `
    <div id="reset-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/50"
        onclick="if (event.target === this) closeResetModal()">
        <div class="bg-white max-w-md w-full p-6 rounded-2xl shadow-xl text-center">
            <div class="mx-auto mb-4 w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
                <i class="fa-solid fa-triangle-exclamation text-xl"></i>
            </div>
            <h3 id="reset-modal-title" class="text-lg font-bold text-gray-800 mb-1">Xác nhận làm mới</h3>
            <p id="reset-modal-desc" class="text-sm text-gray-600 mb-6"></p>
            <div class="flex gap-3">
                <button type="button" onclick="closeResetModal()"
                    class="flex-1 bg-gray-200 text-gray-800 font-semibold py-2 rounded-lg hover:bg-gray-300 transition duration-200">
                    Hủy
                </button>
                <button type="button" id="confirm-reset-btn" onclick="handleResetKey()"
                    class="flex-1 bg-amber-600 text-white font-semibold py-2 rounded-lg hover:bg-amber-700 transition duration-200 disabled:opacity-60">
                    Xác nhận
                </button>
            </div>
        </div>
    </div>
    `,
  init() {
    loadInfo();
  },
});

let resetTypeTarget = null;

function setInfoLoading(loading) {
  [
    "full-name",
    "balance",
    "total-income",
    "total-expense",
    "api-key",
    "secret-key",
    "callback-url",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("skeleton", loading);
  });
}

function toggleKey(inputId, iconId) {
  const field = document.getElementById(inputId);
  const icon = document.getElementById(iconId);
  const isHidden = field.type === "password";
  field.type = isHidden ? "text" : "password";
  icon.classList.toggle("fa-eye", isHidden);
  icon.classList.toggle("fa-eye-slash", !isHidden);
}

async function copyKey(inputId, btnId) {
  const value = document.getElementById(inputId).value;
  if (!value) return;
  await copyText(value);
  const btn = document.getElementById(btnId);
  btn.innerHTML = '<i class="fa-solid fa-check mr-1"></i> Đã copy';
  setTimeout(() => {
    btn.innerHTML = '<i class="fa-regular fa-copy mr-1"></i> Copy';
  }, 1500);
}

function openResetModal(type) {
  resetTypeTarget = type;
  const titleEl = document.getElementById("reset-modal-title");
  const descEl = document.getElementById("reset-modal-desc");

  if (type === "apiKey") {
    titleEl.textContent = "Xác nhận reset API Key?";
    descEl.innerHTML =
      "Bạn có chắc chắn muốn làm mới API Key không? Sau khi reset, API Key cũ sẽ không thể sử dụng. <b>Lưu ý: Thao tác này chỉ có thể thực hiện 1 lần trong 7 ngày.</b>";
  } else if (type === "secretKey") {
    titleEl.textContent = "Xác nhận reset Secret Key?";
    descEl.innerHTML =
      "Bạn có chắc chắn muốn làm mới Secret Key không? Sau khi reset, các kết nối đang chạy key cũ sẽ thất bại. <b>Lưu ý: Thao tác này chỉ có thể thực hiện 1 lần trong 7 ngày.</b>";
  }
  document.getElementById("reset-modal").classList.remove("hidden");
}

function closeResetModal() {
  resetTypeTarget = null;
  document.getElementById("reset-modal").classList.add("hidden");
}

async function handleResetKey() {
  if (!resetTypeTarget) return;
  clearAlerts();
  const isApiKey = resetTypeTarget === "apiKey";
  const endpoint = isApiKey ? RESET_API_KEY_URL : RESET_SECRET_KEY_URL;

  setLoading("confirm-reset-btn", true, "Đang tạo mới...");
  try {
    const data = await api(endpoint, { method: "POST" });
    if (isApiKey && data.rows && data.rows[0]) {
      document.getElementById("api-key").value = data.rows[0].api_key;
    } else if (!isApiKey && data.rows && data.rows[0]) {
      document.getElementById("secret-key").value = data.rows[0].secret_key;
    } else {
      await loadInfo();
    }
    showSuccess(`Làm mới ${isApiKey ? "API Key" : "Secret Key"} thành công!`);
    closeResetModal();
  } catch (e) {
    closeResetModal();
    showError(e.message);
  } finally {
    setLoading("confirm-reset-btn", false);
  }
}

async function loadInfo() {
  setInfoLoading(true);
  try {
    const data = await api(INFO_URL);
    document.getElementById("full-name").textContent = data.full_name || "";
    document.getElementById("balance").textContent = formatMoney(data.balance);
    document.getElementById("api-key").value = data.api_key || "";
    document.getElementById("secret-key").value = data.secret_key || "";
    document.getElementById("callback-url").value = data.call_back_url || "";

    // Gọi thêm API lấy Tổng thu & Tổng chi tháng này
    loadSummary();
  } catch (e) {
    showError(e.message);
  } finally {
    setInfoLoading(false);
  }
}

async function loadSummary() {
  try {
    const summary = await api(TRANSACTION_SUMMARY_URL);
    document.getElementById("total-income").textContent = formatMoney(
      summary.total_income,
    );
    document.getElementById("total-expense").textContent = formatMoney(
      summary.total_expense,
    );
  } catch (e) {
    console.error("Lỗi lấy tổng quan giao dịch:", e.message);
  }
}

async function handleUpdateCallback() {
  clearAlerts();
  const callbackUrl = document.getElementById("callback-url").value.trim();

  if (!callbackUrl) return showError("Callback URL không được để trống!");
  if (callbackUrl.length > 100)
    return showError("Callback URL không được vượt quá 100 ký tự!");
  try {
    new URL(callbackUrl);
  } catch (_) {
    return showError("Callback URL không hợp lệ!");
  }

  setLoading("update-btn", true, "Đang lưu...");
  try {
    await api(CALLBACK_URL, {
      method: "PATCH",
      body: { call_back_url: callbackUrl },
    });
    showSuccess("Cập nhật callback thành công");
  } catch (e) {
    showError(e.message);
  } finally {
    setLoading("update-btn", false);
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeResetModal();
});
