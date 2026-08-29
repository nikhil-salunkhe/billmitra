'use strict';

const mongoose = require('mongoose');
const { SUBSCRIPTION_STATUS, SUBSCRIPTION_PLANS } = require('../config/constants');

/**
 * Schema only — the subscription *engine* (trial activation, expiry, renewal,
 * middleware) lands in Phase 11. Created now so Business.subscriptionId can
 * reference it and the schema docs stay correct.
 */
const subscriptionSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    planId: {
      type: String,
      default: SUBSCRIPTION_PLANS.INITIAL.name,
    },
    status: {
      type: String,
      enum: Object.values(SUBSCRIPTION_STATUS),
      index: true,
    },
    startDate: { type: Date, default: null },
    trialStartDate: { type: Date, default: null },
    trialEndDate: { type: Date, default: null },
    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },
    amount: { type: Number, default: 0 },
    autoRenew: { type: Boolean, default: false },
  },
  { timestamps: true }
);

subscriptionSchema.index({ businessId: 1, status: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);