registerTab('product-stats', {
    html: `
        <section class="bg-white rounded-2xl shadow p-6">
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                    <h2 class="text-lg font-bold">Thống kê sản phẩm bán chạy</h2>
                    <p class="text-xs text-gray-500 mt-0.5">Tổng hợp số lượng bán và doanh thu của từng sản phẩm từ đơn hàng thành công.</p>
                </div>
                <button type="button" onclick="resetProductStatsFilters()" class="text-xs text-blue-600 hover:underline flex items-center gap-1">
                    <i class="fa-solid fa-arrows-rotate"></i> Làm mới bộ lọc
                </button>
            </div>

            <!-- Bộ lọc tìm kiếm & thời gian -->
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div>
                    <label class="block text-xs font-medium text-gray-600 mb-1">Tên sản phẩm</label>
                    <input type="text" id="prod-keyword" placeholder="Nhập tên sản phẩm..." oninput="debounceProductFilter()"
                        class="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                    <label class="block text-xs font-medium text-gray-600 mb-1">Từ ngày</label>
                    <input type="date" id="prod-start-date" onchange="applyProductStatsFilter()"
                        class="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                    <label class="block text-xs font-medium text-gray-600 mb-1">Đến ngày</label>
                    <input type="date" id="prod-end-date" onchange="applyProductStatsFilter()"
                        class="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                    <label class="block text-xs font-medium text-gray-600 mb-1">Sắp xếp số lượng</label>
                    <select id="prod-sort" onchange="applyProductStatsFilter()" class="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="DESC">Giảm dần</option>
                        <option value="ASC">Tăng dần</option>
                    </select>
                </div>
            </div>

            <!-- Bảng hiển thị danh sách sản phẩm -->
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left">
                    <thead class="text-xs text-gray-500 uppercase bg-gray-50 border-b">
                        <tr>
                            <th class="py-3 px-4 font-semibold">Mã sản phẩm</th>
                            <th class="py-3 px-4 font-semibold">Tên sản phẩm</th>
                            <th class="py-3 px-4 font-semibold text-center">Số lượng bán</th>
                            <th class="py-3 px-4 font-semibold text-right">Tổng doanh thu</th>
                        </tr>
                    </thead>
                    <tbody id="product-stats-table-body" class="divide-y">
                        <!-- Dữ liệu JS render vào đây -->
                    </tbody>
                </table>
            </div>

            <!-- Trạng thái Load / Trống / Load more -->
            <div id="product-stats-loading" class="hidden py-6 text-center text-gray-500 text-sm">
                <i class="fa-solid fa-spinner fa-spin mr-2"></i> Đang tải thống kê sản phẩm...
            </div>
            <div id="product-stats-empty" class="hidden py-8 text-center text-gray-400 text-sm">
                Không có dữ liệu sản phẩm trong khoảng thời gian này.
            </div>
            <div id="product-stats-load-more-wrap" class="hidden pt-4 text-center">
                <button type="button" id="product-stats-load-more-btn" onclick="loadMoreProductStats()"
                    class="px-4 py-2 text-sm font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition disabled:opacity-50 disabled:cursor-not-allowed">
                    <i class="fa-solid fa-angles-down mr-1"></i> Tải thêm
                </button>
            </div>
        </section>
    `,

    init() {
        setupProductDateLimits();
    },

    onShow() {
        loadProductStats(true);
    },
});

/* --- XỬ LÝ LOGIC --- */

const PRODUCT_STATS_URL = window.APP_CONFIG.production.PRODUCT_STATS;
const PRODUCT_STATS_LIMIT = 10;

let productDebounceTimer = null;
let productStatsNextCursor = null;
let productStatsLoading = false;

function setupProductDateLimits() {
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(today.getFullYear() - 1);

    const pad = (n) => String(n).padStart(2, '0');
    const toInputStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    ['prod-start-date', 'prod-end-date'].forEach((id) => {
        const input = document.getElementById(id);
        if (input) {
            input.min = toInputStr(oneYearAgo);
            input.max = toInputStr(today);
        }
    });
}

function debounceProductFilter() {
    clearTimeout(productDebounceTimer);
    productDebounceTimer = setTimeout(() => applyProductStatsFilter(), 500);
}

function applyProductStatsFilter() {
    const startDate = document.getElementById('prod-start-date').value;
    const endDate = document.getElementById('prod-end-date').value;

    if (startDate && endDate && startDate > endDate) {
        if (typeof showError === 'function') {
            showError('Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc');
        } else {
            alert('Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc');
        }
        return;
    }

    loadProductStats(true);
}

function resetProductStatsFilters() {
    document.getElementById('prod-keyword').value = '';
    document.getElementById('prod-start-date').value = '';
    document.getElementById('prod-end-date').value = '';
    document.getElementById('prod-sort').value = 'DESC';
    loadProductStats(true);
}

function buildProductStatsQuery(cursor) {
    const keyword = document.getElementById('prod-keyword').value.trim();
    const startDate = document.getElementById('prod-start-date').value;
    const endDate = document.getElementById('prod-end-date').value;
    const sortByQuantity = document.getElementById('prod-sort').value;

    const query = new URLSearchParams({
        sort_by_quantity: sortByQuantity,
        limit: String(PRODUCT_STATS_LIMIT),
    });
    if (keyword) query.append('keyword', keyword);
    if (startDate) query.append('start_date', startDate);
    if (endDate) query.append('end_date', endDate);
    if (cursor) query.append('cursor', cursor);

    return query;
}

/**
 * @param {boolean} reset - true: tải lại từ đầu (đổi filter), false: tải trang tiếp theo
 */
async function loadProductStats(reset = true) {
    if (productStatsLoading) return;

    const loadingEl = document.getElementById('product-stats-loading');
    const emptyEl = document.getElementById('product-stats-empty');
    const tbodyEl = document.getElementById('product-stats-table-body');
    const loadMoreWrap = document.getElementById('product-stats-load-more-wrap');
    const loadMoreBtn = document.getElementById('product-stats-load-more-btn');

    if (reset) {
        productStatsNextCursor = null;
        if (tbodyEl) tbodyEl.innerHTML = '';
        if (emptyEl) emptyEl.classList.add('hidden');
        if (loadMoreWrap) loadMoreWrap.classList.add('hidden');
        if (loadingEl) loadingEl.classList.remove('hidden');
    } else {
        if (loadMoreBtn) {
            loadMoreBtn.disabled = true;
            loadMoreBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Đang tải...';
        }
    }

    productStatsLoading = true;

    const cursor = reset ? null : productStatsNextCursor;
    const query = buildProductStatsQuery(cursor);

    try {
        const url = `${PRODUCT_STATS_URL}?${query.toString()}`;
        const res = await api(url);

        const products = res.products || [];
        productStatsNextCursor = res.next_cursor || null;

        if (reset) {
            renderProductStatsRows(products, true);
        } else {
            renderProductStatsRows(products, false);
        }

        const totalRows = tbodyEl ? tbodyEl.children.length : 0;
        if (totalRows === 0 && emptyEl) {
            emptyEl.classList.remove('hidden');
        }

        if (loadMoreWrap) {
            if (productStatsNextCursor) {
                loadMoreWrap.classList.remove('hidden');
            } else {
                loadMoreWrap.classList.add('hidden');
            }
        }
    } catch (e) {
        if (typeof showError === 'function') {
            showError(e.message);
        } else {
            console.error(e);
        }
    } finally {
        productStatsLoading = false;
        if (loadingEl) loadingEl.classList.add('hidden');
        if (loadMoreBtn) {
            loadMoreBtn.disabled = false;
            loadMoreBtn.innerHTML = '<i class="fa-solid fa-angles-down mr-1"></i> Tải thêm';
        }
    }
}

function loadMoreProductStats() {
    if (!productStatsNextCursor || productStatsLoading) return;
    loadProductStats(false);
}

/**
 * @param {Array} products
 * @param {boolean} replace - true: thay toàn bộ bảng, false: append
 */
function renderProductStatsRows(products, replace = true) {
    const tbody = document.getElementById('product-stats-table-body');
    if (!tbody) return;

    if (replace) {
        tbody.innerHTML = '';
    }

    products.forEach((p) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 transition';

        const qty = Number(p.total_quantity_sold) || 0;
        const revenue = Number(p.total_revenue) || 0;

        tr.innerHTML = `
            <td class="py-3 px-4 text-xs font-mono text-gray-600 whitespace-nowrap">${escapeHtml(String(p.product_id ?? ''))}</td>
            <td class="py-3 px-4 font-medium text-gray-800">${escapeHtml(String(p.product_name ?? ''))}</td>
            <td class="py-3 px-4 text-center font-bold text-blue-600 whitespace-nowrap">${escapeHtml(qty.toLocaleString('vi-VN'))}</td>
            <td class="py-3 px-4 text-right font-bold text-green-600 whitespace-nowrap">+${escapeHtml(formatMoney(revenue))}</td>
        `;
        tbody.appendChild(tr);
    });
}