'use strict';

const express = require('express');

const { authenticateToken } = require('../middleware/authMiddleware');
const { requireTenant } = require('../middleware/tenantMiddleware');
const { requireBusinessOwner } = require('../middleware/roleMiddleware');
const { validate } = require('../middleware/validationMiddleware');
const { reportQuerySchema } = require('../validators/reportValidators');
const reportController = require('../controllers/reportController');

const router = express.Router();

// Owner-scoped.
router.use(authenticateToken, requireTenant, requireBusinessOwner);

router.get('/dashboard', reportController.ownerDashboard);
router.get('/pdf', validate(reportQuerySchema, 'query'), reportController.pdfReport);
router.get('/bill-pdf/:billId', reportController.billPdf);
router.get('/sales', validate(reportQuerySchema, 'query'), reportController.salesReport);
router.get('/products', validate(reportQuerySchema, 'query'), reportController.productsReport);
router.get('/payments', validate(reportQuerySchema, 'query'), reportController.paymentsReport);

module.exports = router;