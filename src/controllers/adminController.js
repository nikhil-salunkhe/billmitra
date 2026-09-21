'use strict';

const { success, created } = require('../utils/ApiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const businessService = require('../services/businessService');
const adminService = require('../services/adminService');
const auditService = require('../services/auditService');

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

module.exports = {
  dashboard,
  listBusinesses,
  createBusiness,
  getBusiness,
  updateBusiness,
  deleteBusiness,
  suspendBusiness,
  activateBusiness,
  resetOwnerPassword,
  auditLogs,
};
