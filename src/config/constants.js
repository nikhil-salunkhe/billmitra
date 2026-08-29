'use strict';

/**
 * Central place for shared enums and business constants.
 * Single source of truth so validators, middleware, models and docs stay aligned.
 */

const ROLES = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN',
  BUSINESS_OWNER: 'BUSINESS_OWNER',
  STAFF: 'STAFF', // reserved for a future phase
});

const BUSINESS_TYPES = Object.freeze({
  GARMENT: 'GARMENT',
  GROCERY: 'GROCERY',
  ELECTRONICS: 'ELECTRONICS',
  MOBILE: 'MOBILE',
  GENERAL_RETAIL: 'GENERAL_RETAIL',
  HOTEL: 'HOTEL',
  CAFE: 'CAFE',
  RESTAURANT: 'RESTAURANT',
  OTHER: 'OTHER',
});

// Businesses that generally manage stock/products.
const PRODUCT_BUSINESS_TYPES = Object.freeze([
  BUSINESS_TYPES.GARMENT,
  BUSINESS_TYPES.GROCERY,
  BUSINESS_TYPES.ELECTRONICS,
  BUSINESS_TYPES.MOBILE,
  BUSINESS_TYPES.GENERAL_RETAIL,
  BUSINESS_TYPES.OTHER,
]);

// Businesses that primarily sell menu items (stock optional).
const MENU_BUSINESS_TYPES = Object.freeze([
  BUSINESS_TYPES.HOTEL,
  BUSINESS_TYPES.CAFE,
  BUSINESS_TYPES.RESTAURANT,
]);

const BUSINESS_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  INACTIVE: 'INACTIVE',
});

const SUBSCRIPTION_STATUS = Object.freeze({
  TRIAL: 'TRIAL',
  ACTIVE: 'ACTIVE',
  EXPIRING: 'EXPIRING',
  EXPIRED: 'EXPIRED',
  SUSPENDED: 'SUSPENDED',
});

const PAYMENT_METHODS = Object.freeze({
  CASH: 'CASH',
  UPI: 'UPI',
  CARD: 'CARD',
  OTHER: 'OTHER',
});

const PAYMENT_STATUS = Object.freeze({
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
});

const STOCK_TRANSACTION_TYPES = Object.freeze({
  OPENING: 'OPENING',
  PURCHASE: 'PURCHASE',
  SALE: 'SALE',
  ADJUSTMENT: 'ADJUSTMENT',
  RETURN: 'RETURN',
  SALE_REVERSAL: 'SALE_REVERSAL', // stock restored when a bill is voided
});

const TAX_MODE = Object.freeze({
  GST: 'GST', // intra-state -> CGST + SGST
  IGST: 'IGST', // inter-state -> single IGST
  NONE: 'NONE',
});

const SUBSCRIPTION_PLANS = Object.freeze({
  INITIAL: {
    name: 'INITIAL',
    setupAmount: 4999, // ₹4,999 initial package
    trialMonths: 2, // first 2 months subscription FREE
    monthlyAmount: 499, // ₹499/month after trial
    label: 'Initial Package',
    tagline: '₹4,999 setup · 2 months free · then ₹499/month',
  },
  // Promotional offer: first 6 months FREE, then a ₹2,500 recharge covers the
  // next 6 months (≈ ₹416/month). Admin picks the plan at business creation.
  SIX_MONTH_FREE: {
    name: 'SIX_MONTH_FREE',
    trialMonths: 6, // first 6 months FREE
    rechargeMonths: 6, // each recharge buys 6 months
    rechargeAmount: 2500, // ₹2,500 per 6-month block
    setupAmount: 2500,
    monthlyAmount: Math.round(2500 / 6), // ≈ ₹417 display figure
    label: 'First 6 Months Free',
    tagline: '6 months free · then ₹2,500 per 6 months',
  },
});

// Threshold (in days) before expiry when a subscription is flagged as EXPIRING.
const EXPIRING_WARNING_DAYS = 7;

// Number of months in the free trial following activation.
const TRIAL_DURATION_MONTHS = 2;

const MONTHLY_AMOUNT = 499; // ₹ (intra-month recurring charge)
const INITIAL_SETUP_AMOUNT = 4999; // ₹ initial package

// How a subscription/recharge can be paid. Kept separate from PAYMENT_METHODS
// (which describe a bill's in-store sale methods) because recharge accepts gateway
// methods (netbanking, wallet) that don't apply to a counter bill.
const RECHARGE_PAYMENT_METHODS = Object.freeze([
  '', // not yet known
  'UPI',
  'CARD',
  'NETBANKING',
  'WALLET',
  'CASH',
  'OTHER',
]);

module.exports = {
  ROLES,
  BUSINESS_TYPES,
  PRODUCT_BUSINESS_TYPES,
  MENU_BUSINESS_TYPES,
  BUSINESS_STATUS,
  SUBSCRIPTION_STATUS,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  STOCK_TRANSACTION_TYPES,
  TAX_MODE,
  SUBSCRIPTION_PLANS,
  EXPIRING_WARNING_DAYS,
  TRIAL_DURATION_MONTHS,
  MONTHLY_AMOUNT,
  INITIAL_SETUP_AMOUNT,
  RECHARGE_PAYMENT_METHODS,
};