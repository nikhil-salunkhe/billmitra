'use strict';

const jwt = require('jsonwebtoken');

const { env } = require('../config/env');
const { ApiError } = require('../utils/ApiError');
const { ROLES } = require('../config/constants');
const Admin = require('../models/Admin');
const User = require('../models/User');

/**
 * Authenticates a Bearer JWT, then reloads the account from the database
 * so disabled accounts are rejected immediately (tokens are not cached).
 * Sets req.user = { id, role, businessId, name, email }.
 */
async function authenticateToken(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      throw ApiError.unauthorized('Authentication required', 'AUTH_REQUIRED');
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw ApiError.unauthorized('Authentication required', 'AUTH_REQUIRED');
    }

    const payload = jwt.verify(token, env.jwtSecret);

    let entity;
    if (payload.role === ROLES.SUPER_ADMIN) {
      entity = await Admin.findById(payload.sub);
    } else if (payload.role === ROLES.BUSINESS_OWNER || payload.role === ROLES.STAFF) {
      entity = await User.findById(payload.sub);
    }

    if (!entity) {
      throw ApiError.unauthorized('Account no longer exists', 'ACCOUNT_NOT_FOUND');
    }
    if (!entity.isActive) {
      throw ApiError.unauthorized('Account is disabled', 'ACCOUNT_DISABLED');
    }

    req.user = {
      id: entity._id.toString(),
      role: entity.role,
      businessId: entity.businessId ? entity.businessId.toString() : null,
      name: entity.name,
      email: entity.email,
      username: entity.username || null,
    };

    return next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    if (err.name === 'TokenExpiredError') {
      return next(ApiError.unauthorized('Token has expired', 'TOKEN_EXPIRED'));
    }
    if (err.name === 'JsonWebTokenError') {
      return next(ApiError.unauthorized('Invalid token', 'INVALID_TOKEN'));
    }
    return next(err);
  }
}

/**
 * Convenience alias for clarity at route definition sites.
 */
const protect = authenticateToken;

module.exports = { authenticateToken, protect };