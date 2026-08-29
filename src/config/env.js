'use strict';

const path = require('path');

// Load environment variables from the monorepo root .env (single source of truth).
require('dotenv').config({
  path: path.resolve(__dirname, '../../../.env'),
});

const DEFAULT_PORT = 5000;

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV !== 'production',

  port: parseInt(process.env.PORT, 10) || DEFAULT_PORT,

  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/billmitra',

  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  // Dev-only admin seed (used by scripts/seed-admin.js). Empty in production.
  adminSeedEmail: process.env.ADMIN_SEED_EMAIL || '',
  adminSeedName: process.env.ADMIN_SEED_NAME || 'Super Admin',
  adminSeedPassword: process.env.ADMIN_SEED_PASSWORD || '',

  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
  adminUrl: process.env.ADMIN_URL || 'http://localhost:5173',
  ownerAppUrl: process.env.OWNER_APP_URL || '',

  // Payment gateway placeholders (never hard-code real secrets).
  // Prefer the RAZORPAY_* names; fall back to the legacy PAYMENT_* names.
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || process.env.PAYMENT_KEY_ID || '',
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || process.env.PAYMENT_KEY_SECRET || '',
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET || '',

  storage: {
    provider: process.env.STORAGE_PROVIDER || 'local',
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },

  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

// Fail fast in production if the JWT secret is missing or is the dev placeholder.
if (
  env.isProduction &&
  (!env.jwtSecret || env.jwtSecret === 'dev-only-insecure-secret-change-me' || env.jwtSecret.length < 32)
) {
  throw new Error('[env] JWT_SECRET must be set to a strong value (>= 32 chars) in production');
}

module.exports = { env };