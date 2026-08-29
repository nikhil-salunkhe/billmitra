'use strict';

const AuditLog = require('../models/AuditLog');

/**
 * Records an audit event. Never accepts sensitive values in metadata:
 * passwords, tokens and payment credentials must not be passed here.
 */
async function logAudit({ actorId, actorRole = 'SUPER_ADMIN', businessId = null, action, entityType, entityId, metadata = {}, ipAddress = null }) {
  try {
    await AuditLog.create({
      actorId,
      actorRole,
      businessId: businessId || null,
      action,
      entityType: entityType || null,
      entityId: entityId || null,
      metadata,
      ipAddress,
    });
  } catch (err) {
    // Auditing must never break a primary request. Log and continue.
    console.warn('[audit] Failed to write audit log:', err.message);
  }
}

/**
 * Paginated list of audit entries, optionally filtered by business.
 */
async function listAuditLogs({ page = 1, limit = 25, businessId = null, action = '' } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));

  const filter = {};
  if (businessId) filter.businessId = businessId;
  if (action) filter.action = action;

  const total = await AuditLog.countDocuments(filter);
  const docs = await AuditLog.find(filter)
    .sort({ createdAt: -1 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum)
    .lean()
    .catch(() => []);

  return {
    logs: docs.map((d) => ({ ...d, id: d._id.toString() })),
    pagination: { page: pageNum, limit: limitNum, total },
  };
}

module.exports = { logAudit, listAuditLogs };