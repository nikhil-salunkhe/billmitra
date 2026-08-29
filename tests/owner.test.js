'use strict';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/billmitra_test_owner';
process.env.JWT_SECRET = 'owner-test-secret-long-enough-6666';
process.env.JWT_EXPIRES_IN = '1h';

const { before, after, test } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const { createApp } = require('../src/app');
const User = require('../src/models/User');
const Business = require('../src/models/Business');
const BusinessSettings = require('../src/models/BusinessSettings');

let server;
let base;
let tokenA;
let tokenB;
let bizA;

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

async function login(username, password) {
  const r = await send('POST', '/api/auth/owner/login', { username, password });
  return r.json.data?.token;
}

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 6000 });
  // Wait for unique index builds before any writes (see config/db.js).
  await require('../src/config/db').ensureIndexes();
  await Promise.all([User.deleteMany({}), Business.deleteMany({}), BusinessSettings.deleteMany({})]);

  bizA = await Business.create({ businessName: 'Owner Retail', businessType: 'GARMENT', status: 'ACTIVE' });
  const bizB = await Business.create({ businessName: 'Owner Cafe', businessType: 'CAFE', status: 'ACTIVE' });

  await User.create([
    {
      businessId: bizA._id,
      name: 'Owner A',
      username: 'dask_a',
      email: 'a@dash.test',
      passwordHash: await bcrypt.hash('Owner@1234', 10),
      role: 'BUSINESS_OWNER',
      isActive: true,
    },
    {
      businessId: bizB._id,
      name: 'Owner B',
      username: 'dash_b',
      email: 'b@dash.test',
      passwordHash: await bcrypt.hash('Owner@1234', 10),
      role: 'BUSINESS_OWNER',
      isActive: true,
    },
  ]);
  await BusinessSettings.create({ businessId: bizA._id, invoicePrefix: 'INV', defaultTaxMode: 'GST' });

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${server.address().port}`;

  tokenA = await login('dask_a', 'Owner@1234');
  tokenB = await login('dash_b', 'Owner@1234');
  assert.ok(tokenA && tokenB);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

test('owner dashboard shows only own business + subscription summary', async () => {
  const res = await send('GET', '/api/reports/dashboard', null, tokenA);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.data.business.businessName, 'Owner Retail');
  assert.strictEqual(res.json.data.business.businessId, bizA._id.toString());
  assert.ok(res.json.data.subscription);
  assert.strictEqual(typeof res.json.data.subscription.status, 'string');
  // Sales/stock metrics are now live (Bill & Product models exist since Phases
  // 7-8) and compute to 0 for this tenant, which owns no bills.
  assert.strictEqual(res.json.data.sales.today.bills, 0);
  assert.strictEqual(res.json.data.metricsAvailable.bills, true);
});

test('owner dashboard tenant isolation (A does not see B)', async () => {
  const a = await send('GET', '/api/reports/dashboard', null, tokenA);
  const b = await send('GET', '/api/reports/dashboard', null, tokenB);
  assert.notStrictEqual(a.json.data.business.businessId, b.json.data.business.businessId);
  assert.strictEqual(b.json.data.business.businessName, 'Owner Cafe');
});

test('owner subscription preview returns trial plan + days remaining', async () => {
  const res = await send('GET', '/api/subscription', null, tokenA);
  assert.strictEqual(res.status, 200);
  const s = res.json.data;
  assert.strictEqual(s.plan, 'INITIAL');
  assert.strictEqual(s.setupAmount, 4999);
  assert.strictEqual(s.amountMonthly, 499);
  assert.ok(s.trialStartDate);
  assert.ok(s.trialEndDate);
  assert.strictEqual(typeof s.daysRemaining, 'number');
});

test('owner can read own business settings', async () => {
  const res = await send('GET', '/api/business/settings', null, tokenA);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.data.settings.invoicePrefix, 'INV');
});

test('owner can update own settings (tenant-scoped)', async () => {
  const res = await send('PUT', '/api/business/settings', { billFooter: 'Thank you!' }, tokenA);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.data.settings.billFooter, 'Thank you!');
});

test('owner B cannot overwrite owner A settings', async () => {
  await send('PUT', '/api/business/settings', { billFooter: 'B hacked' }, tokenB);
  const a = await send('GET', '/api/business/settings', null, tokenA);
  assert.strictEqual(a.json.data.settings.billFooter, 'Thank you!');
});