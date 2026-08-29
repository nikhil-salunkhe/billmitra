'use strict';

const mongoose = require('mongoose');
const { MENU_BUSINESS_TYPES } = require('../config/constants');

/**
 * A sellable product or menu item owned by exactly one tenant.
 *
 * Stock is optional: hotel/cafe/restaurant tenants default to stockEnabled=false
 * so they are never forced into inventory management.
 *
 * Deletion is soft (isActive=false) because products are referenced by
 * historical bills.
 */
const productSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    sku: { type: String, trim: true, uppercase: true, default: null },
    barcode: { type: String, trim: true, default: null },
    description: { type: String, trim: true, default: '' },
    imageUrl: { type: String, trim: true, default: null },

    purchasePrice: { type: Number, min: 0, default: 0 },
    sellingPrice: { type: Number, required: true, min: 0 },

    // GST rate in percent; 0 means exempt/none. Never a single hard-coded rate.
    taxRate: { type: Number, min: 0, max: 100, default: 0 },
    hsnCode: { type: String, trim: true, default: null },

    stockEnabled: { type: Boolean, default: true },
    currentStock: { type: Number, min: 0, default: 0 },
    minimumStock: { type: Number, min: 0, default: 0 },
    unit: { type: String, trim: true, default: 'PCS' },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// SKU is unique per tenant when present (sparse allows multiple nulls).
productSchema.index(
  { businessId: 1, sku: 1 },
  {
    unique: true,
    sparse: true,
    collation: { locale: 'en', strength: 2 },
  }
);
productSchema.index({ businessId: 1, barcode: 1 });
productSchema.index({ businessId: 1, name: 1 });
productSchema.index({ businessId: 1, isActive: 1 });

productSchema.statics.defaultStockEnabledFor = function defaultStockEnabledFor(businessType) {
  return !MENU_BUSINESS_TYPES.includes(businessType);
};

productSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    businessId: this.businessId.toString(),
    categoryId: this.categoryId ? this.categoryId.toString() : null,
    name: this.name,
    sku: this.sku,
    barcode: this.barcode,
    description: this.description,
    imageUrl: this.imageUrl,
    purchasePrice: this.purchasePrice,
    sellingPrice: this.sellingPrice,
    taxRate: this.taxRate,
    hsnCode: this.hsnCode,
    stockEnabled: this.stockEnabled,
    currentStock: this.currentStock,
    minimumStock: this.minimumStock,
    unit: this.unit,
    isActive: this.isActive,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('Product', productSchema);