'use strict';

/**
 * Consistent success response shape used by every endpoint.
 * Success shape -> { success: true, message, data }
 * Error shape   -> { success: false, message, code }  (see errorMiddleware)
 */
function success(res, data = null, message = 'Operation successful', statusCode = 200) {
  return res.status(statusCode).json({ success: true, message, data });
}

function created(res, data = null, message = 'Resource created', options = {}) {
  return res.status(201).json({ success: true, message, data });
}

module.exports = { success, created };