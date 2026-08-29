'use strict';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/billmitra_test_stock';
process.env.JWT_SECRET = 'stock-test-secret-long-enough-1111';
process.env.JWT_EXPIRES_IN = '1h';

const { before, after, test } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const { createApp } = require('../src/app');
const User = require('../src/models/User');
const Business = require('../src/models/Business');
const Product = require('../src/models/Product');
const StockTransaction = require('../src/models/StockTransaction');
const BusinessSettings = require('../src/models/BusinessSettings');

let server;
let base;
let tokenA;
let tokenB;
let bizA;
let bizB;
let widget; // tracked product, starts at 20 / min 5
let tea;    // untracked (menu) product

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
  await require('../src/config/db').ensureIndexes();
  await Promise.all([
    User.deleteMany({}),
    Business.deleteMany({}),
    Product.deleteMany({}),
    StockTransaction.deleteMany({}),
    BusinessSettings.deleteMany({}),
  ]);

  bizA = await Business.create({ businessName: 'Stk Retail', businessType: 'GROCERY', status: 'ACTIVE' });
  bizB = await Business.create({ businessName: 'Stk Cafe', businessType: 'CAFE', status: 'ACTIVE' });

  await BusinessSettings.create([
    { businessId: bizA._id, invoicePrefix: 'STK', allowNegativeStock: false },
    { businessId: bizB._id, invoicePrefix: 'STKB', allowNegativeStock: true },
  ]);

  await User.create([
    {
      businessId: bizA._id, name: 'Owner A', username: 'stk_a', email: 'a@stk.test',
      passwordHash: await bcrypt.hash('Owner@1234', 10), role: 'BUSINESS_OWNER', isActive: true,
    },
    {
      businessId: bizB._id, name: 'Owner B', username: 'stk_b', email: 'b@stk.test',
      passwordHash: await bcrypt.hash('Owner@1234', 10), role: 'BUSINESS_OWNER', isActive: true,
    },
  ]);

  widget = await Product.create({
    businessId: bizA._id, name: 'Widget', sku: 'WDG1', sellingPrice: 100,
    taxRate: 0, stockEnabled: true, currentStock: 20, minimumStock: 5,
  });
  tea = await Product.create({
    businessId: bizB._id, name: 'Tea', sellingPrice: 15, taxRate: 0, stockEnabled: false,
  });

  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${server.address().port}`;

  async function login(username) {
    const r = await send('POST', '/api/auth/owner/login', { username, password: 'Owner@1234' });
    return r.json.data.token;
  }
  tokenA = await login('stk_a');
  tokenB = await login('stk_b');
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

test('stock list returns levels with derived state (OK/LOW/OUT/N/A)', async () => {
  const res = await send('GET', '/api/stock', null, tokenA);
  assert.strictEqual(res.status, 200);
  const item = res.json.data.items.find((i) => i.id === widget._id.toString());
  assert.ok(item, 'widget present');
  assert.strictEqual(item.currentStock, 20);
  assert.strictEqual(item.stockState, 'OK');
});

test('purchase increases stock and writes a PURCHASE ledger row', async () => {
  const res = await send(
    'POST',
    '/api/stock/adjustment',
    { productId: widget._id.toString(), type: 'PURCHASE', quantity: 15 },
    tokenA
  );
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.json.data.product.currentStock, 35);
  assert.strictEqual(res.json.data.transaction.previousStock, 20);
  assert.strictEqual(res.json.data.transaction.newStock, 35);
  assert.strictEqual(res.json.data.transaction.type, 'PURCHASE');

  const db = await Product.findById(widget._id);
  assert.strictEqual(db.currentStock, 35);
});

test('return adds units back; adjustment can subtract within available stock', async () => {
  const ret = await send(
    'POST',
    '/api/stock/adjustment',
    { productId: widget._id.toString(), type: 'RETURN', quantity: 3 },
    tokenA
  );
  assert.strictEqual(ret.status, 201);
  assert.strictEqual(ret.json.data.product.currentStock, 38);

  const adj = await send(
    'POST',
    '/api/stock/adjustment',
    { productId: widget._id.toString(), type: 'ADJUSTMENT', quantity: -4 },
    tokenA
  );
  assert.strictEqual(adj.status, 201);
  assert.strictEqual(adj.json.data.product.currentStock, 34);
  assert.strictEqual(adj.json.data.transaction.previousStock, 38);
  assert.strictEqual(adj.json.data.transaction.newStock, 34);
});

test('adjustment below zero is rejected unless the tenant allows negatives', async () => {
  // Tenant A disallows negatives -> rejected, nothing changes.
  const denied = await send(
    'POST',
    '/api/stock/adjustment',
    { productId: widget._id.toString(), type: 'ADJUSTMENT', quantity: -999 },
    tokenA
  );
  assert.strictEqual(denied.status, 409);
  assert.strictEqual(denied.json.code, 'INSUFFICIENT_STOCK');
  const afterDeny = await Product.findById(widget._id);
  assert.strictEqual(afterDeny.currentStock, 34);

  // Tenant B allows negatives on its own tracked product.
  const trackedB = await Product.create({
    businessId: bizB._id, name: 'Cups', sku: 'CUP1', sellingPrice: 50,
    taxRate: 0, stockEnabled: true, currentStock: 2, minimumStock: 1,
  });
  const allowed = await send(
    'POST',
    '/api/stock/adjustment',
    { productId: trackedB._id.toString(), type: 'ADJUSTMENT', quantity: -5 },
    tokenB
  );
  assert.strictEqual(allowed.status, 201);
  assert.strictEqual(allowed.json.data.product.currentStock, -3);
});

test('opening sets an absolute count and logs previous->new', async () => {
  const res = await send(
    'POST',
    '/api/stock/adjustment',
    { productId: widget._id.toString(), type: 'OPENING', quantity: 100 },
    tokenA
  );
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.json.data.product.currentStock, 100);
  assert.strictEqual(res.json.data.transaction.previousStock, 34);
  assert.strictEqual(res.json.data.transaction.newStock, 100);

  const neg = await send(
    'POST',
    '/api/stock/adjustment',
    { productId: widget._id.toString(), type: 'OPENING', quantity: -1 },
    tokenA
  );
  assert.strictEqual(neg.status, 422);
});

test('SALE cannot be recorded through the manual endpoint', async () => {
  const res = await send(
    'POST',
    '/api/stock/adjustment',
    { productId: widget._id.toString(), type: 'SALE', quantity: 1 },
    tokenA
  );
  assert.strictEqual(res.status, 422); // not in enum
});

test('untracked product rejects adjustments with STOCK_DISABLED', async () => {
  // tea belongs to B; A gets a clean 404 first (tenant isolation).
  const foreign = await send(
    'POST',
    '/api/stock/adjustment',
    { productId: tea._id.toString(), type: 'PURCHASE', quantity: 5 },
    tokenA
  );
  assert.strictEqual(foreign.status, 404);

  const ownUntracked = await send(
    'POST',
    '/api/stock/adjustment',
    { productId: tea._id.toString(), type: 'PURCHASE', quantity: 5 },
    tokenB
  );
  assert.strictEqual(ownUntracked.status, 400);
  assert.strictEqual(ownUntracked.json.code, 'STOCK_DISABLED');
});

test('low-stock endpoint and status filter work; ledger history is scoped', async () => {
  // Drive widget to exactly minimum so it flags LOW.
  const toLow = await send(
    'POST',
    '/api/stock/adjustment',
    { productId: widget._id.toString(), type: 'ADJUSTMENT', quantity: -95 }, // 100 -> 5
    tokenA
  );
  assert.strictEqual(toLow.status, 201);

  const low = await send('GET', '/api/stock/low', null, tokenA);
  assert.strictEqual(low.status, 200);
  const lowItem = low.json.data.items.find((i) => i.id === widget._id.toString());
  assert.ok(lowItem, 'widget flagged as low');
  assert.strictEqual(lowItem.stockState, 'LOW');

  const byStatus = await send('GET', '/api/stock?status=LOW', null, tokenA);
  assert.ok(byStatus.json.data.items.some((i) => i.id === widget._id.toString()));

  const ledger = await send('GET', `/api/stock/${widget._id}/transactions`, null, tokenA);
  assert.strictEqual(ledger.status, 200);
  const types = ledger.json.data.transactions.map((t) => t.type);
  assert.ok(types.includes('PURCHASE'));
  assert.ok(types.includes('ADJUSTMENT'));
  assert.ok(types.includes('OPENING'));
  assert.ok(!types.includes('SALE'));

  // Owner B cannot read A's ledger.
  const foreignLedger = await send('GET', `/api/stock/${widget._id}/transactions`, null, tokenB);
  assert.strictEqual(foreignLedger.status, 404);
});

module.exports = {};