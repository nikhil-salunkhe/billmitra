'use strict';

const { success, created } = require('../utils/ApiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const customerService = require('../services/customerService');

/**
 * GET /api/customers — tenant-scoped list with search/pagination.
 */
const listCustomers = asyncHandler(async (req, res) => {
  const data = await customerService.listCustomers(req.businessId, req.query);
  return success(res, data, 'Customers retrieved');
});

const createCustomer = asyncHandler(async (req, res) => {
  const customer = await customerService.createCustomer(req.businessId, req.user.id, req.body);
  return created(res, { customer: customer.toSafeJSON() }, 'Customer created');
});

const getCustomer = asyncHandler(async (req, res) => {
  const customer = await customerService.getCustomer(req.businessId, req.params.id);
  return success(res, { customer: customer.toSafeJSON() }, 'Customer retrieved');
});

const updateCustomer = asyncHandler(async (req, res) => {
  const customer = await customerService.updateCustomer(req.businessId, req.params.id, req.body);
  return success(res, { customer: customer.toSafeJSON() }, 'Customer updated');
});

const deleteCustomer = asyncHandler(async (req, res) => {
  const customer = await customerService.hardDeleteCustomer(req.businessId, req.params.id);
  return success(res, { customer: customer.toSafeJSON() }, 'Customer deleted');
});

module.exports = { listCustomers, createCustomer, getCustomer, updateCustomer, deleteCustomer };
