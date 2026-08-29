'use strict';

const { success, created } = require('../utils/ApiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const billingService = require('../services/billingService');

/**
 * POST /api/bills
 * Creates a sale. Retries carrying the same idempotencyKey return the original
 * bill (HTTP 200) instead of creating a duplicate or re-deducting stock.
 */
const createBill = asyncHandler(async (req, res) => {
  const { bill, alreadyExisted } = await billingService.createBill(
    req.businessId,
    req.businessType,
    req.user.id,
    req.body
  );

  return alreadyExisted
    ? success(res, { bill: bill.toSafeJSON() }, 'Bill already exists (idempotent retry)')
    : created(res, { bill: bill.toSafeJSON() }, 'Bill created');
});

const listBills = asyncHandler(async (req, res) => {
  const data = await billingService.listBills(req.businessId, req.query);
  return success(res, data, 'Bills retrieved');
});

const getBill = asyncHandler(async (req, res) => {
  const bill = await billingService.getBill(req.businessId, req.params.id);
  return success(res, { bill: bill.toSafeJSON() }, 'Bill retrieved');
});

const reprintBill = asyncHandler(async (req, res) => {
  const bill = await billingService.reprintBill(req.businessId, req.params.id);
  return success(res, { bill: bill.toSafeJSON() }, 'Reprint recorded');
});

/**
 * DELETE /api/bills/:id
 * Voids the bill (soft cancel) and restores stock. Not a hard delete: the
 * historical record and unique invoice number are preserved for audit.
 */
const deleteBill = asyncHandler(async (req, res) => {
  const bill = await billingService.voidBill(
    req.businessId,
    req.user.id,
    req.params.id,
    req.body?.reason || ''
  );
  return success(res, { bill: bill.toSafeJSON() }, 'Bill voided');
});

/**
 * DELETE /api/bills/:id/permanent
 * Permanently removes the bill and its stock-ledger trail (restoring stock for an
 * active bill). Audit-preserving void is the recommended path; this is cleanup.
 */
const permanentDeleteBill = asyncHandler(async (req, res) => {
  const bill = await billingService.permanentlyDeleteBill(
    req.businessId,
    req.user.id,
    req.params.id
  );
  return success(res, { deleted: true, invoiceNumber: bill.invoiceNumber }, 'Bill permanently deleted');
});

module.exports = { createBill, listBills, getBill, deleteBill, reprintBill, permanentDeleteBill };