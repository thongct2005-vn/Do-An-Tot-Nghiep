/* =====================================================================
 * TAB GIAO DỊCH: nạp tiền / rút tiền / chuyển tiền đến user
 * Luồng: nhập thông tin -> xác nhận -> gửi OTP -> nhập OTP đúng (nhận otp_token)
 *        -> thực hiện giao dịch -> màn hình kết quả
 * ===================================================================== */

const TXN_MODES = {
    topup: { label: 'Nạp tiền', icon: 'fa-circle-plus', min: 1000, bank: true },
    withdraw: { label: 'Rút tiền', icon: 'fa-circle-minus', min: 10000, bank: true },
    transfer: { label: 'Chuyển tiền', icon: 'fa-paper-plane', min: 1000, bank: false },
};
const TXN_MAX = 50000000;
const TXN_RESEND_SECONDS = 60;

const txn = {
    initialized: false,
    mode: 'topup',
    view: 'loading',          // loading | link | link-confirm | form | otp | result
    bankData: null,
    accountId: null,
    accountMenuOpen: false,
    amount: '',               // chỉ chứa chữ số
    phone: '',
    receiver: null,           // { user_id, full_name, phone }
    receiverState: 'idle',    // idle | loading | ok | error
    receiverError: '',
    description: '',
    maskedEmail: '',
    otpMethod: 'email',       // email | totp (theo cài đặt Google Authenticator của merchant)
    idempotencyKey: null,
    resendAt: 0,
    busy: false,
    result: null,
    pendingBank: null,        // ngân hàng đang chờ xác nhận / OTP để liên kết
};

let txnLoadSeq = 0;
let txnLookupSeq = 0;
let txnResendTimer = null;

registerTab('transactions', {
    html: `
                    <section id="txn-root" class="bg-white rounded-2xl shadow p-6">
                        <div class="mb-6">
                            <h2 class="text-lg font-bold">Giao dịch</h2>
                            <p class="text-xs text-gray-500 mt-0.5">Nạp tiền, rút tiền và chuyển tiền đến người dùng. Mỗi giao dịch cần xác thực OTP (qua email hoặc Google Authenticator nếu bạn đã bật).</p>
                        </div>
                        <div id="txn-modes" class="grid grid-cols-3 gap-1 bg-gray-100 p-1 rounded-xl mb-6 max-w-xl">
                            ${Object.entries(TXN_MODES).map(([key, m]) => `
                            <button type="button" data-txn-mode="${key}"
                                class="py-2 rounded-lg text-sm font-medium text-gray-600 flex items-center justify-center gap-2 transition">
                                <i class="fa-solid ${m.icon}"></i> ${m.label}
                            </button>`).join('')}
                        </div>
                        <div id="txn-error" class="hidden mb-4 max-w-xl p-3 bg-red-100 border border-red-400 text-red-700 rounded-lg text-sm"></div>
                        <div id="txn-content" class="max-w-xl"></div>
                    </section>
    `,

    init() {
        const root = document.getElementById('txn-root');
        root.addEventListener('click', txnOnClick);
        root.addEventListener('input', txnOnInput);
        root.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.id === 'txn-otp') {
                e.preventDefault();
                txnVerifyOtp();
            }
        });
    },

    onShow() {
        // Đang nhập dở thì giữ nguyên, còn lại thì tải mới
        if (!txn.initialized || txn.view === 'result') {
            txn.initialized = true;
            txnSetMode(txn.mode);
        }
    },
});

/* --- HELPERS --- */

function txnCfg() {
    return window.APP_CONFIG.production;
}

// Gom việc gọi POST vào một chỗ: api() trả về phần data, ném Error(message) khi lỗi
function txnPost(url, body, headers = {}) {
    // api() tự JSON.stringify body, nên truyền object thẳng (stringify thêm lần nữa sẽ bị server báo lỗi JSON)
    return api(url, {
        method: 'POST',
        headers,
        body: body || {},
    });
}

function txnNewKey() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `txn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function txnFormatAmount(digits) {
    return digits ? Number(digits).toLocaleString('vi-VN') : '';
}

function txnShowError(msg) {
    const el = document.getElementById('txn-error');
    el.textContent = msg;
    el.classList.remove('hidden');
}

function txnClearError() {
    const el = document.getElementById('txn-error');
    if (el) el.classList.add('hidden');
}

function txnSelectedAccount() {
    const list = (txn.bankData && txn.bankData.linked_accounts) || [];
    return list.find((a) => a.id === txn.accountId) || list[0] || null;
}

// Logo tải bằng hydrateLogos() (core.js); lỗi hoặc không có logo thì hiện icon ngân hàng
function txnBankLogo(url, size = 'w-9 h-9') {
    const img = url
        ? `<img data-logo-src="${escapeHtml(url)}" alt="" class="hidden absolute inset-0 w-full h-full object-contain bg-white p-0.5">`
        : '';
    return `<div class="relative ${size} shrink-0 rounded-lg bg-gray-100 border text-gray-400 flex items-center justify-center overflow-hidden">
        <i class="fa-solid fa-building-columns"></i>${img}
    </div>`;
}

function txnMaskAccount(n) {
    const s = String(n || '');
    return s.length > 4 ? `•••• ${s.slice(-4)}` : s;
}

/* --- CHUYỂN CHẾ ĐỘ --- */

function txnUpdateModeButtons() {
    document.querySelectorAll('#txn-modes [data-txn-mode]').forEach((btn) => {
        const active = btn.dataset.txnMode === txn.mode;
        btn.className = `py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition ${
            active ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'
        }`;
    });
}

function txnReset() {
    clearInterval(txnResendTimer);
    txnLookupSeq++;
    Object.assign(txn, {
        accountMenuOpen: false, amount: '', phone: '', receiver: null,
        receiverState: 'idle', receiverError: '', description: '',
        maskedEmail: '', otpMethod: 'email', idempotencyKey: null, resendAt: 0, busy: false, result: null, pendingBank: null,
    });
}

async function txnSetMode(mode) {
    txnReset();
    txn.mode = mode;
    txnClearError();
    txnUpdateModeButtons();

    if (!TXN_MODES[mode].bank) {
        txn.view = 'form';
        txnRender();
        return;
    }
    await txnLoadBank('form');
}

// Tải trạng thái liên kết ngân hàng rồi chọn màn hình phù hợp
async function txnLoadBank(viewWhenLinked) {
    const seq = ++txnLoadSeq;
    txn.view = 'loading';
    txnRender();

    try {
        const data = await api(txnCfg().BANK_STATUS);
        if (seq !== txnLoadSeq) return;
        txn.bankData = data;

        const accounts = data.linked_accounts || [];
        if (!accounts.some((a) => a.id === txn.accountId)) {
            txn.accountId = accounts[0] ? accounts[0].id : null;
        }
        txn.view = accounts.length > 0 ? viewWhenLinked : 'link';
        txnRender();
    } catch (e) {
        if (seq !== txnLoadSeq) return;
        txn.view = 'link';
        txn.bankData = { linked_accounts: [], available_banks: [] };
        txnRender();
        txnShowError(e.message);
    }
}

/* --- RENDER --- */

function txnRender() {
    const box = document.getElementById('txn-content');
    if (!box) return;

    const views = {
        loading: txnLoadingHtml,
        link: txnLinkHtml,
        'link-confirm': txnLinkConfirmHtml,
        form: txnFormHtml,
        otp: txnOtpHtml,
        result: txnResultHtml,
    };
    box.innerHTML = views[txn.view]();
    hydrateLogos(box);

    if (txn.view === 'otp') {
        if (txn.otpMethod !== 'totp') txnStartResendTimer();
        const input = document.getElementById('txn-otp');
        if (input) input.focus();
    }
}

function txnLoadingHtml() {
    return `<div class="py-10 text-center text-gray-500 text-sm"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Đang tải...</div>`;
}

// Màn hình chọn ngân hàng để liên kết (lần đầu hoặc khi bấm "Thêm ngân hàng liên kết")
function txnLinkHtml() {
    const banks = (txn.bankData && txn.bankData.available_banks) || [];
    const hasLinked = ((txn.bankData && txn.bankData.linked_accounts) || []).length > 0;
    const action = TXN_MODES[txn.mode].label.toLowerCase();

    const items = banks.map((b) => `
        <button type="button" data-action="pick-bank" data-bank-id="${escapeHtml(b.id)}" ${b.is_linked || txn.busy ? 'disabled' : ''}
            class="flex items-center gap-3 p-3 border rounded-xl text-left transition ${
                b.is_linked ? 'bg-gray-50 opacity-60 cursor-not-allowed' : 'hover:border-blue-500 hover:bg-blue-50'
            }">
            ${txnBankLogo(b.logo_url, 'w-10 h-10')}
            <div class="min-w-0">
                <p class="text-sm font-semibold text-gray-800 truncate">${escapeHtml(b.name)}</p>
                <p class="text-xs ${b.is_linked ? 'text-green-600' : 'text-gray-500'}">${b.is_linked ? 'Đã liên kết' : escapeHtml(b.code || 'Liên kết ngay')}</p>
            </div>
        </button>`).join('');

    return `
        ${hasLinked ? `
        <button type="button" data-action="back-form" class="text-sm text-blue-600 hover:underline mb-4 flex items-center gap-1">
            <i class="fa-solid fa-arrow-left"></i> Quay lại
        </button>` : ''}
        <h3 class="font-semibold text-gray-800">${hasLinked ? 'Thêm ngân hàng liên kết' : 'Bạn chưa liên kết ngân hàng'}</h3>
        <p class="text-sm text-gray-500 mt-1 mb-4">
            ${hasLinked ? 'Chọn ngân hàng bạn muốn liên kết thêm.' : `Chọn một ngân hàng ví hỗ trợ để liên kết trước khi ${escapeHtml(action)}.`}
        </p>
        ${banks.length
            ? `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${items}</div>`
            : '<p class="py-6 text-center text-sm text-gray-400">Hiện chưa có ngân hàng nào được hỗ trợ.</p>'}
    `;
}

// Khung xác nhận trước khi liên kết ngân hàng
function txnLinkConfirmHtml() {
    const b = txn.pendingBank;
    return `
        <div class="text-center border rounded-2xl p-6">
            <div class="mx-auto mb-3 flex justify-center">${txnBankLogo(b.logo_url, 'w-14 h-14')}</div>
            <h3 class="font-semibold text-gray-800">Liên kết ngân hàng ${escapeHtml(b.name)}?</h3>
            <p class="text-sm text-gray-500 mt-1 mb-5">Bạn cần xác thực OTP (qua email hoặc Google Authenticator nếu bạn đã bật) để hoàn tất liên kết.</p>
            <div class="flex gap-3">
                <button type="button" data-action="cancel-link" ${txn.busy ? 'disabled' : ''}
                    class="flex-1 bg-gray-200 text-gray-800 font-semibold py-2.5 rounded-lg hover:bg-gray-300 transition disabled:opacity-60">Hủy</button>
                <button type="button" data-action="confirm-link" ${txn.busy ? 'disabled' : ''}
                    class="flex-1 bg-blue-600 text-white font-semibold py-2.5 rounded-lg hover:bg-blue-700 transition disabled:opacity-60">
                    ${txn.busy ? '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Đang gửi OTP...' : 'Xác nhận'}
                </button>
            </div>
        </div>`;
}

function txnFormHtml() {
    const mode = TXN_MODES[txn.mode];
    return `
        ${mode.bank ? txnBankPickerHtml() : txnReceiverFieldsHtml()}

        <div class="mb-4">
            <label class="block text-xs font-medium text-gray-600 mb-1">Số tiền (VNĐ)</label>
            <input id="txn-amount" type="text" inputmode="numeric" autocomplete="off" placeholder="0"
                value="${escapeHtml(txnFormatAmount(txn.amount))}"
                class="w-full px-3 py-3 border rounded-lg text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p class="text-xs text-gray-400 mt-1">Tối thiểu ${mode.min.toLocaleString('vi-VN')}đ, tối đa ${TXN_MAX.toLocaleString('vi-VN')}đ</p>
        </div>

        ${txn.mode === 'transfer' ? `
        <div class="mb-4">
            <label class="block text-xs font-medium text-gray-600 mb-1">Nội dung (không bắt buộc)</label>
            <input id="txn-desc" type="text" maxlength="100" placeholder="Chuyển tiền" value="${escapeHtml(txn.description)}"
                class="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>` : ''}

        <button type="button" data-action="submit" ${txn.busy ? 'disabled' : ''}
            class="w-full bg-blue-600 text-white font-semibold py-2.5 rounded-lg hover:bg-blue-700 transition disabled:opacity-60">
            ${txn.busy ? '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Đang kiểm tra...' : 'Xác nhận'}
        </button>

        ${mode.bank ? `
        <button type="button" data-action="add-bank"
            class="w-full mt-3 border border-dashed border-gray-300 text-gray-600 text-sm font-medium py-2.5 rounded-lg hover:border-blue-500 hover:text-blue-600 transition">
            <i class="fa-solid fa-plus mr-1"></i> Thêm ngân hàng liên kết
        </button>` : ''}
    `;
}

function txnBankPickerHtml() {
    const accounts = txn.bankData.linked_accounts || [];
    const acc = txnSelectedAccount();
    const label = txn.mode === 'topup' ? 'Nạp từ ngân hàng' : 'Rút về ngân hàng';

    const menu = txn.accountMenuOpen ? `
        <div class="mt-2 border rounded-xl divide-y overflow-hidden">
            ${accounts.map((a) => `
            <button type="button" data-action="pick-account" data-id="${escapeHtml(a.id)}"
                class="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 ${a.id === txn.accountId ? 'bg-blue-50' : ''}">
                ${txnBankLogo(a.logo_url)}
                <div class="min-w-0 flex-1">
                    <p class="text-sm font-semibold text-gray-800 truncate">${escapeHtml(a.bank_name)}</p>
                    <p class="text-xs text-gray-500">${escapeHtml(txnMaskAccount(a.account_number))} · ${escapeHtml(a.account_holder_name || '')}</p>
                </div>
                ${a.id === txn.accountId ? '<i class="fa-solid fa-check text-blue-600"></i>' : ''}
            </button>`).join('')}
        </div>` : '';

    return `
        <div class="mb-4">
            <label class="block text-xs font-medium text-gray-600 mb-1">${label}</label>
            <button type="button" data-action="toggle-accounts"
                class="w-full flex items-center gap-3 p-3 border rounded-xl text-left hover:border-blue-500 transition">
                ${txnBankLogo(acc.logo_url)}
                <div class="min-w-0 flex-1">
                    <p class="text-sm font-semibold text-gray-800 truncate">${escapeHtml(acc.bank_name)}</p>
                    <p class="text-xs text-gray-500">${escapeHtml(txnMaskAccount(acc.account_number))}</p>
                </div>
                <i class="fa-solid fa-chevron-${txn.accountMenuOpen ? 'up' : 'down'} text-gray-400 text-xs"></i>
            </button>
            ${menu}
        </div>`;
}

function txnReceiverFieldsHtml() {
    return `
        <div class="mb-4">
            <label class="block text-xs font-medium text-gray-600 mb-1">Số điện thoại người nhận</label>
            <input id="txn-phone" type="tel" inputmode="numeric" maxlength="10" autocomplete="off" placeholder="Nhập 10 số"
                value="${escapeHtml(txn.phone)}"
                class="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <div id="txn-receiver" class="mt-2">${txnReceiverInfoHtml()}</div>
        </div>`;
}

function txnReceiverInfoHtml() {
    if (txn.receiverState === 'loading') {
        return '<p class="text-xs text-gray-500"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Đang kiểm tra...</p>';
    }
    if (txn.receiverState === 'error') {
        return `<p class="text-xs text-red-600"><i class="fa-solid fa-circle-exclamation mr-1"></i>${escapeHtml(txn.receiverError)}</p>`;
    }
    if (txn.receiverState === 'ok' && txn.receiver) {
        return `
            <div class="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <div class="w-9 h-9 rounded-full bg-green-100 text-green-700 flex items-center justify-center"><i class="fa-solid fa-user"></i></div>
                <div>
                    <p class="text-sm font-semibold text-gray-800">${escapeHtml(txn.receiver.full_name)}</p>
                    <p class="text-xs text-gray-500">${escapeHtml(txn.receiver.phone || '')}</p>
                </div>
            </div>`;
    }
    return '';
}

function txnOtpHtml() {
    const isTotp = txn.otpMethod === 'totp';
    return `
        <div class="text-center">
            <div class="mx-auto mb-3 w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                <i class="fa-solid ${isTotp ? 'fa-shield-halved' : 'fa-envelope-circle-check'} text-xl"></i>
            </div>
            <h3 class="font-semibold text-gray-800">${isTotp ? 'Xác thực Google Authenticator' : 'Nhập mã OTP'}</h3>
            <p class="text-sm text-gray-500 mt-1 mb-5">${isTotp
                ? 'Mở ứng dụng Google Authenticator và nhập mã 6 số hiện tại.'
                : `Mã gồm 6 số đã được gửi đến <span class="font-medium text-gray-700">${escapeHtml(txn.maskedEmail)}</span>`}</p>
        </div>
        <input id="txn-otp" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="••••••"
            class="w-full px-3 py-3 border rounded-lg text-center text-2xl tracking-[0.5em] font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button type="button" data-action="verify" ${txn.busy ? 'disabled' : ''}
            class="w-full mt-4 bg-blue-600 text-white font-semibold py-2.5 rounded-lg hover:bg-blue-700 transition disabled:opacity-60">
            ${txn.busy ? '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Đang xử lý...' : 'Xác nhận giao dịch'}
        </button>
        <div class="flex items-center justify-between mt-3 text-sm">
            <button type="button" data-action="back-otp" ${txn.busy ? 'disabled' : ''} class="text-gray-500 hover:underline disabled:opacity-60">
                <i class="fa-solid fa-arrow-left mr-1"></i> Quay lại
            </button>
            ${isTotp ? '' : '<button type="button" id="txn-resend-btn" data-action="resend" class="text-blue-600 hover:underline disabled:text-gray-400 disabled:no-underline"></button>'}
        </div>
    `;
}

function txnResultHtml() {
    const r = txn.result;
    const mode = TXN_MODES[r.mode];
    const title = r.link ? 'Liên kết ngân hàng' : mode.label;
    const rows = [];

    if (r.ok && r.link) {
        rows.push(['Ngân hàng', r.bankName || '']);
        rows.push(['Thời gian', formatDate(new Date().toISOString())]);
    } else if (r.ok) {
        const d = r.data || {};
        rows.push(['Loại giao dịch', mode.label]);
        if (r.mode === 'transfer') rows.push(['Người nhận', d.destinationUserName || (txn.receiver && txn.receiver.full_name) || '']);
        else rows.push(['Ngân hàng', d.bankName || r.bankName || '']);
        rows.push(['Số tiền', formatMoney(d.amount != null ? d.amount : r.amount)]);
        if (d.sourceBalanceAfter != null) rows.push(['Số dư sau giao dịch', formatMoney(d.sourceBalanceAfter)]);
        if (d.transactionId) rows.push(['Mã giao dịch', d.transactionId]);
        rows.push(['Thời gian', formatDate(new Date().toISOString())]);
    }

    return `
        <div class="text-center">
            <div class="mx-auto mb-3 w-14 h-14 rounded-full flex items-center justify-center ${r.ok ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}">
                <i class="fa-solid ${r.ok ? 'fa-check' : 'fa-xmark'} text-2xl"></i>
            </div>
            <h3 class="text-lg font-bold ${r.ok ? 'text-green-700' : 'text-red-700'}">${escapeHtml(title)} ${r.ok ? 'thành công' : 'thất bại'}</h3>
            ${r.ok ? '' : `<p class="text-sm text-gray-600 mt-2">${escapeHtml(r.message)}</p>`}
        </div>
        ${rows.length ? `
        <dl class="mt-6 border rounded-xl divide-y text-sm">
            ${rows.map(([k, v]) => `
            <div class="flex justify-between gap-4 px-4 py-3">
                <dt class="text-gray-500">${escapeHtml(k)}</dt>
                <dd class="font-medium text-gray-800 text-right break-all">${escapeHtml(v)}</dd>
            </div>`).join('')}
        </dl>` : ''}
        <div class="flex gap-3 mt-6">
            ${r.link ? '' : `
            <button type="button" data-action="go-history"
                class="flex-1 bg-gray-200 text-gray-800 font-semibold py-2.5 rounded-lg hover:bg-gray-300 transition">Xem lịch sử</button>`}
            <button type="button" data-action="reset"
                class="flex-1 bg-blue-600 text-white font-semibold py-2.5 rounded-lg hover:bg-blue-700 transition">${r.link ? 'Tiếp tục' : r.ok ? 'Giao dịch khác' : 'Thử lại'}</button>
        </div>
    `;
}

/* --- SỰ KIỆN --- */

function txnOnClick(e) {
    const modeBtn = e.target.closest('[data-txn-mode]');
    if (modeBtn) {
        if (txn.busy || modeBtn.dataset.txnMode === txn.mode && txn.view !== 'result') return;
        txnSetMode(modeBtn.dataset.txnMode);
        return;
    }

    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;

    switch (el.dataset.action) {
        case 'toggle-accounts':
            txn.accountMenuOpen = !txn.accountMenuOpen;
            txnRender();
            break;
        case 'pick-account':
            txn.accountId = el.dataset.id;
            txn.accountMenuOpen = false;
            txnRender();
            break;
        case 'add-bank':
            txnClearError();
            txn.view = 'link';
            txnRender();
            break;
        case 'back-form':
            txnClearError();
            txn.view = 'form';
            txnRender();
            break;
        case 'pick-bank':
            txnAskLink(el.dataset.bankId);
            break;
        case 'cancel-link':
            txnClearError();
            txn.pendingBank = null;
            txn.view = 'link';
            txnRender();
            break;
        case 'confirm-link':
            txnStartOtp();
            break;
        case 'submit':
            txnSubmitForm();
            break;
        case 'verify':
            txnVerifyOtp();
            break;
        case 'resend':
            txnResendOtp();
            break;
        case 'back-otp':
            clearInterval(txnResendTimer);
            txnClearError();
            txn.view = txn.pendingBank ? 'link-confirm' : 'form';
            txnRender();
            break;
        case 'reset':
            txnSetMode(txn.result ? txn.result.mode : txn.mode);
            break;
        case 'go-history':
            switchTab('history');
            break;
    }
}

function txnOnInput(e) {
    const t = e.target;

    if (t.id === 'txn-amount') {
        txn.amount = t.value.replace(/\D/g, '').slice(0, 9);
        t.value = txnFormatAmount(txn.amount);
    } else if (t.id === 'txn-desc') {
        txn.description = t.value;
    } else if (t.id === 'txn-otp') {
        t.value = t.value.replace(/\D/g, '').slice(0, 6);
    } else if (t.id === 'txn-phone') {
        t.value = t.value.replace(/\D/g, '').slice(0, 10);
        txn.phone = t.value;
        txnLookupReceiver();
    }
}

/* --- LIÊN KẾT NGÂN HÀNG --- */

// Bấm chọn ngân hàng -> hiện khung xác nhận (chưa liên kết ngay)
function txnAskLink(bankId) {
    const bank = ((txn.bankData && txn.bankData.available_banks) || []).find((b) => String(b.id) === String(bankId));
    if (!bank || bank.is_linked) return;

    txnClearError();
    txn.pendingBank = bank;
    txn.view = 'link-confirm';
    txnRender();
}

/* --- NGƯỜI NHẬN --- */

async function txnLookupReceiver() {
    const seq = ++txnLookupSeq;
    txn.receiver = null;
    txn.receiverError = '';

    if (txn.phone.length !== 10) {
        txn.receiverState = 'idle';
        document.getElementById('txn-receiver').innerHTML = '';
        return;
    }

    txn.receiverState = 'loading';
    document.getElementById('txn-receiver').innerHTML = txnReceiverInfoHtml();

    try {
        const data = await api(`${txnCfg().TRANSACTION_RECEIVER}?phone=${encodeURIComponent(txn.phone)}`);
        if (seq !== txnLookupSeq) return;
        txn.receiver = data;
        txn.receiverState = 'ok';
    } catch (e) {
        if (seq !== txnLookupSeq) return;
        txn.receiverState = 'error';
        txn.receiverError = e.message;
    }

    const box = document.getElementById('txn-receiver');
    if (box) box.innerHTML = txnReceiverInfoHtml();
}

/* --- XÁC NHẬN -> OTP -> GIAO DỊCH --- */

function txnValidate() {
    const mode = TXN_MODES[txn.mode];
    const amount = Number(txn.amount);

    if (mode.bank && !txnSelectedAccount()) return 'Vui lòng chọn ngân hàng liên kết';
    if (txn.mode === 'transfer') {
        if (txn.phone.length !== 10) return 'Vui lòng nhập đủ 10 số điện thoại người nhận';
        if (txn.receiverState === 'loading') return 'Đang kiểm tra người nhận, vui lòng đợi';
        if (txn.receiverState !== 'ok') return txn.receiverError || 'Không tìm thấy người nhận';
    }
    if (!amount) return 'Vui lòng nhập số tiền';
    if (amount < mode.min) return `Số tiền tối thiểu là ${mode.min.toLocaleString('vi-VN')}đ`;
    if (amount > TXN_MAX) return `Số tiền tối đa là ${TXN_MAX.toLocaleString('vi-VN')}đ`;
    return null;
}

async function txnSubmitForm() {
    if (txn.busy) return;
    txnClearError();

    const err = txnValidate();
    if (err) {
        txnShowError(err);
        return;
    }

    // Kiểm tra số dư trước khi gửi OTP (server vẫn kiểm tra lại lúc thực hiện giao dịch)
    txn.busy = true;
    txnRender();
    try {
        const balanceError = await txnCheckBalance();
        txn.busy = false;
        if (balanceError) {
            txnRender();
            txnShowError(balanceError);
            return;
        }
    } catch (e) {
        txn.busy = false;
        txnRender();
        txnShowError(e.message);
        return;
    }

    txnStartOtp();
}

// Nạp: ngân hàng liên kết phải đủ tiền. Rút / chuyển: ví merchant phải đủ tiền.
// Trả về chuỗi lỗi nếu không đủ, null nếu đủ.
async function txnCheckBalance() {
    const P = txnCfg();
    const amount = Number(txn.amount);

    if (txn.mode === 'topup') {
        const url = P.BANK_BALANCE.replace('{id}', encodeURIComponent(txnSelectedAccount().id));
        const data = await api(url);
        if (Number(data.balance) < amount) {
            return `Số dư ngân hàng ${data.bank_name} không đủ (hiện có ${formatMoney(data.balance)})`;
        }
        return null;
    }

    const data = await txnPost(P.WALLET_CHECK_TRANSFER, { amount });
    if (!data.is_eligible) {
        return `Số dư ví không đủ (hiện có ${formatMoney(data.wallet_balance)})`;
    }
    return null;
}

// Gửi OTP rồi chuyển sang màn hình nhập OTP (dùng chung cho giao dịch và liên kết ngân hàng)
async function txnStartOtp() {
    if (txn.busy) return;
    txnClearError();
    txn.busy = true;
    txnRender();

    try {
        const data = await txnPost(txnCfg().TRANSACTION_OTP_SEND);
        txn.maskedEmail = data.masked_email || '';
        txn.otpMethod = data.otp_method === 'totp' ? 'totp' : 'email';
        txn.idempotencyKey = txnNewKey();
        txn.resendAt = Date.now() + TXN_RESEND_SECONDS * 1000;
        txn.busy = false;
        txn.view = 'otp';
        txnRender();
    } catch (e) {
        txn.busy = false;
        txnRender();
        txnShowError(e.message);
    }
}

function txnStartResendTimer() {
    clearInterval(txnResendTimer);
    const tick = () => {
        const btn = document.getElementById('txn-resend-btn');
        if (!btn) {
            clearInterval(txnResendTimer);
            return;
        }
        const left = Math.ceil((txn.resendAt - Date.now()) / 1000);
        btn.disabled = left > 0;
        btn.textContent = left > 0 ? `Gửi lại mã (${left}s)` : 'Gửi lại mã';
    };
    tick();
    txnResendTimer = setInterval(tick, 1000);
}

async function txnResendOtp() {
    txnClearError();
    try {
        const data = await txnPost(txnCfg().TRANSACTION_OTP_RESEND);
        txn.maskedEmail = data.masked_email || txn.maskedEmail;
        txn.resendAt = Date.now() + TXN_RESEND_SECONDS * 1000;
        txnStartResendTimer();
    } catch (e) {
        txnShowError(e.message);
    }
}

async function txnVerifyOtp() {
    if (txn.busy) return;
    txnClearError();

    const input = document.getElementById('txn-otp');
    const code = input ? input.value.trim() : '';
    if (!/^\d{6}$/.test(code)) {
        txnShowError('Vui lòng nhập đủ 6 số OTP');
        return;
    }

    txn.busy = true;
    txnRender();
    document.getElementById('txn-otp').value = code;

    // 1) OTP đúng -> nhận otp_token. Sai OTP thì ở lại màn hình OTP để nhập lại
    let otpToken;
    try {
        const data = await txnPost(txnCfg().TRANSACTION_OTP_VERIFY, {
            otp: code,
            idempotency_key: txn.idempotencyKey,
            ...txnOtpBinding(),
        });
        otpToken = data.otp_token;
    } catch (e) {
        txn.busy = false;
        txnRender();
        txnShowError(e.message);
        return;
    }

    // 2) Có otp_token mới được liên kết ngân hàng / thực hiện giao dịch
    const mode = txn.mode;
    if (txn.pendingBank) {
        const bank = txn.pendingBank;
        try {
            await txnPost(txnCfg().BANK_LINK, { bank_id: bank.id }, {
                'X-Otp-Token': otpToken,
                'Idempotency-Key': txn.idempotencyKey,
            });
            txn.result = { ok: true, link: true, mode, bankName: bank.name };
        } catch (e) {
            txn.result = { ok: false, link: true, mode, message: e.message };
        }
        txn.pendingBank = null;
    } else {
        const amount = Number(txn.amount);
        const acc = txnSelectedAccount();
        try {
            const data = await txnExecute(mode, amount, otpToken);
            txn.result = { ok: true, mode, amount, data, bankName: acc && acc.bank_name };
        } catch (e) {
            txn.result = { ok: false, mode, amount, message: e.message };
        }
    }

    clearInterval(txnResendTimer);
    txn.busy = false;
    txn.view = 'result';
    txnRender();
}

// Nội dung giao dịch mà OTP token phải "ký" vào (server so lại với body của request thực hiện).
// Tên action và tên trường phải trùng với PIN_ACTIONS ở server (utils/pinBinding.js).
function txnOtpBinding() {
    if (txn.pendingBank) {
        return { action: 'BANK_LINK', params: { bank_id: txn.pendingBank.id } };
    }
    const amount = Number(txn.amount);
    if (txn.mode === 'transfer') {
        return {
            action: 'TRANSFER',
            params: { destination_user_id: txn.receiver.user_id, amount },
        };
    }
    return {
        action: txn.mode === 'topup' ? 'TOPUP' : 'WITHDRAW',
        params: { linked_bank_account_id: txnSelectedAccount().id, amount },
    };
}

function txnExecute(mode, amount, otpToken) {
    const P = txnCfg();
    const headers = { 'Idempotency-Key': txn.idempotencyKey, 'X-Otp-Token': otpToken };

    if (mode === 'transfer') {
        return txnPost(P.TRANSACTION_TRANSFER, {
            destination_user_id: txn.receiver.user_id,
            amount,
            description: txn.description.trim() || 'Chuyển tiền',
        }, headers);
    }

    const url = mode === 'topup' ? P.TRANSACTION_TOPUP : P.TRANSACTION_WITHDRAW;
    return txnPost(url, { linked_bank_account_id: txnSelectedAccount().id, amount }, headers);
}