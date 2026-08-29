'use strict';

const { success, created } = require('../utils/ApiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const stockService = require('../services/stockService');

/**
 * GET /api/stock — tenant stock levels.
 */
const listStock = asyncHandler(async (req, res) => {
  const data = await stockService.listStock(req.businessId, req.query);
  return success(res, data, 'Stock levels retrieved');
});

/**
 * GET /api/stock/low — items at/below minimum (or out of stock).
 */
const listLowStock = asyncHandler(async (req, res) => {
  const data = await stockService.listLowStock(req.businessId, req.query);
  return success(res, data, 'Low stock items retrieved');
});

/**
 * POST /api/stock/adjustment — manual PURCHASE / RETURN / ADJUSTMENT / OPENING.
 */
const adjustStock = asyncHandler(async (req, res) => {
  const result = await stockService.adjustStock(req.businessId, req.user.id, req.body);
  return created(
    res,
    {
      product: {
        id: result.product._id.toString(),
        name: result.product.name,
        currentStock: result.product.currentStock,
        minimumStock: result.product.minimumStock,
      },
      transaction: result.transaction.toSafeJSON
        ? result.transaction.toSafeJSON()
        : { ...result.transaction.toObject(), id: result.transaction._id.toString() },
    },
    'Stock adjusted'
  );
});

/**
 * GET /api/stock/:productId/transactions — movement history for one product.
 */
const listTransactions = asyncHandler(async (req, res) => {
  const data = await stockService.listTransactions(req.businessId, {
    ...req.query,
    productId: req.params.productId,
  });
  return success(res, data, 'Stock transactions retrieved');
});

module.exports = { listStock, listLowStock, adjustStock, listTransactions };