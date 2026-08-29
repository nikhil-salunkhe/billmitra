'use strict';

const mongoose = require('mongoose');
const { PAYMENT_METHODS, TAX_MODE } = require('../config/constants');

/**
 * Tenant-scoped configuration for a business that shapes billing and receipts.
 */
const businessSettingsSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      unique: true,
      index: true,
    },
    invoicePrefix: { type: String, trim: true, uppercase: true, default: 'INV' },
    currency: { type: String, trim: true, default: '₹' },
    defaultTaxMode: {
      type: String,
      enum: Object.values(TAX_MODE),
      default: TAX_MODE.GST,
    },
    defaultPaymentMethod: {
      type: String,
      enum: Object.values(PAYMENT_METHODS),
      default: PAYMENT_METHODS.CASH,
    },
    showLogoOnBill: { type: Boolean, default: true },
    allowNegativeStock: { type: Boolean, default: false },
    billFooter: { type: String, trim: true, default: 'Thank you for your visit!' },
    addressOnBill: { type: Boolean, default: true },
    phoneOnBill: { type: Boolean, default: true },
    gstNumberOnBill: { type: Boolean, default: true },
  },
  { timestamps: true }
);

businessSettingsSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    businessId: this.businessId.toString(),
    invoicePrefix: this.invoicePrefix,
    currency: this.currency,
    defaultTaxMode: this.defaultTaxMode,
    defaultPaymentMethod: this.defaultPaymentMethod,
    showLogoOnBill: this.showLogoOnBill,
    allowNegativeStock: this.allowNegativeStock,
    billFooter: this.billFooter,
    addressOnBill: this.addressOnBill,
    phoneOnBill: this.phoneOnBill,
    gstNumberOnBill: this.gstNumberOnBill,
  };
};

module.exports = mongoose.model('BusinessSettings', businessSettingsSchema);