'use strict';

const Counter = require('../models/Counter');

/**
 * Generates tenant-scoped invoice numbers of the form PREFIX-YYYY-000001.
 *
 * The sequence comes from the Counter collection via an atomic
 * findOneAndUpdate($inc, upsert) so two simultaneous billing requests can never
 * receive the same number. Pass `session` while inside a transaction so the
 * increment commits/rolls back with the bill itself.
 */
async function nextInvoiceNumber(businessId, invoicePrefix, date = new Date(), session = null) {
  const year = date.getFullYear();
  const prefix = String(invoicePrefix || 'INV').trim().toUpperCase().slice(0, 8);
  const key = `${businessId}:${prefix}:${year}`;

  const value = await Counter.nextValue(key, session);
  const seq = String(value).padStart(6, '0');
  return `${prefix}-${year}-${seq}`;
}

module.exports = { nextInvoiceNumber };