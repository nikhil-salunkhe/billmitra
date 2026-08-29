'use strict';

const express = require('express');

const { authenticateToken } = require('../middleware/authMiddleware');
const { requireTenant } = require('../middleware/tenantMiddleware');
const { requireBusinessOwner } = require('../middleware/roleMiddleware');
const { validate } = require('../middleware/validationMiddleware');
const {
  createCustomerSchema,
  updateCustomerSchema,
  listCustomersQuerySchema,
} = require('../validators/customerValidators');
const customerController = require('../controllers/customerController');

const router = express.Router();

// Owner-scoped.
router.use(authenticateToken, requireTenant, requireBusinessOwner);

router.get('/', validate(listCustomersQuerySchema, 'query'), customerController.listCustomers);
router.post('/', validate(createCustomerSchema), customerController.createCustomer);
router.get('/:id', customerController.getCustomer);
router.put('/:id', validate(updateCustomerSchema), customerController.updateCustomer);
router.delete('/:id', customerController.deleteCustomer);

module.exports = router;
