'use strict';

/**
 * Date helpers. Central place so that subscription expiry, period boundaries
 * and report ranges are computed consistently.
 */

/**
 * Adds `months` calendar months to a date, clamping day-of-month to month-length
 * so edge cases like 31 Aug + 1 month do not spill into October.
 * Example: 25 Aug 2026 + 2 months => 25 Oct 2026.
 */
function addMonthsClamped(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setDate(1); // avoid overflow when the target month is shorter
  d.setMonth(d.getMonth() + months);
  const lastDayOfTarget = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDayOfTarget));
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Returns a Date set to the local start of the given day (00:00:00). */
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Returns a Date set to the local end of the given day (23:59:59.999). */
function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** First moment of the calendar month containing `date`. */
function startOfMonth(date) {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Last millisecond of the calendar month containing `date`. */
function endOfMonth(date) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + 1, 0); // last day of current month
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Whole calendar days between `from` and `to` (to - from), using UTC midnight math
 * to avoid DST drift.
 */
function differenceInDays(from, to) {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86400000);
}

function formatDate(date) {
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

module.exports = {
  addMonthsClamped,
  addDays,
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  differenceInDays,
  formatDate,
};