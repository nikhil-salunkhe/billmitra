'use strict';

const express = require('express');

const { authenticateToken } = require('../middleware/authMiddleware');
const { requireTenant } = require('../middleware/tenantMiddleware');
const { requireBusinessOwner } = require('../middleware/roleMiddleware');
const { validate } = require('../middleware/validationMiddleware');
const {
  createBillSchema,
  listBillsQuerySchema,
} = require('../validators/billValidators');
const billController = require('../controllers/billController');

const router = express.Router();

// Owner-scoped. BillMitra is a lifetime service, so billing is never gated by
// a subscription — only a SUSPENDED business is blocked (requireTenant).
router.use(authenticateToken, requireTenant, requireBusinessOwner);

router.post('/', validate(createBillSchema), billController.createBill);
router.get('/', validate(listBillsQuerySchema, 'query'), billController.listBills);
router.get('/:id/pdf', billController.getBillPdf);
router.get('/:id', billController.getBill);
router.post('/:id/reprint', billController.reprintBill);
router.delete('/:id', billController.deleteBill);
router.delete('/:id/permanent', billController.permanentDeleteBill);

module.exports = router;