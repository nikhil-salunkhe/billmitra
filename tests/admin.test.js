'use strict';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/billmitra_test_admin';
process.env.JWT_SECRET = 'admin-test-secret-long-enough-7777';
process.env.JWT_EXPIRES_IN = '1h';

const { before, after, test } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const { createApp } = require('../src/app');
const Admin = require('../src/models/Admin');
const User = require('../src/models/User');
const Business = require('../src/models/Business');
const AuditLog = require('../src/models/AuditLog');

let server;
let base;
let adminToken;
let ownerToken;
let businessId;

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
  await Promise.all([Admin.deleteMany({}), User.deleteMany({}), Business.deleteMany({}), AuditLog.deleteMany({})]);

  await Admin.create({
    name: 'Root',
    email: 'root@admin.dev',
    passwordHash: await bcrypt.hash('Root@1234', 10),
    role: 'SUPER_ADMIN',
    isActive: true,
  });

  const biz = await Business.create({ businessName: 'Susp Eng', businessType: 'GROCERY' });
  businessId = biz._id;
  await User.create({
    businessId,
    name: 'Owner',
    username: 'susp_owner',
    email: 'o@o.test',
    passwordHash: await bcrypt.hash('Owner@1234', 10),
    role: 'BUSINESS_OWNER',
    isActive: true,
  });

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await send('POST', '/api/auth/admin/login', { email: 'root@admin.dev', password: 'Root@1234' });
  adminToken = login.json.data.token;

  const ownerLogin = await send('POST', '/api/auth/owner/login', { username: 'susp_owner', password: 'Owner@1234' });
  ownerToken = ownerLogin.json.data.token;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

test('dashboard returns business metric cards', async () => {
  const res = await send('GET', '/api/admin/dashboard', null, adminToken);
  assert.strictEqual(res.status, 200);
  const d = res.json.data;
  assert.strictEqual(d.totalBusinesses, 1);
  assert.strictEqual(typeof d.activeBusinesses, 'number');
  assert.strictEqual(typeof d.billsGenerated, 'number'); // 0 until Phase 8
  assert.strictEqual(d.billsGenerated, 0);
  assert.strictEqual(typeof d.newBusinessesLast30Days, 'number');
});

test('business detail includes owner and settings', async () => {
  const res = await send('GET', `/api/admin/businesses/${businessId}`, null, adminToken);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.data.business.business.businessName, 'Susp Eng');
  assert.strictEqual(res.json.data.business.owner.username, 'susp_owner');
});

test('admin can suspend a business and the owner is then blocked', async () => {
  const act = await send('POST', `/api/admin/businesses/${businessId}/activate`, {}, adminToken);
  assert.strictEqual(act.json.data.business.status, 'ACTIVE');

  const susp = await send('POST', `/api/admin/businesses/${businessId}/suspend`, {}, adminToken);
  assert.strictEqual(susp.json.data.business.status, 'SUSPENDED');

  const prof = await send('GET', '/api/business/profile', null, ownerToken);
  assert.strictEqual(prof.status, 403);
  assert.strictEqual(prof.json.code, 'BUSINESS_SUSPENDED');
});

test('admin activate restores access after suspension', async () => {
  const act = await send('POST', `/api/admin/businesses/${businessId}/activate`, {}, adminToken);
  assert.strictEqual(act.json.data.business.status, 'ACTIVE');
  const prof = await send('GET', '/api/business/profile', null, ownerToken);
  assert.strictEqual(prof.status, 200);
});

test('owner cannot suspend/activate businesses (403)', async () => {
  const res = await send('POST', `/api/admin/businesses/${businessId}/suspend`, {}, ownerToken);
  assert.strictEqual(res.status, 403);
});

test('admin can reset owner password; new credential works; password not logged', async () => {
  const res = await send('POST', `/api/admin/businesses/${businessId}/reset-password`, { newPassword: 'NewPass@1234' }, adminToken);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.data.ownerUsername, 'susp_owner');
  assert.strictEqual(res.json.data.initialPassword, 'NewPass@1234');

  const newLogin = await send('POST', '/api/auth/owner/login', { username: 'susp_owner', password: 'NewPass@1234' });
  assert.strictEqual(newLogin.status, 200);

  const oldLogin = await send('POST', '/api/auth/owner/login', { username: 'susp_owner', password: 'Owner@1234' });
  assert.strictEqual(oldLogin.status, 401);

  // The new password must never appear in the audit log.
  const logs = await AuditLog.find({ action: 'OWNER_PASSWORD_RESET' });
  assert.ok(logs.length > 0);
  assert.strictEqual(JSON.stringify(logs).includes('NewPass@1234'), false);
});

test('audit log lists suspend/activate/reset actions', async () => {
  const res = await send('GET', '/api/admin/audit-logs', null, adminToken);
  assert.strictEqual(res.status, 200);
  const actions = res.json.data.logs.map((l) => l.action);
  assert.ok(actions.includes('BUSINESS_SUSPENDED'));
  assert.ok(actions.includes('BUSINESS_ACTIVATED'));
  assert.ok(actions.includes('OWNER_PASSWORD_RESET'));
});