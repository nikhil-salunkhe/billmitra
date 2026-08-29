'use strict';

const mongoose = require('mongoose');

/**
 * A purchasable recharge offer the admin curates (e.g. "3 Months ₹1,299").
 * Global catalog shared by all businesses — prices in whole rupees.
 */
const RechargePlanSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 200, default: '' },
    months: { type: Number, required: true, min: 1, max: 36 },
    price: { type: Number, required: true, min: 1 }, // rupees
    badge: { type: String, trim: true, maxlength: 24, default: '' }, // e.g. "Best value"
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: false,
      transform(doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

RechargePlanSchema.index({ isActive: 1, sortOrder: 1 });

module.exports = mongoose.model('RechargePlan', RechargePlanSchema);
