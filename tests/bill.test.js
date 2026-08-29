'use strict';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/billmitra_test_bill';
process.env.JWT_SECRET = 'bill-test-secret-long-enough-3333';
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
const StockTransaction = require('../src/models/StockTransaction');

let server;
let base;
let tokenA;
let tokenB;
let bizA;
let bizB;
let rice; // stock-enabled product
let dosa; // menu item (no stock)

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

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 6000 });
  // Wait for unique index builds before any writes (see config/db.js).
  await require('../src/config/db').ensureIndexes();
  await Promise.all([
    User.deleteMany({}),
    Business.deleteMany({}),
    Product.deleteMany({}),
    Bill.deleteMany({}),
    StockTransaction.deleteMany({}),
    mongoose.connection.collection('counters').deleteMany({}),
    mongoose.connection.collection('businesssettings').deleteMany({}),
  ]);

  bizA = await Business.create({ businessName: 'Bill Retail', businessType: 'GROCERY', status: 'ACTIVE' });
  bizB = await Business.create({ businessName: 'Bill Cafe', businessType: 'CAFE', status: 'ACTIVE' });

  const BusinessSettings = require('../src/models/BusinessSettings');
  await BusinessSettings.create([
    { businessId: bizA._id, invoicePrefix: 'BLA', defaultTaxMode: 'GST', allowNegativeStock: false },
    { businessId: bizB._id, invoicePrefix: 'BLB', defaultTaxMode: 'GST' },
  ]);

  await User.create([
    {
      businessId: bizA._id, name: 'Owner A', username: 'bill_a', email: 'a@bill.test',
      passwordHash: await bcrypt.hash('Owner@1234', 10), role: 'BUSINESS_OWNER', isActive: true,
    },
    {
      businessId: bizB._id, name: 'Owner B', username: 'bill_b', email: 'b@bill.test',
      passwordHash: await bcrypt.hash('Owner@1234', 10), role: 'BUSINESS_OWNER', isActive: true,
    },
  ]);

  rice = await Product.create({
    businessId: bizA._id, name: 'Rice 5kg', sku: 'RICE5', sellingPrice: 450,
    taxRate: 5, stockEnabled: true, currentStock: 10, minimumStock: 2,
  });
  dosa = await Product.create({
    businessId: bizB._id, name: 'Dosa', sellingPrice: 90, taxRate: 0, stockEnabled: false,
  });

  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${server.address().port}`;

  async function login(username) {
    const r = await send('POST', '/api/auth/owner/login', { username, password: 'Owner@1234' });
    return r.json.data.token;
  }
  tokenA = await login('bill_a');
  tokenB = await login('bill_b');
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

test('creates a bill with server-computed totals, invoice number and stock deduction', async () => {
  const res = await send(
    'POST',
    '/api/bills',
    {
      items: [{ productId: rice._id.toString(), quantity: 2 }], // 2 x 450 = 900, 5% = 45
      paymentMethod: 'CASH',
      customerName: 'Walk-in',
      idempotencyKey: 'bill-test-001',
    },
    tokenA
  );
  assert.strictEqual(res.status, 201);
  const b = res.json.data.bill;

  // Server-authoritative math (client sent no prices at all).
  assert.strictEqual(b.subtotal, 900);
  assert.strictEqual(b.totalTax, 45);
  assert.strictEqual(b.grandTotal, 945);
  assert.strictEqual(b.items[0].unitPrice, 450); // from DB, not client

  // Invoice number format PREFIX-YYYY-000001.
  assert.strictEqual(b.invoiceNumber, `BLA-${new Date().getFullYear()}-000001`);

  // Friendly aliases the owner app / receipt builder rely on must always be
  // present (they previously read bill.totalAmount and rendered ₹0.00).
  assert.strictEqual(b.billNumber, b.invoiceNumber);
  assert.strictEqual(b.totalAmount, b.grandTotal);
  assert.strictEqual(b.discountAmount, b.discount);
  assert.strictEqual(b.paidAmount, b.grandTotal); // CASH bill defaults to PAID
  assert.strictEqual(b.dueAmount, 0);

  // Stock deducted: 10 -> 8, with a ledger entry.
  const p = await Product.findById(rice._id);
  assert.strictEqual(p.currentStock, 8);

  const txs = await StockTransaction.find({ businessId: bizA._id, type: 'SALE' });
  assert.strictEqual(txs.length, 1);
  assert.strictEqual(txs[0].previousStock, 10);
  assert.strictEqual(txs[0].newStock, 8);
  assert.strictEqual(txs[0].quantity, 2);
});

test('idempotency key prevents duplicate bills on retry', async () => {
  const payload = {
    items: [{ productId: rice._id.toString(), quantity: 1 }],
    paymentMethod: 'UPI',
    idempotencyKey: 'retry-key-999',
  };
  const first = await send('POST', '/api/bills', payload, tokenA);
  assert.strictEqual(first.status, 201);

  const second = await send('POST', '/api/bills', { ...payload }, tokenA);
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.json.data.bill.invoiceNumber, first.json.data.bill.invoiceNumber);

  // Exactly one bill exists for the key; stock deducted once only.
  const count = await Bill.countDocuments({ businessId: bizA._id, idempotencyKey: 'retry-key-999' });
  assert.strictEqual(count, 1);
  const p = await Product.findById(rice._id);
  assert.strictEqual(p.currentStock, 7); // 8 - 1, not 6
});

test('insufficient stock is rejected with no partial writes', async () => {
  const beforeCount = await Bill.countDocuments({ businessId: bizA._id });
  const res = await send(
    'POST',
    '/api/bills',
    {
      items: [{ productId: rice._id.toString(), quantity: 999 }],
      paymentMethod: 'CASH',
      idempotencyKey: 'over-stock-001',
    },
    tokenA
  );
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.json.code, 'INSUFFICIENT_STOCK');

  const afterCount = await Bill.countDocuments({ businessId: bizA._id });
  assert.strictEqual(afterCount, beforeCount); // nothing persisted
  const p = await Product.findById(rice._id);
  assert.strictEqual(p.currentStock, 7); // untouched
});

test('client-sent prices are ignored — DB price wins (anti-tamper)', async () => {
  // Payload tries to sneak a fake price field; schema is strict so unknown keys
  // are rejected outright.
  const res = await send(
    'POST',
    '/api/bills',
    {
      items: [{ productId: rice._id.toString(), quantity: 1, unitPrice: 1 }],
      paymentMethod: 'CASH',
      idempotencyKey: 'tamper-attempt-1',
    },
    tokenA
  );
  assert.strictEqual(res.status, 422); // .strict() rejects unknown fields
});

test('validation rejects empty items, zero qty, bad method, short key', async () => {
  const noItems = await send('POST', '/api/bills', { items: [], paymentMethod: 'CASH', idempotencyKey: 'abc12345' }, tokenA);
  assert.strictEqual(noItems.status, 422);

  const zeroQty = await send('POST', '/api/bills', { items: [{ productId: rice._id.toString(), quantity: 0 }], paymentMethod: 'CASH', idempotencyKey: 'abc12346' }, tokenA);
  assert.strictEqual(zeroQty.status, 422);

  const badMethod = await send('POST', '/api/bills', { items: [{ productId: rice._id.toString(), quantity: 1 }], paymentMethod: 'BITCOIN', idempotencyKey: 'abc12347' }, tokenA);
  assert.strictEqual(badMethod.status, 422);

  const shortKey = await send('POST', '/api/bills', { items: [{ productId: rice._id.toString(), quantity: 1 }], paymentMethod: 'CASH', idempotencyKey: 'short' }, tokenA);
  assert.strictEqual(shortKey.status, 422);
});

test('menu item bills skip stock entirely (hotel/cafe mode)', async () => {
  const res = await send(
    'POST',
    '/api/bills',
    { items: [{ productId: dosa._id.toString(), quantity: 3 }], paymentMethod: 'CARD', idempotencyKey: 'cafe-bill-001' },
    tokenB
  );
  assert.strictEqual(res.status, 201);
  const b = res.json.data.bill;
  assert.strictEqual(b.subtotal, 270);
  assert.strictEqual(b.totalTax, 0);
  assert.strictEqual(b.items[0].stockEnabled, false);

  // No stock transactions for a stock-disabled product.
  const txs = await StockTransaction.find({ productId: dosa._id });
  assert.strictEqual(txs.length, 0);
});

module.exports = {};