'use strict';

const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Bill = require('../models/Bill');
const StockTransaction = require('../models/StockTransaction');
const { ApiError } = require('../utils/ApiError');
const { MENU_BUSINESS_TYPES } = require('../config/constants');

/**
 * Lists products for one tenant with search, filters and pagination.
 */
async function listProducts(businessId, {
  page = 1,
  limit = 50,
  search = '',
  categoryId = '',
  active = 'true',
  lowStock = false,
} = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

  const filter = { businessId };
  if (active === 'true') filter.isActive = true;
  else if (active === 'false') filter.isActive = false;

  if (categoryId && mongoose.isValidObjectId(categoryId)) filter.categoryId = categoryId;
  if (lowStock === true || lowStock === 'true') {
    filter.stockEnabled = true;
    filter.$expr = { $lte: ['$currentStock', '$minimumStock'] };
  }
  if (search) {
    const re = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: re }, { sku: re }, { barcode: re }];
  }

  const total = await Product.countDocuments(filter);
  const docs = await Product.find(filter)
    .sort({ createdAt: -1 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum)
    .lean();

  return {
    products: docs.map((p) => ({ ...p, id: p._id.toString() })),
    pagination: { page: pageNum, limit: limitNum, total },
  };
}

async function getProduct(businessId, id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid product id', 'INVALID_ID');
  // Tenant filter inside the query: foreign products resolve to 404.
  const product = await Product.findOne({ _id: id, businessId });
  if (!product) throw ApiError.notFound('Product not found', 'PRODUCT_NOT_FOUND');
  return product;
}

/**
 * Validates that a categoryId belongs to this tenant and returns its ObjectId.
 */
async function resolveCategory(businessId, categoryId) {
  if (categoryId === null || categoryId === '' || categoryId === undefined) return null;
  if (!mongoose.isValidObjectId(categoryId)) {
    throw ApiError.badRequest('Invalid category id', 'INVALID_ID');
  }
  // Cross-tenant category ids are rejected: must exist for THIS tenant.
  const cat = await Category.findOne({ _id: categoryId, businessId });
  if (!cat) throw ApiError.badRequest('Category not found for this business', 'INVALID_CATEGORY');
  return cat._id;
}

/**
 * Creates a product. Derives stockEnabled from the business type when not
 * supplied so hotel/cafe/restaurant tenants are not forced into stock.
 */
async function createProduct(businessId, businessType, payload) {
  if (!businessId) throw ApiError.forbidden('No business tenant', 'NO_BUSINESS_TENANT');

  const categoryId = await resolveCategory(businessId, payload.categoryId);

  const stockEnabled =
    typeof payload.stockEnabled === 'boolean'
      ? payload.stockEnabled
      : !MENU_BUSINESS_TYPES.includes(businessType);

  if (stockEnabled && Number(payload.currentStock ?? 0) < 0) {
    throw ApiError.badRequest('Stock cannot be negative', 'NEGATIVE_STOCK');
  }

  // SKU uniqueness inside the tenant: checked explicitly so it holds even while
  // the compound unique index is still building; the index remains the hard
  // guarantee against races.
  const sku = payload.sku ? String(payload.sku).trim().toUpperCase() : null;
  if (sku) {
    const skuTaken = await Product.exists({ businessId, sku });
    if (skuTaken) throw ApiError.conflict('SKU already exists', 'SKU_EXISTS');
  }

  const product = await Product.create({
    businessId,
    categoryId,
    name: String(payload.name).trim(),
    sku: payload.sku ? String(payload.sku).trim().toUpperCase() : null,
    barcode: payload.barcode ? String(payload.barcode).trim() : null,
    description: payload.description ? String(payload.description).trim() : '',
    imageUrl: payload.imageUrl || null,
    purchasePrice: Number(payload.purchasePrice ?? 0),
    sellingPrice: Number(payload.sellingPrice),
    taxRate: Number(payload.taxRate ?? 0),
    hsnCode: payload.hsnCode ? String(payload.hsnCode).trim() : null,
    stockEnabled,
    currentStock: stockEnabled ? Number(payload.currentStock ?? 0) : 0,
    minimumStock: stockEnabled ? Number(payload.minimumStock ?? 0) : 0,
    unit: payload.unit ? String(payload.unit).trim().toUpperCase() : 'PCS',
    isActive: true,
  });

  return product;
}

/**
 * Updates a product. Edits never rewrite historical bills, which keep their own
 * line snapshots.
 */
async function updateProduct(businessId, id, payload) {
  const product = await getProduct(businessId, id);

  if (payload.name !== undefined) product.name = String(payload.name).trim();
  if (payload.sku !== undefined) product.sku = payload.sku ? String(payload.sku).trim().toUpperCase() : null;
  if (payload.barcode !== undefined) product.barcode = payload.barcode ? String(payload.barcode).trim() : null;
  if (payload.description !== undefined) product.description = String(payload.description).trim();
  if (payload.imageUrl !== undefined) product.imageUrl = payload.imageUrl || null;
  if (payload.purchasePrice !== undefined) product.purchasePrice = Number(payload.purchasePrice);
  if (payload.sellingPrice !== undefined) product.sellingPrice = Number(payload.sellingPrice);
  if (payload.taxRate !== undefined) product.taxRate = Number(payload.taxRate);
  if (payload.hsnCode !== undefined) product.hsnCode = payload.hsnCode ? String(payload.hsnCode).trim() : null;
  if (payload.unit !== undefined) product.unit = String(payload.unit).trim().toUpperCase();

  if (payload.stockEnabled !== undefined) product.stockEnabled = Boolean(payload.stockEnabled);
  if (payload.currentStock !== undefined) {
    if (product.stockEnabled && Number(payload.currentStock) < 0) {
      throw ApiError.badRequest('Stock cannot be negative', 'NEGATIVE_STOCK');
    }
    product.currentStock = Number(payload.currentStock);
  }
  if (payload.minimumStock !== undefined) product.minimumStock = Number(payload.minimumStock);
  if (payload.isActive !== undefined) product.isActive = Boolean(payload.isActive);

  if (payload.categoryId !== undefined) {
    product.categoryId = await resolveCategory(businessId, payload.categoryId);
  }

  await product.save();
  return product;
}

/**
 * Soft delete: keeps the document for historical bills but hides it from
 * billing/search. Hard deletion is intentionally not exposed.
 */
async function deactivateProduct(businessId, id) {
  const product = await getProduct(businessId, id);
  product.isActive = false;
  await product.save();
  return product;
}

/**
 * Permanently deletes a product and its stock-ledger entries. Refuses when the
 * product appears in any historical bill, because deleting it would orphan those
 * invoices; in that case the owner should deactivate it instead.
 */
async function hardDeleteProduct(businessId, id) {
  const product = await getProduct(businessId, id);
  const inBills = await Bill.exists({ businessId, 'items.productId': product._id });
  if (inBills) {
    throw ApiError.conflict(
      'This product is used in existing bills. Deactivate it instead to preserve history.',
      'PRODUCT_IN_BILLS'
    );
  }
  await Product.deleteOne({ _id: product._id, businessId });
  await StockTransaction.deleteMany({ businessId, productId: product._id });
  return product;
}

module.exports = { listProducts, getProduct, createProduct, updateProduct, deactivateProduct, hardDeleteProduct };