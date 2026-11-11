const { httpError } = require('../../utils/httpError');

const FILTERS = {
  tab: ['ALL', 'LINKED', 'PENDING', 'UNCONFIGURED', 'SUSPENDED'],
  approval_status: ['ALL', 'APPROVED', 'PENDING', 'REJECTED'],
  status: ['ALL', 'ACTIVE', 'BLOCKED', 'SUSPENDED', 'UNKNOWN', 'PENDING_ACTIVATION', 'DISABLED'],
  api_status: ['ALL', 'LINKED', 'PENDING_KEY', 'NOT_CONNECTED', 'LOCKED'],
  period: ['ALL', 'TODAY', 'DAY', 'THIS_WEEK', 'WEEK', 'THIS_MONTH', 'MONTH'],
};

function invalid(name) {
  throw httpError(400, `Tham số ${name} không hợp lệ`);
}

function positiveInteger(value, name, fallback, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if (!['string', 'number'].includes(typeof value) || !/^[0-9]+$/.test(String(value))) invalid(name);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) invalid(name);
  return number;
}

function enumValue(value, name) {
  if (value === undefined) return 'ALL';
  if (typeof value !== 'string') invalid(name);
  const normalized = value.trim().toUpperCase();
  if (!FILTERS[name].includes(normalized)) invalid(name);
  return normalized;
}

function calendarDate(value, name) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) invalid(name);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) invalid(name);
  return date;
}

// users.created_at is timestamp WITHOUT time zone: send Vietnam wall-clock
// boundaries, never a JS Date that pg would serialize in the server's timezone.
function midnight(date) {
  if (!date) return null;
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')} 00:00:00`;
}

function dateRange(query, period, now) {
  let start = calendarDate(query.start_date, 'start_date');
  let end = calendarDate(query.end_date, 'end_date');
  if (start && end && start > end) invalid('start_date/end_date');
  if (start || end) {
    if (end) end.setUTCDate(end.getUTCDate() + 1);
  } else if (period !== 'ALL') {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now).map(({ type, value }) => [type, value]));
    start = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
    if (['THIS_WEEK', 'WEEK'].includes(period)) {
      start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
      end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 7);
    } else if (['THIS_MONTH', 'MONTH'].includes(period)) {
      start.setUTCDate(1);
      end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + 1);
    } else {
      end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
    }
  }
  return { startDate: midnight(start), endDate: midnight(end) };
}

function parseMerchantQuery(query = {}, now = new Date()) {
  const page = positiveInteger(query.page, 'page', 1);
  const limit = positiveInteger(query.limit, 'limit', 10, 100);
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) invalid('page');
  const filters = Object.fromEntries(Object.keys(FILTERS).map(name => [name, enumValue(query[name], name)]));
  if (query.search !== undefined && (typeof query.search !== 'string' || query.search.trim().length > 200)) invalid('search');
  return {
    page, limit, offset, search: query.search?.trim(), tab: filters.tab,
    approvalStatus: filters.approval_status, status: filters.status,
    apiStatus: filters.api_status, ...dateRange(query, filters.period, now),
  };
}

module.exports = { parseMerchantQuery };
