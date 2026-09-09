'use strict';

const mongoose = require('mongoose');

/**
 * Device — a physical installation of the Owner app.
 *
 * Every device registers once per business (idempotently). The backend uses
 * this record to associate sync pushes with the originating installation and
 * to power multi-device diagnostics (Phase 5).
 */
const deviceSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, trim: true },
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    deviceName: { type: String, trim: true, default: '' },
    platform: { type: String, default: 'android' },
    appVersion: { type: String, trim: true, default: '' },
    lastActiveAt: { type: Date, default: Date.now },
    lastSyncAt: { type: Date, default: null },
  },
  { timestamps: true }
);

deviceSchema.index({ deviceId: 1, businessId: 1 }, { unique: true });
deviceSchema.index({ businessId: 1, lastActiveAt: -1 });

module.exports = mongoose.model('Device', deviceSchema);