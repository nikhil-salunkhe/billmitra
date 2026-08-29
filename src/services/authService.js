'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { env } = require('../config/env');
const { ApiError } = require('../utils/ApiError');
const { ROLES } = require('../config/constants');
const Admin = require('../models/Admin');
const User = require('../models/User');

const BCRYPT_ROUNDS = 12;

// ---------------------------------------------------------------------------
// Password helpers
// ---------------------------------------------------------------------------

async function hashPassword(plain) {
  if (!plain || plain.length < 8) {
    throw ApiError.badRequest('Password must be at least 8 characters', 'WEAK_PASSWORD');
  }
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

async function comparePassword(plain, hash) {
  if (!plain || !hash) return false;
  return bcrypt.compare(plain, hash);
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

/**
 * Builds a JWT whose `sub` is the entity id and which carries role + businessId
 * so downstream middleware can filter tenants without extra lookups.
 */
function signToken(payload) {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

function buildPayloadFor(entity) {
  const isAdmin = entity instanceof Admin || entity.modelName === 'Admin';
  if (isAdmin) {
    return { sub: entity._id.toString(), role: entity.role, businessId: null };
  }
  return {
    sub: entity._id.toString(),
    role: entity.role,
    businessId: entity.businessId ? entity.businessId.toString() : null,
  };
}

// ---------------------------------------------------------------------------
// Login flows
// ---------------------------------------------------------------------------

/**
 * Authenticates a platform admin. Fails indistinguishably for unknown email
 * and wrong password to avoid user enumeration.
 */
async function loginAdmin(email, password) {
  const admin = await Admin.findOne({ email: String(email).trim().toLowerCase() }).select(
    '+passwordHash'
  );

  if (!admin) {
    throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const valid = await comparePassword(password, admin.passwordHash);
  if (!valid) {
    throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  if (!admin.isActive) {
    throw ApiError.unauthorized('Account is disabled', 'ACCOUNT_DISABLED');
  }

  admin.lastLoginAt = new Date();
  await admin.save();

  const token = signToken(buildPayloadFor(admin));
  return { token, user: admin.toSafeJSON() };
}

/**
 * Authenticates a business owner by username or email.
 */
async function loginOwner(identifier, password) {
  const lookup = { $or: [] };
  const email = String(identifier || '').trim().toLowerCase();
  const username = String(identifier || '').trim().toLowerCase();

  if (username) lookup.$or.push({ username });
  if (email && email.includes('@')) lookup.$or.push({ email });

  const user = await User.findOne(lookup).select('+passwordHash');

  if (!user) {
    throw ApiError.unauthorized('Invalid username or password', 'INVALID_CREDENTIALS');
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    throw ApiError.unauthorized('Invalid username or password', 'INVALID_CREDENTIALS');
  }

  if (!user.isActive) {
    throw ApiError.unauthorized('Account is disabled', 'ACCOUNT_DISABLED');
  }

  user.lastLoginAt = new Date();
  await user.save();

  const token = signToken(buildPayloadFor(user));
  return { token, user: user.toSafeJSON() };
}

module.exports = {
  hashPassword,
  comparePassword,
  signToken,
  verifyToken,
  loginAdmin,
  loginOwner,
  toSafeUser: (u) => u.toSafeJSON(),
};