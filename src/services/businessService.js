'use strict';

const mongoose = require('mongoose');

const { ApiError } = require('../utils/ApiError');
const { BUSINESS_TYPES, PRODUCT_BUSINESS_TYPES, SUBSCRIPTION_STATUS, SUBSCRIPTION_PLANS } = require('../config/constants');
const Business = require('../models/Business');
const BusinessSettings = require('../models/BusinessSettings');
const User = require('../models/User');
const authService = require('./authService');
const subscriptionService = require('./subscriptionService');
const storageService = require('./storageService');

/**
 * Lists businesses (admin). Supports pagination + optional filters.
 */
async function listBusinesses({
  page = 1,
  limit = 20,
  search = '',
  status = '',
  businessType = '',
} = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const filter = {};
  if (status) filter.status = status;
  if (businessType) filter.businessType = businessType;
  if (search) {
    const re = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ businessName: re }, { ownerName: re }, { email: re }, { phone: re }];
  }

  const total = await Business.countDocuments(filter);
  const docs = await Business.find(filter)
    .sort({ createdAt: -1 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum)
    .lean();

  return {
    businesses: docs.map((b) => ({ ...b, id: b._id.toString() })),
    pagination: { page: pageNum, limit: limitNum, total },
  };
}

async function getBusinessById(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw ApiError.badRequest('Invalid business id', 'INVALID_ID');
  }
  const business = await Business.findById(id);
  if (!business) throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');
  return business;
}

function toSafeBusiness(business, extra = {}) {
  return { ...business.toSafeJSON(), ...extra };
}

/**
 * Creates a Business + its BusinessSettings + the owner User.
 *
 * `initialPassword` is the owner's one-time plaintext credential. It is shown
 * only in this response (so the admin can hand it to the owner), is never sent
 * again for this account and is never logged.
 *
 * Sequential writes without a DB transaction (standalone mongod has no
 * multi-document transactions). On failure we delete the half-created business
 * to avoid orphan data.
 */
async function createBusiness({
  businessName,
  businessType,
  ownerName,
  phone,
  email,
  address,
  city,
  state,
  pincode,
  gstRegistered = false,
  gstin,
  plan = SUBSCRIPTION_PLANS.INITIAL.name,
  logoUrl,
  openingTime,
  closingTime,
  showInApp = true,
  ownerUsername,
  ownerPassword,
  ownerDisplayName,
}) {
  const type = String(businessType || '').trim();
  if (!Object.values(BUSINESS_TYPES).includes(type)) {
    throw ApiError.badRequest('Unsupported business type', 'INVALID_BUSINESS_TYPE');
  }

  // The chosen subscription offer must exist (INITIAL or SIX_MONTH_FREE).
  const planName = String(plan || '').trim() || SUBSCRIPTION_PLANS.INITIAL.name;
  if (!Object.prototype.hasOwnProperty.call(SUBSCRIPTION_PLANS, planName)) {
    throw ApiError.badRequest('Unsupported subscription plan', 'INVALID_PLAN');
  }

  const username = String(ownerUsername || '').trim().toLowerCase();
  const normalizedName = String(businessName || '').trim();
  if (!username || !normalizedName) {
    throw ApiError.badRequest('Business name and owner username are required', 'MISSING_FIELDS');
  }

  // Uniqueness checks before any writes.
  const [usernameTaken, nameTaken] = await Promise.all([
    User.exists({ username }),
    Business.exists({ businessName: normalizedName }),
  ]);
  if (usernameTaken) throw ApiError.conflict('Owner username already exists', 'USERNAME_TAKEN');
  if (nameTaken) {
    throw ApiError.conflict('A business with this name already exists', 'BUSINESS_NAME_TAKEN');
  }

  const passwordHash = await authService.hashPassword(ownerPassword);

  const businessDoc = await Business.create({
    businessName: normalizedName,
    businessType: type,
    ownerName,
    phone,
    email,
    address,
    city,
    state,
    pincode,
    gstRegistered,
    gstin,
    plan: planName,
    logoUrl: logoUrl || null,
    openingTime: openingTime || null,
    closingTime: closingTime || null,
    showInApp: Boolean(showInApp),
  });

  try {
    const [settings, owner] = await Promise.all([
      BusinessSettings.create({
        businessId: businessDoc._id,
        invoicePrefix: normalizedName.slice(0, 5).toUpperCase(),
      }),
      User.create({
        businessId: businessDoc._id,
        name: ownerDisplayName || ownerName || 'Business Owner',
        username,
        email: email || null,
        passwordHash,
        role: 'BUSINESS_OWNER',
        isActive: true,
      }),
    ]);

    // Free-trial window starts the moment the tenant exists. The length follows
    // the chosen offer: INITIAL = 2 months free, SIX_MONTH_FREE = 6 months free
    // (then ₹2,500 per 6-month recharge).
    const subscription = await subscriptionService.activateTrialSubscription(
      businessDoc._id,
      businessDoc.createdAt || new Date(),
      planName
    );

    const safe = toSafeBusiness(businessDoc, {
      settings: settings.toSafeJSON(),
      subscriptionId: subscription._id.toString(),
      subscriptionStatus: SUBSCRIPTION_STATUS.TRIAL,
    });
    return { business: safe, owner: owner.toSafeJSON(), initialPassword: ownerPassword };
  } catch (err) {
    // Roll back everything created for this failed tenant.
    await Business.deleteOne({ _id: businessDoc._id });
    const Subscription = require('../models/Subscription');
    await Subscription.deleteMany({ businessId: businessDoc._id });
    // If the failed tenant referenced a freshly uploaded logo, remove the file
    // too so rollback leaves no orphaned images behind.
    if (logoUrl) {
      await storageService.removeUploadedFile(logoUrl);
    }
    throw err;
  }
}

/**
 * Updates editable business profile fields (admin). Status/subscription changes
 * go through dedicated lifecycle endpoints, not free-form edits.
 */
async function updateBusiness(id, updates) {
  const allowed = [
    'businessName',
    'ownerName',
    'phone',
    'email',
    'address',
    'city',
    'state',
    'pincode',
    'gstRegistered',
    'gstin',
    'logoUrl',
    'openingTime',
    'closingTime',
    'showInApp',
  ];
  const patch = {};
  for (const k of allowed) if (updates[k] !== undefined) patch[k] = updates[k];
  if (Object.keys(patch).length === 0) {
    throw ApiError.badRequest('No valid fields to update', 'NO_UPDATES');
  }

  const business = await getBusinessById(id);
  const previousLogo = business.logoUrl;
  Object.assign(business, patch);
  await business.save();

  // If the logo was replaced, drop the superseded local file (best effort).
  if (patch.logoUrl && previousLogo && patch.logoUrl !== previousLogo) {
    await storageService.removeUploadedFile(previousLogo);
  }

  return business;
}

/**
 * Deletes a business and ALL of its tenant data (cascade).
 *
 * This is a destructive hard-delete intended for admin cleanup only. It removes
 * the business, its settings, every user, product, category, customer, bill,
 * stock transaction, subscription, payment, counter and audit record that
 * belongs to the tenant.
 *
 * NOTE: like createBusiness, this does sequential deletes without a
 * multi-document transaction (standalone mongod has none). To avoid a partially
 * deleted tenant on an unexpected mid-way failure, children are removed first
 * and the Business document itself is deleted last.
 */
async function deleteBusiness(id) {
  const business = await getBusinessById(id);
  const businessId = business._id;

  const tenantModels = [
    require('../models/BusinessSettings'),
    require('../models/User'),
    require('../models/Product'),
    require('../models/Category'),
    require('../models/Customer'),
    require('../models/Bill'),
    require('../models/StockTransaction'),
    require('../models/Subscription'),
    require('../models/Payment'),
    require('../models/AuditLog'),
  ];

  for (const model of tenantModels) {
    if (model && typeof model.deleteMany === 'function') {
      // eslint-disable-next-line no-await-in-loop
      await model.deleteMany({ businessId });
    }
  }

  // Counters keyed by "<businessId>:..." — no literal businessId field, so they
  // must be matched by key prefix.
  const Counter = require('../models/Counter');
  await Counter.deleteMany({ key: { $regex: `^${businessId.toString()}:` } });

  await Business.deleteOne({ _id: businessId });
  return business;
}

module.exports = {
  listBusinesses,
  getBusinessById,
  toSafeBusiness,
  createBusiness,
  updateBusiness,
  deleteBusiness,
  getSettings: async (businessId) => BusinessSettings.findOne({ businessId }),
};