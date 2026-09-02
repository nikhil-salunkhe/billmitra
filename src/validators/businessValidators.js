'use strict';

const { z } = require('zod');
const { BUSINESS_TYPES, BUSINESS_STATUS, SUBSCRIPTION_PLANS } = require('../config/constants');

/**
 * Zod schemas for business creation & updates.
 * Owner password must be strong (>= 8 chars) and is shown once at creation.
 */

// 24-hour clock, e.g. "09:00", "21:30".
const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/;

const createBusinessSchema = z.object({
  businessName: z.string().trim().min(2, 'Business name must be at least 2 characters').max(120),
  businessType: z.enum(Object.values(BUSINESS_TYPES)),
  ownerName: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: z.string().trim().max(12).optional(),
  gstRegistered: z.boolean().optional(),
  gstin: z.string().trim().max(20).optional(),
  // Subscription offer: INITIAL (2 months free), SIX_MONTH_FREE (6 months
  // free, then ₹2,500 per 6 months) or YEARLY (buy app + printer -> year 1
  // free, then ₹2,999/year). Defaults to INITIAL when omitted.
  plan: z.enum(Object.keys(SUBSCRIPTION_PLANS)).optional(),
  logoUrl: z.string().trim().max(500).optional(),
  openingTime: z.string().trim().regex(TIME_24H, 'Use 24-hour HH:mm format').optional().or(z.literal('')),
  closingTime: z.string().trim().regex(TIME_24H, 'Use 24-hour HH:mm format').optional().or(z.literal('')),
  showInApp: z.boolean().optional(),
  ownerUsername: z
    .string()
    .trim()
    .min(3, 'Owner username must be at least 3 characters')
    .max(40),
  ownerPassword: z.string().min(8, 'Owner password must be at least 8 characters').max(128),
  ownerDisplayName: z.string().trim().max(120).optional(),
});

const updateBusinessSchema = createBusinessSchema.partial();

const listBusinessesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().max(100).optional(),
  status: z.enum(Object.values(BUSINESS_STATUS)).optional(),
  businessType: z.enum(Object.values(BUSINESS_TYPES)).optional(),
});

const resetPasswordSchema = z.object({
  // Optional: if omitted the server generates a temporary password.
  newPassword: z.string().min(8, 'Password must be at least 8 characters').max(128).optional(),
});

const RECHARGE_METHODS = ['UPI', 'CARD', 'NETBANKING', 'WALLET', 'CASH', 'OTHER'];

const extendSubscriptionSchema = z.object({
  months: z.coerce.number().int().min(1, 'months must be at least 1').max(60).optional(),
  // Record how the customer paid for an admin-granted extension -> stored on a Payment.
  paymentMethod: z.enum(RECHARGE_METHODS).optional(),
});

const updatePaymentMethodSchema = z.object({
  paymentMethod: z.enum(RECHARGE_METHODS),
});

const listSubscriptionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(['TRIAL', 'ACTIVE', 'EXPIRING', 'EXPIRED', 'SUSPENDED']).optional(),
});

const auditLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  businessId: z.string().trim().max(40).optional(),
  action: z.string().trim().max(60).optional(),
});

module.exports = {
  createBusinessSchema,
  updateBusinessSchema,
  listBusinessesQuerySchema,
  resetPasswordSchema,
  auditLogsQuerySchema,
  extendSubscriptionSchema,
  listSubscriptionsQuerySchema,
  updatePaymentMethodSchema,
};