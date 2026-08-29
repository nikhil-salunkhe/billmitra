'use strict';

const mongoose = require('mongoose');

const Bill = require('../models/Bill');
const Product = require('../models/Product');
const StockTransaction = require('../models/StockTransaction');
const BusinessSettings = require('../models/BusinessSettings');
const { ApiError } = require('../utils/ApiError');
const { runInTransaction } = require('../utils/transactionHelper');
const { computeLineTotals, computeBillTotals, TAX_MODE } = require('../utils/taxUtils');
const invoiceNumberService = require('./invoiceNumberService');
const { PAYMENT_METHODS, STOCK_TRANSACTION_TYPES } = require('../config/constants');

/**
 * Resolves the effective tax mode for a tenant from its settings.
 */
async function getBillingContext(businessId) {
  const settings = await BusinessSettings.findOne({ businessId });
  return {
    settings,
    taxMode: settings?.defaultTaxMode || TAX_MODE.GST,
    invoicePrefix: settings?.invoicePrefix || 'INV',
    allowNegativeStock: Boolean(settings?.allowNegativeStock),
    defaultPaymentMethod: settings?.defaultPaymentMethod || PAYMENT_METHODS.CASH,
  };
}

/**
 * Idempotency fast-path: if this business already stored a bill with the same
 * client-generated key (e.g. a network retry), return it instead of creating a
 * second bill or deducting stock twice.
 */
async function findExistingByIdempotencyKey(businessId, idempotencyKey) {
  if (!idempotencyKey) return null;
  return Bill.findOne({ businessId, idempotencyKey });
}

/**
 * Loads and validates every requested product for THIS tenant.
 * Unit prices and tax rates are read from the database — client-sent prices are
 * never trusted.
 */
async function resolveLineItems(businessId, rawItems) {
  const ids = [...new Set(rawItems.map((i) => i.productId))];
  const docs = await Product.find({
    _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
    businessId,
    isActive: true,
  });

  const byId = new Map(docs.map((d) => [d._id.toString(), d]));

  // Aggregate quantities when the same product appears on multiple lines so
  // stock math and totals stay correct.
  const merged = new Map();

  for (const item of rawItems) {
    const product = byId.get(String(item.productId));
    if (!product) {
      throw ApiError.badRequest(
        `Product is unavailable in this business: ${item.productId}`,
        'INVALID_PRODUCT'
      );
    }

    const qty = Number(item.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw ApiError.badRequest('Quantity must be a positive whole number', 'INVALID_QUANTITY');
    }

    const key = String(product._id);
    if (merged.has(key)) {
      merged.get(key).quantity += qty;
    } else {
      merged.set(key, { product, quantity: qty });
    }
  }

  return [...merged.values()];
}

/**
 * Creates a bill end-to-end:
 *   validate lines -> server-computed totals -> atomic invoice number ->
 *   insert Bill -> deduct stock -> write StockTransactions
 *
 * All writes run inside one MongoDB transaction when the topology supports it,
 * so a failure can never leave a half-billed/under-stocked state.
 */
async function createBill(businessId, businessType, userId, payload) {
  const ctx = await getBillingContext(businessId);

  // 1. Idempotent retry?
  const existing = await findExistingByIdempotencyKey(businessId, payload.idempotencyKey);
  if (existing) {
    return { bill: existing, alreadyExisted: true };
  }

  // 2. Resolve products from the DB (authoritative prices/tax).
  const mergedLines = await resolveLineItems(businessId, payload.items);

  // 3. Server-side money math.
  const computed = mergedLines.map(({ product, quantity }) => ({
    product,
    quantity,
    ...computeLineTotals(product.sellingPrice, quantity, product.taxRate, ctx.taxMode),
  }));

  const totals = computeBillTotals(
    computed.map((l) => ({ lineAmount: l.lineAmount, cgst: l.cgst, sgst: l.sgst, igst: l.igst })),
    payload.discount
  );

  if (payload.discount > 0 && totals.discount === 0) {
    throw ApiError.badRequest('Discount must be a positive number', 'INVALID_DISCOUNT');
  }

  // 4. Stock availability check before any writes.
  for (const line of computed) {
    if (!line.product.stockEnabled) continue;
    if (!ctx.allowNegativeStock && line.product.currentStock < line.quantity) {
      throw ApiError.conflict(
        `Insufficient stock for ${line.product.name} (available ${line.product.currentStock}, requested ${line.quantity})`,
        'INSUFFICIENT_STOCK'
      );
    }
  }

  return persistBill({ businessId, businessType, userId, payload, ctx, computed, totals });
}

/**
 * Transactional persistence half of createBill.
 */
async function persistBill({ businessId, businessType, userId, payload, ctx, computed, totals }) {
  const stockLines = computed.filter((l) => l.product.stockEnabled);

  const saved = await runInTransaction(async (session) => {
    const invoiceNumber = await invoiceNumberService.nextInvoiceNumber(
      businessId,
      ctx.invoicePrefix,
      new Date(),
      session
    );

    const bill = await Bill.create(
      [
        {
          businessId,
          invoiceNumber,
          customerName: payload.customerName || null,
          customerPhone: payload.customerPhone || null,
          items: computed.map((l) => ({
            productId: l.product._id,
            name: l.product.name,
            sku: l.product.sku,
            unit: l.product.unit,
            quantity: l.quantity,
            unitPrice: l.product.sellingPrice,
            taxRate: l.product.taxRate,
            lineAmount: l.lineAmount,
            cgst: l.cgst,
            sgst: l.sgst,
            igst: l.igst,
            totalTax: l.taxTotal,
            stockEnabled: l.product.stockEnabled,
          })),
          subtotal: totals.subtotal,
          discount: totals.discount,
          taxableAmount: totals.taxableAmount,
          cgst: totals.cgst,
          sgst: totals.sgst,
          igst: totals.igst,
          totalTax: totals.totalTax,
          grandTotal: totals.grandTotal,
          paymentMethod: payload.paymentMethod,
          paymentStatus: 'PAID',
          businessType,
          notes: payload.notes || '',
          createdBy: userId,
          idempotencyKey: payload.idempotencyKey,
        },
      ],
      { session }
    );

    const stockTxDocs = [];
    for (const line of stockLines) {
      const previousStock = line.product.currentStock;
      const filter = ctx.allowNegativeStock
        ? { _id: line.product._id, businessId }
        : { _id: line.product._id, businessId, currentStock: { $gte: line.quantity } };

      const updated = await Product.findOneAndUpdate(
        filter,
        { $inc: { currentStock: -line.quantity } },
        { new: true, session }
      );

      if (!updated) {
        // Lost the race against another sale; aborts everything on Atlas.
        throw ApiError.conflict(`Insufficient stock for ${line.product.name}`, 'INSUFFICIENT_STOCK');
      }

      stockTxDocs.push({
        businessId,
        productId: line.product._id,
        type: 'SALE',
        quantity: line.quantity,
        previousStock,
        newStock: updated.currentStock,
        referenceType: 'Bill',
        referenceId: bill[0]._id,
        createdBy: userId,
      });
    }

    if (stockTxDocs.length > 0) {
      await StockTransaction.insertMany(stockTxDocs, { session });
    }

    return bill[0];
  });

  return { bill: saved, alreadyExisted: false };
}

/**
 * Lists bills for one tenant with date/payment filters, search, pagination.
 */
async function listBills(businessId, {
  page = 1,
  limit = 20,
  from = '',
  to = '',
  paymentMethod = '',
  search = '',
} = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const filter = { businessId };
  if (paymentMethod) filter.paymentMethod = paymentMethod;

  if (from || to) {
    const range = {};
    const fromDate = new Date(from);
    if (from && !Number.isNaN(fromDate.getTime())) range.$gte = fromDate;
    const toDate = new Date(to);
    if (to && !Number.isNaN(toDate.getTime())) range.$lte = toDate;
    if (Object.keys(range).length > 0) filter.createdAt = range;
  }
  if (search) {
    const re = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ invoiceNumber: re }, { customerName: re }, { customerPhone: re }];
  }

  const total = await Bill.countDocuments(filter);
  const docs = await Bill.find(filter)
    .sort({ createdAt: -1 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum)
    .lean();

  return {
    bills: docs.map((b) => ({ ...b, id: b._id.toString() })),
    pagination: { page: pageNum, limit: limitNum, total },
  };
}

async function getBill(businessId, id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid bill id', 'INVALID_ID');
  // Tenant filter inside the query — foreign bills resolve to 404.
  const bill = await Bill.findOne({ _id: id, businessId });
  if (!bill) throw ApiError.notFound('Bill not found', 'BILL_NOT_FOUND');
  return bill;
}

/**
 * Records a reprint attempt. The bill itself is never modified.
 */
async function reprintBill(businessId, id) {
  const bill = await getBill(businessId, id);
  bill.reprintCount += 1;
  bill.lastReprintAt = new Date();
  await bill.save();
  return bill;
}

/**
 * Voids (cancels) a bill instead of hard-deleting it, so audit history and
 * unique invoice numbers are preserved. Restores stock for every line that
 * consumed stock at sale time, writing a SALE_REVERSAL ledger entry for each.
 * Runs atomically so a restored product can never be left inconsistent.
 *
 * Idempotent: a bill that is already voided returns the same bill untouched.
 */
async function voidBill(businessId, userId, id, reason = '') {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid bill id', 'INVALID_ID');
  const bill = await getBill(businessId, id);
  if (bill.isVoided) {
    throw ApiError.conflict('This bill is already voided', 'BILL_ALREADY_VOIDED');
  }

  const restoredItems = bill.items.filter((i) => i.stockEnabled);

  await runInTransaction(async (session) => {
    // Mark voided first so a concurrent re-void cannot double-restore.
    const marked = await Bill.findOneAndUpdate(
      { _id: bill._id, businessId, isVoided: false },
      { isVoided: true, voidedAt: new Date(), voidedBy: userId || null, voidReason: String(reason).trim() },
      { new: true, session }
    );
    if (!marked) throw ApiError.conflict('This bill is already voided', 'BILL_ALREADY_VOIDED');

    const ledger = [];
    for (const item of restoredItems) {
      const filter = { _id: item.productId, businessId };
      const updated = await Product.findOneAndUpdate(
        filter,
        { $inc: { currentStock: item.quantity } },
        { new: true, session }
      );
      if (!updated) {
        // Product deleted/missing; ledger still records the reversal so stock
        // reconciliation stays complete. currentStock is untouched for it.
        ledger.push({
          businessId,
          productId: item.productId,
          type: STOCK_TRANSACTION_TYPES.SALE_REVERSAL,
          quantity: item.quantity,
          previousStock: null,
          newStock: null,
          referenceType: 'Bill',
          referenceId: bill._id,
          createdBy: userId,
        });
        continue;
      }
      ledger.push({
        businessId,
        productId: item.productId,
        type: STOCK_TRANSACTION_TYPES.SALE_REVERSAL,
        quantity: item.quantity,
        previousStock: updated.currentStock - item.quantity,
        newStock: updated.currentStock,
        referenceType: 'Bill',
        referenceId: bill._id,
        createdBy: userId,
      });
    }
    if (ledger.length > 0) {
      await StockTransaction.insertMany(ledger, { session });
    }
  });

  return Bill.findById(bill._id);
}

/**
 * Permanently deletes a bill and every stock-ledger entry tied to it. For an
 * active (non-voided) bill the deducted stock is first restored, so deleting the
 * record does not silently drop inventory. Runs atomically. Use sparingly — the
 * void flow is the recommended, audit-preserving path; this is for true cleanup.
 */
async function permanentlyDeleteBill(businessId, userId, id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid bill id', 'INVALID_ID');
  const bill = await getBill(businessId, id);

  await runInTransaction(async (session) => {
    if (!bill.isVoided) {
      // Restore stock for products that were sold and still tracked.
      const restoredItems = bill.items.filter((i) => i.stockEnabled);
      for (const item of restoredItems) {
        await Product.findOneAndUpdate(
          { _id: item.productId, businessId },
          { $inc: { currentStock: item.quantity } },
          { session }
        );
      }
    }
    // Remove the ledger trail for this bill (sale + any reversal) so there are
    // no dangling references, then drop the invoice itself.
    await StockTransaction.deleteMany(
      { businessId, referenceType: 'Bill', referenceId: bill._id },
      { session }
    );
    await Bill.deleteOne({ _id: bill._id, businessId }, { session });
  });

  return bill;
}

module.exports = {
  getBillingContext,
  findExistingByIdempotencyKey,
  resolveLineItems,
  createBill,
  listBills,
  getBill,
  reprintBill,
  voidBill,
  permanentlyDeleteBill,
};