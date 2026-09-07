'use strict';

const { success } = require('../utils/ApiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const reportService = require('../services/reportService');
const pdfReportService = require('../services/pdfReportService');
const Business = require('../models/Business');

/** Valid report languages. */
const PDF_LANGS = ['en', 'mr', 'both'];

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
 * GET /api/reports/pdf?type=sales|products|payments&period=...&lang=en|mr|both
 * Streams a beautiful bilingual (English + Marathi) PDF report for the owner.
 * Bypasses the JSON envelope and returns octet-stream with a Content-Disposition.
 */
const pdfReport = asyncHandler(async (req, res) => {
  const type = req.query.type || 'sales';
  const lang = PDF_LANGS.includes(req.query.lang) ? req.query.lang : 'en';
  const range = reportService.getReportRange(req.query);
  const business = await Business.findById(req.businessId).select('businessName phone address city state pincode');
  const businessName = business?.businessName || 'Business';
  const businessMeta = [
    [business?.address, [business?.city, business?.state, business?.pincode].filter(Boolean).join(' - ')].filter(Boolean).join(', '),
    business?.phone ? `Ph: ${business.phone}` : '',
  ].filter(Boolean).join(' | ');

  const isValid = ['sales', 'products', 'payments'].includes(type);
  if (!isValid) throw ApiError.badRequest('Invalid report type', 'INVALID_REPORT_TYPE');

  const fromStr = range.start.toISOString().slice(0, 10);
  const toStr = range.end.toISOString().slice(0, 10);
  const periodLabel = `${fromStr} to ${toStr}`;
  const metaLabel = new Date().toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const { t, fmtAmount, fmtInt } = pdfReportService;
  let headerLines;
  let rows = [];
  let summaryLines = [];
  let extraSections = [];

  // Product-wise breakdown (name + quantity sold) is included on every report —
  // it is what the shop owner actually needs to review the week.
  const topProducts = await reportService.getTopProducts(req.businessId, range, 15);
  const productRows = (topProducts || []).map((p) => [p.name, fmtInt(p.quantity), fmtAmount(p.revenue)]);
  if (productRows.length > 0) {
    extraSections.push({
      heading: t(lang, 'topProducts'),
      header: [t(lang, 'product'), t(lang, 'qty'), t(lang, 'revenue')],
      rows: productRows,
    });
  }

  if (type === 'sales' || type === 'payments') {
    const sales = await reportService.getSalesReport(req.businessId, range, req.query.groupBy || 'day');
    const totals = sales.totals || {};

    if (type === 'sales') {
      rows = [
        [t(lang, 'grossSales'), '', fmtAmount(totals.grossSales)],
        [t(lang, 'discounts'), '', fmtAmount(totals.discount)],
        [t(lang, 'tax'), '', fmtAmount(totals.totalTax)],
        [t(lang, 'netSales'), '', fmtAmount(totals.netSales)],
        { type: 'separator' },
        [t(lang, 'dateDay'), t(lang, 'bills'), t(lang, 'netSales')],
      ];
      for (const s of sales.series || []) {
        rows.push([s.label, fmtInt(s.bills), fmtAmount(s.net)]);
      }
      summaryLines = [
        `${t(lang, 'bills')}: ${fmtInt(totals.bills)}   ${t(lang, 'itemsSold')}: ${fmtInt(totals.itemsSold)}`,
      ];
      headerLines = [t(lang, 'description'), t(lang, 'bills'), t(lang, 'amount')];
    } else {
      rows = (sales.byMethod || []).map((m) => [
        String(m.method || 'OTHER'),
        `${fmtInt(m.count)} ${t(lang, 'bills')}`,
        fmtAmount(m.amount),
      ]);
      if (rows.length === 0) {
        rows.push([t(lang, 'noPayments'), '', '₹0.00']);
      }
      rows.push({ type: 'separator' });
      rows.push([t(lang, 'dateDay'), t(lang, 'bills'), t(lang, 'netSales')]);
      for (const s of sales.series || []) {
        rows.push([s.label, fmtInt(s.bills), fmtAmount(s.net)]);
      }
      summaryLines = [
        `${t(lang, 'totalBills')}: ${fmtInt(totals.bills)}   ${t(lang, 'netSales')}: ${fmtAmount(totals.netSales)}`,
      ];
      headerLines = [t(lang, 'description'), t(lang, 'bills'), t(lang, 'amount')];
    }
  } else {
    // products
    const topProducts = await reportService.getTopProducts(req.businessId, range, req.query.limit);
    rows = (topProducts || []).map((p) => [p.name, fmtInt(p.quantity), fmtAmount(p.revenue)]);
    if (rows.length === 0) rows.push([t(lang, 'noProducts'), '', '']);
    headerLines = [t(lang, 'product'), t(lang, 'qty'), t(lang, 'revenue')];
  }

  const title =
    type === 'sales'
      ? t(lang, 'salesReport')
      : type === 'payments'
        ? t(lang, 'paymentReport')
        : t(lang, 'topProducts');

  const buf = await pdfReportService.buildReportPdf({
    title,
    businessName,
    businessMeta,
    periodLabel,
    metaLabel,
    headerLines,
    rows,
    summaryLines,
    lang,
    extraSections,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="billmitra-${type}-${lang}-report.pdf"`
  );
  return res.send(buf);
});

module.exports = { ownerDashboard, salesReport, productsReport, paymentsReport, pdfReport };