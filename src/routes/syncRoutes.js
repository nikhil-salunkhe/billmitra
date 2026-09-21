'use strict';

const express = require('express');

const { authenticateToken } = require('../middleware/authMiddleware');
const { requireTenant } = require('../middleware/tenantMiddleware');
const { requireAnyAuthenticatedRole } = require('../middleware/roleMiddleware');
const syncController = require('../controllers/syncController');

const router = express.Router();

// Any authenticated tenant member may sync their device's offline queue.
// Tenant is derived from the JWT — a client-supplied businessId is never
// trusted for authorization.
router.use(authenticateToken, requireTenant, requireAnyAuthenticatedRole);

// No billing gate: BillMitra is a lifetime service, so sync always works.
router.post('/push', syncController.push);
router.get('/pull', syncController.pull);

module.exports = router;