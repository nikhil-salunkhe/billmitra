'use strict';

// Test env must be set before any app module import.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/billmitra_test_tenant';
process.env.JWT_SECRET = 'tenant-test-secret-long-enough-000000';
process.env.JWT_EXPIRES_IN = '1h';

const { before, after, test } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const { createApp } = require('../src/app');
const User = require('../src/models/User');
const Business = require('../src/models/Business');

let server;
let base;

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

async function login(role, identifier, password) {
  const path = role === 'admin' ? '/api/auth/admin/login' : '/api/auth/owner/login';
  const body =
    role === 'admin' ? { email: identifier, password } : { username: identifier, password };
  const r = await send('POST', path, body);
  return r.json.data?.token;
}

let adminToken;
let businessAToken;
let businessBToken;
let businessA;
let businessB;

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 6000 });
  // Wait for unique index builds before any writes (see config/db.js).
  await require('../src/config/db').ensureIndexes();
  await Promise.all([User.deleteMany({}), Business.deleteMany({})]);

  // Two businesses + two owners. Business A's owner must never access B's data.
  businessA = await Business.create({ businessName: 'Alpha Retail', businessType: 'GARMENT' });
  businessB = await Business.create({ businessName: 'Beta Grocery', businessType: 'GROCERY' });

  await User.create([
    {
      businessId: businessA._id,
      name: 'Owner A',
      username: 'ownera',
      email: 'a@a.test',
      passwordHash: await bcrypt.hash('OwnerA@1234', 10),
      role: 'BUSINESS_OWNER',
      isActive: true,
    },
    {
      businessId: businessB._id,
      name: 'Owner B',
      username: 'ownerb',
      email: 'b@b.test',
      passwordHash: await bcrypt.hash('OwnerB@1234', 10),
      role: 'BUSINESS_OWNER',
      isActive: true,
    },
  ]);

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${server.address().port}`;

  businessAToken = await login('owner', 'ownera', 'OwnerA@1234');
  businessBToken = await login('owner', 'ownerb', 'OwnerB@1234');
  assert.ok(businessAToken && businessBToken, 'both owner logins should succeed');
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

test('owner profile returns ONLY the owner business', async () => {
  const res = await send('GET', '/api/business/profile', null, businessAToken);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.data.business.businessName, 'Alpha Retail');
});

test('owner B sees a DIFFERENT business than owner A', async () => {
  const a = await send('GET', '/api/business/profile', null, businessAToken);
  const b = await send('GET', '/api/business/profile', null, businessBToken);
  assert.notStrictEqual(a.json.data.business.id, b.json.data.business.id);
  assert.strictEqual(b.json.data.business.businessName, 'Beta Grocery');
});

test('owner cannot access admin business routes (403 FORBIDDEN)', async () => {
  const res = await send('GET', '/api/admin/businesses', null, businessAToken);
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.json.code, 'FORBIDDEN');
});

test('owner cannot access another business by crafting its id in admin path', async () => {
  // Even though a raw id is supplied, the owner role route rejects it upfront.
  const res = await send('GET', `/api/admin/businesses/${businessB._id}`, null, businessAToken);
  assert.strictEqual(res.status, 403);
});

test('owner profile request cannot override tenant via query param', async () => {
  // The tenant comes from the JWT; a client-supplied businessId is ignored.
  const res = await send('GET', `/api/business/profile?businessId=${businessB._id}`, null, businessAToken);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.data.business.id, businessA._id.toString());
});

test('unauthenticated owner business route requires a token', async () => {
  const res = await send('GET', '/api/business/profile');
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.json.code, 'AUTH_REQUIRED');
});