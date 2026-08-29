'use strict';

const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const { env } = require('../config/env');
const logger = require('../config/logger');

/**
 * 404 handler for unknown routes.
 */
function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`, 'NOT_FOUND'));
}

/**
 * Error response builder. Never leaks stack traces or internals in production.
 */
function sendError(res, statusCode, message, code, details) {
  const body = { success: false, message, code };
  if (details !== undefined) body.details = details;
  return res.status(statusCode).json(body);
}

/**
 * Centralized error handling middleware.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Mongoose validation errors.
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.fromEntries(
      Object.entries(err.errors).map(([k, v]) => [k, v.message])
    );
    return sendError(res, 422, 'Validation failed', 'VALIDATION_ERROR', details);
  }

  // MongoDB duplicate key (11000).
  if (err && err.code === 11000) {
    const keys = Object.keys(err.keyPattern || {}).join(', ');
    return sendError(res, 409, `Duplicate value for: ${keys}`, 'DUPLICATE_KEY');
  }

  // Cast errors (bad ObjectId).
  if (err instanceof mongoose.Error.CastError) {
    return sendError(res, 400, `Invalid value for ${err.path}`, 'INVALID_ID');
  }

  // Our own operational errors.
  if (err instanceof ApiError) {
    return sendError(res, err.statusCode, err.message, err.code, err.details);
  }

  // JSON parse errors from express.json().
  if (err.type === 'entity.parse.failed') {
    return sendError(res, 400, 'Invalid JSON payload', 'BAD_JSON');
  }

  // Everything else: unexpected server error.
  if (env.isProduction) {
    console.error('[error] Unhandled error:', err);
    return sendError(res, 500, 'Internal server error', 'INTERNAL_ERROR');
  }

  console.error('[error] Unhandled error:', err);
  return sendError(
    res,
    500,
    'Internal server error',
    'INTERNAL_ERROR',
    { message: err.message, stack: err.stack }
  );
}

module.exports = { notFound: notFoundHandler, errorHandler };