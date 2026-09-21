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

// BillMitra is provided as a lifetime service — there is no subscription,
// trial, expiry or recharge concept anywhere in the product. Billing is always
// allowed for an ACTIVE (non-suspended) business.

module.exports = {
  ROLES,
  BUSINESS_TYPES,
  PRODUCT_BUSINESS_TYPES,
  MENU_BUSINESS_TYPES,
  BUSINESS_STATUS,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  STOCK_TRANSACTION_TYPES,
  TAX_MODE,
};