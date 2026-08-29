'use strict';

const express = require('express');

const { authenticateToken } = require('../middleware/authMiddleware');
const { requireTenant } = require('../middleware/tenantMiddleware');
const { requireBusinessOwner } = require('../middleware/roleMiddleware');
const { validate } = require('../middleware/validationMiddleware');
const {
  adjustmentSchema,
  listStockQuerySchema,
  ledgerQuerySchema,
} = require('../validators/stockValidators');
const stockController = require('../controllers/stockController');

const router = express.Router();

// Owner-scoped.
router.use(authenticateToken, requireTenant, requireBusinessOwner);

router.get('/', validate(listStockQuerySchema, 'query'), stockController.listStock);
router.get('/low', stockController.listLowStock);
router.post('/adjustment', validate(adjustmentSchema), stockController.adjustStock);
// NOTE: '/low' must be declared before any '/:productId' style routes.
router.get('/:productId/transactions', validate(ledgerQuerySchema, 'query'), stockController.listTransactions);

module.exports = router;