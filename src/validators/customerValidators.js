'use strict';

const { z } = require('zod');

const phoneRegex = /^[0-9+\-\s]{6,20}$/;

const createCustomerSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(80),
    phone: z.string().trim().regex(phoneRegex, 'Invalid phone number').optional().or(z.literal('').transform(() => null)),
    email: z.string().trim().email('Invalid email').max(120).optional().or(z.literal('').transform(() => null)),
    address: z.string().trim().max(300).optional(),
    gstNumber: z.string().trim().max(20).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

const updateCustomerSchema = createCustomerSchema.partial();

const listCustomersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().max(80).optional(),
});

module.exports = {
  createCustomerSchema,
  updateCustomerSchema,
  listCustomersQuerySchema,
};
