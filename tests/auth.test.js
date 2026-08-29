'use strict';

// Set test environment BEFORE requiring the app so env.js captures it.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/billmitra_test';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-0123456789';
process.env.JWT_EXPIRES_IN = '1h';

const { before, after, test } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const { createApp } = require('../src/app');
const Admin = require('../src/models/Admin');
const User = require('../src/models/User');

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

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 6000 });
  await Admin.deleteMany({});
  await User.deleteMany({});

  await Admin.create({
    name: 'Root Admin',
    email: 'root@billmitra.test',
    passwordHash: await bcrypt.hash('Admin@1234', 10),
    role: 'SUPER_ADMIN',
    isActive: true,
  });

  await User.create({
    name: 'Owner One',
    username: 'owner1',
    email: 'owner1@shop.test',
    passwordHash: await bcrypt.hash('Owner@1234', 10),
    role: 'BUSINESS_OWNER',
    isActive: true,
    businessId: new mongoose.Types.ObjectId(),
  });

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

/* eslint-disable no-control-regex */
function hasSecret(body) {
  const raw = JSON.stringify(body);
  return /passwordHash|"password"/i.test(raw);
}

test('admin login succeeds and returns a token without secrets', async () => {
  const res = await send('POST', '/api/auth/admin/login', {
    email: 'root@billmitra.test',
    password: 'Admin@1234',
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.success, true);
  assert.ok(res.json.data.token);
  assert.strictEqual(res.json.data.user.role, 'SUPER_ADMIN');
  assert.strictEqual(hasSecret(res.json), false);
});

test('admin login with wrong password returns 401 INVALID_CREDENTIALS', async () => {
  const res = await send('POST', '/api/auth/admin/login', {
    email: 'root@billmitra.test',
    password: 'WrongPass1',
  });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.json.code, 'INVALID_CREDENTIALS');
});

test('admin login with unknown email returns 401 INVALID_CREDENTIALS', async () => {
  const res = await send('POST', '/api/auth/admin/login', {
    email: 'nobody@billmitra.test',
    password: 'WrongPass1',
  });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.json.code, 'INVALID_CREDENTIALS');
});

test('owner login by username succeeds', async () => {
  const res = await send('POST', '/api/auth/owner/login', {
    username: 'owner1',
    password: 'Owner@1234',
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.data.user.role, 'BUSINESS_OWNER');
  assert.ok(res.json.data.user.businessId);
  assert.strictEqual(hasSecret(res.json), false);
});

test('owner login by email succeeds', async () => {
  const res = await send('POST', '/api/auth/owner/login', {
    email: 'owner1@shop.test',
    password: 'Owner@1234',
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.data.user.username, 'owner1');
});

test('disabled owner account cannot login', async () => {
  await User.create({
    name: 'Disabled Owner',
    username: 'disabled1',
    email: 'disabled@shop.test',
    passwordHash: await bcrypt.hash('Owner@1234', 10),
    role: 'BUSINESS_OWNER',
    isActive: false,
    businessId: new mongoose.Types.ObjectId(),
  });
  const res = await send('POST', '/api/auth/owner/login', {
    username: 'disabled1',
    password: 'Owner@1234',
  });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.json.code, 'ACCOUNT_DISABLED');
});

test('GET /api/auth/me returns the authenticated user', async () => {
  const login = await send('POST', '/api/auth/owner/login', {
    username: 'owner1',
    password: 'Owner@1234',
  });
  const res = await send('GET', '/api/auth/me', null, login.json.data.token);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.data.user.role, 'BUSINESS_OWNER');
});

test('GET /api/auth/me without token returns 401 AUTH_REQUIRED', async () => {
  const res = await send('GET', '/api/auth/me');
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.json.code, 'AUTH_REQUIRED');
});

test('GET /api/auth/me with invalid token returns 401 INVALID_TOKEN', async () => {
  const res = await send('GET', '/api/auth/me', null, 'not.a.real.token');
  assert.strictEqual(res.status, 401);
  assert.ok(['INVALID_TOKEN', 'AUTH_REQUIRED'].includes(res.json.code));
});

test('validation rejects short passwords', async () => {
  const res = await send('POST', '/api/auth/admin/login', {
    email: 'root@billmitra.test',
    password: 'short',
  });
  assert.strictEqual(res.status, 422);
  assert.strictEqual(res.json.code, 'VALIDATION_ERROR');
});