'use strict';

const mongoose = require('mongoose');

const Product = require('../models/Product');
const StockTransaction = require('../models/StockTransaction');
const BusinessSettings = require('../models/BusinessSettings');
const { ApiError } = require('../utils/ApiError');
const { runInTransaction } = require('../utils/transactionHelper');
const { STOCK_TRANSACTION_TYPES } = require('../config/constants');

/**
 * Manual movement types allowed through the stock API.
 * SALE is intentionally excluded: sales are recorded exclusively by billing so
 * the ledger always mirrors real revenue events.
 */
const MANUAL_TYPES = [
  STOCK_TRANSACTION_TYPES.OPENING,
  STOCK_TRANSACTION_TYPES.PURCHASE,
  STOCK_TRANSACTION_TYPES.ADJUSTMENT,
  STOCK_TRANSACTION_TYPES.RETURN,
];

/**
 * Lists stock levels for one tenant with search/filters/pagination and a
 * derived per-item status: OUT (0), LOW (<= minimum), OK, or N/A (no tracking).
 */
async function listStock(businessId, {
  page = 1,
  limit = 50,
  search = '',
  categoryId = '',
  status = '',
} = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

  const filter = { businessId };
  if (categoryId && mongoose.isValidObjectId(categoryId)) filter.categoryId = categoryId;
  if (search) {
    const re = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: re }, { sku: re }, { barcode: re }];
  }

  const total = await Product.countDocuments(filter);
  const docs = await Product.find(filter)
    .sort({ name: 1 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum)
    .select('name sku barcode unit imageUrl categoryId stockEnabled currentStock minimumStock isActive')
    .lean();

  let items = docs.map((p) => {
    const tracked = Boolean(p.stockEnabled);
    let state = 'N/A';
    if (tracked) {
      if ((p.currentStock ?? 0) === 0) state = 'OUT';
      else if ((p.currentStock ?? 0) <= (p.minimumStock ?? 0)) state = 'LOW';
      else state = 'OK';
    }
    return { ...p, id: p._id.toString(), businessId: String(businessId), stockState: state };
  });

  if (status) items = items.filter((i) => i.stockState === String(status).toUpperCase());

  return {
    items,
    pagination: { page: pageNum, limit: limitNum, total },
  };
}

/**
 * Items currently at/below their minimum (tracked products only).
 */
async function listLowStock(businessId, { page = 1, limit = 50 } = {}) {
  const data = await listStock(businessId, { page, limit });
  return { items: data.items.filter((i) => i.stockState === 'LOW' || i.stockState === 'OUT') };
}

/**
 * Resolves the tenant's product (404 for foreign ids) or throws if it does not
 * track stock.
 */
async function getTrackedProduct(businessId, productId) {
  if (!mongoose.isValidObjectId(productId)) {
    throw ApiError.badRequest('Invalid product id', 'INVALID_ID');
  }
  const product = await Product.findOne({ _id: productId, businessId });
  if (!product) throw ApiError.notFound('Product not found', 'PRODUCT_NOT_FOUND');
  if (!product.stockEnabled) {
    throw ApiError.badRequest('Stock management is disabled for this product', 'STOCK_DISABLED');
  }
  return product;
}

/**
 * Records a manual stock movement atomically:
 *   PURCHASE / RETURN -> currentStock += quantity
 *   ADJUSTMENT        -> currentStock += signed quantity
 *   OPENING           -> currentStock = quantity (absolute)
 *
 * Decreasing movements are guarded at the database level so a concurrent sale
 * cannot drive stock negative behind our back.
 */
async function adjustStock(businessId, userId, { productId, type, quantity }) {
  const settings = await BusinessSettings.findOne({ businessId }).select('allowNegativeStock');
  const allowNegative = Boolean(settings?.allowNegativeStock);

  const product = await getTrackedProduct(businessId, productId);
  const previousStock = product.currentStock;

  let newStock;
  let ledgerQty;

  if (type === STOCK_TRANSACTION_TYPES.OPENING) {
    // Absolute set to a non-negative count.
    newStock = Number(quantity);
    ledgerQty = newStock - previousStock;
  } else {
    const qty = Number(quantity);
    if (!Number.isInteger(qty)) {
      throw ApiError.badRequest('Quantity must be a whole number', 'INVALID_QUANTITY');
    }
    if (type === STOCK_TRANSACTION_TYPES.ADJUSTMENT) {
      if (qty === 0) throw ApiError.badRequest('Adjustment cannot be zero', 'INVALID_QUANTITY');
      ledgerQty = qty;
      newStock = previousStock + qty;
    } else {
      // PURCHASE / RETURN are inflows only.
      if (qty <= 0) throw ApiError.badRequest('Quantity must be positive', 'INVALID_QUANTITY');
      ledgerQty = qty;
      newStock = previousStock + qty;
    }
  }

  if (!Number.isFinite(newStock)) {
    throw ApiError.badRequest('Invalid quantity', 'INVALID_QUANTITY');
  }
  if (newStock < 0 && !allowNegative) {
    throw ApiError.conflict(
      `Adjustment would drive stock below zero (current ${previousStock})`,
      'INSUFFICIENT_STOCK'
    );
  }

  const result = await runInTransaction(async (session) => {
    const update = type === STOCK_TRANSACTION_TYPES.OPENING
      ? { $set: { currentStock: newStock } }
      : { $inc: { currentStock: ledgerQty } };

    // Guard decreasing movements against races unless negatives are allowed.
    const guardDecrease = !allowNegative && newStock < previousStock;
    const filter = guardDecrease
      ? { _id: product._id, businessId, currentStock: { $gte: Math.abs(ledgerQty) } }
      : { _id: product._id, businessId };

    const updated = await Product.findOneAndUpdate(filter, update, { new: true, session });
    if (!updated) {
      throw ApiError.conflict('Stock changed concurrently; retry', 'INSUFFICIENT_STOCK');
    }

    const [tx] = await StockTransaction.create(
      [{
        businessId,
        productId: product._id,
        type,
        quantity: ledgerQty,
        previousStock,
        newStock: updated.currentStock,
        referenceType: 'Manual',
        createdBy: userId,
      }],
      { session }
    );

    return { product: updated, transaction: tx };
  });

  return result;
}

/**
 * Ledger history for one tenant product (newest first).
 */
async function listTransactions(businessId, {
  productId,
  page = 1,
  limit = 50,
  type = '',
} = {}) {
  await getTrackedProduct(businessId, productId); // 404 for foreign products

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

  const filter = { businessId, productId: new mongoose.Types.ObjectId(productId) };
  if (type) filter.type = type;

  const total = await StockTransaction.countDocuments(filter);
  const docs = await StockTransaction.find(filter)
    .sort({ createdAt: -1 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum)
    .lean();

  return {
    transactions: docs.map((t) => ({ ...t, id: t._id.toString() })),
    pagination: { page: pageNum, limit: limitNum, total },
  };
}

module.exports = {
  MANUAL_TYPES,
  listStock,
  listLowStock,
  adjustStock,
  listTransactions,
};