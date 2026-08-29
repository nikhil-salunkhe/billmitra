'use strict';

const express = require('express');

const { authenticateToken } = require('../middleware/authMiddleware');
const { requireTenant } = require('../middleware/tenantMiddleware');
const { requireBusinessOwner } = require('../middleware/roleMiddleware');
const uploadController = require('../controllers/uploadController');

const router = express.Router();

// Owner-scoped image uploads.
router.use(authenticateToken, requireTenant, requireBusinessOwner);

router.post('/product-image', ...uploadController.uploadProductImage);

module.exports = router;