registerTab("history", {
  html: `
                    <section class="bg-white rounded-2xl shadow p-6">
                        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                            <div>
                                <h2 class="text-lg font-bold">Lịch sử giao dịch</h2>
                                <p class="text-xs text-gray-500 mt-0.5">Nhấn vào một giao dịch để xem chi tiết.</p>
                            </div>
                            <button type="button" onclick="resetHistoryFilters()" class="text-xs text-blue-600 hover:underline flex items-center gap-1">
                                <i class="fa-solid fa-arrows-rotate"></i> Làm mới bộ lọc
                            </button>
                        </div>

                        <!-- Bộ lọc tìm kiếm -->
                        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                            <div>
                                <label class="block text-xs font-medium text-gray-600 mb-1">Loại giao dịch</label>
                                <select id="filter-type" onchange="applyHistoryFilter()" class="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
                                    <option value="">Tất cả loại</option>
                                    <option value="PAYMENT">Thanh toán QR (PAYMENT)</option>
                                    <option value="TRANSFER">Chuyển tiền (TRANSFER)</option>
                                    <option value="TOPUP">Nạp tiền (TOPUP)</option>
                                    <option value="WITHDRAW">Rút tiền (WITHDRAW)</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-xs font-medium text-gray-600 mb-1">Từ khóa liên quan</label>
                                <input type="text" id="filter-keyword" placeholder="Nhập từ khóa..." oninput="debounceApplyFilter()"
                                    class="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            </div>
                            <div>
                                <label class="block text-xs font-medium text-gray-600 mb-1">Từ ngày</label>
                                <input type="date" id="filter-start-date" onchange="applyHistoryFilter()"
                                    class="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            </div>
                            <div>
                                <label class="block text-xs font-medium text-gray-600 mb-1">Đến ngày</label>
                                <input type="date" id="filter-end-date" onchange="applyHistoryFilter()"
                                    class="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            </div>
                        </div>

                        <!-- Danh sách Lịch sử -->
                        <div class="overflow-x-auto">
                            <table class="w-full text-sm text-left">
                                <thead class="text-xs text-gray-500 uppercase bg-gray-50 border-b">
                                    <tr>
                                        <th class="py-3 px-4 font-semibold">Thời gian</th>
                                        <th class="py-3 px-4 font-semibold">Loại</th>
                                        <th class="py-3 px-4 font-semibold">Đối tác / Mô tả</th>
                                        <th class="py-3 px-4 font-semibold text-right">Số tiền</th>
                                        <th class="py-3 px-4 font-semibold text-center">Trạng thái</th>
                                    </tr>
                                </thead>
                                <tbody id="history-table-body" class="divide-y">
                                    <!-- JS sẽ render dòng giao dịch vào đây -->
                                </tbody>
                            </table>
                        </div>

                        <!-- Trạng thái Load / Kết thúc -->
                        <div id="history-loading" class="hidden py-6 text-center text-gray-500 text-sm">
                            <i class="fa-solid fa-spinner fa-spin mr-2"></i> Đang tải danh sách giao dịch...
                        </div>
                        <div id="history-empty" class="hidden py-8 text-center text-gray-400 text-sm">
                            Không tìm thấy giao dịch nào.
                        </div>
                        <div id="history-end" class="hidden py-4 text-center text-xs text-gray-400">
                            Đã hiển thị tất cả giao dịch.
                        </div>
                    </section>
    `,

  // Drawer chi tiết giao dịch (trượt từ bên phải, full màn hình trên điện thoại)
  modals: `
    <div id="tx-detail-overlay" class="hidden fixed inset-0 z-50 bg-black/40 opacity-0 transition-opacity duration-200"
        onclick="closeTransactionDetail()"></div>
    <aside id="tx-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="tx-detail-title"
        class="hidden fixed inset-y-0 right-0 z-50 w-full sm:max-w-md bg-white shadow-2xl flex flex-col translate-x-full transition-transform duration-200">
        <div class="flex items-center justify-between px-5 py-4 border-b">
            <h3 id="tx-detail-title" class="text-lg font-bold text-gray-800">Chi tiết giao dịch</h3>
            <button type="button" id="tx-detail-close" onclick="closeTransactionDetail()" aria-label="Đóng"
                class="w-9 h-9 rounded-lg text-gray-500 hover:bg-gray-100 flex items-center justify-center transition">
                <i class="fa-solid fa-xmark text-lg"></i>
            </button>
        </div>
        <div id="tx-detail-body" class="flex-1 overflow-y-auto p-5 space-y-6"></div>
    </aside>
    `,

  init() {
    const tbody = document.getElementById("history-table-body");
    const openFromEvent = (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (tr) openTransactionDetail(tr.dataset.id);
      return tr;
    };
    tbody.addEventListener("click", openFromEvent);
    tbody.addEventListener("keydown", (e) => {
      if (
        (e.key === "Enter" || e.key === " ") &&
        e.target.closest("tr[data-id]")
      ) {
        e.preventDefault();
        openFromEvent(e);
      }
    });

    // Nút copy / thử lại trong drawer (dùng data-attribute để không chèn dữ liệu vào onclick)
    document
      .getElementById("tx-detail-body")
      .addEventListener("click", async (e) => {
        const copyBtn = e.target.closest("[data-copy]");
        if (copyBtn) {
          await copyText(copyBtn.dataset.copy);
          const icon = copyBtn.querySelector("i");
          icon.className = "fa-solid fa-check text-green-600";
          setTimeout(() => {
            icon.className = "fa-regular fa-copy";
          }, 1500);
          return;
        }
        const retryBtn = e.target.closest("[data-retry-id]");
        if (retryBtn) openTransactionDetail(retryBtn.dataset.retryId);
      });
  },

  onShow() {
    setupMinMaxDateFilters();
    applyHistoryFilter();
  },
});

/* --- TRẠNG THÁI DANH SÁCH --- */

let historyCursor = null;
let historyHasMore = true;
let historyLoading = false;
let historyRequestSeq = 0; // tăng mỗi khi đổi bộ lọc để bỏ qua response của request cũ
let debounceTimer = null;

/* --- META HIỂN THỊ --- */

const TX_TYPE_META = {
  TRANSFER: {
    label: "Chuyển tiền",
    icon: "fa-paper-plane",
    badge: "bg-blue-100 text-blue-700",
    iconBox: "bg-blue-100 text-blue-600",
  },
  PAYMENT: {
    label: "Thanh toán QR",
    icon: "fa-qrcode",
    badge: "bg-purple-100 text-purple-700",
    iconBox: "bg-purple-100 text-purple-600",
  },
  TOPUP: {
    label: "Nạp tiền",
    icon: "fa-circle-plus",
    badge: "bg-green-100 text-green-700",
    iconBox: "bg-green-100 text-green-600",
  },
  WITHDRAW: {
    label: "Rút tiền",
    icon: "fa-circle-minus",
    badge: "bg-orange-100 text-orange-700",
    iconBox: "bg-orange-100 text-orange-600",
  },
  REFUND: {
    label: "Hoàn tiền",
    icon: "fa-rotate-left",
    badge: "bg-gray-100 text-gray-700",
    iconBox: "bg-gray-100 text-gray-600",
  },
  REVERSAL: {
    label: "Hoàn tác giao dịch",
    icon: "fa-clock-rotate-left",
    badge: "bg-gray-100 text-gray-700",
    iconBox: "bg-gray-100 text-gray-600",
  },
};

function txTypeMeta(type) {
  return (
    TX_TYPE_META[type] || {
      label: type || "Giao dịch",
      icon: "fa-receipt",
      badge: "bg-gray-100 text-gray-700",
      iconBox: "bg-gray-100 text-gray-600",
    }
  );
}

function txStatusBadge(status) {
  if (status === "FAILED")
    return '<span class="bg-red-100 text-red-700 text-xs font-medium px-2.5 py-0.5 rounded">Thất bại</span>';
  if (status === "PENDING")
    return '<span class="bg-yellow-100 text-yellow-700 text-xs font-medium px-2.5 py-0.5 rounded">Đang xử lý</span>';
  return '<span class="bg-green-100 text-green-700 text-xs font-medium px-2.5 py-0.5 rounded">Thành công</span>';
}

// Tên đối tác hiển thị ở danh sách: nạp/rút -> ngân hàng, còn lại -> bên đối diện
function txPartnerName(item) {
  if (
    item.transaction_type === "TOPUP" ||
    item.transaction_type === "WITHDRAW"
  ) {
    return item.bank_name || "Ngân hàng liên kết";
  }
  const name =
    item.direction === "IN"
      ? item.source_display_name
      : item.destination_display_name;
  return name || item.bank_name || "Hệ thống";
}

/* --- BỘ LỌC --- */

function toLocalDateInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function setupMinMaxDateFilters() {
  const today = new Date();
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(today.getFullYear() - 1);

  const minDateStr = toLocalDateInput(oneYearAgo);
  const maxDateStr = toLocalDateInput(today);

  ["filter-start-date", "filter-end-date"].forEach((id) => {
    const input = document.getElementById(id);
    input.min = minDateStr;
    input.max = maxDateStr;
  });
}

function debounceApplyFilter() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(applyHistoryFilter, 500);
}

function applyHistoryFilter() {
  clearTimeout(debounceTimer);
  clearAlerts();

  // Huỷ mọi request đang chạy: response của chúng sẽ bị bỏ qua
  historyRequestSeq++;
  historyCursor = null;
  historyHasMore = true;
  historyLoading = false;

  document.getElementById("history-table-body").innerHTML = "";
  document.getElementById("history-loading").classList.add("hidden");
  document.getElementById("history-end").classList.add("hidden");
  document.getElementById("history-empty").classList.add("hidden");

  const startDate = document.getElementById("filter-start-date").value;
  const endDate = document.getElementById("filter-end-date").value;
  if (startDate && endDate && startDate > endDate) {
    showError("Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc");
    return;
  }

  loadHistoryTransactions();
}

function resetHistoryFilters() {
  document.getElementById("filter-type").value = "";
  document.getElementById("filter-keyword").value = "";
  document.getElementById("filter-start-date").value = "";
  document.getElementById("filter-end-date").value = "";
  applyHistoryFilter();
}

async function loadHistoryTransactions() {
  if (historyLoading || !historyHasMore) return;

  historyLoading = true;
  const seq = historyRequestSeq;
  document.getElementById("history-loading").classList.remove("hidden");

  const type = document.getElementById("filter-type").value;
  const keyword = document.getElementById("filter-keyword").value.trim();
  const startDate = document.getElementById("filter-start-date").value;
  const endDate = document.getElementById("filter-end-date").value;

  const query = new URLSearchParams({ limit: 20 });
  if (historyCursor) query.append("cursor_id", historyCursor);
  if (keyword) query.append("keyword", keyword);
  if (type) query.append("type", type);
  if (startDate) query.append("start_date", startDate);
  if (endDate) query.append("end_date", endDate);

  try {
    const data = await api(`${TRANSACTION_HISTORY_URL}?${query.toString()}`);
    if (seq !== historyRequestSeq) return; // bộ lọc đã đổi trong lúc chờ

    const list = data.transaction_list || [];
    historyCursor = data.next_cursor || null;
    historyHasMore = Boolean(historyCursor);

    renderHistoryRows(list);

    const rowCount = document.querySelectorAll("#history-table-body tr").length;
    if (!historyHasMore && rowCount > 0) {
      document.getElementById("history-end").classList.remove("hidden");
    }
    if (rowCount === 0) {
      document.getElementById("history-empty").classList.remove("hidden");
    }
  } catch (e) {
    if (seq === historyRequestSeq) showError(e.message);
  } finally {
    if (seq === historyRequestSeq) {
      historyLoading = false;
      document.getElementById("history-loading").classList.add("hidden");
    }
  }
}

function renderHistoryRows(list) {
  const tbody = document.getElementById("history-table-body");

  list.forEach((item) => {
    const tr = document.createElement("tr");
    tr.className =
      "hover:bg-gray-50 transition cursor-pointer focus:outline-none focus:bg-blue-50";
    tr.dataset.id = item.id;
    tr.tabIndex = 0;
    tr.setAttribute("role", "button");

    const isIncome = item.direction === "IN";
    const description =
      item.description ||
      (item.order_id ? `Mã đơn: ${item.order_id}` : "Giao dịch ví");
    const meta = txTypeMeta(item.transaction_type);

    tr.innerHTML = `
            <td class="py-3 px-4 text-xs whitespace-nowrap text-gray-500">${escapeHtml(formatDate(item.created_at))}</td>
            <td class="py-3 px-4 whitespace-nowrap">
                <span class="text-xs font-semibold px-2 py-1 rounded ${meta.badge}">${escapeHtml(item.transaction_type)}</span>
            </td>
            <td class="py-3 px-4">
                <p class="font-medium text-gray-800">${escapeHtml(txPartnerName(item))}</p>
                <p class="text-xs text-gray-500 truncate max-w-xs">${escapeHtml(description)}</p>
            </td>
            <td class="py-3 px-4 text-right font-bold whitespace-nowrap ${isIncome ? "text-green-600" : "text-red-600"}">
                ${isIncome ? "+" : "-"}${escapeHtml(formatMoney(item.amount))}
            </td>
            <td class="py-3 px-4 text-center whitespace-nowrap">${txStatusBadge(item.status)}</td>
        `;
    tbody.appendChild(tr);
  });
}

window.addEventListener("scroll", () => {
  const panelHistory = document.getElementById("panel-history");
  if (!panelHistory || panelHistory.classList.contains("hidden")) return;

  if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 300) {
    loadHistoryTransactions();
  }
});

/* =====================================================================
 * CHI TIẾT GIAO DỊCH
 *   TRANSFER        : người chuyển + người nhận
 *   PAYMENT         : người thanh toán + bên nhận, thông tin đơn, danh sách sản phẩm
 *   TOPUP / WITHDRAW: thông tin ngân hàng liên kết
 * ===================================================================== */

let txDetailSeq = 0;
let txDetailCloseTimer = null;
let txDetailLastFocus = null;

function showTxDrawer() {
  clearTimeout(txDetailCloseTimer);
  const drawer = document.getElementById("tx-detail-drawer");
  const overlay = document.getElementById("tx-detail-overlay");

  if (drawer.classList.contains("hidden"))
    txDetailLastFocus = document.activeElement;

  drawer.classList.remove("hidden");
  overlay.classList.remove("hidden");
  void drawer.offsetWidth; // ép trình duyệt tính layout để animation chạy
  drawer.classList.remove("translate-x-full");
  overlay.classList.remove("opacity-0");
  document.body.classList.add("overflow-hidden");
  document.getElementById("tx-detail-close").focus();
}

function closeTransactionDetail() {
  const drawer = document.getElementById("tx-detail-drawer");
  const overlay = document.getElementById("tx-detail-overlay");
  if (!drawer || drawer.classList.contains("hidden")) return;

  txDetailSeq++; // bỏ qua response đang chờ
  drawer.classList.add("translate-x-full");
  overlay.classList.add("opacity-0");
  document.body.classList.remove("overflow-hidden");

  txDetailCloseTimer = setTimeout(() => {
    drawer.classList.add("hidden");
    overlay.classList.add("hidden");
  }, 200);

  if (txDetailLastFocus && document.contains(txDetailLastFocus))
    txDetailLastFocus.focus();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeTransactionDetail();
});

async function openTransactionDetail(id) {
  const seq = ++txDetailSeq;
  const body = document.getElementById("tx-detail-body");

  showTxDrawer();
  body.innerHTML = txDetailSkeleton();
  body.scrollTop = 0;

  try {
    const endpointTemplate = window.APP_CONFIG.production.TRANSACTION_DETAIL;
    const url = endpointTemplate.replace("{id}", encodeURIComponent(id));

    const data = await api(url);
    if (seq !== txDetailSeq) return;
    body.innerHTML = renderTransactionDetail(data);
    hydrateLogos(body);
  } catch (e) {
    if (seq !== txDetailSeq) return;
    body.innerHTML = `
            <div class="py-10 text-center">
                <div class="mx-auto mb-3 w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
                    <i class="fa-solid fa-triangle-exclamation text-xl"></i>
                </div>
                <p class="text-sm text-gray-700 mb-4">${escapeHtml(e.message)}</p>
                <button type="button" data-retry-id="${escapeHtml(id)}"
                    class="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition">
                    Thử lại
                </button>
            </div>`;
  }
}

function txDetailSkeleton() {
  return `
        <div class="animate-pulse space-y-6">
            <div class="flex flex-col items-center gap-3">
                <div class="w-14 h-14 rounded-full bg-gray-200"></div>
                <div class="h-4 w-24 bg-gray-200 rounded"></div>
                <div class="h-8 w-44 bg-gray-200 rounded"></div>
            </div>
            <div class="h-24 bg-gray-200 rounded-xl"></div>
            <div class="h-40 bg-gray-200 rounded-xl"></div>
        </div>`;
}

/* --- Các khối dựng giao diện chi tiết --- */

function txSection(title, innerHtml) {
  return `
        <section>
            <h4 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">${title}</h4>
            ${innerHtml}
        </section>`;
}

function txInfoRow(label, valueHtml) {
  return `
        <div class="flex items-start justify-between gap-4 py-2.5 text-sm">
            <span class="text-gray-500 shrink-0">${label}</span>
            <span class="text-right font-medium text-gray-800 break-words min-w-0">${valueHtml}</span>
        </div>`;
}

function txInfoCard(rowsHtml) {
  return `<div class="rounded-xl border border-gray-200 px-4 divide-y divide-gray-100">${rowsHtml}</div>`;
}

function txPartyCard(label, party) {
  const name = (party && party.full_name) || "Không rõ";
  const initial = Array.from(name)[0].toUpperCase();
  const selfTag =
    party && party.is_self
      ? '<span class="ml-1.5 text-[11px] font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Bạn</span>'
      : "";
  const phone =
    party && party.phone
      ? `<p class="text-xs text-gray-500 font-mono">${escapeHtml(party.phone)}</p>`
      : "";

  return `
        <div class="flex items-center gap-3 p-3 rounded-xl border border-gray-200 bg-gray-50">
            <div class="w-11 h-11 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold shrink-0">${escapeHtml(initial)}</div>
            <div class="min-w-0">
                <p class="text-xs text-gray-500">${label}</p>
                <p class="font-semibold text-gray-800 truncate">${escapeHtml(name)}${selfTag}</p>
                ${phone}
            </div>
        </div>`;
}

function txPartiesHtml(d) {
  if (!d.source && !d.destination) return "";

  const labels =
    d.transaction_type === "TRANSFER"
      ? {
          title: "Người chuyển & người nhận",
          from: "Người chuyển",
          to: "Người nhận",
        }
      : d.transaction_type === "PAYMENT"
        ? {
            title: "Bên thanh toán & bên nhận",
            from: "Khách thanh toán",
            to: "Bên nhận thanh toán",
          }
        : { title: "Bên gửi & bên nhận", from: "Bên gửi", to: "Bên nhận" };

  return txSection(
    labels.title,
    `
        ${txPartyCard(labels.from, d.source)}
        <div class="flex justify-center text-gray-300 py-1.5"><i class="fa-solid fa-arrow-down"></i></div>
        ${txPartyCard(labels.to, d.destination)}
    `,
  );
}

function txBankHtml(d) {
  const title =
    d.transaction_type === "TOPUP" ? "Nạp từ ngân hàng" : "Rút về ngân hàng";
  const b = d.bank;
  if (!b) {
    return txSection(
      title,
      '<p class="text-sm text-gray-400">Không có thông tin ngân hàng.</p>',
    );
  }

  const logoImg = b.logo_url
    ? `<img data-logo-src="${escapeHtml(b.logo_url)}" alt="" class="hidden absolute inset-0 w-full h-full object-contain bg-white p-1">`
    : "";

  return txSection(
    title,
    `
        <div class="rounded-xl border border-gray-200 overflow-hidden">
            <div class="flex items-center gap-3 p-3 bg-gray-50">
                <div class="relative w-12 h-12 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-gray-400 shrink-0 overflow-hidden">
                    <i class="fa-solid fa-building-columns text-xl"></i>
                    ${logoImg}
                </div>
                <div class="min-w-0">
                    <p class="font-semibold text-gray-800 truncate">${escapeHtml(b.bank_name)}</p>
                    ${b.bank_code ? `<p class="text-xs text-gray-500">${escapeHtml(b.bank_code)}</p>` : ""}
                </div>
            </div>
            <div class="px-4 divide-y divide-gray-100">
                ${txInfoRow("Chủ tài khoản", escapeHtml(b.account_holder_name || "---"))}
                ${txInfoRow("Số tài khoản", `<span class="font-mono">${escapeHtml(b.account_number || "---")}</span>`)}
            </div>
        </div>`,
  );
}

function txPaymentHtml(d) {
  const p = d.payment;
  if (!p) {
    return txSection(
      "Thông tin đơn hàng",
      '<p class="text-sm text-gray-400">Không có thông tin đơn hàng cho giao dịch này.</p>',
    );
  }

  let orderRows = txInfoRow("Mã đơn hàng", escapeHtml(p.order_id || "---"));
  orderRows += txInfoRow(
    "Mã tham chiếu QR",
    `<span class="font-mono">${escapeHtml(p.reference_code || "---")}</span>`,
  );
  if (p.paid_at)
    orderRows += txInfoRow("Thanh toán lúc", escapeHtml(formatDate(p.paid_at)));
  if (p.description)
    orderRows += txInfoRow("Mô tả đơn hàng", escapeHtml(p.description));

  let itemsHtml;
  if (p.items.length === 0) {
    itemsHtml =
      '<p class="text-sm text-gray-400">Đơn hàng không gửi kèm danh sách sản phẩm.</p>';
  } else {
    const rows = p.items
      .map(
        (item) => `
            <div class="flex items-start justify-between gap-3 py-3">
                <div class="min-w-0">
                    <p class="text-sm font-medium text-gray-800 break-words">${escapeHtml(item.name)}</p>
                    <p class="text-xs text-gray-500 break-words">Mã: ${escapeHtml(item.product_id)}${item.description ? " · " + escapeHtml(item.description) : ""}</p>
                    <p class="text-xs text-gray-500 mt-0.5">${escapeHtml(formatMoney(item.unit_price))} × ${escapeHtml(item.quantity)}</p>
                </div>
                <p class="text-sm font-semibold text-gray-800 whitespace-nowrap">${escapeHtml(formatMoney(item.line_total))}</p>
            </div>`,
      )
      .join("");

    const mismatch =
      p.items_total !== d.amount
        ? `<p class="text-xs text-amber-600 mt-1.5">Tổng giá trị sản phẩm (${escapeHtml(formatMoney(p.items_total))}) khác với số tiền thanh toán.</p>`
        : "";

    itemsHtml = `
            <div class="rounded-xl border border-gray-200 px-4 divide-y divide-gray-100">${rows}</div>
            <div class="flex items-center justify-between px-4 py-3 mt-2 rounded-xl bg-gray-50 text-sm">
                <span class="text-gray-600">Tổng thanh toán</span>
                <span class="font-bold text-gray-800">${escapeHtml(formatMoney(d.amount))}</span>
            </div>
            ${mismatch}`;
  }

  return (
    txSection("Thông tin đơn hàng", txInfoCard(orderRows)) +
    txSection(`Sản phẩm (${p.items.length})`, itemsHtml)
  );
}

function txGeneralInfoHtml(d) {
  let rows = txInfoRow(
    "Mã giao dịch",
    `
        <span class="font-mono">${escapeHtml(d.id)}</span>
        <button type="button" data-copy="${escapeHtml(d.id)}" aria-label="Copy mã giao dịch"
            class="ml-1.5 text-gray-400 hover:text-gray-700"><i class="fa-regular fa-copy"></i></button>`,
  );
  rows += txInfoRow("Thời gian tạo", escapeHtml(formatDate(d.created_at)));
  if (d.completed_at)
    rows += txInfoRow("Hoàn tất lúc", escapeHtml(formatDate(d.completed_at)));
  rows += txInfoRow("Nội dung", escapeHtml(d.description || "---"));
  rows += txInfoRow("Phí giao dịch", escapeHtml(formatMoney(d.fee)));
  if (d.balance_before !== null)
    rows += txInfoRow("Số dư trước", escapeHtml(formatMoney(d.balance_before)));
  if (d.balance_after !== null)
    rows += txInfoRow("Số dư sau", escapeHtml(formatMoney(d.balance_after)));

  return txSection("Chi tiết", txInfoCard(rows));
}

function renderTransactionDetail(d) {
  const meta = txTypeMeta(d.transaction_type);
  const isIncome = d.direction === "IN";

  const hero = `
        <div class="text-center">
            <div class="mx-auto w-14 h-14 rounded-full flex items-center justify-center text-2xl ${meta.iconBox}">
                <i class="fa-solid ${meta.icon}"></i>
            </div>
            <p class="mt-3 text-sm text-gray-500">${escapeHtml(meta.label)}</p>
            <p class="text-3xl font-bold mt-1 ${isIncome ? "text-green-600" : "text-red-600"}">
                ${isIncome ? "+" : "-"}${escapeHtml(formatMoney(d.amount))}
            </p>
            <div class="mt-2">${txStatusBadge(d.status)}</div>
            <p class="text-xs text-gray-400 mt-2">${escapeHtml(formatDate(d.created_at))}</p>
        </div>`;

  let middle = "";
  if (d.transaction_type === "TOPUP" || d.transaction_type === "WITHDRAW") {
    middle = txBankHtml(d);
  } else {
    middle = txPartiesHtml(d);
    if (d.transaction_type === "PAYMENT") middle += txPaymentHtml(d);
  }

  return hero + middle + txGeneralInfoHtml(d);
}
