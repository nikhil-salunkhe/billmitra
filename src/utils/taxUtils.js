'use strict';

const { ApiError } = require('./ApiError');
const { TAX_MODE } = require('../config/constants');

/**
 * GST / tax computation. Centralized so billing math lives in exactly one place,
 * is server-side authoritative and unit-testable.
 *
 * Amounts are rounded to two decimals at the end to avoid floating-point drift.
 */

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Compute tax for a single line.
 * @param {number} price - unit selling price
 * @param {number} qty - quantity
 * @param {number} taxRate - GST percentage for the line (0 = exempt), non-negative
 * @param {string} taxMode - one of TAX_MODE.GST | TAX_MODE.IGST | TAX_MODE.NONE
 */
function computeLineTotals(price, qty, taxRate = 0, taxMode = TAX_MODE.GST) {
  if (!Number.isFinite(price) || price < 0) {
    throw ApiError.badRequest('Invalid price', 'INVALID_PRICE');
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    throw ApiError.badRequest('Invalid quantity', 'INVALID_QTY');
  }
  const rate = Number.isFinite(taxRate) && taxRate > 0 ? taxRate : 0;
  const mode = rate > 0 ? taxMode : TAX_MODE.NONE;

  const lineAmount = round2(price * qty);
  const taxAmount = round2((lineAmount * rate) / 100);

  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  if (mode === TAX_MODE.IGST) {
    igst = taxAmount;
  } else if (mode === TAX_MODE.GST) {
    cgst = round2(taxAmount / 2);
    sgst = round2(taxAmount - cgst); // absorb the rounding remainder
  }

  return { lineAmount, taxTotal: taxAmount, cgst, sgst, igst };
}

/**
 * Aggregate billing lines plus a whole-bill discount.
 *
 * Discount is applied before tax: the taxable base is reduced and line tax is
 * scaled proportionally (standard GST practice where the discount reduces the
 * taxable value).
 *
 * @returns {subtotal, discount, taxableAmount, cgst, sgst, igst, totalTax, grandTotal}
 */
function computeBillTotals(lines, discount = 0) {
  const d = Number.isFinite(discount) && discount > 0 ? discount : 0;

  const subtotal = round2(lines.reduce((s, l) => s + l.lineAmount, 0));
  const taxableAmount = Math.max(0, round2(subtotal - d));

  const sum = (key) => round2(lines.reduce((s, l) => s + (l[key] || 0), 0));
  let cgst = sum('cgst');
  let sgst = sum('sgst');
  let igst = sum('igst');

  // Scale precomputed tax lines to the discounted taxable base.
  if (subtotal > 0 && taxableAmount !== subtotal) {
    const ratio = taxableAmount / subtotal;
    cgst = round2(cgst * ratio);
    sgst = round2(sgst * ratio);
    igst = round2(igst * ratio);
  }

  const totalTax = round2(cgst + sgst + igst);
  const grandTotal = round2(taxableAmount + totalTax);

  return { subtotal, discount: d, taxableAmount, cgst, sgst, igst, totalTax, grandTotal };
}

module.exports = {
  round2,
  computeLineTotals,
  computeBillTotals,
  TAX_MODE,
};