'use strict';

const mongoose = require('mongoose');
const { PAYMENT_METHODS, PAYMENT_STATUS } = require('../config/constants');

/**
 * A completed sale. Bills are append-only: no update/delete endpoints exist,
 * because historical bills must never be silently rewritten. Line items embed a
 * snapshot (name/price/tax at sale time) so later product edits cannot alter
 * the past.
 */
const billItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true, trim: true },
    sku: { type: String, default: null },
    unit: { type: String, default: 'PCS' },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    taxRate: { type: Number, required: true, min: 0 },
    lineAmount: { type: Number, required: true, min: 0 },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    igst: { type: Number, default: 0 },
    totalTax: { type: Number, default: 0 },
    stockEnabled: { type: Boolean, default: false },
  },
  { _id: false }
);

const billSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    invoiceNumber: { type: String, required: true },
    // Optional walk-in customer snapshot until the customers module lands.
    customerName: { type: String, trim: true, default: null },
    customerPhone: { type: String, trim: true, default: null },

    items: { type: [billItemSchema], required: true },

    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, required: true, min: 0, default: 0 },
    // How the stored discount was expressed at sale time (amount vs percent).
    discountType: { type: String, enum: ['AMOUNT', 'PERCENT'], default: 'AMOUNT' },
    taxableAmount: { type: Number, required: true, min: 0 },
    cgst: { type: Number, required: true, min: 0 },
    sgst: { type: Number, required: true, min: 0 },
    igst: { type: Number, required: true, min: 0 },
    totalTax: { type: Number, required: true, min: 0 },
    grandTotal: { type: Number, required: true, min: 0 },

    paymentMethod: {
      type: String,
      enum: Object.values(PAYMENT_METHODS),
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PAID,
    },
    businessType: { type: String, index: true },

    notes: { type: String, trim: true, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // Duplicate-submission protection (client-generated request id).
    idempotencyKey: { type: String, required: true },

    reprintCount: { type: Number, default: 0 },
    lastReprintAt: { type: Date, default: null },

    // Void/cancel. Bills are never hard-deleted: voiding keeps the historical
    // record (financial integrity + unique invoice numbers) but flags it and
    // restores any deducted stock.
    isVoided: { type: Boolean, default: false },
    voidedAt: { type: Date, default: null },
    voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    voidReason: { type: String, trim: true, maxlength: 300, default: '' },
  },
  { timestamps: true }
);

billSchema.index({ businessId: 1, invoiceNumber: 1 }, { unique: true });
billSchema.index({ businessId: 1, idempotencyKey: 1 }, { unique: true });
billSchema.index({ businessId: 1, createdAt: -1 });

billSchema.methods.toSafeJSON = function toSafeJSON() {
  // The Bill schema stores canonical names (grandTotal, discount, …) while the
  // owner app and the ESC/POS receipt builder read the friendlier aliases
  // (totalAmount, discountAmount, billNumber, …). Both are emitted here so
  // clients never render a missing total.
  const paid = this.paymentStatus === 'PAID' ? this.grandTotal : 0;
  return {
    id: this._id.toString(),
    businessId: this.businessId.toString(),
    invoiceNumber: this.invoiceNumber,
    // Alias: the app addresses the invoice by this name.
    billNumber: this.invoiceNumber,
    customerName: this.customerName,
    customerPhone: this.customerPhone,
    items: this.items.map((i) => ({
      productId: i.productId.toString(),
      name: i.name,
      sku: i.sku,
      unit: i.unit,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      taxRate: i.taxRate,
      lineAmount: i.lineAmount,
      cgst: i.cgst,
      sgst: i.sgst,
      igst: i.igst,
      totalTax: i.totalTax,
      stockEnabled: i.stockEnabled,
    })),
    subtotal: this.subtotal,
    discount: this.discount,
    discountType: this.discountType || 'AMOUNT',
    // Alias: discount as shown on the receipt.
    discountAmount: this.discount,
    taxableAmount: this.taxableAmount,
    cgst: this.cgst,
    sgst: this.sgst,
    igst: this.igst,
    totalTax: this.totalTax,
    grandTotal: this.grandTotal,
    // Alias: the headline total.
    totalAmount: this.grandTotal,
    // No partial-payment ledger exists yet: PAID bills are fully paid.
    paidAmount: paid,
    dueAmount: this.grandTotal - paid,
    paymentMethod: this.paymentMethod,
    paymentStatus: this.paymentStatus,
    notes: this.notes,
    reprintCount: this.reprintCount,
    isVoided: Boolean(this.isVoided),
    voidedAt: this.voidedAt || null,
    voidReason: this.voidReason || '',
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('Bill', billSchema);