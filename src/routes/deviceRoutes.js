'use strict';

const express = require('express');

const { authenticateToken } = require('../middleware/authMiddleware');
const { requireTenant } = require('../middleware/tenantMiddleware');
const { requireAnyAuthenticatedRole } = require('../middleware/roleMiddleware');
const deviceController = require('../controllers/deviceController');

const router = express.Router();

router.use(authenticateToken, requireTenant, requireAnyAuthenticatedRole);

router.post('/register', deviceController.register);

module.exports = router;