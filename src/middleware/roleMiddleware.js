'use strict';

const { ApiError } = require('../utils/ApiError');
const { ROLES } = require('../config/constants');

/**
 * Requires the authenticated user to have one of the given roles.
 * Must run after authenticateToken.
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required', 'AUTH_REQUIRED'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(ApiError.forbidden('You do not have permission to perform this action', 'FORBIDDEN'));
    }
    return next();
  };
}

const requireSuperAdmin = requireRole(ROLES.SUPER_ADMIN);
const requireBusinessOwner = requireRole(ROLES.BUSINESS_OWNER);

/** Accepts SUPER_ADMIN, BUSINESS_OWNER or STAFF (owner endpoints). */
const requireAnyAuthenticatedRole = requireRole(
  ROLES.SUPER_ADMIN,
  ROLES.BUSINESS_OWNER,
  ROLES.STAFF
);

module.exports = { requireRole, requireSuperAdmin, requireBusinessOwner, requireAnyAuthenticatedRole };