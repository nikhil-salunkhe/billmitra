'use strict';

const mongoose = require('mongoose');
const { ROLES } = require('../config/constants');

/**
 * User accounts belonging to a Business tenant.
 * - BUSINESS_OWNER is the primary MVP role.
 * - STAFF is reserved for a future phase (schema already allows it).
 * username is unique; businessId ties the account to exactly one tenant.
 */
const userSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    email: { type: String, trim: true, lowercase: true, default: null },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.BUSINESS_OWNER },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    businessId: this.businessId ? this.businessId.toString() : null,
    name: this.name,
    username: this.username,
    email: this.email,
    role: this.role,
    isActive: this.isActive,
    lastLoginAt: this.lastLoginAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('User', userSchema);