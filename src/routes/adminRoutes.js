'use strict';

const express = require('express');

const { validate } = require('../middleware/validationMiddleware');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requireSuperAdmin } = require('../middleware/roleMiddleware');
const {
  createBusinessSchema,
  updateBusinessSchema,
  listBusinessesQuerySchema,
  resetPasswordSchema,
  auditLogsQuerySchema,
  extendSubscriptionSchema,
  listSubscriptionsQuerySchema,
  updatePaymentMethodSchema,
} = require('../validators/businessValidators');
const adminController = require('../controllers/adminController');
const uploadController = require('../controllers/uploadController');

const router = express.Router();

// All admin-business routes require a SUPER_ADMIN token.
router.use(authenticateToken, requireSuperAdmin);

router.get('/dashboard', adminController.dashboard);
router.get('/businesses', validate(listBusinessesQuerySchema, 'query'), adminController.listBusinesses);
// Business logo upload (multipart field "logo") → { logoUrl }.
router.post('/businesses/upload-logo', ...uploadController.uploadBusinessLogo);
router.post('/businesses', validate(createBusinessSchema), adminController.createBusiness);
router.get('/businesses/:id', adminController.getBusiness);
router.put('/businesses/:id', validate(updateBusinessSchema), adminController.updateBusiness);
router.delete('/businesses/:id', adminController.deleteBusiness);
router.post('/businesses/:id/suspend', adminController.suspendBusiness);
router.post('/businesses/:id/activate', adminController.activateBusiness);
router.post('/businesses/:id/reset-password', validate(resetPasswordSchema), adminController.resetOwnerPassword);
router.post('/businesses/:id/extend', validate(extendSubscriptionSchema), adminController.extendSubscription);
router.post('/businesses/:id/end-subscription', adminController.endSubscription);
router.get('/subscriptions', validate(listSubscriptionsQuerySchema, 'query'), adminController.listSubscriptions);
router.get('/audit-logs', validate(auditLogsQuerySchema, 'query'), adminController.auditLogs);

// Recharge plan catalog (admin-curated offers owners purchase).
const {
  createRechargePlanSchema,
  updateRechargePlanSchema,
} = require('../validators/rechargePlanValidators');

router.get('/recharge-plans', adminController.listRechargePlans);
router.post('/recharge-plans', validate(createRechargePlanSchema), adminController.createRechargePlan);
router.put('/recharge-plans/:id', validate(updateRechargePlanSchema), adminController.updateRechargePlan);
router.delete('/recharge-plans/:id', adminController.deactivateRechargePlan);
router.get('/payments', adminController.listAllPayments);
router.patch('/payments/:id', validate(updatePaymentMethodSchema), adminController.updatePaymentMethod);

module.exports = router;