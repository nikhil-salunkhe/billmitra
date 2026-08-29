'use strict';

const mongoose = require('mongoose');

const { ApiError } = require('../utils/ApiError');
const Subscription = require('../models/Subscription');
const Business = require('../models/Business');
const AuditLog = require('../models/AuditLog');
const {
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_STATUS,
  EXPIRING_WARNING_DAYS,
} = require('../config/constants');
const { differenceInDays, addMonthsClamped } = require('../utils/dateUtils');

const BILLABLE_STATES = [
  SUBSCRIPTION_STATUS.TRIAL,
  SUBSCRIPTION_STATUS.ACTIVE,
  SUBSCRIPTION_STATUS.EXPIRING,
];

// ---------------------------------------------------------------------------
// State derivation (pure — no DB writes)
// ---------------------------------------------------------------------------

/**
 * Derives the effective status purely from dates so a missed cron never leaves
 * an expired account looking active.
 *
 * Priority: SUSPENDED (sticky) > EXPIRED (past end) > EXPIRING (within warning
 * window) > TRIAL (free window) / ACTIVE (paid period).
 */
function deriveState(sub) {
  if (!sub) return null;

  if (sub.status === SUBSCRIPTION_STATUS.SUSPENDED) return SUBSCRIPTION_STATUS.SUSPENDED;

  const end = sub.currentPeriodEnd || sub.trialEndDate;
  if (!end) return sub.status || SUBSCRIPTION_STATUS.TRIAL;

  const now = Date.now();
  if (now > new Date(end).getTime()) return SUBSCRIPTION_STATUS.EXPIRED;

  const msLeft = new Date(end).getTime() - now;
  if (msLeft <= EXPIRING_WARNING_DAYS * 86400000) return SUBSCRIPTION_STATUS.EXPIRING;

  // Paid period running -> ACTIVE; otherwise still inside the free trial.
  return sub.currentPeriodEnd ? SUBSCRIPTION_STATUS.ACTIVE : SUBSCRIPTION_STATUS.TRIAL;
}

/** Builds the equivalent trial window for tenants created before this engine. */
function virtualTrialFrom(business) {
  const plan = SUBSCRIPTION_PLANS.INITIAL;
  const start = business.createdAt || new Date();
  return {
    status: SUBSCRIPTION_STATUS.TRIAL,
    trialStartDate: start,
    trialEndDate: addMonthsClamped(start, plan.trialMonths),
    currentPeriodEnd: null,
  };
}

async function loadContext(businessId) {
  const business = await Business.findById(businessId).select('status subscriptionStatus subscriptionId createdAt');
  if (!business) throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');

  let sub = await Subscription.findOne({ businessId }).sort({ createdAt: -1 });
  if (!sub) {
    // Legacy tenant (created before this engine): materialize its trial window
    // so admin lists, expiry sweeps and extensions operate on a real document.
    sub = await activateTrialSubscription(businessId, business.createdAt || new Date());
  }

  const state = deriveState(sub);

  // Keep the stored document aligned with the derived state (e.g. ACTIVE ->
  // EXPIRING inside the warning window) so admin lists/filters stay accurate.
  if (state && sub.status !== state) {
    await Subscription.updateOne({ _id: sub._id }, { $set: { status: state } });
    sub.status = state;
  }

  return { business, sub, effective: sub, state };
}

/**
 * Write-through sync: persists derived status changes onto the Business record
 * so dashboards/filters stay accurate without a cron dependency.
 */
async function syncBusinessStatus(business, state) {
  if (business.subscriptionStatus !== state) {
    await Business.updateOne(
      { _id: business._id },
      { $set: { subscriptionStatus: state } }
    );
    business.subscriptionStatus = state;
  }
}

// ---------------------------------------------------------------------------
// Public engine API
// ---------------------------------------------------------------------------

/**
 * Authoritative billing gate used by subscriptionMiddleware.
 */
async function isBillingAllowed(businessId) {
  const { business, effective, state } = await loadContext(businessId);
  await syncBusinessStatus(business, state);

  if (business.status === 'SUSPENDED') {
    return { allowed: false, state: SUBSCRIPTION_STATUS.SUSPENDED, code: 'BUSINESS_SUSPENDED' };
  }
  if (state === SUBSCRIPTION_STATUS.EXPIRED) {
    return { allowed: false, state, code: 'SUBSCRIPTION_EXPIRED' };
  }
  if (state === SUBSCRIPTION_STATUS.SUSPENDED) {
    return { allowed: false, state, code: 'SUBSCRIPTION_SUSPENDED' };
  }
  return { allowed: BILLABLE_STATES.includes(state), state, code: null };
}

/**
 * Owner-facing read-only summary (now powered by the real engine).
 */
async function getOwnerSubscription(businessId) {
  const { business, sub, effective, state } = await loadContext(businessId);
  await syncBusinessStatus(business, state);

  const plan = resolvePlan(effective.planId);
  const end = effective.currentPeriodEnd || effective.trialEndDate;

  return {
    plan: plan.name,
    planLabel: plan.label,
    planTagline: plan.tagline || '',
    status: state,
    trialStartDate: effective.trialStartDate || business.createdAt || null,
    trialEndDate: effective.trialEndDate || null,
    currentPeriodStart: effective.currentPeriodStart || null,
    currentPeriodEnd: effective.currentPeriodEnd || null,
    daysRemaining: end ? Math.max(0, differenceInDays(new Date(), new Date(end))) : null,
    amountMonthly: plan.monthlyAmount,
    rechargeAmount: plan.rechargeAmount || null,
    rechargeMonths: plan.rechargeMonths || null,
    setupAmount: plan.setupAmount,
    subscribed: BILLABLE_STATES.includes(state),
    canBill: BILLABLE_STATES.includes(state),
  };
}

/**
 * Resolves a plan name to its config, falling back to INITIAL for legacy rows.
 */
function resolvePlan(planName) {
  const name = String(planName || '').trim() || SUBSCRIPTION_PLANS.INITIAL.name;
  return SUBSCRIPTION_PLANS[name] || SUBSCRIPTION_PLANS.INITIAL;
}

/**
 * Creates the free-trial subscription for a brand-new tenant and links it.
 * Called from businessService.createBusiness. The trial length follows the
 * chosen plan (default INITIAL: 2 months; SIX_MONTH_FREE: 6 months).
 */
async function activateTrialSubscription(businessId, startDate = new Date(), planName = SUBSCRIPTION_PLANS.INITIAL.name) {
  const plan = resolvePlan(planName);
  const trialEnd = addMonthsClamped(startDate, plan.trialMonths);

  // Re-running must not duplicate or reset an existing window.
  const existing = await Subscription.findOne({ businessId }).sort({ createdAt: -1 });
  if (existing) {
    const state = deriveState(existing);
    await Business.updateOne(
      { _id: businessId },
      { $set: { subscriptionId: existing._id, subscriptionStatus: state } }
    );
    return existing;
  }

  const [sub] = await Subscription.create([
    {
      businessId,
      planId: plan.name,
      status: SUBSCRIPTION_STATUS.TRIAL,
      startDate,
      trialStartDate: startDate,
      trialEndDate: trialEnd,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      amount: 0,
      autoRenew: false,
    },
  ]);

  await Business.updateOne(
    { _id: businessId },
    { $set: { subscriptionId: sub._id, subscriptionStatus: SUBSCRIPTION_STATUS.TRIAL } }
  );

  return sub;
}

/**
 * Applies a paid renewal/extension of `months` calendar months.
 *
 * - Admin "extend" and Phase-12 payment verification both funnel through here
 *   so the money-affecting logic exists in exactly one place.
 * - Extends from the later of (now, current end) so early renewals never lose
 *   days the tenant already paid for.
 * - The price follows the business's chosen plan: SIX_MONTH_FREE tenants renew
 *   in ₹2,500 / 6-month blocks (pro-rated for partial extensions), others use
 *   the INITIAL monthly rate.
 */
async function applyRenewal({ businessId, months = 1, actorId = null, actorRole = 'SUPER_ADMIN', action = 'SUBSCRIPTION_RENEWED', paymentReference = null }) {
  const n = Math.max(1, Math.min(60, parseInt(months, 10) || 1));

  const business = await Business.findById(businessId).select('subscriptionStatus subscriptionId');
  if (!business) throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');

  let sub = await Subscription.findOne({ businessId }).sort({ createdAt: -1 });
  const now = new Date();

  if (!sub) {
    sub = await activateTrialSubscription(businessId, now);
    // Reload the freshly created doc.
    sub = await Subscription.findById(sub._id);
  }

  const plan = resolvePlan(sub.planId);
  const currentEnd = sub.currentPeriodEnd || sub.trialEndDate || now;
  const base = currentEnd > now ? new Date(currentEnd) : now;
  const newPeriodStart = base > now ? base : now;
  const newPeriodEnd = addMonthsClamped(base, n);

  // SIX_MONTH_FREE: block pricing — ₹2,500 per full 6-month block, pro-rated
  // at the ≈ monthly figure for partial blocks. INITIAL: monthly rate.
  let amount;
  if (plan.rechargeMonths && plan.rechargeAmount) {
    const blocks = Math.floor(n / plan.rechargeMonths);
    const remainderMonths = n % plan.rechargeMonths;
    amount = blocks * plan.rechargeAmount + remainderMonths * plan.monthlyAmount;
  } else {
    amount = plan.monthlyAmount * n;
  }

  const previousStatus = sub.status;
  sub.status = SUBSCRIPTION_STATUS.ACTIVE;
  sub.startDate = sub.startDate || now;
  if (!sub.currentPeriodStart) sub.currentPeriodStart = base;
  sub.currentPeriodStart = newPeriodStart;
  sub.currentPeriodEnd = newPeriodEnd;
  sub.amount = amount;
  await sub.save();

  await Business.updateOne(
    { _id: businessId },
    { $set: { subscriptionId: sub._id, subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE } }
  );

  await AuditLog.create({
    actorId: actorId || null,
    actorRole,
    businessId,
    action,
    entityType: 'Subscription',
    entityId: sub._id,
    metadata: {
      plan: plan.name,
      months: n,
      previousStatus,
      newPeriodEnd,
      amount: sub.amount,
      paymentReference: paymentReference || undefined,
    },
  });

  return sub;
}

/**
 * Admin-triggered termination: immediately expires a tenant's subscription so
 * billing is blocked and the owner is prompted to recharge. Idempotent — safe
 * to call even on an already-expired account.
 */
async function endSubscription({ businessId, actorId = null, reason = 'ENDED_BY_ADMIN' }) {
  const business = await Business.findById(businessId).select('subscriptionStatus subscriptionId createdAt');
  if (!business) throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');

  let sub = await Subscription.findOne({ businessId }).sort({ createdAt: -1 });
  if (!sub) {
    sub = await activateTrialSubscription(businessId, business.createdAt || new Date());
  }

  const previousStatus = sub.status;
  // End the paid/free period at the current instant (set a hair in the past) so
  // deriveState settles on EXPIRED and stays there until a recharge extends it.
  sub.status = SUBSCRIPTION_STATUS.EXPIRED;
  sub.currentPeriodEnd = new Date(Date.now() - 1);
  await sub.save();

  await Business.updateOne(
    { _id: businessId },
    { $set: { subscriptionId: sub._id, subscriptionStatus: SUBSCRIPTION_STATUS.EXPIRED } }
  );

  await AuditLog.create({
    actorId: actorId || null,
    actorRole: 'SUPER_ADMIN',
    businessId,
    action: 'SUBSCRIPTION_ENDED',
    entityType: 'Subscription',
    entityId: sub._id,
    metadata: { previousStatus, reason },
  });

  return sub;
}

/**
 * Batch sweep for schedulers: flips every stale TRIAL/ACTIVE/EXPIRING
 * subscription to EXPIRED and mirrors it on the Business record.
 */
async function runExpirySweep() {
  const now = new Date();
  const stale = await Subscription.find({
    status: { $in: [SUBSCRIPTION_STATUS.TRIAL, SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.EXPIRING] },
    $expr: { $gt: [now, { $ifNull: ['$currentPeriodEnd', '$trialEndDate'] }] },
  }).select('_id businessId');

  let affected = 0;
  for (const s of stale) {
    s.status = SUBSCRIPTION_STATUS.EXPIRED;
    await s.save();
    await Business.updateOne(
      { _id: s.businessId },
      { $set: { subscriptionStatus: SUBSCRIPTION_STATUS.EXPIRED } }
    );
    affected += 1;
  }
  return { checked: stale.length, expired: affected };
}

module.exports = {
  BILLABLE_STATES,
  deriveState,
  virtualTrialFrom,
  isBillingAllowed,
  getOwnerSubscription,
  activateTrialSubscription,
  applyRenewal,
  endSubscription,
  runExpirySweep,
};