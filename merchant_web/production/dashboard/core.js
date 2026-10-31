/* =====================================================================
 * dashboard/core.js
 * Phần dùng chung: cấu hình URL, gọi API (tự refresh token), helper,
 * đăng ký tab (registerTab) và chuyển tab (switchTab).
 * Mỗi tab nằm trong file riêng: overview.js, history.js, guide.js
 * ===================================================================== */

// Lấy đường dẫn API từ file config.js
const PROD_CFG = APP_CONFIG.production;

const REFRESH_TOKEN_URL = PROD_CFG.REFRESH_TOKEN;
const LOGOUT_URL = PROD_CFG.LOGOUT;

const INFO_URL = PROD_CFG.INFO;
const CALLBACK_URL = PROD_CFG.CALLBACK;
const RESET_API_KEY_URL = PROD_CFG.RESET_API_KEY;
const RESET_SECRET_KEY_URL = PROD_CFG.RESET_SECRET_KEY;

const TRANSACTION_HISTORY_URL = PROD_CFG.TRANSACTION_HISTORY;
const TRANSACTION_SUMMARY_URL = PROD_CFG.TRANSACTION_SUMMARY;

const GATEWAY_BASE = PROD_CFG.API_ROOT;
const EP_CREATE_PAYMENT = PROD_CFG.EP_CREATE_PAYMENT;
const EP_PAYMENT_STATUS = PROD_CFG.EP_PAYMENT_STATUS;


let alertTimeout = null;

function showError(msg) {
    clearAlerts();
    const el = document.getElementById('error-alert');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');

    alertTimeout = setTimeout(() => {
        el.classList.add('hidden');
    }, 5000);
}

function showSuccess(msg) {
    clearAlerts();
    const el = document.getElementById('success-alert');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');

    alertTimeout = setTimeout(() => {
        el.classList.add('hidden');
    }, 5000);
}

function clearAlerts() {
    if (alertTimeout) {
        clearTimeout(alertTimeout);
        alertTimeout = null;
    }
    const errEl = document.getElementById('error-alert');
    const succEl = document.getElementById('success-alert');
    if (errEl) errEl.classList.add('hidden');
    if (succEl) succEl.classList.add('hidden');
}

/* --- PHIÊN ĐĂNG NHẬP & GỌI API --- */

// access_token chỉ giữ trong bộ nhớ của trang (tải lại trang thì lấy lại bằng cookie refresh token).
// refresh_token nằm trong cookie httpOnly do server đặt, JavaScript không đọc được.
let memoryAccessToken = null;

function clearSession() {
    memoryAccessToken = null;
    localStorage.removeItem('user_phone');
    // Dọn token của phiên bản cũ (trước đây lưu trong localStorage)
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
}

function goLogin() {
    clearSession();
    window.location.href = 'login.html';
}

let refreshPromise = null;
function refreshAccessToken() {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
        let res;
        try {
            // Cookie refresh token tự được trình duyệt đính kèm nhờ credentials: 'include'
            res = await fetch(REFRESH_TOKEN_URL, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'ngrok-skip-browser-warning': 'true',
                },
                body: '{}',
            });
        } catch (_) {
            throw new Error('Không kết nối được tới server');
        }

        const json = await res.json().catch(() => ({}));
        const token = json.data && json.data.token;
        if (!res.ok || !token || !token.access_token) {
            throw new Error(json.message || 'Không làm mới được phiên đăng nhập');
        }
        memoryAccessToken = token.access_token;
    })().finally(() => { refreshPromise = null; });

    return refreshPromise;
}

async function api(url, { method = 'GET', body, headers: extraHeaders = {} } = {}, retried = false) {
    // extraHeaders: header bổ sung theo từng request (vd: Idempotency-Key)
    const headers = {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
        ...extraHeaders,
        'Authorization': 'Bearer ' + memoryAccessToken,
    };

    let res;
    try {
        res = await fetch(url, {
            method,
            credentials: 'include',
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });
    } catch (_) {
        throw new Error('Không kết nối được tới server');
    }

    const json = await res.json().catch(() => ({}));
    if (res.status === 401) {
        if (!retried) {
            try {
                await refreshAccessToken();
            } catch (_) {
                goLogin();
                throw new Error('Phiên đăng nhập đã hết hạn');
            }
            return api(url, { method, body, headers: extraHeaders }, true);
        }
        goLogin();
        throw new Error('Phiên đăng nhập đã hết hạn');
    }
    if (!res.ok) throw new Error(json.message || `Có lỗi xảy ra (HTTP ${res.status})`);
    return json.data ?? {};
}

/* --- HELPER DÙNG CHUNG --- */

function setLoading(btnId, loading, text = 'Đang xử lý...') {
    const btn = document.getElementById(btnId);
    if (loading) {
        if (btn.dataset.loading) return;
        btn.dataset.loading = '1';
        btn.dataset.html = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>' + text;
        btn.disabled = true;
    } else {
        if (!btn.dataset.loading) return;
        delete btn.dataset.loading;
        btn.innerHTML = btn.dataset.html;
        btn.disabled = false;
    }
}

function formatMoney(value) {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' })
        .format(Number(value) || 0);
}

function formatDate(dateString) {
    if (!dateString) return '---';
    const date = new Date(dateString);
    return date.toLocaleString('vi-VN', {
        hour: '2-digit', minute: '2-digit',
        day: '2-digit', month: '2-digit', year: 'numeric'
    });
}

// Escape dữ liệu từ server trước khi chèn vào innerHTML (tránh XSS)
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
    }
}

/* --- LOGO NGÂN HÀNG ---
 * <img src> không gửi được header, nên ảnh qua ngrok bị trang cảnh báo chặn.
 * Dùng: <img data-logo-src="URL" class="hidden ..."> rồi gọi hydrateLogos(vùng_chứa)
 * sau khi chèn HTML. Tải lỗi thì ảnh bị gỡ để lộ icon dự phòng bên dưới. */
const logoCache = new Map();

function hydrateLogos(root = document) {
    root.querySelectorAll('img[data-logo-src]').forEach(async (img) => {
        const url = img.dataset.logoSrc;
        try {
            if (!logoCache.has(url)) {
                logoCache.set(url, fetch(url, { headers: { 'ngrok-skip-browser-warning': 'true' } })
                    .then((r) => {
                        if (!r.ok) throw new Error('logo');
                        return r.blob();
                    })
                    .then((blob) => URL.createObjectURL(blob)));
            }
            const blobUrl = await logoCache.get(url);
            if (img.isConnected) {
                img.src = blobUrl;
                img.classList.remove('hidden');
            }
        } catch (_) {
            logoCache.delete(url);
            img.remove();
        }
    });
}

/* --- ĐĂNG XUẤT --- */

function openLogoutModal() {
    document.getElementById('logout-modal').classList.remove('hidden');
}

function closeLogoutModal() {
    document.getElementById('logout-modal').classList.add('hidden');
}

async function handleLogout() {
    setLoading('confirm-logout-btn', true, 'Đang đăng xuất...');
    try {
        await api(LOGOUT_URL, { method: 'POST' });
    } catch (_) {}
    goLogin();
}

/* --- ĐĂNG KÝ & CHUYỂN TAB ---
 * registerTab(name, { html, modals?, init?, onShow? })
 *   html   : nội dung panel của tab
 *   modals : (tuỳ chọn) modal/drawer của tab, được gắn vào #modal-root
 *   init   : (tuỳ chọn) chạy 1 lần sau khi tất cả tab đã được dựng
 *   onShow : (tuỳ chọn) chạy mỗi lần chuyển sang tab
 */
const TABS = {};
const TAB_ORDER = [];

function registerTab(name, definition) {
    TABS[name] = definition;
    TAB_ORDER.push(name);
}

function mountTabs() {
    const container = document.getElementById('tab-container');
    const modalRoot = document.getElementById('modal-root');

    TAB_ORDER.forEach((name) => {
        const panel = document.createElement('div');
        panel.id = 'panel-' + name;
        panel.className = 'hidden space-y-6';
        panel.innerHTML = TABS[name].html;
        container.appendChild(panel);

        if (TABS[name].modals) modalRoot.insertAdjacentHTML('beforeend', TABS[name].modals);
    });

    TAB_ORDER.forEach((name) => { if (TABS[name].init) TABS[name].init(); });
}

function switchTab(name) {
    if (!TABS[name]) name = 'overview';

    TAB_ORDER.forEach((t) => {
        document.getElementById('panel-' + t).classList.toggle('hidden', t !== name);
        document.getElementById('tab-' + t).classList.toggle('active', t === name);
    });
    document.getElementById('guide-toc').classList.toggle('hidden', name !== 'guide');
    clearAlerts();
    window.scrollTo({ top: 0 });
    history.replaceState(null, '', '#' + name);

    if (TABS[name].onShow) TABS[name].onShow();
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLogoutModal();
});

window.addEventListener('load', async () => {
    // Chưa có access token trong bộ nhớ: lấy bằng cookie refresh token, không được thì về trang đăng nhập
    try {
        await refreshAccessToken();
    } catch (_) {
        return goLogin();
    }

    mountTabs();

    const h = location.hash;
    if (h === '#history') {
        switchTab('history');
    } else if (h === '#transactions') {
        switchTab('transactions');
    } else if (h === '#security') {
        switchTab('security');
    } else if (h === '#guide' || h.startsWith('#g-')) {
        switchTab('guide');
    } else {
        switchTab('overview');
    }
    if (h.startsWith('#g-')) { const t = document.querySelector(h); if (t) t.scrollIntoView(); }
});