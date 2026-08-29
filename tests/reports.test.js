'use strict';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/billmitra_test_reports';
process.env.JWT_SECRET = 'reports-test-secret-long-enough-0001';
process.env.JWT_EXPIRES_IN = '1h';

const { before, after, test } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const { createApp } = require('../src/app');
const User = require('../src/models/User');
const Business = require('../src/models/Business');
const Product = require('../src/models/Product');
const Bill = require('../src/models/Bill');
const BusinessSettings = require('../src/models/BusinessSettings');
const { startOfMonth, addMonthsClamped } = require('../src/utils/dateUtils');

let server;
let base;
let tokenA;
let tokenB;
let bizA;
let bizB;

// Server-local offset so report windows align with how we seed/expect.
const TZ_OFF = -new Date().getTimezoneOffset();
const Q_TZ = `tzOffsetMinutes=${TZ_OFF}`;

const seeds = []; // {createdAt, subtotal, discount, totalTax, grandTotal, method}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function sameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}
function inBucket(d, bucket) {
  const now = new Date();
  if (bucket === 'today') return sameDay(d, now);
  if (bucket === 'yesterday') return sameDay(d, addDaysLocal(now, -1));
  if (bucket === 'this_month') return sameMonth(d, now) && d <= now;
  if (bucket === 'last_month') {
    const prev = addMonthsClamped(now, -1);
    return sameMonth(d, prev);
  }
  return false;
}
function addDaysLocal(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

async function send(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

async function seedBill({ key, method, items, discount = 0, when }) {
  // items: [{product, qty}]
  const body = {
    items: items.map(({ product, qty }) => ({ productId: product._id.toString(), quantity: qty })),
    paymentMethod: method,
    discount,
    idempotencyKey: key,
  };
  const res = await send('POST', '/api/bills', body, tokenA);
  assert.strictEqual(res.status, 201, `seed bill ${key} failed`);
  const id = res.json.data.bill.id;

  let createdAt = new Date();
  const now = new Date();
  if (when === 'yesterday') {
    createdAt = addDaysLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12), -1);
  } else if (when === 'last_month') {
    createdAt = addMonthsClamped(now, -1);
  } else if (when === 'month_start') {
    createdAt = new Date(startOfMonth(now).getTime() + 12 * 3600000);
    if (!(createdAt <= now)) return null; // today IS the 1st morning; skip safely
  }
  // 'now' -> leave as-is (always lands in today).

  await Bill.updateOne({ _id: id }, { $set: { createdAt, updatedAt: createdAt } });
  const doc = await Bill.findById(id).lean();
  const rec = {
    createdAt: doc.createdAt,
    subtotal: doc.subtotal,
    discount: doc.discount,
    totalTax: doc.totalTax,
    grandTotal: doc.grandTotal,
    method: doc.paymentMethod,
    items: doc.items,
  };
  seeds.push(rec);
  return rec;
}

let p1;
let p2;
let hasMonthStartSeed = false;

function totalsFor(bucket) {
  const rows = seeds.filter((s) => inBucket(s.createdAt, bucket));
  const t = {
    bills: rows.length,
    grossSales: 0,
    discount: 0,
    totalTax: 0,
    netSales: 0,
    itemsSold: 0,
  };
  for (const r of rows) {
    t.grossSales += r.subtotal;
    t.discount += r.discount;
    t.totalTax += r.totalTax;
    t.netSales += r.grandTotal;
    t.itemsSold += r.items.reduce((s, i) => s + i.quantity, 0);
  }
  return t;
}
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 6000 });
  await require('../src/config/db').ensureIndexes();
  await Promise.all([
    User.deleteMany({}),
    Business.deleteMany({}),
    Product.deleteMany({}),
    Bill.deleteMany({}),
    BusinessSettings.deleteMany({}),
    mongoose.connection.collection('counters').deleteMany({}),
  ]);

  bizA = await Business.create({ businessName: 'Rep Retail', businessType: 'GROCERY', status: 'ACTIVE' });
  bizB = await Business.create({ businessName: 'Rep Cafe', businessType: 'CAFE', status: 'ACTIVE' });

  await BusinessSettings.create([
    { businessId: bizA._id, invoicePrefix: 'RPA', defaultTaxMode: 'GST' },
    { businessId: bizB._id, invoicePrefix: 'RPB', defaultTaxMode: 'GST' },
  ]);

  await User.create([
    {
      businessId: bizA._id, name: 'Owner A', username: 'rep_a', email: 'a@rep.test',
      passwordHash: await bcrypt.hash('Owner@1234', 10), role: 'BUSINESS_OWNER', isActive: true,
    },
    {
      businessId: bizB._id, name: 'Owner B', username: 'rep_b', email: 'b@rep.test',
      passwordHash: await bcrypt.hash('Owner@1234', 10), role: 'BUSINESS_OWNER', isActive: true,
    },
  ]);

  p1 = await Product.create({
    businessId: bizA._id, name: 'Atta 10kg', sku: 'ATT1', sellingPrice: 100,
    taxRate: 10, stockEnabled: true, currentStock: 100, minimumStock: 5,
  }); // line: 100 -> tax 20 on x2 (CGST 10/SGST 10)
  p2 = await Product.create({
    businessId: bizA._id, name: 'Ghee 1L', sku: 'GHE1', sellingPrice: 200,
    taxRate: 0, stockEnabled: true, currentStock: 50, minimumStock: 5,
  });

  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${server.address().port}`;

  async function login(username) {
    const r = await send('POST', '/api/auth/owner/login', { username, password: 'Owner@1234' });
    return r.json.data.token;
  }
  tokenA = await login('rep_a');
  tokenB = await login('rep_b');

  // Seed a deterministic, calendar-safe dataset.
  await seedBill({ key: 'rpt-today-a', method: 'CASH', items: [{ product: p1, qty: 2 }], when: 'now' });
  await seedBill({
    key: 'rpt-today-b', method: 'UPI', items: [{ product: p2, qty: 1 }],
    discount: 50, when: 'now',
  });
  await seedBill({ key: 'rpt-yest-c', method: 'CARD', items: [{ product: p1, qty: 1 }], when: 'yesterday' });
  await seedBill({ key: 'rpt-lm-d', method: 'CASH', items: [{ product: p2, qty: 3 }], when: 'last_month' });
  const e = await seedBill({
    key: 'rpt-ms-e', method: 'UPI', items: [{ product: p1, qty: 1 }], when: 'month_start',
  });
  hasMonthStartSeed = Boolean(e);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

function localLabel(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

test('sales report for TODAY matches seeded totals, methods and daily series', async () => {
  const exp = totalsFor('today');
  const res = await send('GET', `/api/reports/sales?period=today&${Q_TZ}`, null, tokenA);
  assert.strictEqual(res.status, 200);

  const t = res.json.data.totals;
  assert.strictEqual(t.bills, exp.bills);
  assert.strictEqual(round2(t.grossSales), round2(exp.grossSales));
  assert.strictEqual(round2(t.discount), round2(exp.discount));
  assert.strictEqual(round2(t.totalTax), round2(exp.totalTax));
  assert.strictEqual(round2(t.netSales), round2(exp.netSales));
  assert.strictEqual(t.itemsSold, exp.itemsSold);

  // Payment breakdown sums to the same net.
  const methodSum = round2(res.json.data.byMethod.reduce((s, m) => s + m.amount, 0));
  assert.strictEqual(methodSum, round2(exp.netSales));

  // Daily series contains today's label with the right net.
  const todayLabel = localLabel(new Date());
  const row = res.json.data.series.find((s) => s.label === todayLabel);
  assert.ok(row, `series should include ${todayLabel}`);
  assert.strictEqual(row.net, round2(exp.netSales));
});

test('this_month and last_month windows are correct and disjoint', async () => {
  const tmExp = totalsFor('this_month');
  const lmExp = totalsFor('last_month');

  const tm = await send('GET', `/api/reports/sales?period=this_month&groupBy=month&${Q_TZ}`, null, tokenA);
  assert.strictEqual(tm.status, 200);
  assert.strictEqual(tm.json.data.totals.bills, tmExp.bills);
  assert.strictEqual(round2(tm.json.data.totals.netSales), round2(tmExp.netSales));

  const now = new Date();
  const monthLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const row = tm.json.data.series.find((s) => s.label === monthLabel);
  assert.ok(row, 'monthly series includes current month');
  assert.strictEqual(row.net, round2(tmExp.netSales));

  const lm = await send('GET', `/api/reports/sales?period=last_month&${Q_TZ}`, null, tokenA);
  assert.strictEqual(lm.json.data.totals.bills, lmExp.bills);
  assert.strictEqual(round2(lm.json.data.totals.netSales), round2(lmExp.netSales));
});

test('custom range spanning two months aggregates both and buckets monthly', async () => {
  const now = new Date();
  const prev = addMonthsClamped(now, -1);
  const p = (n) => String(n).padStart(2, '0');
  const from = `${prev.getFullYear()}-${p(prev.getMonth() + 1)}-01`;
  const to = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;

  const expNet = round2(totalsFor('last_month').netSales + totalsFor('this_month').netSales);
  const expBills = totalsFor('last_month').bills + totalsFor('this_month').bills;

  const res = await send(
    'GET',
    `/api/reports/sales?period=custom&from=${from}&to=${to}&groupBy=month&${Q_TZ}`,
    null,
    tokenA
  );
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.data.totals.bills, expBills);
  assert.strictEqual(round2(res.json.data.totals.netSales), expNet);
  assert.ok(res.json.data.series.length >= 1 && res.json.data.series.length <= 2);
});

test('top products report ranks by revenue within tenant', async () => {
  const res = await send(
    'GET',
    `/api/reports/products?period=this_month&limit=5&${Q_TZ}`,
    null,
    tokenA
  );
  assert.strictEqual(res.status, 200);
  const rows = res.json.data.topProducts;

  const expectMap = new Map();
  for (const s of seeds.filter((x) => inBucket(x.createdAt, 'this_month'))) {
    for (const it of s.items) {
      const cur = expectMap.get(it.name) || { quantity: 0, revenue: 0 };
      cur.quantity += it.quantity;
      cur.revenue += it.lineAmount;
      expectMap.set(it.name, cur);
    }
  }
  assert.strictEqual(rows.length, expectMap.size);

  const sorted = [...expectMap.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
  rows.forEach((row, idx) => {
    const [name, exp] = sorted[idx];
    assert.strictEqual(row.name, name);
    assert.strictEqual(row.quantity, exp.quantity);
    assert.strictEqual(round2(row.revenue), round2(exp.revenue));
  });
});

test('payments report mirrors sales breakdown for the range', async () => {
  const exp = totalsFor('today');
  const res = await send('GET', `/api/reports/payments?period=today&${Q_TZ}`, null, tokenA);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.data.totals.bills, exp.bills);
  assert.strictEqual(round2(res.json.data.totals.netSales), round2(exp.netSales));

  const methodSum = round2(res.json.data.byMethod.reduce((s, m) => s + m.amount, 0));
  assert.strictEqual(methodSum, round2(exp.netSales));
});

test('validation: custom without dates / reversed range / oversized span -> 422', async () => {
  const noDates = await send('GET', '/api/reports/sales?period=custom', null, tokenA);
  assert.strictEqual(noDates.status, 422);

  const reversed = await send(
    'GET',
    `/api/reports/sales?period=custom&from=2026-05-10&to=2026-05-01`,
    null,
    tokenA
  );
  assert.strictEqual(reversed.status, 422);

  const d1 = new Date(Date.now() - 401 * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  const f = `${d1.getFullYear()}-${p(d1.getMonth() + 1)}-${p(d1.getDate())}`;
  const n2 = new Date();
  const t = `${n2.getFullYear()}-${p(n2.getMonth() + 1)}-${p(n2.getDate())}`;
  const huge = await send(
    'GET',
    `/api/reports/sales?period=custom&from=${f}&to=${t}&${Q_TZ}`,
    null,
    tokenA
  );
  assert.strictEqual(huge.status, 422);
});

test('tenant isolation: owner B gets empty reports despite same server/db', async () => {
  const s = await send('GET', `/api/reports/sales?period=this_month&${Q_TZ}`, null, tokenB);
  assert.strictEqual(s.json.data.totals.bills, 0);
  assert.strictEqual(s.json.data.byMethod.length, 0);

  const pr = await send('GET', `/api/reports/products?period=this_month&${Q_TZ}`, null, tokenB);
  assert.strictEqual(pr.json.data.topProducts.length, 0);
});

module.exports = {};