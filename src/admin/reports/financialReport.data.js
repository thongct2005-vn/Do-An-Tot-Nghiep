const { httpError } = require('../../utils/httpError');

// Excel guarantees 15 significant decimal digits. Reject before creating cells.
const MAX_EXCEL_INTEGER = 999999999999999n;
function exactInteger(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return precisionError();
  if (!['number', 'string', 'bigint'].includes(typeof value) || !/^-?\d+$/.test(String(value))) {
    throw new TypeError('Expected an integer report value');
  }
  const integer = BigInt(value);
  if (integer > MAX_EXCEL_INTEGER || integer < -MAX_EXCEL_INTEGER) return precisionError();
  return Number(integer);
}
function precisionError() {
  const error = httpError(422, 'Số tiền hoặc số lượng vượt độ chính xác cho phép của Excel. Vui lòng thu hẹp kỳ báo cáo.');
  error.code = 'EXPORT_AMOUNT_PRECISION_EXCEEDED';
  throw error;
}
function sum(rows, key) {
  return exactInteger(rows.reduce((total, row) => total + BigInt(exactInteger(row[key])), 0n));
}
function normalizeIntegers(value) {
  if (typeof value === 'number' || typeof value === 'bigint') return exactInteger(value);
  if (Array.isArray(value)) return value.map(normalizeIntegers);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeIntegers(v)]));
  return value;
}
const percentChange = (current, previous) => previous === 0 ? null : (current - previous) / previous;
function previousRange(filters) {
  const end = filters.startInstant;
  const start = new Date(end.getTime() - (filters.nextDayInstant - end));
  return { ...filters, startInstant: start, nextDayInstant: end };
}
module.exports = { exactInteger, sum, normalizeIntegers, percentChange, previousRange };
