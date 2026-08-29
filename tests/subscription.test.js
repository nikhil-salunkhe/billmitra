'use strict';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/billmitra_test_subs';
process.env.JWT_SECRET = 'subs-test-secret-long-enough-99999';
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
const Subscription = require('../src/models/Subscription');
const BusinessSettings = require('../src/models/BusinessSettings');
const AuditLog = require('../src/models/AuditLog');
const Admin = require('../src/models/Admin');
const { addMonthsClamped } = require('../src/utils/dateUtils');

let server;
let base;
let adminToken;
let ownerToken;
let biz;
let sub;
let prod;

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

async function createBill(key, qty = 1) {
  return send(
    'POST',
    '/api/bills',
    { items: [{ productId: prod._id.toString(), quantity: qty }], paymentMethod: 'CASH', idempotencyKey: key },
    ownerToken
  );
}

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 6000 });
  await require('../src/config/db').ensureIndexes();
  await Promise.all([
    User.deleteMany({}),
    Admin.deleteMany({}),
    Business.deleteMany({}),
    Product.deleteMany({}),
    Bill.deleteMany({}),
    Subscription.deleteMany({}),
    BusinessSettings.deleteMany({}),
    AuditLog.deleteMany({}),
    mongoose.connection.collection('counters').deleteMany({}),
  ]);

  const Admin0 = Admin;
  await Admin0.create({
    name: 'Root',
    email: 'root@subs.dev',
    passwordHash: await bcrypt.hash('Root@1234', 10),
    role: 'SUPER_ADMIN',
    isActive: true,
  });

  // Tenant WITHOUT a pre-existing subscription doc: created directly so we can
  // exercise activateTrialSubscription through the admin business-creation API
  // for one tenant and manual setup for this one.
  biz = await Business.create({ businessName: 'Subs Retail', businessType: 'GROCERY', status: 'ACTIVE' });
  const ownerUser = await User.create({
    businessId: biz._id,
    name: 'Owner',
    username: 'subs_owner',
    email: 'o@subs.test',
    passwordHash: await bcrypt.hash('Owner@1234', 10),
    role: 'BUSINESS_OWNER',
    isActive: true,
  });

  prod = await Product.create({
    businessId: biz._id, name: 'Item', sku: 'ITM1', sellingPrice: 200,
    taxRate: 0, stockEnabled: true, currentStock: 100, minimumStock: 5,
  });

  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${server.address().port}`;

  const al = await send('POST', '/api/auth/admin/login', { email: 'root@subs.dev', password: 'Root@1234' });
  adminToken = al.json.data.token;
  const ol = await send('POST', '/api/auth/owner/login', { username: 'subs_owner', password: 'Owner@1234' });
  ownerToken = ol.json.data.token;
  assert.ok(adminToken && ownerToken);
  void ownerUser;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

test('legacy tenant without a subscription doc gets a virtual trial and can bill', async () => {
  const preview = await send('GET', '/api/subscription', null, ownerToken);
  assert.strictEqual(preview.status, 200);
  assert.strictEqual(preview.json.data.status, 'TRIAL');
  assert.strictEqual(preview.json.data.canBill, true);

  const bill = await createBill('subs-bill-001');
  assert.strictEqual(bill.status, 201, JSON.stringify(bill.json));

  // A Subscription document now exists (write-through) with trial dates set.
  sub = await Subscription.findOne({ businessId: biz._id });
  assert.ok(sub, 'subscription doc materialized');
  assert.strictEqual(sub.trialEndDate instanceof Date || sub.trialEndDate, true);
});

test('expired trial blocks billing with 402 SUBSCRIPTION_EXPIRED; reads stay open', async () => {
  const past = addMonthsClamped(new Date(), -3);
  await Subscription.updateOne({ _id: sub._id }, { $set: { status: 'TRIAL', trialEndDate: past } });

  const blocked = await createBill('subs-expired-001');
  assert.strictEqual(blocked.status, 402);
  assert.strictEqual(blocked.json.code, 'SUBSCRIPTION_EXPIRED');

  // No bill persisted for the blocked attempt.
  assert.strictEqual(await Bill.countDocuments({ idempotencyKey: 'subs-expired-001' }), 0);

  // Reads remain available per spec §21.
  const history = await send('GET', '/api/bills', null, ownerToken);
  assert.strictEqual(history.status, 200);
  const reports = await send('GET', '/api/reports/sales?period=this_month', null, ownerToken);
  assert.strictEqual(reports.status, 200);
  const dash = await send('GET', '/api/reports/dashboard', null, ownerToken);
  assert.strictEqual(dash.status, 200);
  const preview = await send('GET', '/api/subscription', null, ownerToken);
  assert.strictEqual(preview.json.data.status, 'EXPIRED');
  assert.strictEqual(preview.json.data.canBill, false);
});

test('admin extend re-activates billing and is audited', async () => {
  const ext = await send(
    'POST',
    `/api/admin/businesses/${biz._id}/extend`,
    { months: 2 },
    adminToken
  );
  assert.strictEqual(ext.status, 200);
  assert.strictEqual(ext.json.data.subscription.status, 'ACTIVE');
  const newEnd = new Date(ext.json.data.subscription.currentPeriodEnd);
  assert.ok(newEnd > new Date());

  // Business mirror updated.
  const b = await Business.findById(biz._id).select('subscriptionStatus');
  assert.strictEqual(b.subscriptionStatus, 'ACTIVE');

  // Billing works again.
  const bill = await createBill('subs-after-extend');
  assert.strictEqual(bill.status, 201);

  // Audit trail contains the extension.
  const log = await AuditLog.findOne({ action: 'SUBSCRIPTION_EXTENDED', businessId: biz._id }).sort({ createdAt: -1 });
  assert.ok(log, 'extension audited');
  assert.strictEqual(log.metadata.months, 2);
});

test('expiring window derives EXPIRING state while still allowing bills', async () => {
  const soon = new Date(Date.now() + 5 * 86400000); // within 7-day warning
  await Subscription.updateOne(
    { _id: sub._id },
    { $set: { currentPeriodEnd: soon } }
  );

  const preview = await send('GET', '/api/subscription', null, ownerToken);
  assert.strictEqual(preview.json.data.status, 'EXPIRING');
  assert.ok(preview.json.data.daysRemaining !== null && preview.json.data.daysRemaining <= 7);
  assert.strictEqual(preview.json.data.canBill, true);

  const bill = await createBill('subs-expiring-window');
  assert.strictEqual(bill.status, 201);
});

test('admin subscriptions list filters by status', async () => {
  const active = await send('GET', '/api/admin/subscriptions?status=EXPIRING', null, adminToken);
  assert.strictEqual(active.status, 200);
  assert.ok(active.json.data.subscriptions.some((s) => s.businessId === biz._id.toString()));

  const expired = await send('GET', '/api/admin/subscriptions?status=EXPIRED', null, adminToken);
  assert.ok(!expired.json.data.subscriptions.some((s) => s.businessId === biz._id.toString()));
});

test('business creation via API activates a fresh 2-month trial automatically', async () => {
  const created = await send(
    'POST',
    '/api/admin/businesses',
    {
      businessName: 'Fresh Trial Shop',
      businessType: 'MOBILE',
      ownerUsername: 'fresh_owner',
      ownerPassword: 'Owner@1234',
    },
    adminToken
  );
  assert.strictEqual(created.status, 201);
  const newBizId = created.json.data.business.id;

  const s = await Subscription.findOne({ businessId: new mongoose.Types.ObjectId(newBizId) });
  assert.ok(s, 'trial subscription created');
  assert.strictEqual(s.status, 'TRIAL');

  const expectedEnd = addMonthsClamped(new Date(created.json.data.business.createdAt), 2);
  assert.strictEqual(new Date(s.trialEndDate).getMonth(), expectedEnd.getMonth());

  const ol = await send('POST', '/api/auth/owner/login', { username: 'fresh_owner', password: 'Owner@1234' });
  const prev = await send('GET', '/api/subscription', null, ol.json.data.token);
  assert.strictEqual(prev.json.data.status, 'TRIAL');
  assert.strictEqual(prev.json.data.canBill, true);
});

test('First 6 Months Free offer: 6-month trial + ₹2,500 per 6-month renewal', async () => {
  const created = await send(
    'POST',
    '/api/admin/businesses',
    {
      businessName: 'Six Month Offer Shop',
      businessType: 'GENERAL_RETAIL',
      ownerUsername: 'sixmon_owner',
      ownerPassword: 'Owner@1234',
      plan: 'SIX_MONTH_FREE',
    },
    adminToken
  );
  assert.strictEqual(created.status, 201);
  const newBizId = created.json.data.business.id;

  // Trial runs for 6 months under the promotional plan.
  const s = await Subscription.findOne({ businessId: new mongoose.Types.ObjectId(newBizId) });
  assert.ok(s);
  assert.strictEqual(s.planId, 'SIX_MONTH_FREE');
  assert.strictEqual(s.status, 'TRIAL');
  const expectedEnd = addMonthsClamped(new Date(created.json.data.business.createdAt), 6);
  assert.strictEqual(new Date(s.trialEndDate).getMonth(), expectedEnd.getMonth());
  assert.ok(new Date(s.trialEndDate) > addMonthsClamped(new Date(created.json.data.business.createdAt), 4));

  // Owner subscription summary carries the ₹2,500 / 6-month recharge terms.
  const ol = await send('POST', '/api/auth/owner/login', { username: 'sixmon_owner', password: 'Owner@1234' });
  const prev = await send('GET', '/api/subscription', null, ol.json.data.token);
  assert.strictEqual(prev.json.data.plan, 'SIX_MONTH_FREE');
  assert.strictEqual(prev.json.data.planLabel, 'First 6 Months Free');
  assert.strictEqual(prev.json.data.rechargeAmount, 2500);
  assert.strictEqual(prev.json.data.rechargeMonths, 6);

  // Admin extends by 6 months → the recorded amount is exactly ₹2,500.
  const ext = await send('POST', `/api/admin/businesses/${newBizId}/extend`, { months: 6 }, adminToken);
  assert.strictEqual(ext.status, 200);
  assert.strictEqual(ext.json.data.subscription.amount, 2500);
  assert.strictEqual(ext.json.data.subscription.status, 'ACTIVE');
});

module.exports = {};