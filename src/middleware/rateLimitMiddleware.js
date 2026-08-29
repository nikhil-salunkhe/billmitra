'use strict';

const rateLimit = require('express-rate-limit');
const { env } = require('../config/env');

/**
 * Global API rate limiter (applied to all /api requests).
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: Number(process.env.RATE_LIMIT_WINDOW) || 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later',
    code: 'RATE_LIMITED',
  },
});

/**
 * Stricter limiter for authentication attempts (brute-force mitigation).
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT) || 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts, please try again later',
    code: 'AUTH_RATE_LIMITED',
  },
});

module.exports = { apiLimiter, authLimiter };