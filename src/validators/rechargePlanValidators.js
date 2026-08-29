'use strict';

const { z } = require('zod');

/** Admin-curated recharge offer validation. */
const createRechargePlanSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(200).optional().default(''),
  months: z.coerce.number().int().min(1).max(36),
  price: z.coerce.number().min(1), // whole rupees
  badge: z.string().trim().max(24).optional().default(''),
  isActive: z.coerce.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().optional().default(0),
});

const updateRechargePlanSchema = createRechargePlanSchema.partial();

module.exports = { createRechargePlanSchema, updateRechargePlanSchema };
