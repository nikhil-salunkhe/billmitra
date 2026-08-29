'use strict';

const mongoose = require('mongoose');

/**
 * Product/menu-item category scoped to a single tenant.
 * Category names are unique within a business (case-insensitive).
 */
const categorySchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Case-insensitive uniqueness of the name inside one tenant.
categorySchema.index(
  { businessId: 1, name: 1 },
  {
    unique: true,
    collation: { locale: 'en', strength: 2 },
  }
);

categorySchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    businessId: this.businessId.toString(),
    name: this.name,
    description: this.description,
    isActive: this.isActive,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('Category', categorySchema);