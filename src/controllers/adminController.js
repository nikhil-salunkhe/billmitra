'use strict';

const { success, created } = require('../utils/ApiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const businessService = require('../services/businessService');
const adminService = require('../services/adminService');
const auditService = require('../services/auditService');
const RechargePlan = require('../models/RechargePlan');
const Payment = require('../models/Payment');

/**
 * GET /api/admin/dashboard — full card metrics.
 */
const dashboard = asyncHandler(async (req, res) => {
  const data = await adminService.getDashboard();
  return success(res, data, 'Dashboard summary');
});

/**
 * GET /api/admin/businesses
 */
const listBusinesses = asyncHandler(async (req, res) => {
  const data = await businessService.listBusinesses(req.query);
  return success(res, data, 'Businesses retrieved');
});

/**
 * POST /api/admin/businesses
 * Creates business + settings + owner. Returns one-time owner credentials.
 */
const createBusiness = asyncHandler(async (req, res) => {
  const result = await businessService.createBusiness(req.body);
  return created(
    res,
    {
      business: result.business,
      owner: result.owner,
      // One-time credential for the admin to hand to the business owner.
      ownerInitialPassword: result.initialPassword,
    },
    'Business created'
  );
});

/**
 * GET /api/admin/businesses/:id — includes owner user + settings.
 */
const getBusiness = asyncHandler(async (req, res) => {
  const data = await adminService.getBusinessDetail(req.params.id);
  return success(res, { business: data }, 'Business retrieved');
});

/**
 * PUT /api/admin/businesses/:id
 */
const updateBusiness = asyncHandler(async (req, res) => {
  const business = await businessService.updateBusiness(req.params.id, req.body);
  return success(res, { business: businessService.toSafeBusiness(business) }, 'Business updated');
});

/**
 * DELETE /api/admin/businesses/:id — cascade delete of a tenant + all data.
 * Audited for accountability.
 */
const deleteBusiness = asyncHandler(async (req, res) => {
  const business = await businessService.deleteBusiness(req.params.id);
  await auditService.logAudit({
    actorId: req.user.id,
    actorRole: 'SUPER_ADMIN',
    businessId: business._id,
    action: 'BUSINESS_DELETED',
    entityType: 'Business',
    entityId: business._id,
    metadata: { businessName: business.businessName },
  });
  return success(res, { id: req.params.id }, 'Business and its data deleted');
});

/**
 * POST /api/admin/businesses/:id/suspend
 */
const suspendBusiness = asyncHandler(async (req, res) => {
  const business = await adminService.setBusinessStatus(req.params.id, 'SUSPENDED', req.user.id);
  return success(res, { business: businessService.toSafeBusiness(business) }, 'Business suspended');
});

/**
 * POST /api/admin/businesses/:id/activate
 */
const activateBusiness = asyncHandler(async (req, res) => {
  const business = await adminService.setBusinessStatus(req.params.id, 'ACTIVE', req.user.id);
  return success(res, { business: businessService.toSafeBusiness(business) }, 'Business activated');
});

/**
 * POST /api/admin/businesses/:id/reset-password — returns one-time credential.
 */
const resetOwnerPassword = asyncHandler(async (req, res) => {
  const result = await adminService.resetOwnerPassword(req.params.id, req.user.id, req.body?.newPassword);
  return success(res, result, 'Owner password reset');
});

/**
 * GET /api/admin/audit-logs
 */
const auditLogs = asyncHandler(async (req, res) => {
  const data = await auditService.listAuditLogs(req.query);
  return success(res, data, 'Audit logs retrieved');
});

/**
 * POST /api/admin/businesses/:id/extend — audited subscription extension.
 */
const extendSubscription = asyncHandler(async (req, res) => {
  const subscriptionService = require('../services/subscriptionService');
  const sub = await subscriptionService.applyRenewal({
    businessId: req.params.id,
    months: req.body?.months || 1,
    actorId: req.user.id,
    actorRole: 'SUPER_ADMIN',
    action: 'SUBSCRIPTION_EXTENDED',
  });

  // If the admin recorded how the customer paid, store it as a manual Payment so
  // it shows in the recharge history + payment-method column. Without a method we
  // keep the original behaviour (no Payment row) so monthly revenue isn't skewed.
  let payment = null;
  if (req.body?.paymentMethod) {
    payment = await Payment.create({
      businessId: sub.businessId,
      userId: req.user.id,
      planName: `${req.body.months || 1}-month admin extension`,
      months: Math.max(1, parseInt(req.body.months, 10) || 1),
      amount: sub.amount,
      provider: 'MANUAL',
      status: 'PAID',
      paymentMethod: req.body.paymentMethod,
      subscriptionExtendedAt: new Date(),
    });
  }

  return success(
    res,
    {
      subscription: {
        id: sub._id.toString(),
        businessId: sub.businessId.toString(),
        status: sub.status,
        currentPeriodStart: sub.currentPeriodStart,
        currentPeriodEnd: sub.currentPeriodEnd,
        amount: sub.amount,
      },
      payment: payment ? { id: payment._id.toString(), paymentMethod: payment.paymentMethod } : null,
    },
    'Subscription extended'
  );
});

/**
 * POST /api/admin/businesses/:id/end-subscription — admin terminates an owner's
 * subscription immediately. The tenant is set to EXPIRED, so billing is blocked
 * and the owner is prompted to recharge. Audited as SUBSCRIPTION_ENDED.
 */
const endSubscription = asyncHandler(async (req, res) => {
  const subscriptionService = require('../services/subscriptionService');
  const sub = await subscriptionService.endSubscription({
    businessId: req.params.id,
    actorId: req.user.id,
    reason: req.body?.reason || 'ENDED_BY_ADMIN',
  });
  return success(
    res,
    {
      subscription: {
        id: sub._id.toString(),
        businessId: sub.businessId.toString(),
        status: sub.status,
        currentPeriodStart: sub.currentPeriodStart,
        currentPeriodEnd: sub.currentPeriodEnd,
      },
    },
    'Subscription ended'
  );
});

/**
 * GET /api/admin/subscriptions — paginated list with optional status filter.
 */
const listSubscriptions = asyncHandler(async (req, res) => {
  const Subscription = require('../models/Subscription');
  const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));

  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  const total = await Subscription.countDocuments(filter);
  const docs = await Subscription.find(filter)
    .populate('businessId', 'businessName status')
    .sort({ createdAt: -1 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum)
    .lean();

  // Latest Payment per tenant (by created time) so each row can show/edit the
  // most recent way the customer paid. Batched via aggregation (not N queries).
  const ids = docs.map((d) => d.businessId?._id || d.businessId).filter(Boolean);
  const latestByBusiness = {};
  if (ids.length) {
    const aggreg = await Payment.aggregate([
      { $match: { businessId: { $in: ids } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$businessId', doc: { $first: '$$ROOT' } } },
    ]);
    for (const row of aggreg) {
      const key = String(row._id);
      latestByBusiness[key] = {
        id: row.doc._id.toString(),
        status: row.doc.status,
        paymentMethod: row.doc.paymentMethod || '',
      };
    }
  }

  return success(
    res,
    {
      subscriptions: docs.map((d) => {
        const bizId = d.businessId?._id?.toString() || String(d.businessId);
        const latest = latestByBusiness[bizId] || null;
        return {
          id: d._id.toString(),
          businessId: bizId,
          businessName: d.businessId?.businessName || null,
          businessStatus: d.businessId?.status || null,
          planId: d.planId,
          status: d.status,
          trialStartDate: d.trialStartDate,
          trialEndDate: d.trialEndDate,
          currentPeriodStart: d.currentPeriodStart,
          currentPeriodEnd: d.currentPeriodEnd,
          amount: d.amount,
          autoRenew: d.autoRenew,
          // Latest recharge for this tenant (drives the payment-method column).
          latestPayment: latest,
        };
      }),
      pagination: { page: pageNum, limit: limitNum, total },
    },
    'Subscriptions retrieved'
  );
});

// ------------------- Recharge plans (admin-curated offers) ------------------

const listRechargePlans = asyncHandler(async (req, res) => {
  const plans = await RechargePlan.find({}).sort({ sortOrder: 1, months: 1 }).lean();
  return success(res, { plans }, 'Recharge plans retrieved');
});

const createRechargePlan = asyncHandler(async (req, res) => {
  const plan = await RechargePlan.create(req.body);
  return created(res, { plan }, 'Recharge plan created');
});

const updateRechargePlan = asyncHandler(async (req, res) => {
  const { ApiError } = require('../utils/ApiError');
  const plan = await RechargePlan.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!plan) throw ApiError.notFound('Recharge plan not found', 'PLAN_NOT_FOUND');
  return success(res, { plan }, 'Recharge plan updated');
});

/** Soft-off so historical Payment records keep their meaning. */
const deactivateRechargePlan = asyncHandler(async (req, res) => {
  const { ApiError } = require('../utils/ApiError');
  const plan = await RechargePlan.findById(req.params.id);
  if (!plan) throw ApiError.notFound('Recharge plan not found', 'PLAN_NOT_FOUND');
  plan.isActive = false;
  await plan.save();
  return success(res, { plan }, 'Recharge plan deactivated');
});

/**
 * Hard delete a recharge plan. Use when the plan was created by mistake and
 * must disappear from every list (owner-facing included). Any Subscription or
 * Payment that references this planId still keeps its planId string (we never
 * cascade-delete financial records), but the plan card vanishes from purchase
 * lists because the owner app only offers plans that exist in this collection.
 */
const deleteRechargePlan = asyncHandler(async (req, res) => {
  const { ApiError } = require('../utils/ApiError');
  const plan = await RechargePlan.findByIdAndDelete(req.params.id);
  if (!plan) throw ApiError.notFound('Recharge plan not found', 'PLAN_NOT_FOUND');
  return success(res, { id: req.params.id }, 'Recharge plan deleted');
});

/** GET /api/admin/payments — recharge history across all businesses. */
const listAllPayments = asyncHandler(async (req, res) => {
  const limit = Math.min(200, parseInt(req.query?.limit, 10) || 50);
  const docs = await Payment.find({}).sort({ createdAt: -1 }).limit(limit)
    .populate('businessId', 'businessName').lean();
  const payments = docs.map((p) => ({ ...p, id: p._id.toString(), businessName: p.businessId?.businessName || null }));
  return success(res, { payments }, 'Payments retrieved');
});

/**
 * PATCH /api/admin/payments/:id — admin overrides/corrects how a recharge was
 * paid (e.g. gateway reported '' but the owner paid by cash). Audited.
 */
const updatePaymentMethod = asyncHandler(async (req, res) => {
  const { ApiError } = require('../utils/ApiError');
  const payment = await Payment.findById(req.params.id);
  if (!payment) throw ApiError.notFound('Payment not found', 'PAYMENT_NOT_FOUND');

  const from = payment.paymentMethod || '';
  const to = req.body.paymentMethod;
  payment.paymentMethod = to;
  await payment.save();

  await auditService.logAudit({
    actorId: req.user.id,
    actorRole: 'SUPER_ADMIN',
    businessId: payment.businessId,
    action: 'PAYMENT_METHOD_UPDATED',
    entityType: 'Payment',
    entityId: payment._id,
    metadata: { from, to, provider: payment.provider },
  });

  return success(
    res,
    {
      payment: {
        id: payment._id.toString(),
        businessId: payment.businessId.toString(),
        status: payment.status,
        paymentMethod: payment.paymentMethod,
        provider: payment.provider,
      },
    },
    'Payment method updated'
  );
});

module.exports = {
  dashboard,
  listBusinesses,
  createBusiness,
  getBusiness,
  updateBusiness,
  deleteBusiness,
  suspendBusiness,
  activateBusiness,
  extendSubscription,
  endSubscription,
  listSubscriptions,
  resetOwnerPassword,
  auditLogs,
  listRechargePlans,
  createRechargePlan,
  updateRechargePlan,
  deactivateRechargePlan,
  deleteRechargePlan,
  listAllPayments,
  updatePaymentMethod,
};