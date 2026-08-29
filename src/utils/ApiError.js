'use strict';

/**
 * Operational error with an HTTP status and a stable machine-readable code.
 * Used across the app so error middleware can respond consistently.
 */
class ApiError extends Error {
  constructor(statusCode, message, code = 'API_ERROR', details = undefined, isOperational = true) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details; // optional structured validation details
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Bad request', code = 'BAD_REQUEST', details) {
    return new ApiError(400, message, code, details);
  }

  static unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED', details) {
    return new ApiError(401, message, code, details);
  }

  static forbidden(message = 'Forbidden', code = 'FORBIDDEN', details) {
    return new ApiError(403, message, code, details);
  }

  static notFound(message = 'Not found', code = 'NOT_FOUND', details) {
    return new ApiError(404, message, code, details);
  }

  static conflict(message = 'Conflict', code = 'CONFLICT', details) {
    return new ApiError(409, message, code, details);
  }

  static validation(message = 'Validation failed', code = 'VALIDATION_ERROR', details) {
    return new ApiError(422, message, code, details);
  }

  static internal(message = 'Internal server error', code = 'INTERNAL_ERROR', details) {
    return new ApiError(500, message, code, details, false);
  }
}

module.exports = { ApiError };