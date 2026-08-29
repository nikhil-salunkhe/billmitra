'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  requireSuperAdmin,
  requireBusinessOwner,
  requireRole,
} = require('../src/middleware/roleMiddleware');
const { ApiError } = require('../src/utils/ApiError');

function catchNext() {
  let captured = null;
  const next = (err) => {
    if (err) captured = err;
  };
  return { captured: () => captured, next };
}

test('requireSuperAdmin passes for SUPER_ADMIN', () => {
  const { captured, next } = catchNext();
  requireSuperAdmin({ user: { role: 'SUPER_ADMIN' } }, {}, next);
  assert.strictEqual(captured(), null);
});

test('requireSuperAdmin rejects BUSINESS_OWNER with 403 FORBIDDEN', () => {
  const { captured, next } = catchNext();
  requireSuperAdmin({ user: { role: 'BUSINESS_OWNER' } }, {}, next);
  const err = captured();
  assert.ok(err instanceof ApiError);
  assert.strictEqual(err.statusCode, 403);
  assert.strictEqual(err.code, 'FORBIDDEN');
});

test('requireBusinessOwner rejects SUPER_ADMIN', () => {
  const { captured, next } = catchNext();
  requireBusinessOwner({ user: { role: 'SUPER_ADMIN' } }, {}, next);
  const err = captured();
  assert.strictEqual(err.statusCode, 403);
});

test('requireRole denies when no user present (must run after auth)', () => {
  const { captured, next } = catchNext();
  requireRole('SUPER_ADMIN')({}, {}, next);
  const err = captured();
  assert.strictEqual(err.statusCode, 401);
  assert.strictEqual(err.code, 'AUTH_REQUIRED');
});

test('requireRole passes when role is in the allowed list', () => {
  const { captured, next } = catchNext();
  requireRole('BUSINESS_OWNER', 'STAFF')({ user: { role: 'STAFF' } }, {}, next);
  assert.strictEqual(captured(), null);
});