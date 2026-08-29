'use strict';

const express = require('express');

const { authenticateToken } = require('../middleware/authMiddleware');
const { requireTenant } = require('../middleware/tenantMiddleware');
const { requireBusinessOwner } = require('../middleware/roleMiddleware');
const businessController = require('../controllers/businessController');

const router = express.Router();

// Owner-scoped routes: auth + tenant scoping + owner role.
router.use(authenticateToken, requireTenant, requireBusinessOwner);

router.get('/profile', businessController.getProfile);
router.get('/settings', businessController.getSettings);
router.put('/settings', businessController.updateSettings);

module.exports = router;