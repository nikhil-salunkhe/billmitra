'use strict';

const { success, created } = require('../utils/ApiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const billingService = require('../services/billingService');
const pdfReportService = require('../services/pdfReportService');
const Business = require('../models/Business');

/** Valid bill PDF languages. */
const PDF_LANGS = ['en', 'mr', 'both'];

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

/**
 * GET /api/bills/:id/pdf?lang=en|mr|both&paper=a4|58|80
 * Streams a professional bilingual (English + Marathi) TAX INVOICE PDF with
 * product name, quantity, rate, GST% and amount columns plus a clear TOTAL.
 * paper=58 / paper=80 produce thermal receipt-width PDFs (for POS printing or
 * sharing on WhatsApp); paper=a4 (default) produces the full-page invoice.
 * Bypasses the JSON envelope and returns octet-stream with Content-Disposition.
 */
const getBillPdf = asyncHandler(async (req, res) => {
  const lang = PDF_LANGS.includes(req.query.lang) ? req.query.lang : 'both';
  const paper = req.query.paper === '58' || req.query.paper === '80' ? req.query.paper : 'a4';
  const bill = await billingService.getBill(req.businessId, req.params.id);
  const business = await Business.findById(req.businessId).select(
    'businessName addressLine city pincode phone gstNumber'
  );
  const args = {
    business: business ? business.toObject() : {},
    bill: bill.toSafeJSON(),
    lang,
  };
  const buf = paper === 'a4'
    ? await pdfReportService.buildBillPdf(args)
    : await pdfReportService.buildThermalBillPdf({ ...args, widthMm: Number(paper) });
  const safeNo = String(bill.invoiceNumber || 'bill').replace(/[^A-Za-z0-9_-]/g, '');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="billmitra-${safeNo}-${lang}${paper === 'a4' ? '' : '-' + paper + 'mm'}.pdf"`
  );
  return res.send(buf);
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

module.exports = { createBill, listBills, getBill, getBillPdf, deleteBill, reprintBill, permanentDeleteBill };