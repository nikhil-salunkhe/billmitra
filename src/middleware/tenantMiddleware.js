'use strict';

const { ApiError } = require('../utils/ApiError');
const { ROLES } = require('../config/constants');
const Business = require('../models/Business');

/**
 * Enforces tenant isolation for business-owned routes.
 *
 * For BUSINESS_OWNER / STAFF the tenant is derived from the JWT
 * (req.user.businessId). The client is never trusted to supply it.
 *
 * Also rejects requests when the business has been SUSPENDED by the admin
 * (a frozen tenant). This is a hard freeze — separate from subscription
 * expiry, which is handled by subscriptionMiddleware in a later phase.
 *
 * For SUPER_ADMIN, tenant routes are NOT allowed here (admins use /api/admin).
 * Must run after authenticateToken.
 */
async function requireBusinessTenant(req, res, next) {
  try {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required', 'AUTH_REQUIRED'));
    }

    if (req.user.role === ROLES.SUPER_ADMIN) {
      return next(ApiError.forbidden('Admins do not have a business tenant', 'FORBIDDEN'));
    }

    if (!req.user.businessId) {
      return next(
        ApiError.forbidden('Account is not linked to a business', 'NO_BUSINESS_TENANT')
      );
    }

    // Confirm the tenant exists and is not suspended (one lightweight lookup).
    const business = await Business.findById(req.user.businessId).select('status businessType');
    if (!business) {
      return next(
        ApiError.forbidden('Business account does not exist', 'BUSINESS_TENANT_MISSING')
      );
    }
    if (business.status === 'SUSPENDED') {
      return next(ApiError.forbidden('Business is suspended', 'BUSINESS_SUSPENDED'));
    }

    // Authoritative tenant for this request; downstream code must use this value.
    req.businessId = req.user.businessId;
    req.businessStatus = business.status;
    req.businessType = business.businessType;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Applies tenant filtering to a Mongoose query. Handy for controller reuse.
 * Always scopes by req.businessId (never a client-sent id).
 */
function scopeFilter(req, extra = {}) {
  return { businessId: req.businessId, ...extra };
}

module.exports = { requireTenant: requireBusinessTenant, scopeFilter };