'use strict';

const { success, created } = require('../utils/ApiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const subscriptionService = require('../services/subscriptionService');
const paymentService = require('../services/paymentService');
const RechargePlan = require('../models/RechargePlan');

/**
 * GET /api/subscription — owner's read-only subscription preview.
 */
const getSubscription = asyncHandler(async (req, res) => {
  const data = await subscriptionService.getOwnerSubscription(req.businessId);
  return success(res, data, 'Subscription status retrieved');
});

/**
 * GET /api/subscription/plans — active recharge offers curated by the admin.
 * Does NOT require an active subscription (expired owners must see plans).
 */
const listPlans = asyncHandler(async (req, res) => {
  const plans = await RechargePlan.find({ isActive: true }).sort({ sortOrder: 1, months: 1 }).lean();
  // .lean() bypasses the schema's toJSON transform, so expose `id` explicitly
  // (the owner app expects `plan.id` when it posts a recharge).
  const normalized = plans.map((p) => ({ ...p, id: p._id.toString() }));
  return success(res, { plans: normalized }, 'Recharge plans retrieved');
});

/**
 * POST /api/subscription/recharge { planId } — creates a Razorpay Payment Link
 * (UPI-ready). Success on the gateway is verified server-side only.
 */
const createRecharge = asyncHandler(async (req, res) => {
  const { planId } = req.body || {};
  if (!planId) throw ApiError.badRequest('planId is required', 'PLAN_ID_REQUIRED');
  const data = await paymentService.createRecharge({
    businessId: req.businessId,
    userId: req.user.id,
    planId,
  });
  return created(res, { paymentId: data.payment.id, paymentUrl: data.paymentUrl, amount: data.payment.amount, months: data.payment.months }, 'Payment link created');
});

/**
 * POST /api/subscription/recharge/:paymentId/sync — polls the gateway for the
 * real payment state; activates the renewal exactly once when actually paid.
 */
const syncRecharge = asyncHandler(async (req, res) => {
  // Tenant guard before touching the gateway.
  const payment = await paymentService.listPayments(req.businessId, { limit: 100 });
  if (!payment.some((p) => p.id === req.params.paymentId)) {
    throw ApiError.notFound('Payment not found', 'PAYMENT_NOT_FOUND');
  }
  const result = await paymentService.syncAndActivateIfPaid(req.params.paymentId);
  return success(
    res,
    {
      paymentId: result.payment.id,
      status: result.payment.status,
      activatedNow: Boolean(result.activatedNow),
      newExpiry: result.subscription?.currentPeriodEnd || null,
    },
    'Payment status synced'
  );
});

/** GET /api/subscription/payments — this tenant's recharge history. */
const listPayments = asyncHandler(async (req, res) => {
  const payments = await paymentService.listPayments(req.businessId, req.query);
  return success(res, { payments }, 'Payment history retrieved');
});

module.exports = { getSubscription, listPlans, createRecharge, syncRecharge, listPayments };
