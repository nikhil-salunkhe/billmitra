'use strict';

const mongoose = require('mongoose');

/**
 * Generic atomic counter used for race-safe server-generated sequences such as
 * invoice numbers. Two simultaneous requests can never receive the same value.
 *
 * key examples:
 *   "<businessId>:<PREFIX>:<year>"   -> per-tenant, per-year invoice sequence
 */
const counterSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Number, default: 0 },
  },
  { timestamps: true }
);

/**
 * Atomically increments and returns the counter for `key`.
 * Must be called with the current transaction `session` when one exists so the
 * increment rolls back together with the rest of the operation.
 */
counterSchema.statics.nextValue = async function nextValue(key, session = null) {
  const doc = await this.findOneAndUpdate(
    { key },
    { $inc: { value: 1 }, $setOnInsert: { key } },
    { upsert: true, new: true, session }
  );
  if (!doc || typeof doc.value !== 'number') {
    throw Object.assign(new Error('Failed to allocate counter'), { code: 'COUNTER_FAILED' });
  }
  return doc.value;
};

module.exports = mongoose.model('Counter', counterSchema);