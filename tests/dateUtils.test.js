'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  addMonthsClamped,
  addDays,
  differenceInDays,
  formatDate,
  startOfDay,
  endOfDay,
} = require('../src/utils/dateUtils');

test('addMonthsClamped: 25 Aug 2026 + 2 months => 25 Oct 2026', () => {
  const d = addMonthsClamped(new Date(2026, 7, 25), 2); // Aug is month index 7
  assert.strictEqual(d.getDate(), 25);
  assert.strictEqual(d.getMonth(), 9); // Oct
  assert.strictEqual(d.getFullYear(), 2026);
});

test('addMonthsClamped: month-end clamps (31 Jan + 1 month => 28 Feb)', () => {
  const d = addMonthsClamped(new Date(2026, 0, 31), 1);
  assert.strictEqual(d.getMonth(), 1); // Feb
  assert.strictEqual(d.getDate(), 28);
});

test('addMonthsClamped: year rollover', () => {
  const d = addMonthsClamped(new Date(2026, 10, 15), 2); // Nov 2026 + 2 => Jan 2027
  assert.strictEqual(d.getFullYear(), 2027);
  assert.strictEqual(d.getMonth(), 0);
});

test('differenceInDays works across months', () => {
  const a = new Date(2026, 7, 25); // 25 Aug
  const b = new Date(2026, 9, 25); // 25 Oct
  assert.strictEqual(differenceInDays(a, b), 61);
});

test('formatDate pads day and month', () => {
  assert.strictEqual(formatDate(new Date(2026, 7, 25)), '25-08-2026');
});

test('startOfDay/endOfDay bound to midnight', () => {
  const s = startOfDay(new Date(2026, 7, 25, 14, 30, 0));
  assert.strictEqual(s.getHours(), 0);
  const e = endOfDay(new Date(2026, 7, 25, 14, 30, 0));
  assert.strictEqual(e.getDate(), 25);
  assert.ok([23].includes(e.getHours()));
});