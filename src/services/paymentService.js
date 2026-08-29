'use strict';

const crypto = require('crypto');

const Payment = require('../models/Payment');
const RechargePlan = require('../models/RechargePlan');
const { ApiError } = require('../utils/ApiError');
const razorpayClient = require('./razorpayClient');
const subscriptionService = require('./subscriptionService');
const Business = require('../models/Business');
const User = require('../models/User');
const auditService = require('./auditService');
const { ROLES } = require('../config/constants');
const { RECHARGE_PAYMENT_METHODS } = require('../config/constants');
const { env } = require('../config/env');

/**
 * Creates a Razorpay Payment Link (UPI/cards/netbanking all supported by the
 * hosted page) for the chosen admin-curated plan.
 */
async function createRecharge({ businessId, userId, planId }) {
  const plan = await RechargePlan.findOne({ _id: planId, isActive: true });
  if (!plan) throw ApiError.notFound('Recharge plan not found or inactive', 'PLAN_NOT_FOUND');

  const [business, owner] = await Promise.all([
    Business.findById(businessId).select('businessName ownerPhone'),
    User.findOne({ businessId, role: ROLES.BUSINESS_OWNER }).select('phone username'),
  ]);
  if (!business) throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');

  // Reuse an in-flight link for the same plan instead of stacking duplicates.
  const pending = await Payment.findOne({
    businessId,
    planId: plan._id,
    status: 'CREATED',
    createdAt: { $gte: new Date(Date.now() - 20 * 60 * 1000) }, // fresh enough
  }).sort({ createdAt: -1 });

  if (pending?.providerLinkId) {
    return { payment: pending, paymentUrl: pending.providerLinkUrl || null };
  }

  const payment = await Payment.create({
    businessId,
    userId: userId || null,
    planId: plan._id,
    planName: plan.name,
    months: plan.months,
    amount: plan.price,
  });

  // Razorpay caps reference_id at 40 chars. The previous "billmitra|<businessId>|<paymentId>"
  // format joined two 24-char ObjectIds and totalled 58 chars -> rejected. The payment id
  // alone is sufficient for webhook routing (it resolves the Payment -> tenant).
  const referenceId = `billmitra_${payment.id}`;

  const link = await razorpayClient.createPaymentLink({
    amountInPaise: Math.round(plan.price * 100),
    description: `BillMitra recharge — ${plan.name} (${plan.months} month${plan.months > 1 ? 's' : ''})`,
    referenceId,
    customerPhone: owner?.phone || '',
    customerName: business.businessName,
  });

  payment.providerLinkId = link.id;
  payment.providerLinkUrl = link.short_url || '';
  payment.referenceId = referenceId;
  await payment.save();

  return { payment, paymentUrl: payment.providerLinkUrl || null };
}

/**
 * Maps a Razorpay payment `method` string to our normalized display method.
 * Unknown/empty gateway values stay '' (frontend shows "—" until override).
 */
function normalizePaymentMethod(raw) {
  const value = String(raw || '').toLowerCase().trim();
  if (!value) return '';
  if (value === 'upi') return 'UPI';
  if (value.includes('card')) return 'CARD';
  if (value === 'netbanking') return 'NETBANKING';
  if (value === 'wallet') return 'WALLET';
  if (value === 'cash') return 'CASH';
  return 'OTHER';
}

/**
 * Server-side status sync + idempotent activation. Called by owner polling
 * and the webhook alike; renewal happens at most once per Payment record.
 */
async function syncAndActivateIfPaid(paymentId) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw ApiError.notFound('Payment not found', 'PAYMENT_NOT_FOUND');
  if (payment.status === 'PAID') {
    return { payment, activatedNow: false };
  }
  if (!payment.providerLinkId) return { payment, activatedNow: false };

  const link = await razorpayClient.fetchPaymentLink(payment.providerLinkId);
  const paymentsList = Array.isArray(link.payments) ? link.payments : [];

  const paidEntry =
    link.status === 'paid' ? {} : paymentsList.find((p) => p.status === 'captured' || p.status === 'authorized');
  if (link.status !== 'paid' && !paidEntry) {
    if (link.status === 'expired') {
      payment.status = 'FAILED';
      payment.failureReason = 'Link expired without payment';
      await payment.save();
    }
    return { payment, activatedNow: false };
  }

  // Paid → extend validity exactly once (this guard makes retries safe).
  if (payment.status !== 'PAID') {
    payment.status = 'PAID';
    payment.providerPaymentId = paidEntry?.payment_id || paymentsList[0]?.id || null;
    payment.subscriptionExtendedAt = new Date();
    // Capture how the customer paid (Razorpay reports method on a captured payment).
    payment.paymentMethod = normalizePaymentMethod(paidEntry?.method) || payment.paymentMethod;
    payment.providerMethod = paidEntry?.method || '';
    await payment.save();

    const sub = await subscriptionService.applyRenewal({
      businessId: payment.businessId.toString(),
      months: payment.months,
      actorRole: 'SYSTEM',
      action: 'SUBSCRIPTION_RENEWED_VIA_PAYMENT',
      paymentReference: payment.providerLinkId,
    });

    await auditService.logAudit({
      actorRole: 'SYSTEM',
      businessId: payment.businessId,
      action: 'PAYMENT_COMPLETED',
      entityType: 'Payment',
      entityId: payment._id,
      metadata: { amount: payment.amount, months: payment.months, provider: 'RAZORPAY', newExpiry: sub.currentPeriodEnd },
    });

    return { payment, activatedNow: true, subscription: sub };
  }
  return { payment, activatedNow: false };
}

/** Lists this tenant's recharge history (newest first). */
async function listPayments(businessId, { limit = 20 } = {}) {
  const docs = await Payment.find({ businessId })
    .sort({ createdAt: -1 })
    .limit(Math.min(100, parseInt(limit, 10) || 20))
    .lean();
  return docs.map((p) => ({ ...p, id: p._id.toString() }));
}

/**
 * Webhook verification — HMAC SHA256 over the raw request body using the
 * dashboard-configured webhook secret. Requires req.rawBody captured upstream.
 */
function verifyWebhookSignature(rawBody, signature) {
  if (!env.razorpayWebhookSecret) return false;
  const expected = crypto.createHmac('sha256', env.razorpayWebhookSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
  } catch {
    return false;
  }
}

module.exports = {
  createRecharge,
  syncAndActivateIfPaid,
  listPayments,
  verifyWebhookSignature,
  normalizePaymentMethod,
  RECHARGE_PAYMENT_METHODS,
};
