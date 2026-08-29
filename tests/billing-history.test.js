'use strict';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/billmitra_test_bill2';
process.env.JWT_SECRET = 'bill2-test-secret-long-enough-2222';
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

let server;
let base;
let tokenA;
let tokenB;
let bizA;
let prodA;
let prodB;

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

async function createBill(token, key, qty = 1, method = 'CASH') {
  return send(
    'POST',
    '/api/bills',
    { items: [{ productId: prodA._id.toString(), quantity: qty }], paymentMethod: method, idempotencyKey: key },
    token
  );
}

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 6000 });
  // Wait for unique index builds before any writes (see config/db.js).
  await require('../src/config/db').ensureIndexes();
  await Promise.all([
    User.deleteMany({}),
    Business.deleteMany({}),
    Product.deleteMany({}),
    Bill.deleteMany({}),
    mongoose.connection.collection('counters').deleteMany({}),
    mongoose.connection.collection('businesssettings').deleteMany({}),
  ]);

  bizA = await Business.create({ businessName: 'Hist Retail', businessType: 'GARMENT', status: 'ACTIVE' });
  const bizB = await Business.create({ businessName: 'Hist Cafe', businessType: 'CAFE', status: 'ACTIVE' });

  const BusinessSettings = require('../src/models/BusinessSettings');
  await BusinessSettings.create([
    { businessId: bizA._id, invoicePrefix: 'HRA' },
    { businessId: bizB._id, invoicePrefix: 'HRB' },
  ]);

  await User.create([
    {
      businessId: bizA._id, name: 'Owner A', username: 'hist_a', email: 'a@hist.test',
      passwordHash: await bcrypt.hash('Owner@1234', 10), role: 'BUSINESS_OWNER', isActive: true,
    },
    {
      businessId: bizB._id, name: 'Owner B', username: 'hist_b', email: 'b@hist.test',
      passwordHash: await bcrypt.hash('Owner@1234', 10), role: 'BUSINESS_OWNER', isActive: true,
    },
  ]);

  prodA = await Product.create({
    businessId: bizA._id, name: 'Kurta', sku: 'KUR1', sellingPrice: 800,
    taxRate: 12, stockEnabled: true, currentStock: 50, minimumStock: 5,
  });
  // Tenant B sells its own menu item so cross-tenant billing stays impossible.
  prodB = await Product.create({
    businessId: bizB._id, name: 'Tea', sellingPrice: 20, taxRate: 0,
    stockEnabled: false,
  });

  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${server.address().port}`;

  async function login(username) {
    const r = await send('POST', '/api/auth/owner/login', { username, password: 'Owner@1234' });
    return r.json.data.token;
  }
  tokenA = await login('hist_a');
  tokenB = await login('hist_b');
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

test('invoice numbers increment atomically per tenant per year', async () => {
  const b1 = await createBill(tokenA, 'seq-key-001');
  const b2 = await createBill(tokenA, 'seq-key-002');
  assert.strictEqual(b1.json.data.bill.invoiceNumber, `HRA-${new Date().getFullYear()}-000001`);
  assert.strictEqual(b2.json.data.bill.invoiceNumber, `HRA-${new Date().getFullYear()}-000002`);

  // Tenant B has its own independent sequence (billing its OWN product).
  const b3 = await send(
    'POST',
    '/api/bills',
    { items: [{ productId: prodB._id.toString(), quantity: 2 }], paymentMethod: 'CASH', idempotencyKey: 'seq-key-003' },
    tokenB
  );
  assert.strictEqual(b3.status, 201);
  assert.ok(b3.json.data.bill.invoiceNumber.startsWith('HRB-'));
  // And B billing A's product is still refused.
  const cross = await createBill(tokenB, 'seq-cross-001');
  assert.strictEqual(cross.status, 400);
  assert.strictEqual(cross.json.code, 'INVALID_PRODUCT');
});

test('tenant isolation: owner B cannot read or reprint A bill; lists are scoped', async () => {
  const mine = await createBill(tokenA, 'iso-bill-001');
  const id = mine.json.data.bill.id;

  const read = await send('GET', `/api/bills/${id}`, null, tokenB);
  assert.strictEqual(read.status, 404);

  const reprint = await send('POST', `/api/bills/${id}/reprint`, {}, tokenB);
  assert.strictEqual(reprint.status, 404);

  // Even a targeted search cannot leak A's bills into B's list.
  const listB = await send('GET', `/api/bills?search=${mine.json.data.bill.invoiceNumber}`, null, tokenB);
  assert.strictEqual(listB.json.data.bills.length, 0);
});

test('bill history: payment-method filter, search and pagination work', async () => {
  const upi = await send(
    'POST',
    '/api/bills',
    { items: [{ productId: prodA._id.toString(), quantity: 2 }], paymentMethod: 'UPI', customerName: 'Ravi Kumar', idempotencyKey: 'hist-upi-001' },
    tokenA
  );
  assert.strictEqual(upi.status, 201);

  const byMethod = await send('GET', '/api/bills?paymentMethod=UPI', null, tokenA);
  assert.ok(byMethod.json.data.bills.every((b) => b.paymentMethod === 'UPI'));
  assert.ok(byMethod.json.data.bills.length >= 1);

  const bySearch = await send('GET', '/api/bills?search=Ravi', null, tokenA);
  assert.strictEqual(bySearch.json.data.bills.length, 1);

  const paged = await send('GET', '/api/bills?page=1&limit=1', null, tokenA);
  assert.strictEqual(paged.json.data.bills.length, 1);
  assert.ok(paged.json.data.pagination.total >= 2);
});

test('reprint increments the counter and never mutates financial fields', async () => {
  const created = await createBill(tokenA, 'reprint-001');
  const id = created.json.data.bill.id;
  const before = created.json.data.bill;

  const r1 = await send('POST', `/api/bills/${id}/reprint`, {}, tokenA);
  assert.strictEqual(r1.status, 200);
  assert.strictEqual(r1.json.data.bill.reprintCount, 1);

  const r2 = await send('POST', `/api/bills/${id}/reprint`, {}, tokenA);
  assert.strictEqual(r2.json.data.bill.reprintCount, 2);

  ['subtotal', 'totalTax', 'grandTotal', 'invoiceNumber'].forEach((f) => {
    assert.strictEqual(r2.json.data.bill[f], before[f]);
  });
});

test('foreign/unknown product is rejected for this tenant', async () => {
  const foreign = new mongoose.Types.ObjectId().toString();
  const res = await send(
    'POST',
    '/api/bills',
    { items: [{ productId: foreign, quantity: 1 }], paymentMethod: 'CASH', idempotencyKey: 'foreign-001' },
    tokenA
  );
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.json.code, 'INVALID_PRODUCT');
});

module.exports = {};