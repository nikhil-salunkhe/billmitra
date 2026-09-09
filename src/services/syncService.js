'use strict';

const Bill = require('../models/Bill');
const Device = require('../models/Device');
const billingService = require('./billingService');
const { ApiError } = require('../utils/ApiError');

/** Server-side cap on how many queue records a single push may carry. */
const PUSH_BATCH_LIMIT = 50;
/** Server-side cap for the pull change feed. */
const PULL_LIMIT = 2000;

/**
 * Registers (upserts) an installation device for a business.
 * Idempotent: re-registering the same deviceId simply refreshes metadata.
 */
async function registerDevice({ businessId, userId, deviceId, deviceName, platform, appVersion }) {
  if (!deviceId) throw ApiError.badRequest('deviceId is required', 'DEVICE_ID_REQUIRED');
  return Device.findOneAndUpdate(
    { deviceId, businessId },
    {
      deviceId,
      businessId,
      userId,
      deviceName: String(deviceName || '').slice(0, 120),
      platform: String(platform || 'android').slice(0, 24),
      appVersion: String(appVersion || '').slice(0, 40),
      lastActiveAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

/** Best-effort touch: updates a device's lastSyncAt after a successful push. */
async function touchDevice(businessId, deviceId) {
  if (!deviceId) return;
  await Device.findOneAndUpdate(
    { deviceId, businessId },
    { lastActiveAt: new Date(), lastSyncAt: new Date() }
  ).catch(() => {});
}

/**
 * Applies ONE queued transaction server-side.
 *
 * Currently supports BILL aggregates (Phase 4 scope). The offline bill
 * payload is a snapshot; the server never trusts client math — it re-resolves
 * products, recomputes totals, validates stock, and inserts atomically
 * (billingService.createBill). Idempotency anchors: transactionId →
 * idempotencyKey; clientBillId → partial-unique index.

async function pushTransaction(businessId, businessType, userId, tx) {
  const payload = tx.payload || {};
  const billData = payload.bill || {};
  const items = (billData.items || []).map((i) => ({
    productId: i.productId,
    quantity: Number(i.quantity || 1),
  }));

  if (items.length === 0) {
    throw ApiError.badRequest('Bill payload has no items', 'BILL_NO_ITEMS');
  }

  const result = await billingService.createBill(businessId, businessType, userId, {
    idempotencyKey: tx.transactionId || billData.transactionId,
    items,
    discount: billData.discount || 0,
    discountType: billData.discountType || 'AMOUNT',
    paymentMethod: billData.paymentMethod || 'CASH',
    notes: billData.notes || '',
    customerName: billData.customerName || null,
    customerPhone: billData.customerPhone || null,
    deviceId: tx.deviceId || null,
    clientBillId: billData.billId || tx.entityId || null,
    billCreatedAt: billData.createdAt || undefined,
  });

  return {
    transactionId: tx.transactionId || billData.transactionId,
    entityId: result.bill._id.toString(),
    alreadyProcessed: Boolean(result.alreadyExisted),
  };
}

/**
 * Pushes a batch of queued records. Each record is processed independently
 * so a single bad record cannot corruptthe rest of the queue. The client must
 * keep failed entries until a later retry.

async function pushBatch(businessId, businessType, userId, transactions = []) {
  const synced = [];
  const failed = [];

  for (const tx of (transactions || []).slice(0, PUSH_BATCH_LIMIT))) {
    try {
      const r = await pushTransaction(businessId, businessType, userId, tx);
      synced.push(r);
    } catch (err) {
      failed.push({
        transactionId: tx.transactionId || tx.entityId || null,
        entityId: tx.entityId || null,
        message: err.message || 'Sync failed',
        code: err.code || err.statusCode || 'SYNC_FAILED',
      });
    }
  }

  return { synced, failed };
}

/**
 * Pull: a cursor-based change feed of bills created after `since`
 * (an ISO timestamp). The app advances its local cursor only AFTER these
 * changes are applied locally (Phase 5 implements the apply step).
 */
async function pullChanges(businessId, since, { limit = PULL_LIMIT } = {}) {
  const filter = { businessId };
  if (since) {
    const sinceDate = new Date(since);
    if (!Number.isNaN(sinceDate.getTime())) {
      filter.createdAt = { $gt: sinceDate };
    }
  }

  const lim = Math.max(1, Math.min(PULL_LIMIT, Number(limit) || PULL_LIMIT));
  const bills = await Bill.find(filter)
    .select('_id invoiceNumber createdAt')
    .sort({ createdAt: 1 })
    .limit(lim);

  const changes = bills.map((b) => ({
    entityType: 'BILL',
    entityId: b._id.toString(),
    operation: 'CONFIRM',
    serverBillId: b._id.toString(),
    invoiceNumber: b.invoiceNumber,
    createdAt: b.createdAt,
  }));

  const nextCursor = bills.length > 0 ? bills[bills.length - 1].createdAt.toISOString() : (since || null);
  return { changes, cursor: nextCursor };
}

module.exports = { registerDevice, touchDevice, pushBatch, pullChanges };