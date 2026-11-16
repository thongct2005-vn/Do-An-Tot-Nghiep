const test = require('node:test');
const assert = require('node:assert/strict');
const cases = require('./fixtures/merchant_fee_reference.json');

// Independent, fixed business oracle. No imports from the production calculator.
function referenceFee(amount) {
  const a = BigInt(amount);
  const [rate, boundary] = a <= 200000n ? [150n, 0n]
    : a <= 1000000n ? [120n, 3000n] : [100n, 12000n];
  const rounded = (a * rate + 5000n) / 10000n;
  const floor = [rounded, boundary, 200n].reduce((x, y) => x > y ? x : y);
  return Number(a < floor ? a : floor);
}

test('approved invoice fee examples agree with independent integer arithmetic', () => {
  for (const { amount, fee, net } of cases) {
    assert.equal(referenceFee(amount), fee, `fee for ${amount}`);
    assert.equal(amount - fee, net, `net for ${amount}`);
  }
});

test('reference boundaries are monotone, half-up and capped by the invoice', () => {
  for (const boundary of [200000, 250000, 1000000, 1200000]) {
    let previous = referenceFee(boundary - 20);
    for (let a = boundary - 19; a <= boundary + 20; a++) {
      assert.ok(referenceFee(a) >= previous);
      previous = referenceFee(a);
    }
  }
  assert.equal(referenceFee(100100), 1502); // 1501.5 => 1502
  assert.equal(referenceFee(100), 100);
});
