'use strict';

const { z } = require('zod');

/**
 * Zod schemas for authentication payloads.
 * Password minimum is 8 characters to discourage weak credentials.
 */

const adminLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

const ownerLoginSchema = z
  .object({
    // Owner may sign in with either a username or an email.
    username: z.string().trim().min(1).max(64).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  })
  .refine((d) => Boolean(d.username || d.email), {
    message: 'Provide a username or email',
    path: ['username'],
  });

module.exports = { adminLoginSchema, ownerLoginSchema };