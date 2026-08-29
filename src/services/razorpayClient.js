'use strict';

const { env } = require('../config/env');
const { ApiError } = require('../utils/ApiError');

const API_BASE = 'https://api.razorpay.com/v1';

/**
 * Minimal server-side Razorpay REST client (Payment Links API).
 * Runs ONLY on the backend — the key secret never leaves this process.
 * Uses global fetch (Node >= 18) to avoid adding an SDK dependency.
 */
function assertConfigured() {
  if (!env.razorpayKeyId || !env.razorpayKeySecret) {
    throw new ApiError(503, 'Payment gateway is not configured', 'PAYMENTS_NOT_CONFIGURED');
  }
}

function authHeader() {
  return `Basic ${Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString('base64')}`;
}

async function request(method, path, body) {
  assertConfigured();
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new ApiError(502, 'Could not reach payment gateway', 'PAYMENT_GATEWAY_UNREACHABLE');
  }

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      502,
      payload?.error?.description || 'Payment gateway rejected the request',
      'PAYMENT_GATEWAY_ERROR'
    );
  }
  return payload;
}

/** Creates a UPI-capable Payment Link for an amount in paise. */
async function createPaymentLink({ amountInPaise, description, referenceId, customerPhone, customerName }) {
  const body = {
    amount: amountInPaise,
    currency: 'INR',
    accept_partial: false,
    description: String(description).slice(0, 200),
    reference_id: referenceId,
    notify: { sms: Boolean(customerPhone), email: false },
    notes: { app: 'billmitra', reference_id: referenceId },
  };
  if (customerName || customerPhone) {
    body.customer = {};
    if (customerName) body.customer.name = String(customerName).slice(0, 60);
    if (customerPhone) body.customer.contact = String(customerPhone).replace(/\D/g, '').slice(-10);
  }
  return request('POST', '/payment_links', body);
}

/** Fetches a Payment Link's live status + its payments list. */
async function fetchPaymentLink(linkId) {
  return request('GET', `/payment_links/${linkId}`);
}

module.exports = { createPaymentLink, fetchPaymentLink };
