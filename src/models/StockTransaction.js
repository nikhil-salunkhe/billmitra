'use strict';

const mongoose = require('mongoose');
const { STOCK_TRANSACTION_TYPES } = require('../config/constants');

/**
 * Immutable stock ledger entry. Every stock change (sale, opening, adjustment,
 * purchase, return) records the before/after quantities so discrepancies can be
 * audited. Created by billing on each sale (Phase 8) and by stock endpoints.
 */
const stockTransactionSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    type: { type: String, enum: Object.values(STOCK_TRANSACTION_TYPES), required: true },
    quantity: { type: Number, required: true },
    previousStock: { type: Number, required: true },
    newStock: { type: Number, required: true },
    referenceType: { type: String, default: null }, // e.g. 'Bill'
    referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

stockTransactionSchema.index({ businessId: 1, createdAt: -1 });
stockTransactionSchema.index({ businessId: 1, productId: 1, createdAt: -1 });

module.exports = mongoose.model('StockTransaction', stockTransactionSchema);