'use strict';

const mongoose = require('mongoose');

/**
 * One recharge purchase lifecycle for a business. Idempotency anchor for
 * auto-extending subscriptions exactly once per successful payment.
 */
const PaymentSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'RechargePlan' },
    planName: { type: String, trim: true },
    months: { type: Number, required: true, min: 1 },

    amount: { type: Number, required: true, min: 0 }, // rupees
    currency: { type: String, default: 'INR' },

    provider: { type: String, enum: ['RAZORPAY', 'MANUAL'], default: 'RAZORPAY' },
    // Razorpay payment_link id — unique so a retried recharge reuses one record.
    providerLinkId: { type: String, index: { unique: true, sparse: true } },
    providerLinkUrl: { type: String, default: '' }, // Razorpay hosted checkout (UPI/cards)
    providerPaymentId: { type: String },
    // Short link reference (<=40 chars, Razorpay constraint) used for webhook routing.
    referenceId: { type: String, trim: true, default: '' },

    // How the customer actually paid. Captured from the gateway on a paid
    // recharge, or curated by the admin for manual extensions/overrides.
    paymentMethod: {
      type: String,
      enum: ['', 'UPI', 'CARD', 'NETBANKING', 'WALLET', 'CASH', 'OTHER'],
      default: '',
    },
    // Raw gateway method string (e.g. 'upi', 'netbanking') for audit/tracing.
    providerMethod: { type: String, trim: true, default: '' },

    status: {
      type: String,
      enum: ['CREATED', 'PAID', 'FAILED'],
      default: 'CREATED',
      index: true,
    },
    subscriptionExtendedAt: { type: Date, default: null },
    failureReason: { type: String, default: '' },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

module.exports = mongoose.model('Payment', PaymentSchema);
