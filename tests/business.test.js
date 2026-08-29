'use strict';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/billmitra_test_biz';
process.env.JWT_SECRET = 'business-test-secret-long-enough-8888';
process.env.JWT_EXPIRES_IN = '1h';

const { before, after, test } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const { createApp } = require('../src/app');
const Admin = require('../src/models/Admin');
const User = require('../src/models/User');
const Business = require('../src/models/Business');

let server;
let base;
let adminToken;

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
  await Promise.all([Admin.deleteMany({}), User.deleteMany({}), Business.deleteMany({})]);

  await Admin.create({
    name: 'Root',
    email: 'root@billmitra.dev',
    passwordHash: await bcrypt.hash('Root@1234', 10),
    role: 'SUPER_ADMIN',
    isActive: true,
  });

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await send('POST', '/api/auth/admin/login', {
    email: 'root@billmitra.dev',
    password: 'Root@1234',
  });
  adminToken = login.json.data.token;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

test('admin creates a business + owner with one-time password', async () => {
  const res = await send(
    'POST',
    '/api/admin/businesses',
    {
      businessName: 'Crown Garments',
      businessType: 'GARMENT',
      ownerName: 'Karan Mehta',
      ownerUsername: 'crown_owner',
      ownerPassword: 'Owner@12345',
      city: 'Mumbai',
      phone: '9876543210',
    },
    adminToken
  );
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.json.success, true);
  assert.ok(res.json.data.business.id);
  assert.ok(res.json.data.owner.username === 'crown_owner');
  assert.ok(res.json.data.ownerInitialPassword === 'Owner@12345'); // one-time only
  assert.strictEqual(res.json.data.business.status, 'INACTIVE');
  assert.ok(res.json.data.business.settings);
  // passwordHash is never returned.
  assert.strictEqual(JSON.stringify(res.json).includes('passwordHash'), false);
});

test('owner created by admin can log in', async () => {
  const res = await send('POST', '/api/auth/owner/login', {
    username: 'crown_owner',
    password: 'Owner@12345',
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.data.user.role, 'BUSINESS_OWNER');
});

test('duplicate owner username is rejected with 409 USERNAME_TAKEN', async () => {
  const res = await send(
    'POST',
    '/api/admin/businesses',
    {
      businessName: 'Another Shop',
      businessType: 'MOBILE',
      ownerName: 'X',
      ownerUsername: 'crown_owner',
      ownerPassword: 'Owner@12345',
    },
    adminToken
  );
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.json.code, 'USERNAME_TAKEN');
});

test('super admin cannot be impersonated as owner via business route data', async () => {
  // Owner route derivation is from the token; supplying SUPER_ADMIN role body is ignored.
  const res = await send('POST', '/api/auth/owner/login', {
    username: 'crown_owner',
    password: 'Owner@12345',
    role: 'SUPER_ADMIN',
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.data.user.role, 'BUSINESS_OWNER');
});

test('validation rejects unknown business type', async () => {
  const res = await send(
    'POST',
    '/api/admin/businesses',
    {
      businessName: 'Bad Biz',
      businessType: 'NOT_A_TYPE',
      ownerUsername: 'badowner',
      ownerPassword: 'Owner@12345',
    },
    adminToken
  );
  assert.strictEqual(res.status, 422);
  assert.strictEqual(res.json.code, 'VALIDATION_ERROR');
});

test('list businesses returns the created tenant', async () => {
  const res = await send('GET', '/api/admin/businesses?search=Crown', null, adminToken);
  assert.strictEqual(res.status, 200);
  assert.ok(res.json.data.businesses.some((b) => b.businessName === 'Crown Garments'));
});

test('admin can create a business on the First 6 Months Free offer with hours + logo + show-in-app', async () => {
  const res = await send(
    'POST',
    '/api/admin/businesses',
    {
      businessName: 'Raghav Electronics',
      businessType: 'ELECTRONICS',
      ownerName: 'Raghav Kumar',
      ownerUsername: 'raghav_owner',
      ownerPassword: 'Owner@12345',
      plan: 'SIX_MONTH_FREE',
      openingTime: '09:30',
      closingTime: '21:00',
      showInApp: true,
      logoUrl: '/uploads/logo-raghav.png',
      city: 'Pune',
    },
    adminToken
  );
  assert.strictEqual(res.status, 201);
  const b = res.json.data.business;
  assert.strictEqual(b.plan, 'SIX_MONTH_FREE');
  assert.strictEqual(b.planLabel, 'First 6 Months Free');
  assert.ok(b.planTagline.includes('2,500'));
  assert.strictEqual(b.openingTime, '09:30');
  assert.strictEqual(b.closingTime, '21:00');
  assert.strictEqual(b.showInApp, true);
  assert.strictEqual(b.logoUrl, '/uploads/logo-raghav.png');

  // Owner profile exposes the new fields too.
  const ol = await send('POST', '/api/auth/owner/login', { username: 'raghav_owner', password: 'Owner@12345' });
  const prof = await send('GET', '/api/business/profile', null, ol.json.data.token);
  assert.strictEqual(prof.status, 200);
  assert.strictEqual(prof.json.data.business.plan, 'SIX_MONTH_FREE');
  assert.strictEqual(prof.json.data.business.openingTime, '09:30');
  assert.strictEqual(prof.json.data.business.showInApp, true);

  // The persisted tenant carries the plan for subscription activation.
  const stored = await Business.findById(b.id).select('plan logoUrl showInApp');
  assert.strictEqual(stored.plan, 'SIX_MONTH_FREE');
  assert.strictEqual(stored.logoUrl, '/uploads/logo-raghav.png');
  assert.strictEqual(stored.showInApp, true);
});

test('validation rejects a bad business time format and unknown plan', async () => {
  const badTime = await send(
    'POST',
    '/api/admin/businesses',
    {
      businessName: 'Time Shop',
      businessType: 'CAFE',
      ownerUsername: 'time_owner',
      ownerPassword: 'Owner@12345',
      openingTime: '09:70',
    },
    adminToken
  );
  assert.strictEqual(badTime.status, 422);
  assert.strictEqual(badTime.json.code, 'VALIDATION_ERROR');

  const badPlan = await send(
    'POST',
    '/api/admin/businesses',
    {
      businessName: 'Plan Shop',
      businessType: 'CAFE',
      ownerUsername: 'pl_owner',
      ownerPassword: 'Owner@12345',
      plan: 'FREE_FOREVER',
    },
    adminToken
  );
  assert.strictEqual(badPlan.status, 422);
});

test('admin can upload a business logo (multipart) and update business fields', async () => {
  // 1. Upload a logo file → public URL (local storage).
  const fd = new FormData();
  fd.append('logo', new Blob([Buffer.from('fake-png-bytes')], { type: 'image/png' }), 'logo.png');
  const up = await fetch(`${base}/api/admin/businesses/upload-logo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: fd,
  });
  const upJson = await up.json();
  assert.strictEqual(up.status, 200);
  assert.ok(upJson.data.logoUrl.startsWith('/uploads/'));

  // 2. Attach the logo + hours + show-in-app toggle to a business via PUT.
  const list = await send('GET', '/api/admin/businesses?search=Crown', null, adminToken);
  const crownId = list.json.data.businesses.find((b) => b.businessName === 'Crown Garments').id;
  const upd2 = await send(
    'PUT',
    `/api/admin/businesses/${crownId}`,
    { logoUrl: upJson.data.logoUrl, openingTime: '10:00', closingTime: '20:00', showInApp: false },
    adminToken
  );
  assert.strictEqual(upd2.status, 200);
  assert.strictEqual(upd2.json.data.business.logoUrl, upJson.data.logoUrl);
  assert.strictEqual(upd2.json.data.business.openingTime, '10:00');
  assert.strictEqual(upd2.json.data.business.showInApp, false);

  // 3. Clean up the uploaded file from local storage.
  const fs = require('fs');
  const path = require('path');
  const file = path.join(__dirname, '../uploads', upJson.data.logoUrl.split('/').pop());
  if (fs.existsSync(file)) fs.unlinkSync(file);
});