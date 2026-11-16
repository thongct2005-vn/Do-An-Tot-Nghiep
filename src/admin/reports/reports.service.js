const pool = require('../../config/database');
const { httpError } = require('../../utils/httpError');
const { resolveAdminDateRange } = require('../../utils/dateRange');

function filters(input = {}) {
  for (const key of ['start_date', 'end_date', 'merchant_id', 'transaction_type', 'group_by', 'role']) {
    if (input[key] !== undefined && typeof input[key] !== 'string') throw httpError(400, `${key} không hợp lệ`);
  }
  const range = resolveAdminDateRange(input.start_date, input.end_date);
  const group = input.group_by || 'day';
  if (!['day', 'week', 'month', 'quarter', 'year'].includes(group)) throw httpError(400, 'group_by không hợp lệ');
  const merchant = input.merchant_id || null;
  if (merchant && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(merchant)) throw httpError(400, 'merchant_id không hợp lệ');
  const type = input.transaction_type || 'ALL';
  if (!['ALL', 'PAYMENT', 'TRANSFER'].includes(type)) throw httpError(400, 'transaction_type không hợp lệ');
  const role = input.role || 'ALL';
  if (!['ALL', 'USER', 'MERCHANT'].includes(role)) throw httpError(400, 'role không hợp lệ');
  const page = Number(input.page ?? 1), limit = Number(input.limit ?? 20);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw httpError(400, 'Phân trang không hợp lệ');
  return { ...range, group, merchant, type: type === 'ALL' ? null : type, role, page, limit,
    period: { ...range.period, group_by: group },
  };
}

// Separate ledger and transaction events avoid multiplying transactions by fee rows.
// All reporting views below share a single SQL statement and database snapshot.
const REPORT_SQL = `
WITH events AS MATERIALIZED (
  SELECT u.id merchant_id, t.transaction_type::text type,
    date_trunc($5, l.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') bucket,
    l.amount revenue, 0::bigint gross, 0::bigint tx_count
  FROM fee_ledger_entries l JOIN transactions t ON t.id=l.transaction_id
  JOIN users u ON u.id=t.destination_user_id AND u.role='MERCHANT'
  WHERE l.fee_type='QR_FEE' AND t.status IN ('SUCCESS','COMPLETED')
    AND t.transaction_type IN ('PAYMENT','TRANSFER')
    AND l.created_at >= $1 AND l.created_at < $2
    AND ($3::uuid IS NULL OR u.id=$3) AND ($4::text IS NULL OR t.transaction_type::text=$4)
  UNION ALL
  SELECT u.id, t.transaction_type::text,
    date_trunc($5, t.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'),
    0::bigint, t.amount, 1::bigint
  FROM transactions t JOIN users u ON u.id=t.destination_user_id AND u.role='MERCHANT'
  WHERE t.status IN ('SUCCESS','COMPLETED') AND t.transaction_type IN ('PAYMENT','TRANSFER')
    AND t.created_at >= $1 AND t.created_at < $2
    AND ($3::uuid IS NULL OR u.id=$3) AND ($4::text IS NULL OR t.transaction_type::text=$4)
), totals AS (
  SELECT coalesce(sum(revenue),0) revenue,coalesce(sum(gross),0) gross,coalesce(sum(tx_count),0) transactions FROM events
), type_totals AS (
  SELECT types.type, coalesce(sum(e.revenue),0) revenue,coalesce(sum(e.gross),0) gross,coalesce(sum(e.tx_count),0) transactions
  FROM (VALUES ('PAYMENT'),('TRANSFER')) types(type) LEFT JOIN events e ON e.type=types.type
  GROUP BY types.type
), bucket_totals AS (
  SELECT bucket,sum(revenue) revenue,sum(gross) gross,sum(tx_count) transactions FROM events GROUP BY bucket
), buckets AS (
  SELECT generate_series(date_trunc($5,$1::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh'),
    date_trunc($5,($2::timestamptz - interval '1 microsecond') AT TIME ZONE 'Asia/Ho_Chi_Minh'),
    CASE $5 WHEN 'quarter' THEN interval '3 months' WHEN 'year' THEN interval '1 year'
      WHEN 'month' THEN interval '1 month' WHEN 'week' THEN interval '1 week' ELSE interval '1 day' END) bucket
), series AS (
  SELECT to_char(b.bucket,'YYYY-MM-DD') bucket,coalesce(t.revenue,0) revenue,
    coalesce(t.gross,0) gross,coalesce(t.transactions,0) transactions
  FROM buckets b LEFT JOIN bucket_totals t USING(bucket)
), merchant_totals AS (
  SELECT e.merchant_id,u.full_name merchant_name,sum(e.revenue) revenue,sum(e.gross) gross,sum(e.tx_count) transactions
  FROM events e JOIN users u ON u.id=e.merchant_id GROUP BY e.merchant_id,u.full_name
), merchant_page AS (
  SELECT * FROM merchant_totals ORDER BY revenue DESC,merchant_id LIMIT $6 OFFSET $7
), gateway AS (
  SELECT count(*) total,
    count(*) FILTER(WHERE pr.status IN ('SUCCESS','PAID')) success,
    count(*) FILTER(WHERE pr.status='PENDING') pending,
    count(*) FILTER(WHERE pr.status='EXPIRED') expired,
    count(*) FILTER(WHERE pr.status='FAILED') failed,
    count(*) FILTER(WHERE pr.status='CANCELLED') cancelled
  FROM payment_requests pr JOIN users u ON u.id=pr.destination_user_id AND u.role='MERCHANT'
  WHERE pr.order_id IS NOT NULL AND pr.created_at >= $1 AND pr.created_at < $2
    AND ($3::uuid IS NULL OR u.id=$3)
)
SELECT jsonb_build_object(
  'overview',(SELECT to_jsonb(t) FROM totals t),
  'breakdown',(SELECT jsonb_agg(to_jsonb(t) ORDER BY type) FROM type_totals t),
  'timeseries',(SELECT jsonb_agg(to_jsonb(s) ORDER BY bucket) FROM series s),
  'merchants',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY revenue DESC,merchant_id) FROM merchant_page m),'[]'::jsonb),
  'total_merchants',(SELECT count(*) FROM merchant_totals),
  'gateway',(SELECT to_jsonb(g) FROM gateway g)
) data`;

async function report(input, { db = pool, allMerchants = false } = {}) {
  const f = filters(input);
  const data = (await db.query(REPORT_SQL, [f.startInstant, f.nextDayInstant, f.merchant, f.type, f.group,
    allMerchants ? null : f.limit, allMerchants ? 0 : (f.page - 1) * f.limit])).rows[0].data;
  const g = data.gateway;
  g.resolved = g.success + g.expired + g.failed + g.cancelled;
  g.success_rate = g.resolved ? g.success / g.resolved * 100 : null;
  return { ...data, period: f.period, filters: { merchant_id: f.merchant, transaction_type: f.type || 'ALL' },
    pagination: { page: allMerchants ? 1 : f.page, limit: allMerchants ? data.total_merchants : f.limit, total: data.total_merchants } };
}

async function growth(input, { db = pool } = {}) {
  const f = filters(input);
  const previous = new Date(f.startInstant.getTime() - (f.nextDayInstant - f.startInstant));
  const result = await db.query(`WITH accounts AS (
    SELECT role,count(*) FILTER(WHERE created_at >= ($1::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')) current,
      count(*) FILTER(WHERE created_at >= ($3::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND created_at < ($1::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')) previous,count(*) total
    FROM users WHERE role IN ('USER','MERCHANT') AND ($4='ALL' OR role=$4)
      AND created_at < ($2::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh') GROUP BY role
  ), volume AS (
    SELECT count(*) FILTER(WHERE t.created_at >= $1) current_count,
      count(*) FILTER(WHERE t.created_at < $1) previous_count,
      coalesce(sum(t.amount) FILTER(WHERE t.created_at >= $1),0) current_gross,
      coalesce(sum(t.amount) FILTER(WHERE t.created_at < $1),0) previous_gross
    FROM transactions t WHERE t.status IN ('SUCCESS','COMPLETED') AND t.created_at >= $3 AND t.created_at < $2
      AND ($5::text IS NULL OR t.transaction_type::text=$5)
      AND ($6::uuid IS NULL OR t.destination_user_id=$6)
  ) SELECT coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM accounts a),'[]'::jsonb) accounts,
    (SELECT to_jsonb(v) FROM volume v) transactions`,
  [f.startInstant, f.nextDayInstant, previous, f.role, f.type, f.merchant]);
  const data = result.rows[0];
  const percent = (current, prev) => prev === 0 ? null : (current - prev) / prev * 100;
  data.accounts = (f.role === 'ALL' ? ['USER', 'MERCHANT'] : [f.role]).map(role => {
    const r = data.accounts.find(a => a.role === role) || { role, current: 0, previous: 0, total: 0 };
    return { ...r, growth_percent: percent(r.current, r.previous) };
  });
  data.transactions.count_growth_percent = percent(data.transactions.current_count, data.transactions.previous_count);
  data.transactions.gross_growth_percent = percent(data.transactions.current_gross, data.transactions.previous_gross);
  return { ...data, period: f.period, previous_period: { start: previous.toISOString(), end_exclusive: f.startIso } };
}

async function exportReport(input) {
  const data = await report(input, { allMerchants: true });
  const ExcelJS = require('exceljs');
  const book = new ExcelJS.Workbook();
  const summary = book.addWorksheet('Tong hop');
  summary.addRows([
    ['Báo cáo phí Merchant đã khấu trừ'], ['Từ ngày', data.period.start_date], ['Đến ngày', data.period.end_date],
    ['Múi giờ', data.period.timezone], ['Merchant', data.filters.merchant_id || 'Tất cả'], ['Loại giao dịch', data.filters.transaction_type],
    ['Phí Merchant', data.overview.revenue], ['Giá trị giao dịch', data.overview.gross], ['Số giao dịch', data.overview.transactions],
  ]);
  for (const [name, rows, fields] of [
    ['Merchant', data.merchants, ['merchant_id','merchant_name','revenue','gross','transactions']],
    ['Theo thoi gian', data.timeseries, ['bucket','revenue','gross','transactions']],
    ['Theo loai', data.breakdown, ['type','revenue','gross','transactions']],
  ]) {
    const sheet = book.addWorksheet(name); sheet.addRow(fields);
    for (const row of rows) sheet.addRow(fields.map(k => row[k]));
    sheet.getRow(1).font = { bold: true }; sheet.columns.forEach(c => { c.width = 25; });
  }
  return book.xlsx.writeBuffer();
}

async function logins(input) {
  const f = filters(input);
  if (require('mongoose').connection.readyState !== 1) throw httpError(503, 'Dữ liệu đăng nhập tạm thời không khả dụng');
  return require('../user/user.service').getLoginStats({ start_date: f.startDate, end_date: f.endDate });
}

module.exports = { filters, report, growth, logins, exportReport, REPORT_SQL };
