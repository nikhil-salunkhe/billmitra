'use strict';

const { z } = require('zod');

/**
 * Zod schemas for report queries (Phase 10).
 */

const PERIODS = ['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'custom'];

const reportQuerySchema = z
  .object({
    period: z.enum(PERIODS).optional(),
    from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD').optional(),
    to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD').optional(),
    // Client's UTC offset so "today" matches the shop's calendar, not the server's.
    tzOffsetMinutes: z.coerce.number().int().min(-720).max(840).optional(),
    groupBy: z.enum(['day', 'month']).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .superRefine((val, ctx) => {
    const period = val.period || 'this_month';
    if (period === 'custom') {
      if (!val.from || !val.to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['from'],
          message: 'from and to are required when period=custom',
        });
      } else if (val.from > val.to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['from'],
          message: 'from must be on or before to',
        });
      }
    }
  });

module.exports = { reportQuerySchema };