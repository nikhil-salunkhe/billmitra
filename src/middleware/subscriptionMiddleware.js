'use strict';

const { ApiError } = require('../utils/ApiError');
const subscriptionService = require('../services/subscriptionService');

/**
 * Gates paid operations behind an active subscription.
 *
 * Must run AFTER authenticateToken + requireTenant so req.businessId exists.
 * Expired accounts receive HTTP 402 with code SUBSCRIPTION_EXPIRED so the
 * client can route to the recharge screen; a suspended business is a hard
 * 403 BUSINESS_SUSPENDED (already enforced by requireTenant, re-checked here).
 *
 * Read-only endpoints (history, reports, dashboard) intentionally do NOT use
 * this guard — expired owners keep visibility of their data per spec §21.
 */
async function requireBilling(req, res, next) {
  try {
    if (!req.businessId) {
      return next(ApiError.forbidden('No business tenant', 'NO_BUSINESS_TENANT'));
    }

    const verdict = await subscriptionService.isBillingAllowed(req.businessId);
    if (verdict.allowed) {
      req.subscriptionState = verdict.state;
      return next();
    }

    const status = verdict.code === 'SUBSCRIPTION_EXPIRED' ? 402 : 403;
    return next(new ApiError(
      status,
      verdict.code === 'SUBSCRIPTION_EXPIRED'
        ? 'Subscription expired — please recharge to continue billing'
        : 'Subscription is not active',
      verdict.code
    ));
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireBilling };