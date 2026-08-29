'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  computeLineTotals,
  computeBillTotals,
  TAX_MODE,
} = require('../src/utils/taxUtils');

test('computeLineTotals: CGST/SGST split for intra-state GST', () => {
  const r = computeLineTotals(799, 2, 12, TAX_MODE.GST); // 1598 * 12% = 191.76
  assert.strictEqual(r.lineAmount, 1598);
  assert.strictEqual(r.taxTotal, 191.76);
  assert.strictEqual(r.cgst, 95.88);
  assert.strictEqual(r.sgst, 95.88);
  assert.strictEqual(r.igst, 0);
});

test('computeLineTotals: full IGST for inter-state', () => {
  const r = computeLineTotals(1299, 1, 18, TAX_MODE.IGST);
  assert.strictEqual(r.lineAmount, 1299);
  assert.strictEqual(r.igst, 233.82);
  assert.strictEqual(r.cgst, 0);
  assert.strictEqual(r.sgst, 0);
});

test('computeLineTotals: zero tax for exempt lines', () => {
  const r = computeLineTotals(100, 3, 0, TAX_MODE.GST);
  assert.strictEqual(r.lineAmount, 300);
  assert.strictEqual(r.taxTotal, 0);
  assert.strictEqual(r.cgst, 0);
  assert.strictEqual(r.sgst, 0);
});

test('computeLineTotals: rejects invalid quantities', () => {
  assert.throws(() => computeLineTotals(100, 0, 12, TAX_MODE.GST));
  assert.throws(() => computeLineTotals(-5, 1, 12, TAX_MODE.GST));
});

test('computeBillTotals: full bill math with discount', () => {
  const lines = [
    { lineAmount: 1598, cgst: 95.88, sgst: 95.88, igst: 0, taxTotal: 191.76 },
    { lineAmount: 1299, cgst: 0, sgst: 0, igst: 233.82, taxTotal: 233.82 },
  ];
  const t = computeBillTotals(lines, 100);
  assert.strictEqual(t.subtotal, 2897);
  assert.strictEqual(t.discount, 100);
  assert.strictEqual(t.taxableAmount, 2797);
  // Tax is scaled down proportionally to the discounted base.
  assert.ok(t.totalTax < 425.58 && t.totalTax > 0);
  assert.ok(t.cgst > 0 && t.sgst > 0 && t.igst > 0);
  // grandTotal must equal taxable amount + tax.
  assert.strictEqual(t.grandTotal, Math.round((t.taxableAmount + t.totalTax) * 100) / 100);
  // And must be below the pre-discount subtotal + full tax (no inflation of totals).
  assert.ok(t.grandTotal < 2897 + 425.58);
});

test('computeBillTotals: no discount leaves totals unchanged', () => {
  const lines = [
    { lineAmount: 1000, cgst: 60, sgst: 60, igst: 0, taxTotal: 120 },
  ];
  const t = computeBillTotals(lines, 0);
  assert.strictEqual(t.subtotal, 1000);
  assert.strictEqual(t.taxableAmount, 1000);
  assert.strictEqual(t.cgst, 60);
  assert.strictEqual(t.sgst, 60);
  assert.strictEqual(t.totalTax, 120);
  assert.strictEqual(t.grandTotal, 1120);
});