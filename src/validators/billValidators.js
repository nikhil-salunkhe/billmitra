'use strict';

const { z } = require('zod');
const { PAYMENT_METHODS } = require('../config/constants');

/**
 * Zod schemas for bill creation and listing.
 * NOTE: prices/tax rates are intentionally NOT accepted from the client —
 * the server reads them from Product documents to prevent manipulation.
 */

const billItemSchema = z
  .object({
    productId: z.string().trim().min(1, 'productId is required').max(40),
    quantity: z.coerce.number().int('Quantity must be a whole number').positive('Quantity must be > 0'),
  })
  .strict(); // unknown fields (e.g. client-sent unitPrice) are rejected, not ignored

const createBillSchema = z
  .object({
    items: z.array(billItemSchema).min(1, 'At least one item is required').max(200),
    // Whole-bill discount. `discount` is either an amount (default) or a
    // percentage when discountType === 'PERCENT' (server converts to amount).
    discount: z.coerce.number().min(0).optional(),
    discountType: z.enum(['AMOUNT', 'PERCENT']).optional(),
    paymentMethod: z.enum(Object.values(PAYMENT_METHODS)),
    customerName: z.string().trim().max(80).optional(),
    customerPhone: z.string().trim().max(20).optional(),
    notes: z.string().trim().max(500).optional(),
    // Client-generated request id: retries with the same key never double-bill.
    idempotencyKey: z.string().trim().min(8, 'idempotencyKey must be at least 8 characters').max(64),
  })
  .strict();

const listBillsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  from: z.string().trim().max(30).optional(),
  to: z.string().trim().max(30).optional(),
  paymentMethod: z.enum(Object.values(PAYMENT_METHODS)).optional(),
  search: z.string().trim().max(80).optional(),
});

module.exports = { createBillSchema, listBillsQuerySchema };