'use strict';

const mongoose = require('mongoose');
const {
  BUSINESS_TYPES,
  BUSINESS_STATUS,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_PLANS,
} = require('../config/constants');

/**
 * A tenant. Every business-owned record belongs to exactly one Business.
 * subscriptionId links to a Subscription document (engine lands in Phase 11);
 * until then subscriptionStatus is informational.
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

    // Subscription offer chosen by the admin at creation. INITIAL gives the
    // standard 2-month free trial; SIX_MONTH_FREE is the promotional offer of
    // 6 months free followed by ₹2,500 recharges per 6 months.
    plan: {
      type: String,
      enum: Object.keys(SUBSCRIPTION_PLANS),
      default: SUBSCRIPTION_PLANS.INITIAL.name,
      index: true,
    },
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
    subscriptionStatus: {
      type: String,
      enum: Object.values(SUBSCRIPTION_STATUS),
      default: SUBSCRIPTION_STATUS.TRIAL,
      index: true,
    },
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null,
    },
  },
  { timestamps: true }
);

businessSchema.index({ businessType: 1, status: 1 });
businessSchema.index({ city: 1 });

businessSchema.methods.toSafeJSON = function toSafeJSON() {
  const plan = SUBSCRIPTION_PLANS[this.plan] || SUBSCRIPTION_PLANS.INITIAL;
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
    plan: plan.name,
    planLabel: plan.label,
    planTagline: plan.tagline || '',
    logoUrl: this.logoUrl || null,
    openingTime: this.openingTime || null,
    closingTime: this.closingTime || null,
    showInApp: Boolean(this.showInApp),
    status: this.status,
    subscriptionStatus: this.subscriptionStatus,
    subscriptionId: this.subscriptionId ? this.subscriptionId.toString() : null,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('Business', businessSchema);