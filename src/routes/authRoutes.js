'use strict';

const express = require('express');

const { validate } = require('../middleware/validationMiddleware');
const { authLimiter } = require('../middleware/rateLimitMiddleware');
const { authenticateToken } = require('../middleware/authMiddleware');
const { adminLoginSchema, ownerLoginSchema } = require('../validators/authValidators');
const authController = require('../controllers/authController');

const router = express.Router();

router.post('/admin/login', authLimiter, validate(adminLoginSchema), authController.loginAdmin);
router.post('/owner/login', authLimiter, validate(ownerLoginSchema), authController.loginOwner);
router.get('/me', authenticateToken, authController.me);

module.exports = router;