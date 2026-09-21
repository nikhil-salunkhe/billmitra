'use strict';

const mongoose = require('mongoose');
const { BUSINESS_TYPES, BUSINESS_STATUS } = require('../config/constants');

/**
 * A tenant. Every business-owned record belongs to exactly one Business.
 * BillMitra is a lifetime service: there is no subscription, trial or expiry.
 * The only lifecycle control is `status` (ACTIVE / SUSPENDED / INACTIVE), which
 * the super-admin uses to freeze an account when genuinely necessary.
 */
const businessSchema = new mongoose.Schema(
  {
    businessName: { type: String, required: true, trim: true, index: true },
    businessType: {
      type: String,
      required: true,
      enum: Object.values(BUSINESS_TYPES),
      index: true,
    },
    ownerName: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true, default: null },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
    gstRegistered: { type: Boolean, default: false },
    gstin: { type: String, trim: true, default: null },

    // Public URL of the owner business logo (uploaded via the admin panel).
    logoUrl: { type: String, trim: true, default: null },
    // Business hours the shop operates (24-hour "HH:mm", e.g. "09:00"–"21:30").
    openingTime: { type: String, trim: true, default: null },
    closingTime: { type: String, trim: true, default: null },
    // Whether the business (logo + hours + branding) is shown inside the app.
    showInApp: { type: Boolean, default: true },

    status: {
      type: String,
      enum: Object.values(BUSINESS_STATUS),
      default: BUSINESS_STATUS.INACTIVE,
      index: true,
    },
  },
  { timestamps: true }
);

businessSchema.index({ businessType: 1, status: 1 });
businessSchema.index({ city: 1 });

businessSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    businessName: this.businessName,
    businessType: this.businessType,
    ownerName: this.ownerName,
    phone: this.phone,
    email: this.email,
    address: this.address,
    city: this.city,
    state: this.state,
    pincode: this.pincode,
    gstRegistered: this.gstRegistered,
    gstin: this.gstin,
    logoUrl: this.logoUrl || null,
    openingTime: this.openingTime || null,
    closingTime: this.closingTime || null,
    showInApp: Boolean(this.showInApp),
    status: this.status,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('Business', businessSchema);