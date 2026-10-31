registerTab('stats', {
    html: `
        <section class="bg-white rounded-2xl shadow p-6">
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                    <h2 class="text-lg font-bold">Thống kê doanh thu</h2>
                    <p class="text-xs text-gray-500 mt-0.5">Tổng hợp doanh thu bán hàng từ giao dịch thanh toán QR thành công.</p>
                </div>
                <button type="button" onclick="resetStatsFilters()" class="text-xs text-blue-600 hover:underline flex items-center gap-1">
                    <i class="fa-solid fa-arrows-rotate"></i> Làm mới bộ lọc
                </button>
            </div>

            <!-- Bộ lọc thời gian -->
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                <div>
                    <label class="block text-xs font-medium text-gray-600 mb-1">Từ ngày</label>
                    <input type="date" id="stats-start-date" onchange="applyStatsFilter()"
                        class="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                    <label class="block text-xs font-medium text-gray-600 mb-1">Đến ngày</label>
                    <input type="date" id="stats-end-date" onchange="applyStatsFilter()"
                        class="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div class="flex items-end">
                    <button type="button" onclick="applyStatsFilter()" class="w-full bg-blue-600 text-white text-sm font-semibold py-2 rounded-lg hover:bg-blue-700 transition">
                        Áp dụng lọc
                    </button>
                </div>
            </div>

            <!-- Thẻ tổng hợp số liệu (Cards) -->
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div class="p-4 rounded-xl border border-gray-100 bg-blue-50/50">
                    <p class="text-xs text-gray-500 font-medium">Tổng doanh thu</p>
                    <p id="stats-total-revenue" class="text-2xl font-bold text-blue-600 mt-1">0 đ</p>
                </div>
                <div class="p-4 rounded-xl border border-gray-100 bg-green-50/50">
                    <p class="text-xs text-gray-500 font-medium">Tổng đơn hàng thành công</p>
                    <p id="stats-total-orders" class="text-2xl font-bold text-green-600 mt-1">0</p>
                </div>
                <div class="p-4 rounded-xl border border-gray-100 bg-purple-50/50">
                    <p class="text-xs text-gray-500 font-medium">Giá trị trung bình / đơn</p>
                    <p id="stats-avg-order" class="text-2xl font-bold text-purple-600 mt-1">0 đ</p>
                </div>
            </div>

            <!-- Bảng chi tiết doanh thu theo ngày -->
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left">
                    <thead class="text-xs text-gray-500 uppercase bg-gray-50 border-b">
                        <tr>
                            <th class="py-3 px-4 font-semibold">Ngày</th>
                            <th class="py-3 px-4 font-semibold text-center">Số lượng đơn</th>
                            <th class="py-3 px-4 font-semibold text-right">Doanh thu</th>
                        </tr>
                    </thead>
                    <tbody id="stats-table-body" class="divide-y">
                        <!-- JS render dữ liệu vào đây -->
                    </tbody>
                </table>
            </div>

            <!-- Trạng thái Load / Trống -->
            <div id="stats-loading" class="hidden py-6 text-center text-gray-500 text-sm">
                <i class="fa-solid fa-spinner fa-spin mr-2"></i> Đang tải số liệu thống kê...
            </div>
            <div id="stats-empty" class="hidden py-8 text-center text-gray-400 text-sm">
                Không có dữ liệu doanh thu trong khoảng thời gian này.
            </div>
        </section>
    `,

    init() {
        setupStatsDateLimits();
    },

    onShow() {
        loadMerchantStats();
    },
});

/* --- XỬ LÝ LOGIC THỐNG KÊ --- */

const TRANSACTION_STATS_URL = window.APP_CONFIG.production.TRANSACTION_STATS; // Điều chỉnh lại path API theo prefix của bạn nếu có

function setupStatsDateLimits() {
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(today.getFullYear() - 1);

    const pad = (n) => String(n).padStart(2, '0');
    const toInputStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    ['stats-start-date', 'stats-end-date'].forEach((id) => {
        const input = document.getElementById(id);
        if (input) {
            input.min = toInputStr(oneYearAgo);
            input.max = toInputStr(today);
        }
    });
}

function applyStatsFilter() {
    const startDate = document.getElementById('stats-start-date').value;
    const endDate = document.getElementById('stats-end-date').value;

    if (startDate && endDate && startDate > endDate) {
        if (typeof showError === 'function') {
            showError('Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc');
        } else {
            alert('Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc');
        }
        return;
    }

    loadMerchantStats();
}

function resetStatsFilters() {
    document.getElementById('stats-start-date').value = '';
    document.getElementById('stats-end-date').value = '';
    loadMerchantStats();
}

async function loadMerchantStats() {
    const loadingEl = document.getElementById('stats-loading');
    const emptyEl = document.getElementById('stats-empty');
    const tbodyEl = document.getElementById('stats-table-body');

    if (loadingEl) loadingEl.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');
    if (tbodyEl) tbodyEl.innerHTML = '';

    const startDate = document.getElementById('stats-start-date').value;
    const endDate = document.getElementById('stats-end-date').value;

    const query = new URLSearchParams();
    if (startDate) query.append('start_date', startDate);
    if (endDate) query.append('end_date', endDate);

    try {
        const url = query.toString() ? `${TRANSACTION_STATS_URL}?${query.toString()}` : TRANSACTION_STATS_URL;
        const res = await api(url);
        
        // Gán số liệu tổng quan lên các thẻ card
        document.getElementById('stats-total-revenue').innerText = formatMoney(res.total_revenue || 0);
        document.getElementById('stats-total-orders').innerText = res.total_orders || 0;
        document.getElementById('stats-avg-order').innerText = formatMoney(res.avg_order_value || 0);

        const list = res.daily_stats || [];
        renderStatsRows(list);

        if (list.length === 0 && emptyEl) {
            emptyEl.classList.remove('hidden');
        }
    } catch (e) {
        if (typeof showError === 'function') {
            showError(e.message);
        } else {
            console.error(e);
        }
    } finally {
        if (loadingEl) loadingEl.classList.add('hidden');
    }
}

function renderStatsRows(list) {
    const tbody = document.getElementById('stats-table-body');
    if (!tbody) return;

    list.forEach((item) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 transition';

        tr.innerHTML = `
            <td class="py-3 px-4 text-xs font-medium text-gray-700 whitespace-nowrap">${escapeHtml(item.date)}</td>
            <td class="py-3 px-4 text-center whitespace-nowrap text-gray-600">${escapeHtml(item.order_count)}</td>
            <td class="py-3 px-4 text-right font-bold text-green-600 whitespace-nowrap">+${escapeHtml(formatMoney(item.revenue))}</td>
        `;
        tbody.appendChild(tr);
    });
}