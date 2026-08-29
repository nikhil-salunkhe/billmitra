'use strict';

const { success } = require('../utils/ApiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const authService = require('../services/authService');

/**
 * POST /api/auth/admin/login
 */
const loginAdmin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.loginAdmin(email, password);
  return success(res, { token: result.token, user: result.user }, 'Login successful');
});

/**
 * POST /api/auth/owner/login
 * Owner may authenticate with username or email.
 */
const loginOwner = asyncHandler(async (req, res) => {
  const { username, email, password } = req.body;
  const identifier = username || email;
  const result = await authService.loginOwner(identifier, password);
  return success(res, { token: result.token, user: result.user }, 'Login successful');
});

/**
 * GET /api/auth/me
 * Returns the currently authenticated user built by authenticateToken.
 */
const me = asyncHandler(async (req, res) => {
  return success(res, { user: req.user }, 'Authenticated');
});

module.exports = { loginAdmin, loginOwner, me };