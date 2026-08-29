'use strict';

const { z } = require('zod');
const { STOCK_TRANSACTION_TYPES } = require('../config/constants');

/**
 * Zod schemas for the stock module.
 */

const MANUAL_TYPES = [
  STOCK_TRANSACTION_TYPES.OPENING,
  STOCK_TRANSACTION_TYPES.PURCHASE,
  STOCK_TRANSACTION_TYPES.ADJUSTMENT,
  STOCK_TRANSACTION_TYPES.RETURN,
];

const adjustmentSchema = z
  .object({
    productId: z.string().trim().min(1).max(40),
    type: z.enum(MANUAL_TYPES), // SALE is excluded: billing owns it
    quantity: z.coerce.number().int('Quantity must be a whole number'),
  })
  .superRefine((val, ctx) => {
    const q = val.quantity;
    if (!Number.isFinite(q)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quantity'], message: 'Invalid quantity' });
      return;
    }
    if (val.type === 'OPENING' && q < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quantity'], message: 'Opening stock cannot be negative' });
    }
    if ((val.type === 'PURCHASE' || val.type === 'RETURN') && q <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quantity'], message: 'Quantity must be positive' });
    }
    if (val.type === 'ADJUSTMENT' && q === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quantity'], message: 'Adjustment cannot be zero' });
    }
  });

const listStockQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  search: z.string().trim().max(120).optional(),
  categoryId: z.string().trim().max(40).optional(),
  status: z.enum(['OUT', 'LOW', 'OK', 'N/A']).optional(),
});

const ledgerQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  type: z.enum(Object.values(STOCK_TRANSACTION_TYPES)).optional(),
});

module.exports = { adjustmentSchema, listStockQuerySchema, ledgerQuerySchema };