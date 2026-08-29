'use strict';

/**
 * Wraps async route handlers so rejected promises are forwarded
 * to the centralized error middleware instead of crashing the process.
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };