'use strict';

const express = require('express');

const { authenticateToken } = require('../middleware/authMiddleware');
const { requireTenant } = require('../middleware/tenantMiddleware');
const { requireBilling } = require('../middleware/subscriptionMiddleware');
const { requireAnyAuthenticatedRole } = require('../middleware/roleMiddleware');
const syncController = require('../controllers/syncController');

const router = express.Router();

// Any authenticated tenant member may sync their device's offline queue.
// Tenant is derived from the JWT — a client-supplied businessId is never
// trusted for authorization.
router.use(authenticateToken, requireTenant, requireAnyAuthenticatedRole);

// Billing gate applies — expired subscriptions must not create server bills.
router.post('/push', requireBilling, syncController.push);
router.get('/pull', syncController.pull);

module.exports = router;