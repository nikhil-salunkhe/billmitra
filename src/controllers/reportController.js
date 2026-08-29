'use strict';

const { success } = require('../utils/ApiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const reportService = require('../services/reportService');
const pdfReportService = require('../services/pdfReportService');
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
 * GET /api/reports/pdf?type=sales|products|payments&period=...
 * Streams a PDF report (ASCII text) for the owner. Bypasses the JSON envelope
 * and returns octet-stream with a Content-Disposition filename.
 */
const pdfReport = asyncHandler(async (req, res) => {
  const type = req.query.type || 'sales';
  const range = reportService.getReportRange(req.query);
  const business = await Business.findById(req.businessId).select('businessName');
  const businessName = business?.businessName || 'Business';

  const isValid = ['sales', 'products', 'payments'].includes(type);
  if (!isValid) throw ApiError.badRequest('Invalid report type', 'INVALID_REPORT_TYPE');

  const periodPretty = req.query.period || 'custom';
  const fromStr = range.start.toISOString().slice(0, 10);
  const toStr = range.end.toISOString().slice(0, 10);
  const periodLabel = `${fromStr} to ${toStr}`;

  let title;
  let headerLines;
  let rows = [];
  let summaryLines = [];

  if (type === 'sales' || type === 'payments') {
    const sales = await reportService.getSalesReport(req.businessId, range, req.query.groupBy || 'day');
    const totals = sales.totals || {};
    title = type === 'sales' ? 'Sales Report' : 'Payment Report';
    headerLines = ['Item', '', 'Amount'];

    if (type === 'sales') {
      rows = [
        ['Gross Sales', '', pdfReportService.fmtAmount(totals.grossSales)],
        ['Discounts', '', pdfReportService.fmtAmount(totals.discount)],
        ['Tax (GST)', '', pdfReportService.fmtAmount(totals.totalTax)],
        ['Net Sales', '', pdfReportService.fmtAmount(totals.netSales)],
      ];
      summaryLines = [
        `Bills: ${pdfReportService.fmtInt(totals.bills)}   Items Sold: ${pdfReportService.fmtInt(totals.itemsSold)}`,
        `Average Bill: ${pdfReportService.fmtAmount(totals.bills ? totals.netSales / totals.bills : 0)}`,
      ];
    } else {
      rows = (sales.byMethod || []).map((m) => [
        String(m.method || 'OTHER'),
        '',
        pdfReportService.fmtAmount(m.amount) + `  (${m.count} bills)`,
      ]);
      if (rows.length === 0) rows.push(['No payments in period', '', 'Rs. 0.00']);
      summaryLines = [
        `Total Bills: ${pdfReportService.fmtInt(totals.bills)}   Net Sales: ${pdfReportService.fmtAmount(totals.netSales)}`,
      ];
    }

    // Time series.
    rows.push(['', '', '']);
    rows.push(['Date / Day', '', 'Net Sales']);
    for (const s of sales.series || []) {
      rows.push([s.label, '', pdfReportService.fmtAmount(s.net)]);
    }
  } else {
    // products
    const topProducts = await reportService.getTopProducts(req.businessId, range, req.query.limit);
    title = 'Top Products Report';
    headerLines = ['Product', 'Qty', 'Revenue'];
    rows = (topProducts || []).map((p) => [p.name, String(p.quantity), pdfReportService.fmtAmount(p.revenue)]);
    if (rows.length === 0) rows.push(['No products sold in this period', '', '']);
  }

  const buf = pdfReportService.buildReportPdf({
    title,
    businessName,
    periodLabel,
    headerLines,
    rows,
    summaryLines,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="billmitra-${type}-report.pdf"`
  );
  return res.send(buf);
});

module.exports = { ownerDashboard, salesReport, productsReport, paymentsReport, pdfReport };
