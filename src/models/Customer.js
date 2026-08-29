'use strict';

const mongoose = require('mongoose');

/**
 * A customer owned by exactly one tenant. Customers are soft-deleted
 * (isActive=false) because historical bills reference their snapshots.
 */
const customerSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    // Loose normalization happens in the service layer (digits kept only).
    phone: { type: String, trim: true, default: null },
    email: { type: String, trim: true, lowercase: true, default: null },
    address: { type: String, trim: true, default: '' },
    gstNumber: { type: String, trim: true, uppercase: true, default: null },
    notes: { type: String, trim: true, default: '' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Fast tenant-scoped lookups by name/phone.
customerSchema.index({ businessId: 1, name: 1 });
customerSchema.index({ businessId: 1, phone: 1 });
// One active customer per unique phone number within a tenant (nulls exempt).
customerSchema.index(
  { businessId: 1, phone: 1, isActive: 1 },
  {
    unique: true,
    partialFilterExpression: { phone: { $type: 'string' }, isActive: true },
    collation: { locale: 'en', strength: 2 },
  }
);

customerSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    businessId: this.businessId.toString(),
    name: this.name,
    phone: this.phone,
    email: this.email,
    address: this.address,
    gstNumber: this.gstNumber,
    notes: this.notes,
    isActive: this.isActive,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('Customer', customerSchema);
