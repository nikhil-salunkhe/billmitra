'use strict';

// Separate DB from product.test.js so both files can run concurrently.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/billmitra_test_catalog2';
process.env.JWT_SECRET = 'catalog2-test-secret-long-enough-4444';
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

  bizA = await Business.create({ businessName: 'Iso Retail', businessType: 'GARMENT', status: 'ACTIVE' });
  bizB = await Business.create({ businessName: 'Iso Cafe', businessType: 'CAFE', status: 'ACTIVE' });

  await User.create([
    {
      businessId: bizA._id,
      name: 'Owner A',
      username: 'iso_a',
      email: 'a@iso.test',
      passwordHash: await bcrypt.hash('Owner@1234', 10),
      role: 'BUSINESS_OWNER',
      isActive: true,
    },
    {
      businessId: bizB._id,
      name: 'Owner B',
      username: 'iso_b',
      email: 'b@iso.test',
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
  tokenA = await login('iso_a');
  tokenB = await login('iso_b');
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

test('tenant isolation: B cannot read/update/delete A product or reuse A category', async () => {
  const created = await send(
    'POST',
    '/api/products',
    { name: 'Jeans', sku: 'JN-1', sellingPrice: 1299, currentStock: 8, minimumStock: 2 },
    tokenA
  );
  assert.strictEqual(created.status, 201);
  const pid = created.json.data.product.id;

  const read = await send('GET', `/api/products/${pid}`, null, tokenB);
  assert.strictEqual(read.status, 404);

  const upd = await send('PUT', `/api/products/${pid}`, { sellingPrice: 1 }, tokenB);
  assert.strictEqual(upd.status, 404);

  const del = await send('DELETE', `/api/products/${pid}`, null, tokenB);
  assert.strictEqual(del.status, 404);

  // Cross-tenant categoryId must be refused.
  const steal = await send(
    'POST',
    '/api/products',
    { name: 'Steal', sellingPrice: 5, categoryId: catA._id.toString() },
    tokenB
  );
  assert.strictEqual(steal.status, 400);
  assert.strictEqual(steal.json.code, 'INVALID_CATEGORY');

  // And listing only returns own products.
  const listB = await send('GET', '/api/products?active=all', null, tokenB);
  assert.ok(listB.json.data.products.every((p) => p.businessId === bizB._id.toString()));
});

test('search by name/sku, category filter and low-stock filter work within tenant', async () => {
  await send(
    'POST',
    '/api/products',
    { name: 'Jeans Blue', sku: 'JB-9', sellingPrice: 1399, categoryId: catA._id.toString(), currentStock: 1, minimumStock: 4 },
    tokenA
  );

  const byName = await send('GET', '/api/products?search=jeans', null, tokenA);
  assert.ok(byName.json.data.products.length >= 1);

  const byCat = await send('GET', `/api/products?categoryId=${catA._id}`, null, tokenA);
  assert.ok(byCat.json.data.products.every((p) => p.categoryId === catA._id.toString()));

  const low = await send('GET', '/api/products/low', null, tokenA);
  assert.ok(low.status === 200 && Array.isArray(low.json.data.products));
  assert.ok(low.json.data.products.some((p) => p.name === 'Jeans Blue'));
});

test('soft delete hides product from active list but keeps the document', async () => {
  const created = await send('POST', '/api/products', { name: 'Cap', sellingPrice: 199 }, tokenA);
  const pid = created.json.data.product.id;

  const del = await send('DELETE', `/api/products/${pid}`, null, tokenA);
  assert.strictEqual(del.status, 200);
  assert.strictEqual(del.json.data.product.isActive, false);

  const active = await send('GET', '/api/products', null, tokenA);
  assert.ok(active.json.data.products.every((p) => p.id !== pid));

  const all = await send('GET', '/api/products?active=all', null, tokenA);
  assert.ok(all.json.data.products.some((p) => p.id === pid && p.isActive === false));

  // The document is retained in the database (historical bills depend on it).
  const doc = await Product.findById(pid);
  assert.ok(doc);
});