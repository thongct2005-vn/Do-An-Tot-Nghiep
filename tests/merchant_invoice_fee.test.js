const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateMerchantInvoiceFeeDetails: calculate } = require('../src/modules/fee/feeCalculator');
const cases = require('./fixtures/merchant_fee_reference.json');
const config = {
  rate_bps: 150, min_fee: 200, max_fee: null, free_threshold_amount: 0,
  tiers: [{ from_amount: 0, rate_bps: 150 }, { from_amount: 200001, rate_bps: 120 }, { from_amount: 1000001, rate_bps: 100 }],
};

test('invoice fees match approved independent examples and ignore monthly turnover', () => {
  for (const { amount, fee, net } of cases) {
    for (const monthly_qr_gross_before of [0, 49999999, 200000000]) {
      const result = calculate(amount, { ...config, monthly_qr_gross_before });
      assert.equal(result.fee_amount, fee);
      assert.equal(result.net_amount, net);
      assert.equal(result.fee_rate_snapshot.pricing_model, 'MERCHANT_INVOICE_BOUNDARY_V1');
      assert.equal(result.fee_rate_snapshot.amount, amount);
    }
  }
});

test('minimum, cap, explicit zero, recursive boundaries, half-up and safe integers', () => {
  assert.equal(calculate(100, config).fee_amount, 100);
  assert.equal(calculate(1000, config).fee_amount, 200);
  assert.equal(calculate(100100, config).fee_amount, 1502);
  assert.equal(calculate(500000, { ...config, max_fee: 4000 }).fee_amount, 4000);
  assert.equal(calculate(100, { ...config, free_threshold_amount: 101 }).fee_amount, 0);
  assert.equal(calculate(101, { ...config, free_threshold_amount: 101 }).fee_amount, 101);
  const zero = { ...config, rate_bps: 0, tiers: [], min_fee: 0 };
  assert.equal(calculate(500000, zero).fee_amount, 0);
  assert.equal(calculate(500000, { ...zero, min_fee: 200 }).fee_amount, 200);
  const descending = { ...config, min_fee: 0, tiers: [
    { from_amount: 0, rate_bps: 1000 }, { from_amount: 1001, rate_bps: 10 }, { from_amount: 2001, rate_bps: 0 },
  ] };
  assert.equal(calculate(3000, descending).fee_amount, 100);
  assert.equal(calculate(Number.MAX_SAFE_INTEGER, { ...zero, rate_bps: 10000 }).fee_amount, Number.MAX_SAFE_INTEGER);
  for (const value of [0, -1, 1.2, true, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => calculate(value, config));
  assert.throws(() => calculate(100, null));
  assert.throws(() => calculate(100, { ...config, tiers: undefined }));
  assert.throws(() => calculate(100, { ...config, tiers: [...config.tiers].reverse() }));
});

test('fees never decrease around all boundaries and remain within amount', () => {
  for (const boundary of [200000, 250000, 1000000, 1200000]) {
    let previous = 0;
    for (let a = boundary - 100; a <= boundary + 100; a++) {
      const result = calculate(a, config);
      assert.ok(result.fee_amount >= previous && result.fee_amount <= a);
      assert.equal(result.net_amount + result.fee_amount, a);
      previous = result.fee_amount;
    }
  }
});
