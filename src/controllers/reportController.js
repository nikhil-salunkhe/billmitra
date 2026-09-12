'use strict';

const { success } = require('../utils/ApiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const reportService = require('../services/reportService');
const pdfReportService = require('../services/pdfReportService');
const { safeFileName } = require('../utils/pdfFormat');
const Bill = require('../models/Bill');
const Business = require('../models/Business');

/**
 * GET /api/reports/dashboard — owner dashboard overview.
 * Tenant-scoped to req.businessId.
 */
const ownerDashboard = asyncHandler(async (req, res) => {
  const data = await reportService.getOwnerDashboard(req.businessId);
  return success(res, data, 'Dashboard retrieved');
});

/**
 * GET /api/reports/sales — totals + payment breakdown + daily/monthly series.
 */
const salesReport = asyncHandler(async (req, res) => {
  const range = reportService.getReportRange(req.query);
  const data = await reportService.getSalesReport(
    req.businessId,
    range,
    req.query.groupBy || 'day'
  );
  return success(res, { period: { from: range.start, to: range.end }, ...data }, 'Sales report');
});

/**
 * GET /api/reports/products — top products by revenue.
 */
const productsReport = asyncHandler(async (req, res) => {
  const range = reportService.getReportRange(req.query);
  const topProducts = await reportService.getTopProducts(req.businessId, range, req.query.limit);
  return success(
    res,
    { period: { from: range.start, to: range.end }, topProducts },
    'Product report'
  );
});

/**
 * GET /api/reports/payments — payment-method breakdown for the range.
 */
const paymentsReport = asyncHandler(async (req, res) => {
  const range = reportService.getReportRange(req.query);
  const data = await reportService.getSalesReport(req.businessId, range);
  return success(
    res,
    {
      period: { from: range.start, to: range.end },
      byMethod: data.byMethod,
      totals: { bills: data.totals.bills, netSales: data.totals.netSales },
    },
    'Payment report'
  );
});

/**
 * GET /api/reports/pdf?type=daily|weekly|monthly|custom&period=...&paper=a4|58|80
 * Streams a professional English PDF report. Bypasses JSON envelope.
 */
const pdfReport = asyncHandler(async (req, res) => {
  // Map UI range keys (today/week/month) to report types (daily/weekly/monthly)
  const typeMap = { today: 'daily', week: 'weekly', month: 'monthly' };
  const rawType = typeMap[req.query.type] || req.query.type || 'daily';
  const type = ['daily', 'weekly', 'monthly', 'custom'].includes(rawType) ? rawType : 'daily';
  const range = reportService.getReportRange(req.query);
  const paper = req.query.paper === '58' || req.query.paper === '80' ? req.query.paper : 'a4';

  const business = await Business.findById(req.businessId).select('businessName phone address city state pincode gstNumber');
  const businessName = business?.businessName || 'Business';
  const businessMeta = [
    [business?.address, [business?.city, business?.state, business?.pincode].filter(Boolean).join(', ')].filter(Boolean).join(', '),
    business?.phone ? `Ph: ${business.phone}` : '',
  ].filter(Boolean).join(' | ');

  const fromStr = range.start.toISOString().slice(0, 10);
  const toStr = range.end.toISOString().slice(0, 10);
  const periodLabel = `${fromStr} to ${toStr}`;
  const metaLabel = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // Fetch data in parallel
  const [sales, topProducts] = await Promise.all([
    reportService.getSalesReport(req.businessId, range, 'day'),
    reportService.getTopProducts(req.businessId, range, 15),
  ]);

  const totals = sales.totals || {};
  const byMethod = sales.byMethod || [];

  // Build payment summary
  const payments = { cash: 0, upi: 0, card: 0, credit: 0 };
  for (const m of byMethod) {
    const key = String(m.method || 'OTHER').toUpperCase();
    if (key === 'CASH') payments.cash += m.amount || 0;
    else if (key === 'UPI') payments.upi += m.amount || 0;
    else if (key === 'CARD' || key === 'CARD_SWIPE' || key === 'CREDIT_CARD' || key === 'DEBIT_CARD') payments.card += m.amount || 0;
    else if (key === 'CREDIT') payments.credit += m.amount || 0;
    else payments.cash += m.amount || 0; // fallback
  }

  // Build summary
  const summary = {
    totalBills: totals.bills || 0,
    totalItems: totals.itemsSold || 0,
    grossSales: totals.grossSales || 0,
    discount: totals.discount || 0,
    taxableSales: (totals.grossSales || 0) - (totals.discount || 0),
    cgst: totals.cgst || 0,
    sgst: totals.sgst || 0,
    igst: totals.igst || 0,
    netSales: totals.netSales || 0,
  };

  // If tax breakdown not in totals, derive from items
  if (!summary.cgst && !summary.sgst && !summary.igst && totals.totalTax) {
    // Assume CGST/SGST split for intra-state
    summary.cgst = Math.round((totals.totalTax / 2) * 100) / 100;
    summary.sgst = totals.totalTax - summary.cgst;
  }

  // Build daily breakdown
  const dailyBreakdown = (sales.series || []).map((s) => ({
    label: s.label,
    bills: s.bills || 0,
    gross: s.gross || s.net || 0,
    discount: s.discount || 0,
    tax: s.tax || 0,
    net: s.net || 0,
  }));

  // RECONCILIATION: Verify summary matches sum of daily breakdown
  const dailySum = dailyBreakdown.reduce((acc, d) => ({
    bills: acc.bills + (d.bills || 0),
    gross: acc.gross + (d.gross || 0),
    discount: acc.discount + (d.discount || 0),
    tax: acc.tax + (d.tax || 0),
    net: acc.net + (d.net || 0),
  }), { bills: 0, gross: 0, discount: 0, tax: 0, net: 0 });

  // Log reconciliation issues in development
  if (process.env.NODE_ENV !== 'production') {
    const tolerance = 0.01;
    if (Math.abs(summary.totalBills - dailySum.bills) > tolerance) {
      console.warn(`[REPORT_RECONCILIATION] Bills mismatch: summary=${summary.totalBills}, daily=${dailySum.bills}`);
    }
    if (Math.abs(summary.netSales - dailySum.net) > tolerance) {
      console.warn(`[REPORT_RECONCILIATION] NetSales mismatch: summary=${summary.netSales}, daily=${dailySum.net}`);
    }
  }

  // Build products list
  const products = (topProducts || []).map((p) => ({
    name: p.name,
    quantity: p.quantity,
    revenue: p.revenue,
  }));

  const pdfData = {
    type,
    businessName,
    businessMeta,
    periodLabel,
    metaLabel,
    summary,
    payments,
    products,
    dailyBreakdown,
  };

  const buf = paper === 'a4'
    ? await pdfReportService.buildReportPdf(pdfData)
    : await pdfReportService.buildThermalReportPdf({
        title: type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ') + ' Report',
        businessName,
        periodLabel,
        summary,
        payments,
        dailyBreakdown,
      });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="billmitra-${safeFileName(type)}-report${paper === 'a4' ? '' : '-' + paper + 'mm'}.pdf"`);
  return res.send(buf);
});

/**
 * GET /api/reports/bill-pdf/:billId?paper=a4|58
 * Streams a professional English PDF bill/invoice for a specific bill.
 */
const billPdf = asyncHandler(async (req, res) => {
  const paper = req.query.paper === '58' || req.query.paper === '80' ? req.query.paper : 'a4';
  const bill = await Bill.findOne({ _id: req.params.billId, businessId: req.businessId });
  if (!bill) throw ApiError.notFound('Bill not found', 'BILL_NOT_FOUND');

  const business = await Business.findById(req.businessId).select('businessName phone address city state pincode gstNumber');
  const billData = bill.toSafeJSON ? bill.toSafeJSON() : bill;

  const buf = paper === 'a4'
    ? await pdfReportService.buildBillPdf(billData, business)
    : await pdfReportService.buildReceiptPdf(billData, business);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="billmitra-invoice-${safeFileName(billData.billNumber || billData.invoiceNumber)}${paper === 'a4' ? '' : '-' + paper + 'mm'}.pdf"`);
  return res.send(buf);
});

module.exports = { ownerDashboard, salesReport, productsReport, paymentsReport, pdfReport, billPdf };