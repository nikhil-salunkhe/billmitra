'use strict';

const { success, created } = require('../utils/ApiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const productService = require('../services/productService');

/**
 * GET /api/products — search / filter / paginate within the tenant.
 */
const listProducts = asyncHandler(async (req, res) => {
  const data = await productService.listProducts(req.businessId, req.query);
  return success(res, data, 'Products retrieved');
});

/**
 * POST /api/products
 */
const createProduct = asyncHandler(async (req, res) => {
  const product = await productService.createProduct(
    req.businessId,
    req.businessType,
    req.body
  );
  return created(res, { product: product.toSafeJSON() }, 'Product created');
});

/**
 * GET /api/products/low — products at/below their minimum stock.
 */
const listLowStock = asyncHandler(async (req, res) => {
  const data = await productService.listProducts(req.businessId, { ...req.query, lowStock: 'true' });
  return success(res, data, 'Low stock products retrieved');
});

/**
 * GET /api/products/:id
 */
const getProduct = asyncHandler(async (req, res) => {
  const product = await productService.getProduct(req.businessId, req.params.id);
  return success(res, { product: product.toSafeJSON() }, 'Product retrieved');
});

/**
 * PUT /api/products/:id
 */
const updateProduct = asyncHandler(async (req, res) => {
  const product = await productService.updateProduct(req.businessId, req.params.id, req.body);
  return success(res, { product: product.toSafeJSON() }, 'Product updated');
});

/**
 * DELETE /api/products/:id — soft delete (isActive=false).
 */
const deleteProduct = asyncHandler(async (req, res) => {
  const product = await productService.deactivateProduct(req.businessId, req.params.id);
  return success(res, { product: product.toSafeJSON() }, 'Product deactivated');
});

/** DELETE /api/products/:id/permanent — hard delete (refuses if used in bills). */
const permanentDeleteProduct = asyncHandler(async (req, res) => {
  await productService.hardDeleteProduct(req.businessId, req.params.id);
  return success(res, { ok: true }, 'Product permanently deleted');
});

module.exports = {
  listProducts,
  listLowStock,
  createProduct,
  getProduct,
  updateProduct,
  deleteProduct,
  permanentDeleteProduct,
};