'use strict';

const { success } = require('../utils/ApiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const businessService = require('../services/businessService');
const { ApiError } = require('../utils/ApiError');
const BusinessSettings = require('../models/BusinessSettings');

/**
 * GET /api/business/profile
 * Owner's own business + settings. Tenant comes from the JWT (req.businessId),
 * never from the client.
 */
const getProfile = asyncHandler(async (req, res) => {
  const business = await businessService.getBusinessById(req.businessId);
  const settings = await businessService.getSettings(req.businessId);
  return success(
    res,
    {
      business: businessService.toSafeBusiness(business, { settings: settings?.toSafeJSON() || null }),
    },
    'Business profile retrieved'
  );
});

/**
 * GET /api/business/settings
 * Owner reads their own invoice/receipt configuration.
 */
const getSettings = asyncHandler(async (req, res) => {
  const settings = await BusinessSettings.findOne({ businessId: req.businessId });
  return success(res, { settings: settings ? settings.toSafeJSON() : null }, 'Settings retrieved');
});

/**
 * PUT /api/business/settings
 * Owner updates their own invoice/receipt configuration (tenant-scoped).
 */
const updateSettings = asyncHandler(async (req, res) => {
  const allowed = [
    'invoicePrefix',
    'defaultTaxMode',
    'defaultPaymentMethod',
    'showLogoOnBill',
    'billFooter',
    'addressOnBill',
    'phoneOnBill',
    'gstNumberOnBill',
  ];
  const patch = {};
  for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
  if (Object.keys(patch).length === 0) throw ApiError.badRequest('No settings to update', 'NO_UPDATES');

  let settings = await BusinessSettings.findOne({ businessId: req.businessId });
  if (!settings) {
    settings = await BusinessSettings.create({ businessId: req.businessId });
  }
  Object.assign(settings, patch);
  await settings.save();
  return success(res, { settings: settings.toSafeJSON() }, 'Settings updated');
});

module.exports = { getProfile, getSettings, updateSettings };