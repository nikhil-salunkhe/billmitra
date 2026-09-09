'use strict';

/**
 * Centralized formatting utilities for PDF generation.
 * English-only. Indian currency (₹ with Indian grouping), dates, times, quantities.
 */

const INDIAN_GROUP = /(\d+?)(?=(\d{2})+(?!\d))/g;

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Format as Indian currency: ₹1,25,000.00
 * Always two decimal places. Handles negative (prefixes - before ₹).
 */
function formatCurrency(value) {
  const n = round2(value || 0);
  const neg = n < 0;
  const abs = Math.abs(n);
  const [rupees, paise] = abs.toFixed(2).split('.');
  let grouped = rupees;
  if (rupees.length > 3) {
    // Indian grouping: last 3 digits, then groups of 2 from the right
    const last3 = rupees.slice(-3);
    const rest = rupees.slice(0, -3);
    const groupedRest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    grouped = groupedRest ? groupedRest + ',' + last3 : last3;
  }
  return `${neg ? '-' : ''}₹${grouped}.${paise}`;
}

/**
 * Format quantity: integers shown as-is, decimals trimmed (2.5 not 2.5000).
 */
function formatQuantity(value) {
  const n = Number(value || 0);
  if (Number.isInteger(n)) return String(n);
  return String(round2(n));
}

/**
 * Format date from ISO/Date to "09 Sep 2026".
 */
function formatDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Format time from ISO/Date to "07:45 PM".
 */
function formatTime(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  let h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`;
}

/**
 * Format date+time: "09 Sep 2026, 07:45 PM".
 */
function formatDateTime(value) {
  const d = formatDate(value);
  const t = formatTime(value);
  return t ? `${d}, ${t}` : d;
}

/**
 * Convert a number to English words (for "Amount in Words" on bills).
 */
function amountToWords(amount) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
    'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function twoDigit(n) {
    if (n === 0) return '';
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (ones[n % 10] ? ' ' + ones[n % 10] : '');
  }

  function threeDigit(n) {
    let s = '';
    if (n >= 100) s += ones[Math.floor(n / 100)] + ' Hundred';
    const rem = n % 100;
    if (rem) s += (s ? ' and ' : '') + twoDigit(rem);
    return s;
  }

  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);

  if (rupees === 0 && paise === 0) return 'Zero Rupees Only';

  const groups = [];
  let n = rupees;
  groups.push(n % 1000); n = Math.floor(n / 1000);
  while (n > 0) { groups.push(n % 100); n = Math.floor(n / 100); }

  const labels = ['', 'Thousand', 'Lakh', 'Crore'];
  let words = '';
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i]) words += (words ? ' ' : '') + threeDigit(groups[i]) + ' ' + labels[i];
  }

  words = words.trim() + ' Rupees';
  if (paise) words += ' and ' + twoDigit(paise) + ' Paise';
  words += ' Only';
  return words;
}

module.exports = {
  formatCurrency,
  formatQuantity,
  formatDate,
  formatTime,
  formatDateTime,
  amountToWords,
  round2,
};
