'use strict';

const syncService = require('../services/syncService');
const { ApiError } = require('../utils/ApiError');
const { success } = require('../utils/ApiResponse');

/**
 * POST /api/sync/push
 * Body: { deviceId, transactions: [ { entityType, entityId, operation, transactionId, payload } ] }
 *
 * Tenant is derived from the authenticated JWT (never the body). Each
 * record is processed independently so one bad record cannot block others.

async function push(req, res, next) {
  try {
    const transactions = req.body?.transactions;
    if (!Array.isArray(transactions)) {
      throw ApiError.badRequest('transactions array is required', 'INVALID_TRANSACTIONS');
    }

    const result = await syncService.pushBatch(
      req.businessId,
      req.businessType,
      req.user.id,
      transactions
    );

    // Best-effort device metadata refresh (never fails the request).
    if (req.body?.deviceId) {
      syncService.touchDevice(req.businessId, req.body.deviceId).catch(() => {});
    }

    return success(res, { synced: result.synced, failed: result.failed, serverChanges: [] }, 'Sync processed');
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/sync/pull?since=<ISO>&limit=<n>
 * Cursor-based change feed of tenant bills (Phase 5 will apply them locally).
 */
async function pull(req, res, next) {
  try {
    const since = req.query?.since || null;
    const limit = req.query?.limit ? Number(req.query.limit) : undefined;
    const result = await syncService.pullChanges(req.businessId, since, { limit });
    return success(res, { changes: result.changes, cursor: result.cursor }, 'Sync processed');
  } catch (err) {
    return next(err);
  }
}

module.exports = { push, pull };