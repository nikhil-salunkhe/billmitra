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
router.get('/audit-logs', validate(auditLogsQuerySchema, 'query'), adminController.auditLogs);

module.exports = router;