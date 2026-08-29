'use strict';

const express = require('express');

const paymentController = require('../controllers/paymentController');

const router = express.Router();

/**
 * Razorpay webhook — mounted with express.raw() BEFORE the global JSON parser
 * so the HMAC signature can be verified over the exact raw bytes.
 * Unauthenticated by JWT: authenticity comes from the signature check.
 */
router.post('/webhook', express.raw({ type: '*/*' }), paymentController.handleWebhook);

module.exports = router;
