'use strict';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/billmitra_test_sync';
process.env.JWT_SECRET = 'sync-test-secret-long-enough-3333';
process.env.JWT_EXPIRES_IN = '1h';

const { before, after, test } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const { createApp } = require('../src/app');
const User = require('../src/models/User');
const Business = require('../src/models/Business');
const BusinessSettings = require('../src/models/BusinessSettings');
const Product = require('../src/models/Product');
const Bill = require('../src/models/Bill');
const StockTransaction = require('../src/models/StockTransaction');
const Device = require('../src/models/Device');
const syncService = require('../src/services/syncService');

let server;
let base;
let tokenA;
let tokenB;
let bizA;
let bizB;
let rice;
let dosa;

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
    Bill.deleteMany({}),
    StockTransaction.deleteMany({}),
    Device.deleteMany({}),
    mongoose.connection.collection('counters').deleteMany({}),
    mongoose.connection.collection('businesssettings').deleteMany({}),
  ]);

  bizA = await Business.create({ businessName: 'Sync Retail', businessType: 'GROCERY', status: 'ACTIVE' });
  bizB = await Business.create({ businessName: 'Sync Cafe', businessType: 'CAFE', status: 'ACTIVE' });

  await BusinessSettings.create([
    { businessId: bizA._id, invoicePrefix: 'SRA', defaultTaxMode: 'GST', allowNegativeStock: false },
    { businessId: bizB._id, invoicePrefix: 'SRB', defaultTaxMode: 'GST' },
  ]);

  await User.create([
    {
      businessId: bizA._id, name: 'Owner A', username: 'sync_a', email: 'sync-a@bill.test',
      passwordHash: await bcrypt.hash('Owner@1234', 10), role: 'BUSINESS_OWNER', isActive: true,
    },
    {
      businessId: bizB._id, name: 'Owner B', username: 'sync_b', email: 'sync-b@bill.test',
      passwordHash: await bcrypt.hash('Owner@1234', 10), role: 'BUSINESS_OWNER', isActive: true,
    },
  ]);

  rice = await Product.create({
    businessId: bizA._id, name: 'Rice 5kg', sku: 'RICE5', sellingPrice: 450,
    taxRate: 5, stockEnabled: true, currentStock: 100, minimumStock: 2,
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
  tokenA = await login('sync_a');
  tokenB = await login('sync_b');
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

// Device registration
test('registerDevice: registers a device idempotently', async () => {
  const dev = await syncService.registerDevice({
    businessId: bizA._id, userId: '507f1f77bcf86cd799439011',
    deviceId: 'dev-A1', deviceName: 'Phone A', platform: 'android', appVersion: '1.1.2',
  });
  assert.ok(dev, 'device returned');
  assert.strictEqual(dev.deviceId, 'dev-A1');
  const dev2 = await syncService.registerDevice({
    businessId: bizA._id, userId: '507f1f77bcf86cd799439011',
    deviceId: 'dev-A1', deviceName: 'Phone A renamed',
  });
  const count = await Device.countDocuments({ deviceId: 'dev-A1', businessId: bizA._id });
  assert.strictEqual(count, 1, 'idempotent: still one device record');
  assert.strictEqual(dev2.deviceName, 'Phone A renamed', 'metadata refreshed');
});

test('registerDevice: rejects missing deviceId', async () => {
  await assert.rejects(
    () => syncService.registerDevice({ businessId: bizA._id, userId: 'x' }),
    /deviceId is required/
  );
});

test('touchDevice: updates lastSyncAt', async () => {
  await syncService.touchDevice(bizA._id, 'dev-A1');
  const dev = await Device.findOne({ deviceId: 'dev-A1', businessId: bizA._id });
  assert.ok(dev.lastSyncAt, 'lastSyncAt set');
});

// Push batch
test('pushBatch: syncs a bill from offline queue', async () => {
  const result = await syncService.pushBatch(bizA._id, 'GROCERY', '507f1f77bcf86cd799439011', [
    {
      entityType: 'BILL', entityId: 'client-bill-001', operation: 'CREATE',
      transactionId: 'txn-001', deviceId: 'dev-A1',
      payload: {
        bill: {
          billId: 'client-bill-001', transactionId: 'txn-001',
          items: [{ productId: rice._id.toString(), quantity: 2 }],
          paymentMethod: 'CASH', discount: 0, discountType: 'AMOUNT',
        },
      },
    },
  ]);
  assert.strictEqual(result.synced.length, 1, 'one bill synced');
  assert.strictEqual(result.failed.length, 0, 'no failures');
  assert.ok(result.synced[0].entityId, 'returns server bill id');
  assert.strictEqual(result.synced[0].alreadyProcessed, false, 'first time processed');
  const billCount = await Bill.countDocuments({ businessId: bizA._id });
  assert.strictEqual(billCount, 1, 'bill persisted on server');
});

test('pushBatch: idempotent retry does not duplicate', async () => {
  const result = await syncService.pushBatch(bizA._id, 'GROCERY', '507f1f77bcf86cd799439011', [
    {
      entityType: 'BILL', entityId: 'client-bill-001', operation: 'CREATE',
      transactionId: 'txn-001', deviceId: 'dev-A1',
      payload: {
        bill: {
          billId: 'client-bill-001', transactionId: 'txn-001',
          items: [{ productId: rice._id.toString(), quantity: 2 }],
          paymentMethod: 'CASH',
        },
      },
    },
  ]);
  assert.strictEqual(result.synced.length, 1, 'still reports synced');
  assert.strictEqual(result.synced[0].alreadyProcessed, true, 'flags as already processed');
  const billCount = await Bill.countDocuments({ businessId: bizA._id });
  assert.strictEqual(billCount, 1, 'no duplicate bill created');
});

test('pushBatch: bad record does not block good ones (partial batch)', async () => {
  const result = await syncService.pushBatch(bizA._id, 'GROCERY', '507f1f77bcf86cd799439011', [
    {
      entityType: 'BILL', entityId: 'bad', operation: 'CREATE',
      transactionId: 'txn-bad', payload: { bill: { items: [] } },
    },
    {
      entityType: 'BILL', entityId: 'good', operation: 'CREATE',
      transactionId: 'txn-good', deviceId: 'dev-A1',
      payload: {
        bill: {
          billId: 'client-bill-002', transactionId: 'txn-good',
          items: [{ productId: rice._id.toString(), quantity: 1 }],
          paymentMethod: 'CASH',
        },
      },
    },
  ]);
  assert.strictEqual(result.failed.length, 1, 'one failed (no items)');
  assert.strictEqual(result.failed[0].code, 'BILL_NO_ITEMS', 'correct error code');
  assert.strictEqual(result.synced.length, 1, 'good record still synced');
});

test('pushBatch: empty batch is a no-op', async () => {
  const result = await syncService.pushBatch(bizA._id, 'GROCERY', 'x', []);
  assert.strictEqual(result.synced.length, 0);
  assert.strictEqual(result.failed.length, 0);
});

test('pushBatch: respects PUSH_BATCH_LIMIT', async () => {
  const many = Array.from({ length: 60 }, (_, i) => ({
    entityType: 'BILL', entityId: 'limit-' + i, operation: 'CREATE',
    transactionId: 'txn-limit-' + i,
    payload: { bill: { items: [{ productId: rice._id.toString(), quantity: 1 }] } },
  }));
  const result = await syncService.pushBatch(bizA._id, 'GROCERY', 'x', many);
  assert.ok(result.synced.length <= 50, 'capped at 50');
});

// Pull changes
test('pullChanges: returns bills created after cursor', async () => {
  const result = await syncService.pullChanges(bizA._id, null, { limit: 100 });
  assert.ok(result.changes.length >= 2, 'returns synced bills');
  assert.ok(result.changes.every((c) => c.entityType === 'BILL'), 'all bills');
  assert.ok(result.changes.every((c) => c.operation === 'CONFIRM'), 'confirm operation');
  assert.ok(result.cursor, 'returns a cursor');
});

test('pullChanges: tenant isolation - bizB sees no bizA bills', async () => {
  const result = await syncService.pullChanges(bizB._id, null, {});
  assert.strictEqual(result.changes.length, 0, 'bizB sees nothing from bizA');
});

test('pullChanges: cursor advances past seen records', async () => {
  const first = await syncService.pullChanges(bizA._id, null, { limit: 1 });
  assert.strictEqual(first.changes.length, 1, 'limit 1');
  const second = await syncService.pullChanges(bizA._id, first.cursor, { limit: 100 });
  assert.ok(second.changes.length >= 1, 'more after cursor');
  const ids = new Set(first.changes.map((c) => c.entityId));
  assert.ok(!second.changes.some((c) => ids.has(c.entityId)), 'no duplicates across pages');
});

test('pullChanges: invalid since is ignored gracefully', async () => {
  const result = await syncService.pullChanges(bizA._id, 'not-a-date', {});
  assert.ok(result.changes.length > 0, 'ignores bad cursor, returns all');
});

// Multi-device sync
test('multi-device: Phone A and Phone B push - no duplicates, all unique', async () => {
  await syncService.pushBatch(bizA._id, 'GROCERY', '507f1f77bcf86cd799439011', [
    {
      entityType: 'BILL', entityId: 'phoneA-b1', operation: 'CREATE', transactionId: 'txn-a1', deviceId: 'dev-A1',
      payload: { bill: { billId: 'phoneA-b1', transactionId: 'txn-a1', items: [{ productId: rice._id.toString(), quantity: 1 }], paymentMethod: 'CASH' } },
    },
    {
      entityType: 'BILL', entityId: 'phoneA-b2', operation: 'CREATE', transactionId: 'txn-a2', deviceId: 'dev-A1',
      payload: { bill: { billId: 'phoneA-b2', transactionId: 'txn-a2', items: [{ productId: rice._id.toString(), quantity: 1 }], paymentMethod: 'CASH' } },
    },
    {
      entityType: 'BILL', entityId: 'phoneA-b3', operation: 'CREATE', transactionId: 'txn-a3', deviceId: 'dev-A1',
      payload: { bill: { billId: 'phoneA-b3', transactionId: 'txn-a3', items: [{ productId: rice._id.toString(), quantity: 1 }], paymentMethod: 'CASH' } },
    },
  ]);
  await syncService.pushBatch(bizA._id, 'GROCERY', '507f1f77bcf86cd799439012', [
    {
      entityType: 'BILL', entityId: 'phoneB-b1', operation: 'CREATE', transactionId: 'txn-b1', deviceId: 'dev-B1',
      payload: { bill: { billId: 'phoneB-b1', transactionId: 'txn-b1', items: [{ productId: rice._id.toString(), quantity: 1 }], paymentMethod: 'CASH' } },
    },
    {
      entityType: 'BILL', entityId: 'phoneB-b2', operation: 'CREATE', transactionId: 'txn-b2', deviceId: 'dev-B1',
      payload: { bill: { billId: 'phoneB-b2', transactionId: 'txn-b2', items: [{ productId: rice._id.toString(), quantity: 1 }], paymentMethod: 'CASH' } },
    },
    {
      entityType: 'BILL', entityId: 'phoneB-b3', operation: 'CREATE', transactionId: 'txn-b3', deviceId: 'dev-B1',
      payload: { bill: { billId: 'phoneB-b3', transactionId: 'txn-b3', items: [{ productId: rice._id.toString(), quantity: 1 }], paymentMethod: 'CASH' } },
    },
  ]);
  const allBills = await Bill.countDocuments({ businessId: bizA._id });
  assert.ok(allBills >= 6, 'at least 6 unique bills (got ' + allBills + ')');
  const pull = await syncService.pullChanges(bizA._id, null, { limit: 2000 });
  const ids = pull.changes.map((c) => c.entityId);
  const unique = new Set(ids);
  assert.strictEqual(ids.length, unique.size, 'no duplicate entityIds in pull');
});

// HTTP endpoint tests
test('POST /api/sync/push: authenticated push via HTTP', async () => {
  const res = await send('POST', '/api/sync/push', {
    deviceId: 'dev-A1',
    transactions: [{
      entityType: 'BILL', entityId: 'http-bill-1', operation: 'CREATE',
      transactionId: 'txn-http-1',
      payload: { bill: { items: [{ productId: rice._id.toString(), quantity: 1 }], paymentMethod: 'CASH' } },
    }],
  }, tokenA);
  assert.strictEqual(res.status, 200);
  assert.ok(res.json.data.synced.length >= 1, 'synced via HTTP');
});

test('POST /api/sync/push: invalid token rejected', async () => {
  const res = await send('POST', '/api/sync/push', {
    transactions: [{ transactionId: 'x', payload: { bill: { items: [] } } }],
  }, 'bearer-invalid-token-xyz');
  assert.strictEqual(res.status, 401);
});

test('POST /api/sync/push: non-array transactions rejected', async () => {
  const res = await send('POST', '/api/sync/push', { transactions: 'nope' }, tokenA);
  assert.strictEqual(res.status, 400);
});

test('GET /api/sync/pull: authenticated pull via HTTP', async () => {
  const res = await send('GET', '/api/sync/pull?limit=10', null, tokenA);
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.json.data.changes), 'returns changes array');
});

test('GET /api/sync/pull: cannot pull another business data', async () => {
  const res = await send('GET', '/api/sync/pull', null, tokenB);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.data.changes.length, 0, 'tenant isolation via HTTP');
});

test('multi-device: concurrent pushes produce unique invoice numbers', async () => {
  await syncService.pushBatch(bizA._id, 'GROCERY', '507f1f77bcf86cd799439011', [
    {
      entityType: 'BILL', entityId: 'inv-1', operation: 'CREATE', transactionId: 'txn-inv-1', deviceId: 'dev-A1',
      payload: { bill: { billId: 'inv-1', transactionId: 'txn-inv-1', items: [{ productId: rice._id.toString(), quantity: 1 }], paymentMethod: 'CASH' } },
    },
  ]);
  await syncService.pushBatch(bizA._id, 'GROCERY', '507f1f77bcf86cd799439012', [
    {
      entityType: 'BILL', entityId: 'inv-2', operation: 'CREATE', transactionId: 'txn-inv-2', deviceId: 'dev-B1',
      payload: { bill: { billId: 'inv-2', transactionId: 'txn-inv-2', items: [{ productId: rice._id.toString(), quantity: 1 }], paymentMethod: 'CASH' } },
    },
  ]);
  const bills = await Bill.find({ businessId: bizA._id }).select('invoiceNumber');
  const invoices = bills.map((b) => b.invoiceNumber).filter(Boolean);
  const unique = new Set(invoices);
  assert.strictEqual(invoices.length, unique.size, 'all invoice numbers unique');
});
