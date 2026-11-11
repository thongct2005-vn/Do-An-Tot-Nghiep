const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMerchantQuery: parse } = require('../src/admin/merchants/merchants.query');

test('defaults apply only to absent parameters; malformed input is rejected', () => {
  assert.deepEqual(parse({}), { page: 1, limit: 10, offset: 0, search: undefined,
    tab: 'ALL', approvalStatus: 'ALL', status: 'ALL', apiStatus: 'ALL', startDate: null, endDate: null });
  const invalid = { page: ['', '0', '-1', '1.5', '1x', '1e2', '9007199254740992', [], {}],
    limit: ['', '101', '0', 'Infinity', null], search: [[], {}, 'x'.repeat(201)],
    start_date: ['', '2026-02-30', '2025-02-29', '2026-1-01', '2026-11-01T00:00:00Z', '0000-01-01'],
    end_date: ['', '2026-04-31'] };
  for (const name of ['tab', 'approval_status', 'status', 'api_status', 'period']) invalid[name] = ['', 'invalid', [], null];
  for (const [name, values] of Object.entries(invalid)) {
    for (const value of values) assert.throws(() => parse({ [name]: value }),
      error => error.statusCode === 400 && error.message.includes(name), `${name}=${JSON.stringify(value)}`);
  }
  assert.throws(() => parse({ page: '9007199254740991', limit: '100' }), { statusCode: 400 });
  assert.throws(() => parse({ start_date: '2026-11-11', end_date: '2026-11-10' }), { statusCode: 400 });
});

test('normalizes enums and keeps compatibility aliases', () => {
  for (const status of ['ACTIVE', 'BLOCKED', 'SUSPENDED', 'UNKNOWN', 'PENDING_ACTIVATION', 'DISABLED']) {
    assert.equal(parse({ status: ` ${status.toLowerCase()} ` }).status, status);
  }
  assert.equal(parse({ search: '  DigiMart  ' }).search, 'DigiMart');
  assert.equal(parse({ page: '2', limit: '100' }).offset, 100);
});

test('Vietnam calendar ranges are half-open and independent of host timezone', () => {
  // Sunday in UTC, already Monday in Vietnam.
  const now = new Date('2026-11-08T17:00:00Z');
  for (const period of ['TODAY', 'DAY']) {
    const r = parse({ period }, now);
    assert.equal(r.startDate, '2026-11-09 00:00:00');
    assert.equal(r.endDate, '2026-11-10 00:00:00');
  }
  for (const period of ['THIS_WEEK', 'WEEK']) {
    const r = parse({ period }, now);
    assert.equal(r.startDate, '2026-11-09 00:00:00');
    assert.equal(r.endDate, '2026-11-16 00:00:00');
  }
  const sunday = parse({ period: 'WEEK' }, new Date('2026-11-08T16:59:59Z'));
  assert.equal(sunday.startDate, '2026-11-02 00:00:00');
  assert.equal(sunday.endDate, '2026-11-09 00:00:00');
  for (const period of ['THIS_MONTH', 'MONTH']) {
    const r = parse({ period }, now);
    assert.equal(r.startDate, '2026-11-01 00:00:00');
    assert.equal(r.endDate, '2026-12-01 00:00:00');
  }
  const r = parse({ start_date: '2024-02-29', end_date: '2024-02-29', period: 'TODAY' }, now);
  assert.equal(r.startDate, '2024-02-29 00:00:00');
  assert.equal(r.endDate, '2024-03-01 00:00:00');
  assert.equal(parse({ end_date: '2026-12-31', period: 'MONTH' }, now).startDate, null);
  assert.equal(parse({ end_date: '2026-12-31' }).endDate, '2027-01-01 00:00:00');
  assert.throws(() => parse({ start_date: '2026-11-10', period: 'wrong' }), { statusCode: 400 });
});
