'use strict';

const { ApiError } = require('../utils/ApiError');

/**
 * Validates a request part (body/query/params) against a Zod schema.
 * On failure it short-circuits with a consistent 422 VALIDATION_ERROR.
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.join('.') || source,
        message: i.message,
      }));
      return next(ApiError.validation('Validation failed', 'VALIDATION_ERROR', details));
    }
    req[source] = result.data;
    return next();
  };
}

module.exports = { validate };