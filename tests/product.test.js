'use strict';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/billmitra_test_catalog';
process.env.JWT_SECRET = 'catalog-test-secret-long-enough-5555';
process.env.JWT_EXPIRES_IN = '1h';

const { before, after, test } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const { createApp } = require('../src/app');
const User = require('../src/models/User');
const Business = require('../src/models/Business');
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');

let server;
let base;
let tokenA;
let tokenB;
let bizA;
let bizB;
let catA;

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
    Category.deleteMany({}),
    Product.deleteMany({}),
  ]);

  bizA = await Business.create({ businessName: 'Catalog Retail', businessType: 'GARMENT', status: 'ACTIVE' });
  bizB = await Business.create({ businessName: 'Catalog Cafe', businessType: 'CAFE', status: 'ACTIVE' });

  await User.create([
    {
      businessId: bizA._id,
      name: 'Owner A',
      username: 'cat_a',
      email: 'a@cat.test',
      passwordHash: await bcrypt.hash('Owner@1234', 10),
      role: 'BUSINESS_OWNER',
      isActive: true,
    },
    {
      businessId: bizB._id,
      name: 'Owner B',
      username: 'cat_b',
      email: 'b@cat.test',
      passwordHash: await bcrypt.hash('Owner@1234', 10),
      role: 'BUSINESS_OWNER',
      isActive: true,
    },
  ]);

  catA = await Category.create({ businessId: bizA._id, name: 'Shirts' });

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${server.address().port}`;

  async function login(username) {
    const r = await send('POST', '/api/auth/owner/login', { username, password: 'Owner@1234' });
    return r.json.data.token;
  }
  tokenA = await login('cat_a');
  tokenB = await login('cat_b');
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

test('owner creates a category; duplicate name rejected', async () => {
  const ok = await send('POST', '/api/categories', { name: 'Pants' }, tokenA);
  assert.strictEqual(ok.status, 201);

  const dup = await send('POST', '/api/categories', { name: 'shirts' }, tokenA);
  assert.strictEqual(dup.status, 409);
  assert.strictEqual(dup.json.code, 'CATEGORY_EXISTS');
});

test('owner creates a product with tax + stock config', async () => {
  const res = await send(
    'POST',
    '/api/products',
    {
      name: 'Cotton Shirt',
      categoryId: catA._id.toString(),
      sku: 'SHIRT-001',
      sellingPrice: 799,
      purchasePrice: 500,
      taxRate: 12,
      currentStock: 25,
      minimumStock: 5,
      unit: 'PCS',
    },
    tokenA
  );
  assert.strictEqual(res.status, 201);
  const p = res.json.data.product;
  assert.strictEqual(p.sellingPrice, 799);
  assert.strictEqual(p.taxRate, 12);
  assert.strictEqual(p.stockEnabled, true); // GARMENT defaults to stock on
  assert.strictEqual(p.currentStock, 25);
});

test('menu tenant defaults to stock disabled (hotel/cafe mode)', async () => {
  const res = await send('POST', '/api/products', { name: 'Masala Dosa', sellingPrice: 90 }, tokenB);
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.json.data.product.stockEnabled, false);
});

test('product validation rejects bad price / negative stock / foreign category', async () => {
  const missingPrice = await send('POST', '/api/products', { name: 'X' }, tokenA);
  assert.strictEqual(missingPrice.status, 422);

  const negStock = await send(
    'POST',
    '/api/products',
    { name: 'Y', sellingPrice: 10, currentStock: -3 },
    tokenA
  );
  assert.strictEqual(negStock.status, 422); // Zod min(0)

  const badCat = await send(
    'POST',
    '/api/products',
    { name: 'Z', sellingPrice: 10, categoryId: new mongoose.Types.ObjectId().toString() },
    tokenA
  );
  assert.strictEqual(badCat.status, 400);
  assert.strictEqual(badCat.json.code, 'INVALID_CATEGORY');
});

test('duplicate SKU inside a tenant is rejected (409)', async () => {
  const dup = await send(
    'POST',
    '/api/products',
    { name: 'Another Shirt', sku: 'shirt-001', sellingPrice: 999 },
    tokenA
  );
  assert.strictEqual(dup.status, 409);
  assert.strictEqual(dup.json.code, 'SKU_EXISTS');
});

module.exports = {};