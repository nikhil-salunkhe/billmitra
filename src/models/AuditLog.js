'use strict';

const mongoose = require('mongoose');
const { ROLES } = require('../config/constants');

/**
 * Audit trail for sensitive administrative actions (suspend/activate/reset/
 * extend/disable) and the corresponding owner-side login events.
 * Indexed by business and actor for efficient opt-in reports.
 */
const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    actorRole: {
      type: String,
      enum: Object.values(ROLES),
      default: ROLES.SUPER_ADMIN,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      default: null,
      index: true,
    },
    action: { type: String, required: true, index: true },
    entityType: { type: String },
    entityId: { type: mongoose.Schema.Types.ObjectId },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    ipAddress: { type: String, default: null },
  },
  { timestamps: true }
);

auditLogSchema.index({ businessId: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);