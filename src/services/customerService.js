'use strict';

const mongoose = require('mongoose');

const Customer = require('../models/Customer');
const { ApiError } = require('../utils/ApiError');

/**
 * Lists customers for one tenant with search and pagination.
 * Search matches name, phone and email (case-insensitive, escaped).
 */
async function listCustomers(businessId, { page = 1, limit = 50, search = '' } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

  const filter = { businessId };
  if (search) {
    const re = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: re }, { phone: re }, { email: re }];
  }

  const total = await Customer.countDocuments(filter);
  const docs = await Customer.find(filter)
    .sort({ name: 1 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum)
    .lean();

  return {
    customers: docs.map((c) => ({ ...c, id: c._id.toString() })),
    pagination: { page: pageNum, limit: limitNum, total },
  };
}

/** Normalizes a phone string to digits-plus-optional-leading-plus. */
function normalizePhone(phone) {
  if (!phone) return null;
  const trimmed = String(phone).trim();
  return trimmed === '' ? null : trimmed.replace(/\s+/g, '');
}

async function createCustomer(businessId, userId, payload) {
  if (!businessId) throw ApiError.forbidden('No business tenant', 'NO_BUSINESS_TENANT');

  const phone = normalizePhone(payload.phone);
  if (phone) {
    // Duplicate-phone guard for active tenants' customers.
    const taken = await Customer.exists({ businessId, phone, isActive: true });
    if (taken) throw ApiError.conflict('A customer with this phone already exists', 'PHONE_EXISTS');
  }

  const customer = await Customer.create({
    businessId,
    createdBy: userId || null,
    name: String(payload.name).trim(),
    phone,
    email: payload.email ? String(payload.email).trim().toLowerCase() : null,
    address: payload.address ? String(payload.address).trim() : '',
    gstNumber: payload.gstNumber ? String(payload.gstNumber).trim().toUpperCase() : null,
    notes: payload.notes ? String(payload.notes).trim() : '',
  });

  return customer;
}

async function getCustomer(businessId, id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid customer id', 'INVALID_ID');
  // Tenant filter inside the query: foreign customers resolve to 404.
  const customer = await Customer.findOne({ _id: id, businessId });
  if (!customer) throw ApiError.notFound('Customer not found', 'CUSTOMER_NOT_FOUND');
  return customer;
}

async function updateCustomer(businessId, id, payload) {
  const customer = await getCustomer(businessId, id);

  if (payload.name !== undefined) customer.name = String(payload.name).trim();

  if (payload.phone !== undefined) {
    const phone = normalizePhone(payload.phone);
    if (phone && phone !== customer.phone) {
      const taken = await Customer.exists({ businessId, phone, isActive: true });
      if (taken) throw ApiError.conflict('A customer with this phone already exists', 'PHONE_EXISTS');
    }
    customer.phone = phone;
  }
  if (payload.email !== undefined) customer.email = payload.email ? String(payload.email).trim().toLowerCase() : null;
  if (payload.address !== undefined) customer.address = String(payload.address ?? '').trim();
  if (payload.gstNumber !== undefined) {
    customer.gstNumber = payload.gstNumber ? String(payload.gstNumber).trim().toUpperCase() : null;
  }
  if (payload.notes !== undefined) customer.notes = String(payload.notes ?? '').trim();

  await customer.save();
  return customer;
}

/** Soft delete — keeps the document for historical bill references. */
async function deactivateCustomer(businessId, id) {
  const customer = await getCustomer(businessId, id);
  customer.isActive = false;
  await customer.save();
  return customer;
}

/**
 * Permanently deletes a customer. Bills store only a name/phone snapshot (not the
 * customer id), so no historical invoice is broken by removing it.
 */
async function hardDeleteCustomer(businessId, id) {
  const customer = await getCustomer(businessId, id);
  await Customer.deleteOne({ _id: customer._id, businessId });
  return customer;
}

module.exports = { listCustomers, createCustomer, getCustomer, updateCustomer, deactivateCustomer, hardDeleteCustomer };
