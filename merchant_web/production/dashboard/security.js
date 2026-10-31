/* =====================================================================
 * dashboard/security.js
 * Tab "Bảo mật": bật / tắt Google Authenticator (TOTP) cho đăng nhập và OTP giao dịch.
 *
 * Bật  : nhập lại mật khẩu -> quét mã QR -> nhập mã 6 số đầu tiên để xác nhận
 * Tắt  : nhập mã 6 số hiện tại của ứng dụng
 * ===================================================================== */

const TOTP_STATUS_URL = PROD_CFG.TOTP_STATUS;
const TOTP_SETUP_URL = PROD_CFG.TOTP_SETUP;
const TOTP_ENABLE_URL = PROD_CFG.TOTP_ENABLE;
const TOTP_DISABLE_URL = PROD_CFG.TOTP_DISABLE;

let totpEnabled = null;       // null = đang tải hoặc tải lỗi
let totpLoadFailed = false;
let totpSecretRaw = '';       // khoá thô để nút "Sao chép"; xoá khi đóng modal

registerTab('security', {
    html: `
        <section class="bg-white rounded-2xl shadow p-6">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div class="flex items-start gap-4">
                    <div class="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                        <i class="fa-solid fa-shield-halved text-lg"></i>
                    </div>
                    <div>
                        <h2 class="text-lg font-bold">Google Authenticator</h2>
                        <p class="text-xs text-gray-500 mt-0.5 max-w-xl">
                            Khi bật, đăng nhập và OTP giao dịch đều dùng mã 6 số từ ứng dụng Google Authenticator
                            thay cho mã OTP gửi qua email. Khi tắt, tất cả OTP được gửi qua email.
                        </p>
                        <p id="totp-status" class="mt-3 text-sm"></p>
                    </div>
                </div>
                <div id="totp-actions" class="shrink-0"></div>
            </div>
        </section>
    `,

    modals: `
        <!-- Bật Google Authenticator -->
        <div id="totp-setup-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/50"
            onclick="if (event.target === this) closeTotpSetupModal()">
            <div class="bg-white max-w-md w-full p-6 rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
                <div id="totp-setup-error" class="hidden mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-lg text-sm"></div>

                <!-- Bước 1: nhập lại mật khẩu -->
                <form id="totp-step-password" onsubmit="submitTotpPassword(event)" class="space-y-4">
                    <div class="text-center">
                        <div class="mx-auto mb-3 w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                            <i class="fa-solid fa-lock text-xl"></i>
                        </div>
                        <h3 class="text-lg font-bold text-gray-800">Bật Google Authenticator</h3>
                        <p class="text-sm text-gray-600 mt-1">Nhập mật khẩu hiện tại để tiếp tục.</p>
                    </div>
                    <input type="password" id="totp-password" required maxlength="15" autocomplete="current-password"
                        placeholder="Mật khẩu"
                        class="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <div class="flex gap-3">
                        <button type="button" onclick="closeTotpSetupModal()"
                            class="flex-1 bg-gray-200 text-gray-800 font-semibold py-2 rounded-lg hover:bg-gray-300 transition duration-200">
                            Hủy
                        </button>
                        <button type="submit" id="totp-password-btn"
                            class="flex-1 bg-blue-600 text-white font-semibold py-2 rounded-lg hover:bg-blue-700 transition duration-200 disabled:opacity-60">
                            Tiếp tục
                        </button>
                    </div>
                </form>

                <!-- Bước 2: quét QR + xác nhận mã đầu tiên -->
                <div id="totp-step-scan" class="hidden space-y-4">
                    <div class="text-center">
                        <h3 class="text-lg font-bold text-gray-800">Quét mã QR</h3>
                        <p class="text-sm text-gray-600 mt-1">
                            Mở Google Authenticator, chọn dấu <span class="font-semibold">+</span>
                            rồi <span class="font-semibold">Quét mã QR</span>.
                        </p>
                    </div>

                    <div class="flex justify-center">
                        <div id="totp-qr" class="bg-white p-2 border rounded-lg min-w-[12rem] min-h-[12rem] flex items-center justify-center"></div>
                    </div>

                    <div class="text-center">
                        <p class="text-xs text-gray-500 mb-1">Không quét được? Nhập khóa này vào ứng dụng:</p>
                        <div class="inline-flex items-center gap-2 bg-gray-50 border rounded-lg px-3 py-2">
                            <code id="totp-secret" class="text-sm font-mono tracking-wider break-all"></code>
                            <button type="button" id="totp-copy-btn" onclick="copyTotpSecret()"
                                class="text-xs text-blue-600 hover:underline whitespace-nowrap">Sao chép</button>
                        </div>
                    </div>

                    <form onsubmit="submitTotpEnable(event)" class="space-y-3">
                        <label class="block text-sm font-medium text-gray-700">
                            Nhập mã 6 số hiện trên ứng dụng để xác nhận
                        </label>
                        <input type="text" id="totp-enable-code" required maxlength="6" inputmode="numeric"
                            autocomplete="one-time-code" oninput="totpOnlyDigits(this)" placeholder="000000"
                            class="w-full px-4 py-3 border rounded-lg text-center text-xl tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        <div class="flex gap-3">
                            <button type="button" onclick="closeTotpSetupModal()"
                                class="flex-1 bg-gray-200 text-gray-800 font-semibold py-2 rounded-lg hover:bg-gray-300 transition duration-200">
                                Hủy
                            </button>
                            <button type="submit" id="totp-enable-btn"
                                class="flex-1 bg-blue-600 text-white font-semibold py-2 rounded-lg hover:bg-blue-700 transition duration-200 disabled:opacity-60">
                                Xác nhận
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>

        <!-- Tắt Google Authenticator -->
        <div id="totp-disable-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/50"
            onclick="if (event.target === this) closeTotpDisableModal()">
            <form class="bg-white max-w-sm w-full p-6 rounded-2xl shadow-xl space-y-4" onsubmit="submitTotpDisable(event)">
                <div id="totp-disable-error" class="hidden p-3 bg-red-100 border border-red-400 text-red-700 rounded-lg text-sm"></div>
                <div class="text-center">
                    <div class="mx-auto mb-3 w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
                        <i class="fa-solid fa-shield-halved text-xl"></i>
                    </div>
                    <h3 class="text-lg font-bold text-gray-800">Tắt Google Authenticator?</h3>
                    <p class="text-sm text-gray-600 mt-1">
                        Nhập mã 6 số hiện tại từ ứng dụng để xác nhận. Sau khi tắt, đăng nhập và giao dịch sẽ dùng mã OTP gửi qua email.
                    </p>
                </div>
                <input type="text" id="totp-disable-code" required maxlength="6" inputmode="numeric"
                    autocomplete="one-time-code" oninput="totpOnlyDigits(this)" placeholder="000000"
                    class="w-full px-4 py-3 border rounded-lg text-center text-xl tracking-widest focus:outline-none focus:ring-2 focus:ring-red-500" />
                <div class="flex gap-3">
                    <button type="button" onclick="closeTotpDisableModal()"
                        class="flex-1 bg-gray-200 text-gray-800 font-semibold py-2 rounded-lg hover:bg-gray-300 transition duration-200">
                        Hủy
                    </button>
                    <button type="submit" id="totp-disable-btn"
                        class="flex-1 bg-red-600 text-white font-semibold py-2 rounded-lg hover:bg-red-700 transition duration-200 disabled:opacity-60">
                        Tắt
                    </button>
                </div>
            </form>
        </div>
    `,

    onShow: loadTotpStatus,
});

/* --- TRẠNG THÁI --- */

async function loadTotpStatus() {
    totpEnabled = null;
    totpLoadFailed = false;
    renderTotpStatus();

    try {
        const data = await api(TOTP_STATUS_URL);
        totpEnabled = data.totp_enabled === true;
    } catch (e) {
        totpLoadFailed = true;
        showError(e.message);
    }
    renderTotpStatus();
}

function renderTotpStatus() {
    const statusEl = document.getElementById('totp-status');
    const actionsEl = document.getElementById('totp-actions');
    if (!statusEl || !actionsEl) return;

    if (totpLoadFailed) {
        statusEl.innerHTML = '<span class="text-gray-500">Không tải được trạng thái bảo mật.</span>';
        actionsEl.innerHTML = `
            <button type="button" onclick="loadTotpStatus()"
                class="bg-gray-800 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-gray-900 transition duration-200">
                <i class="fa-solid fa-arrows-rotate mr-1"></i> Thử lại
            </button>`;
        return;
    }

    if (totpEnabled === null) {
        statusEl.innerHTML = '<span class="skeleton">Đang tải trạng thái</span>';
        actionsEl.innerHTML = '';
        return;
    }

    if (totpEnabled) {
        statusEl.innerHTML = `
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
                <i class="fa-solid fa-circle-check"></i> Đang bật
            </span>`;
        actionsEl.innerHTML = `
            <button type="button" onclick="openTotpDisableModal()"
                class="bg-red-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-red-700 transition duration-200">
                Tắt Google Authenticator
            </button>`;
    } else {
        statusEl.innerHTML = `
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 text-xs font-semibold">
                <i class="fa-solid fa-circle-minus"></i> Chưa bật
            </span>`;
        actionsEl.innerHTML = `
            <button type="button" onclick="openTotpSetupModal()"
                class="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition duration-200">
                Bật Google Authenticator
            </button>`;
    }
}

/* --- HELPER --- */

function totpOnlyDigits(input) {
    input.value = input.value.replace(/\D/g, '');
}

// Lỗi hiện ngay trong modal (alert chung của trang nằm sau lớp phủ nên người dùng không thấy)
function totpModalError(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
}

/* --- BẬT --- */

function openTotpSetupModal() {
    resetTotpSetupModal();
    document.getElementById('totp-setup-modal').classList.remove('hidden');
    document.getElementById('totp-password').focus();
}

function closeTotpSetupModal() {
    document.getElementById('totp-setup-modal').classList.add('hidden');
    resetTotpSetupModal();
}

// Đưa modal về bước nhập mật khẩu và xoá mật khẩu, khoá bí mật, mã QR khỏi trang
function resetTotpSetupModal() {
    totpSecretRaw = '';
    document.getElementById('totp-password').value = '';
    document.getElementById('totp-enable-code').value = '';
    document.getElementById('totp-secret').textContent = '';
    document.getElementById('totp-qr').innerHTML = '';
    document.getElementById('totp-copy-btn').textContent = 'Sao chép';
    totpModalError('totp-setup-error', '');
    document.getElementById('totp-step-password').classList.remove('hidden');
    document.getElementById('totp-step-scan').classList.add('hidden');
}

function renderTotpQr(otpauthUri, secret) {
    const box = document.getElementById('totp-qr');
    box.innerHTML = '';

    // Mã QR được dựng ngay trên trình duyệt, khoá bí mật không gửi tới bên thứ ba
    if (typeof QRCode === 'undefined') {
        const msg = document.createElement('p');
        msg.className = 'text-xs text-gray-500 text-center px-4';
        msg.textContent = 'Không tải được mã QR. Hãy nhập khóa bên dưới vào ứng dụng.';
        box.appendChild(msg);
    } else {
        new QRCode(box, {
            text: otpauthUri,
            width: 192,
            height: 192,
            correctLevel: QRCode.CorrectLevel.M,
        });
    }

    totpSecretRaw = secret;
    document.getElementById('totp-secret').textContent = secret.replace(/(.{4})/g, '$1 ').trim();
}

async function copyTotpSecret() {
    if (!totpSecretRaw) return;
    await copyText(totpSecretRaw);
    const btn = document.getElementById('totp-copy-btn');
    btn.textContent = 'Đã sao chép';
    setTimeout(() => { btn.textContent = 'Sao chép'; }, 1500);
}

async function submitTotpPassword(event) {
    event.preventDefault();
    totpModalError('totp-setup-error', '');

    const password = document.getElementById('totp-password').value;
    if (password.length < 8 || password.length > 15) {
        return totpModalError('totp-setup-error', 'Mật khẩu phải có độ dài từ 8 đến 15 ký tự!');
    }

    setLoading('totp-password-btn', true, 'Đang kiểm tra...');
    try {
        const data = await api(TOTP_SETUP_URL, { method: 'POST', body: { password } });
        document.getElementById('totp-password').value = '';
        renderTotpQr(data.otpauth_uri, data.secret);

        document.getElementById('totp-step-password').classList.add('hidden');
        document.getElementById('totp-step-scan').classList.remove('hidden');
        document.getElementById('totp-enable-code').focus();
    } catch (e) {
        totpModalError('totp-setup-error', e.message);
    } finally {
        setLoading('totp-password-btn', false);
    }
}

async function submitTotpEnable(event) {
    event.preventDefault();
    totpModalError('totp-setup-error', '');

    const codeInput = document.getElementById('totp-enable-code');
    const code = codeInput.value;
    if (!/^\d{6}$/.test(code)) {
        return totpModalError('totp-setup-error', 'Mã xác thực phải gồm 6 chữ số');
    }

    setLoading('totp-enable-btn', true, 'Đang xác nhận...');
    try {
        await api(TOTP_ENABLE_URL, { method: 'POST', body: { code } });
        totpEnabled = true;
        totpLoadFailed = false;
        closeTotpSetupModal();
        renderTotpStatus();
        showSuccess('Đã bật Google Authenticator. Từ lần đăng nhập sau, hãy nhập mã mới hiển thị trong ứng dụng.');
    } catch (e) {
        totpModalError('totp-setup-error', e.message);
        codeInput.value = '';
        codeInput.focus();
    } finally {
        setLoading('totp-enable-btn', false);
    }
}

/* --- TẮT --- */

function openTotpDisableModal() {
    document.getElementById('totp-disable-code').value = '';
    totpModalError('totp-disable-error', '');
    document.getElementById('totp-disable-modal').classList.remove('hidden');
    document.getElementById('totp-disable-code').focus();
}

function closeTotpDisableModal() {
    document.getElementById('totp-disable-modal').classList.add('hidden');
    document.getElementById('totp-disable-code').value = '';
    totpModalError('totp-disable-error', '');
}

async function submitTotpDisable(event) {
    event.preventDefault();
    totpModalError('totp-disable-error', '');

    const codeInput = document.getElementById('totp-disable-code');
    const code = codeInput.value;
    if (!/^\d{6}$/.test(code)) {
        return totpModalError('totp-disable-error', 'Mã xác thực phải gồm 6 chữ số');
    }

    setLoading('totp-disable-btn', true, 'Đang xử lý...');
    try {
        await api(TOTP_DISABLE_URL, { method: 'POST', body: { code } });
        totpEnabled = false;
        totpLoadFailed = false;
        closeTotpDisableModal();
        renderTotpStatus();
        showSuccess('Đã tắt Google Authenticator. Đăng nhập sẽ dùng mã OTP gửi qua email.');
    } catch (e) {
        totpModalError('totp-disable-error', e.message);
        codeInput.value = '';
        codeInput.focus();
    } finally {
        setLoading('totp-disable-btn', false);
    }
}

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const setupModal = document.getElementById('totp-setup-modal');
    const disableModal = document.getElementById('totp-disable-modal');
    if (setupModal && !setupModal.classList.contains('hidden')) closeTotpSetupModal();
    if (disableModal && !disableModal.classList.contains('hidden')) closeTotpDisableModal();
});