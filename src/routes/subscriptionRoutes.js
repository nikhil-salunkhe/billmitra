'use strict';

const express = require('express');

const { authenticateToken } = require('../middleware/authMiddleware');
const { requireTenant } = require('../middleware/tenantMiddleware');
const { requireBusinessOwner } = require('../middleware/roleMiddleware');
const subscriptionController = require('../controllers/subscriptionController');

const router = express.Router();

// Owner-scoped. (Paid recharge/order/webhook endpoints arrive in Phase 12.)
router.use(authenticateToken, requireTenant, requireBusinessOwner);

router.get('/', subscriptionController.getSubscription);
router.get('/plans', subscriptionController.listPlans);
router.post('/recharge', subscriptionController.createRecharge);
router.post('/recharge/:paymentId/sync', subscriptionController.syncRecharge);
router.get('/payments', subscriptionController.listPayments);

module.exports = router;