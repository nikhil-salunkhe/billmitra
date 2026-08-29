'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');

const { ApiError } = require('../utils/ApiError');
const Business = require('../models/Business');
const User = require('../models/User');
const { BUSINESS_STATUS, SUBSCRIPTION_STATUS, ROLES } = require('../config/constants');
const { addDays } = require('../utils/dateUtils');
const auditService = require('./auditService');
const authService = require('./authService');

/**
 * Computes the admin dashboard card metrics from live collections.
 *
 * 'billsGenerated' and 'monthlySubscriptionRevenue' depend on the Bill and
 * Payment collections (Phases 8 and 12). Until those land they are returned
 * as 0 explicitly — never fabricated.
 */
async function getDashboard() {
  const since30 = addDays(new Date(), -30);
  since30.setHours(0, 0, 0, 0);

  const [
    totalBusinesses,
    activeBusinesses,
    suspendedBusinesses,
    inactiveBusinesses,
    trialBusinesses,
    activeSubs,
    expiringSubs,
    expiredBusinesses,
    newBusinesses,
    totalOwners,
    staffCount,
  ] = await Promise.all([
    Business.countDocuments({}),
    Business.countDocuments({ status: BUSINESS_STATUS.ACTIVE }),
    Business.countDocuments({ status: BUSINESS_STATUS.SUSPENDED }),
    Business.countDocuments({ status: BUSINESS_STATUS.INACTIVE }),
    Business.countDocuments({ subscriptionStatus: SUBSCRIPTION_STATUS.TRIAL }),
    Business.countDocuments({
      subscriptionStatus: { $in: [SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.EXPIRING] },
    }),
    Business.countDocuments({ subscriptionStatus: SUBSCRIPTION_STATUS.EXPIRING }),
    Business.countDocuments({ subscriptionStatus: SUBSCRIPTION_STATUS.EXPIRED }),
    Business.countDocuments({ createdAt: { $gte: since30 } }),
    User.countDocuments({ role: ROLES.BUSINESS_OWNER }),
    User.countDocuments({ role: ROLES.STAFF }),
  ]);

  return {
    totalBusinesses,
    activeBusinesses,
    suspendedBusinesses,
    inactiveBusinesses,
    trialBusinesses,
    activeSubscriptions: activeSubs,
    expiringSubscriptions: expiringSubs,
    expiredBusinesses,
    newBusinessesLast30Days: newBusinesses,
    totalOwners,
    staffAccounts: staffCount,
    // Computed in later phases (declared explicitly to remain honest).
    billsGenerated: 0,
    monthlySubscriptionRevenue: 0,
  };
}

/**
 * Rich detail for a single business including its owner user and settings.
 */
async function getBusinessDetail(businessId) {
  const business = await Business.findById(businessId);
  if (!business) throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');

  const [ownerUser, settings, ownerCount] = await Promise.all([
    User.findOne({ businessId, role: ROLES.BUSINESS_OWNER }).select('-passwordHash'),
    require('../models/BusinessSettings').findOne({ businessId }),
    User.countDocuments({ businessId }),
  ]);

  return {
    business: business.toSafeJSON(),
    settings: settings ? settings.toSafeJSON() : null,
    owner: ownerUser ? ownerUser.toSafeJSON() : null,
    totalUserAccounts: ownerCount,
  };
}

/**
 * Suspends or activates a business, recording the change in the audit log.
 */
async function setBusinessStatus(businessId, status, actorId) {
  if (status !== BUSINESS_STATUS.ACTIVE && status !== BUSINESS_STATUS.SUSPENDED) {
    throw ApiError.badRequest('Only ACTIVE/SUSPENDED are allowed here', 'INVALID_STATUS');
  }
  const business = await Business.findById(businessId);
  if (!business) throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');

  const from = business.status;
  business.status = status;
  await business.save();

  await auditService.logAudit({
    actorId,
    actorRole: ROLES.SUPER_ADMIN,
    businessId: business._id,
    action: status === BUSINESS_STATUS.SUSPENDED ? 'BUSINESS_SUSPENDED' : 'BUSINESS_ACTIVATED',
    entityType: 'Business',
    entityId: business._id,
    metadata: { from, to: status },
  });

  return business;
}

/**
 * Resets an owner password to a fresh value. Returns the one-time plaintext
 * credential to the admin exactly once; the password itself is never logged.
 */
async function resetOwnerPassword(businessId, actorId, newPassword) {
  const owner = await User.findOne({ businessId, role: ROLES.BUSINESS_OWNER }).select('+passwordHash');
  if (!owner) throw ApiError.notFound('Owner account not found', 'OWNER_NOT_FOUND');

  const password = newPassword && newPassword.length >= 8 ? newPassword : generateTemporaryPassword(10);
  const passwordHash = await authService.hashPassword(password);
  owner.passwordHash = passwordHash;
  await owner.save();

  await auditService.logAudit({
    actorId,
    actorRole: ROLES.SUPER_ADMIN,
    businessId,
    action: 'OWNER_PASSWORD_RESET',
    entityType: 'User',
    entityId: owner._id,
    metadata: { resetBy: String(actorId) }, // NEVER log the password.
  });

  return { ownerUsername: owner.username, initialPassword: password };
}

function generateTemporaryPassword(length = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const buf = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[buf[i] % alphabet.length];
  return out;
}

module.exports = { getDashboard, getBusinessDetail, setBusinessStatus, resetOwnerPassword };