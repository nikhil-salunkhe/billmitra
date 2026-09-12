'use strict';

/**
 * Production PDF generator - English only.
 * Four document types: 58mm receipt, A4 bill, A4 report, thermal report.
 * Uses pdfkit (pure JS, works on Render/Linux).
 * DejaVuSans / DejaVuSans-Bold TTFs are registered on every document.
 */

var fs = require('fs');
var path = require('path');
const PDFDocument = require('pdfkit');
const { formatCurrency, formatQuantity, formatDate, formatTime, amountToWords } = require('../utils/pdfFormat');

const MM = (mm) => mm * 2.83465;
const PAGE = {
  RECEIPT: { width: MM(58), margins: { top: 3, bottom: 3, left: 3, right: 3 } },
  A4: { width: MM(210), height: MM(297), margins: { top: 15, bottom: 15, left: 15, right: 15 } },
};
const C = { black: '#000000', dark: '#1F2937', medium: '#4B5563', light: '#9CA3AF', line: '#D1D5DB', accent: '#2563EB', grandBg: '#F3F4F6', voidBg: '#FEF2F2', voidText: '#DC2626', headerBg: '#F8F9FA' };

var _FONT_DIR = path.join(__dirname, '..', 'utils', 'fonts');
var _FONT_REGULAR = 'DejaVuSans';
var _FONT_BOLD = 'DejaVuSans-Bold';
var _fontRegPath = null;
var _fontBoldPath = null;
function _resolveFonts() {
  if (_fontRegPath) return;
  var r = path.join(_FONT_DIR, _FONT_REGULAR + '.ttf');
  var b = path.join(_FONT_DIR, _FONT_BOLD + '.ttf');
  if (fs.existsSync(r)) _fontRegPath = r;
  if (fs.existsSync(b)) _fontBoldPath = b;
}

function _newDoc(opts) {
  _resolveFonts();
  var doc = new PDFDocument(opts);
  if (_fontRegPath) doc.registerFont(_FONT_REGULAR, _fontRegPath);
  if (_fontBoldPath) doc.registerFont(_FONT_BOLD, _fontBoldPath);
  return doc;
}

function drawLine(doc, x1, y1, x2, y2, color, width) { doc.save().strokeColor(color || C.line).lineWidth(width || 0.5).moveTo(x1, y1).lineTo(x2, y2).stroke().restore(); }
function drawDashedLine(doc, x1, y1, x2, y2, color) { doc.save().strokeColor(color || C.line).lineWidth(0.5).dash(2, { space: 2 }).moveTo(x1, y1).lineTo(x2, y2).stroke().undash().restore(); }
var _scratch = null;
function measureWidth(text, fontSize) { if (!_scratch) _scratch = _newDoc({ size: [1, 1], margin: 0 }); return _scratch.font(_FONT_REGULAR).fontSize(fontSize).widthOfString(String(text || '')); }
function wrapText(text, fontSize, maxWidth) { var words = String(text || '').split(/\s+/).filter(Boolean); var lines = []; var cur = ''; for (var wi = 0; wi < words.length; wi++) { var w = words[wi]; var test = cur ? cur + ' ' + w : w; if (measureWidth(test, fontSize) <= maxWidth) { cur = test; } else { if (cur) lines.push(cur); cur = w.length > 20 ? w.slice(0, 20) : w; } } if (cur) lines.push(cur); return lines.length ? lines : ['']; }

function _calcReceiptHeight(bill, business) {
  var fs = 7;
  var h = 0;
  h += 11; // shop name
  if (business && business.address) h += 9;
  if (business && business.phone) h += 9;
  if (business && business.gstNumber) h += 9;
  h += 2 + 4; // dashed line
  h += 11; // TAX INVOICE
  h += 2 + 4; // dashed line
  h += 9; // Bill No
  h += 9; // Date
  h += 9; // Time
  if (bill.customerName) h += 9;
  if (bill.customerPhone) h += 9;
  h += 2 + 4; // dashed line
  var items = Array.isArray(bill.items) ? bill.items : [];
  for (var i = 0; i < items.length; i++) {
    var nameLines = wrapText(items[i].name || '', fs, MM(58) - 6);
    h += 8.5 * nameLines.length;
    h += 8.5; // qty
    h += 8.5; // rate
    h += 9; // amount
  }
  if (items.length) h += 10;
  h += 2 + 4; // dashed line
  h += 10; // subtotal
  h += 10; // discount
  h += 10; // CGST
  h += 10; // SGST
  h += 12; // TOTAL
  if (bill.notes) { h += 2 + 4 + 9; }
  h += 4 + 8 + 8; // footer
  h += 6; // bottom margin
  return Math.max(h, MM(50)); // minimum 50mm
}

function buildReceiptPdf(bill, business) {
  var fs = 7;
  var h = _calcReceiptHeight(bill, business);
  var doc = _newDoc({ size: [PAGE.RECEIPT.width, h], margin: 0, bufferPages: true });
  var chunks = [];
  doc.on('data', function (c) { chunks.push(c); });
  var x = PAGE.RECEIPT.margins.left;
  var y = PAGE.RECEIPT.margins.top;
  var w = PAGE.RECEIPT.width - PAGE.RECEIPT.margins.left - PAGE.RECEIPT.margins.right;

  doc.font(_FONT_BOLD).fontSize(9).fillColor(C.black).text(business && business.businessName || 'Business', x, y, { width: w, align: 'center', characterSpacing: 0.5 });
  y += 11;
  if (business && business.address) { doc.font(_FONT_REGULAR).fontSize(fs).fillColor(C.medium).text(business.address, x, y, { width: w, align: 'center' }); y += 9; }
  if (business && business.phone) { doc.text('Ph: ' + business.phone, x, y, { width: w, align: 'center' }); y += 9; }
  if (business && business.gstNumber) { doc.text('GSTIN: ' + business.gstNumber, x, y, { width: w, align: 'center' }); y += 9; }

  y += 2;
  drawDashedLine(doc, x, y, x + w, y, C.light);
  y += 4;
  doc.font(_FONT_BOLD).fontSize(8).fillColor(C.black).text('TAX INVOICE', x, y, { width: w, align: 'center' });
  y += 11;
  drawDashedLine(doc, x, y, x + w, y, C.light);
  y += 5;

  doc.font(_FONT_REGULAR).fontSize(fs).fillColor(C.dark);
  var billNo = bill.billNumber || bill.invoiceNumber || '';
  doc.text('Bill No: ' + billNo, x, y, { width: w }); y += 9;
  doc.text('Date: ' + formatDate(bill.createdAt), x, y, { width: w }); y += 9;
  doc.text('Time: ' + formatTime(bill.createdAt), x, y, { width: w }); y += 9;
  if (bill.customerName) { doc.text('Customer: ' + bill.customerName, x, y, { width: w }); y += 9; }
  if (bill.customerPhone) { doc.text('Mobile: ' + bill.customerPhone, x, y, { width: w }); y += 9; }

  y += 2;
  drawDashedLine(doc, x, y, x + w, y, C.light);
  y += 5;

  var items = Array.isArray(bill.items) ? bill.items : [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var nameLines = wrapText(it.name || '', fs, w);
    for (var nl = 0; nl < nameLines.length; nl++) { doc.font(_FONT_REGULAR).fontSize(fs).fillColor(C.dark).text(nameLines[nl], x, y, { width: w }); y += 8.5; }
    doc.font(_FONT_REGULAR).fontSize(fs).fillColor(C.medium).text(formatQuantity(it.quantity) + ' ' + (it.unit || 'PCS'), x, y, { width: w }); y += 8.5;
    doc.font(_FONT_REGULAR).fontSize(fs).fillColor(C.dark).text(formatCurrency(it.unitPrice), x, y, { width: w }); y += 8.5;
    doc.font(_FONT_REGULAR).fontSize(fs).fillColor(C.dark).text(formatCurrency(it.lineAmount), x, y, { width: w, align: 'right' }); y += 9;
  }
  if (items.length) { y += 1; doc.font(_FONT_REGULAR).fontSize(fs).fillColor(C.medium).text('Items: ' + items.length, x, y, { width: w }); y += 9; }

  y += 2;
  drawDashedLine(doc, x, y, x + w, y, C.light);
  y += 5;

  var bold = function (fz, color) { doc.font(_FONT_BOLD).fontSize(fz || 9).fillColor(color || C.dark); };
  var reg = function (fz, color) { doc.font(_FONT_REGULAR).fontSize(fz || fs).fillColor(color || C.dark); };
  var totalW = w / 2;
  bold(10); doc.text('Subtotal:', x, y, { width: totalW }); reg(); doc.text(formatCurrency(bill.subtotal || 0), x + totalW, y, { width: totalW, align: 'right' }); y += 10;
  bold(10); doc.text('Discount:', x, y, { width: totalW }); reg(); doc.text(formatCurrency(bill.discount || 0), x + totalW, y, { width: totalW, align: 'right' }); y += 10;
  bold(10); doc.text('CGST:', x, y, { width: totalW }); reg(); doc.text(formatCurrency(bill.cgst || 0), x + totalW, y, { width: totalW, align: 'right' }); y += 10;
  bold(10); doc.text('SGST:', x, y, { width: totalW }); reg(); doc.text(formatCurrency(bill.sgst || 0), x + totalW, y, { width: totalW, align: 'right' }); y += 10;
  bold(11, C.accent); doc.text('TOTAL:', x, y, { width: totalW }); doc.font(_FONT_BOLD).fontSize(11).fillColor(C.accent).text(formatCurrency(bill.grandTotal || 0), x + totalW, y, { width: totalW, align: 'right' }); y += 12;

  if (bill.notes) {
    y += 2;
    drawDashedLine(doc, x, y, x + w, y, C.light);
    y += 4;
    var noteLines = wrapText(bill.notes, fs, w);
    for (var ni = 0; ni < noteLines.length; ni++) { doc.font(_FONT_REGULAR).fontSize(fs).fillColor(C.dark).text(noteLines[ni], x, y, { width: w }); y += 8.5; }
  }

  y += 4;
  doc.font(_FONT_REGULAR).fontSize(fs).fillColor(C.medium).text('Thank you! Visit Again.', x, y, { width: w, align: 'center' });
  y += 8;
  doc.font(_FONT_REGULAR).fontSize(6).fillColor(C.light).text('Powered by BillMitra', x, y, { width: w, align: 'center' });

  doc.end();
  return new Promise(function (resolve, reject) { doc.on('end', function () { resolve(Buffer.concat(chunks)); }); doc.on('error', reject); });
}
function buildBillPdf(_a1, _a2) {
  var _norm = _a2 ? { business: _a2, bill: _a1, lang: "both" } : (_a1 && _a1.business ? _a1 : { business: null, bill: _a1, lang: "both" });
  var bill = _norm.bill;
  var business = _norm.business;
  var lang = _norm.lang || "both";

  var doc = _newDoc({ size: [PAGE.A4.width, PAGE.A4.height], margin: 0, bufferPages: true });
  var chunks = [];
  doc.on('data', function (c) { chunks.push(c); });
  var p = PAGE.A4;
  var x = p.margins.left;
  var y = p.margins.top;
  var w = p.width - p.margins.left - p.margins.right;

  if (bill.isVoided) {
    doc.save().fillColor(C.voidBg).rect(x, y, w, 22).fill().restore();
    doc.font(_FONT_BOLD).fontSize(10).fillColor(C.voidText).text('VOIDED - This bill has been cancelled.', x + 4, y + 6, { width: w - 8 });
    y += 26;
  }

  var halfW = w / 2 - 5;
  doc.font(_FONT_BOLD).fontSize(16).fillColor(C.dark).text(business && business.businessName || 'Business', x, y, { width: halfW });
  var by = y + 20;
  doc.font(_FONT_REGULAR).fontSize(8).fillColor(C.medium);
  if (business && business.address) { doc.text(business.address, x, by, { width: halfW }); by += 10; }
  if (business && (business.city || business.state)) { doc.text([business.city, business.state, business.pincode].filter(Boolean).join(', '), x, by, { width: halfW }); by += 10; }
  if (business && business.phone) { doc.text('Ph: ' + business.phone, x, by, { width: halfW }); by += 10; }
  if (business && business.gstNumber) { doc.text('GSTIN: ' + business.gstNumber, x, by, { width: halfW }); by += 10; }

  var hasGst = business && business.gstNumber && Number(bill.totalTax || 0) > 0;
  doc.font(_FONT_BOLD).fontSize(18).fillColor(C.accent).text(hasGst ? 'TAX INVOICE' : 'BILL', x + halfW + 10, y, { width: halfW, align: 'right' });
  doc.font(_FONT_REGULAR).fontSize(9).fillColor(C.medium);
  var billNo = bill.billNumber || bill.invoiceNumber || '';
  doc.text((hasGst ? 'Invoice' : 'Bill') + ' No: ' + billNo, x + halfW + 10, y + 22, { width: halfW, align: 'right' });
  doc.text('Date: ' + formatDate(bill.createdAt), x + halfW + 10, y + 34, { width: halfW, align: 'right' });
  doc.text('Time: ' + formatTime(bill.createdAt), x + halfW + 10, y + 46, { width: halfW, align: 'right' });

  y = Math.max(by, y + 60) + 5;
  drawLine(doc, x, y, x + w, y, C.accent, 1);
  y += 10;

  if (bill.customerName || bill.customerPhone) {
    doc.font(_FONT_REGULAR).fontSize(9).fillColor(C.dark);
    if (bill.customerName) doc.text('Customer: ' + bill.customerName, x, y, { width: w * 0.6 });
    if (bill.customerPhone) doc.text('Mobile: ' + bill.customerPhone, x + w * 0.6, y, { width: w * 0.4, align: 'right' });
    y += 14;
  }

  var items = Array.isArray(bill.items) ? bill.items : [];
  var showGst = Number(bill.totalTax || 0) > 0;
  var cols = showGst
    ? [{ key: '#', w: 0.06, align: 'center' }, { key: 'Item', w: 0.30 }, { key: 'Qty', w: 0.08, align: 'center' }, { key: 'Rate', w: 0.12, align: 'right' }, { key: 'Disc', w: 0.10, align: 'right' }, { key: 'Taxable', w: 0.12, align: 'right' }, { key: 'GST', w: 0.08, align: 'center' }, { key: 'Amount', w: 0.14, align: 'right' }]
    : [{ key: '#', w: 0.06, align: 'center' }, { key: 'Item', w: 0.40 }, { key: 'Qty', w: 0.10, align: 'center' }, { key: 'Rate', w: 0.14, align: 'right' }, { key: 'Disc', w: 0.12, align: 'right' }, { key: 'Amount', w: 0.18, align: 'right' }];

  var th = 16;
  doc.save().fillColor(C.headerBg).rect(x, y, w, th).fill().restore();
  doc.font(_FONT_BOLD).fontSize(7.5).fillColor(C.dark);
  var cx = x;
  for (var ci = 0; ci < cols.length; ci++) { doc.text(cols[ci].key, cx + 2, y + 4, { width: w * cols[ci].w - 4 }); cx += w * cols[ci].w; }
  y += th;
  drawLine(doc, x, y, x + w, y, C.line);
  doc.font(_FONT_REGULAR).fontSize(8).fillColor(C.dark);

  for (var ii = 0; ii < items.length; ii++) {
    var it = items[ii];
    var nameLines = wrapText(it.name || '', _FONT_REGULAR, 8, w * (showGst ? 0.30 : 0.40) - 6);
    var rowH = Math.max(14, nameLines.length * 9 + 4);
    if (y + rowH > p.height - p.margins.bottom - 40) {
      doc.addPage({ size: [p.width, p.height], margin: 0 }); y = p.margins.top;
      doc.save().fillColor(C.headerBg).rect(x, y, w, th).fill().restore();
      doc.font(_FONT_BOLD).fontSize(7.5).fillColor(C.dark);
      cx = x;
      for (var cj = 0; cj < cols.length; cj++) { doc.text(cols[cj].key, cx + 2, y + 4, { width: w * cols[cj].w - 4 }); cx += w * cols[cj].w; }
      y += th; drawLine(doc, x, y, x + w, y, C.line);
      doc.font(_FONT_REGULAR).fontSize(8).fillColor(C.dark);
    }
    cx = x;
    var rowY = y + 3;
    if (showGst) {
      doc.text(String(ii + 1), cx, rowY, { width: w * 0.06, align: 'center' }); cx += w * 0.06;
      doc.text(nameLines[0] || '', cx + 2, rowY, { width: w * 0.30 - 4 }); cx += w * 0.30;
      if (nameLines.length > 1) doc.text(nameLines[1] || '', cx - w * 0.30 + 2, rowY + 9, { width: w * 0.30 - 4 });
      doc.text(formatQuantity(it.quantity), cx, rowY, { width: w * 0.08, align: 'center' }); cx += w * 0.08;
      doc.text(formatCurrency(it.unitPrice), cx, rowY, { width: w * 0.12, align: 'right' }); cx += w * 0.12;
      var itDisc = Number(it.discount || 0);
      doc.text(itDisc > 0 ? formatCurrency(itDisc) : '-', cx, rowY, { width: w * 0.10, align: 'right' }); cx += w * 0.10;
      doc.text(formatCurrency(it.lineAmount), cx, rowY, { width: w * 0.12, align: 'right' }); cx += w * 0.12;
      doc.text((it.taxRate || 0) + '%', cx, rowY, { width: w * 0.08, align: 'center' }); cx += w * 0.08;
      doc.text(formatCurrency(it.lineAmount), cx, rowY, { width: w * 0.14, align: 'right' });
    } else {
      doc.text(String(ii + 1), cx, rowY, { width: w * 0.06, align: 'center' }); cx += w * 0.06;
      doc.text(nameLines[0] || '', cx + 2, rowY, { width: w * 0.40 - 4 }); cx += w * 0.40;
      if (nameLines.length > 1) doc.text(nameLines[1] || '', cx - w * 0.40 + 2, rowY + 9, { width: w * 0.40 - 4 });
      doc.text(formatQuantity(it.quantity), cx, rowY, { width: w * 0.10, align: 'center' }); cx += w * 0.10;
      doc.text(formatCurrency(it.unitPrice), cx, rowY, { width: w * 0.14, align: 'right' }); cx += w * 0.14;
      var itDisc2 = Number(it.discount || 0);
      doc.text(itDisc2 > 0 ? formatCurrency(itDisc2) : '-', cx, rowY, { width: w * 0.12, align: 'right' }); cx += w * 0.12;
      doc.text(formatCurrency(it.lineAmount), cx, rowY, { width: w * 0.18, align: 'right' });
    }
    y += rowH;
    drawLine(doc, x, y, x + w, y, C.line, 0.3);
  }

  y += 5;
  if (y > p.height - p.margins.bottom - 80) { doc.addPage({ size: [p.width, p.height], margin: 0 }); y = p.margins.top; }
  var totX = x + w * 0.55;
  var totW = w * 0.45;
  var totRight = x + w;

  var drawTotalRow = function (label, value, opts) {
    opts = opts || {};
    var fs = opts.sz || 9;
    if (opts.bg) { doc.save().fillColor(opts.bg).rect(totX - 2, y - 1, totW + 4, fs + 4).fill().restore(); }
    doc.font(opts.bold ? _FONT_BOLD : _FONT_REGULAR).fontSize(fs).fillColor(opts.color || C.dark);
    doc.text(label, totX, y, { width: totW * 0.55 });
    doc.text(value, totX + totW * 0.55, y, { width: totW * 0.45, align: 'right' });
    y += (opts.bold ? fs + 5 : fs + 4);
  };

  drawTotalRow('Subtotal', formatCurrency(bill.subtotal));
  var disc2 = Number(bill.discountAmount || bill.discount || 0);
  if (disc2 > 0) { var dLabel = bill.discountType === 'PERCENT' ? 'Discount (' + Number(bill.discount) + '%)' : 'Discount'; drawTotalRow(dLabel, '- ' + formatCurrency(disc2)); }
  if (Number(bill.taxableAmount || 0) > 0) drawTotalRow('Taxable Amount', formatCurrency(bill.taxableAmount));
  var cgst2 = Number(bill.cgst || 0), sgst2 = Number(bill.sgst || 0), igst2 = Number(bill.igst || 0);
  if (cgst2 > 0) drawTotalRow('CGST', formatCurrency(cgst2));
  if (sgst2 > 0) drawTotalRow('SGST', formatCurrency(sgst2));
  if (igst2 > 0) drawTotalRow('IGST', formatCurrency(igst2));
  if (Number(bill.totalTax || 0) > 0) drawTotalRow('Total Tax', formatCurrency(bill.totalTax));

  y += 2;
  var grandTotal = bill.totalAmount || bill.grandTotal || 0;
  drawTotalRow('GRAND TOTAL', formatCurrency(grandTotal), { bold: true, sz: 13, bg: C.grandBg });
  y += 3;
  drawLine(doc, totX, y, totRight, y, C.accent, 1);
  y += 8;

  doc.font(_FONT_REGULAR).fontSize(8).fillColor(C.medium);
  doc.text('Amount in Words: ' + amountToWords(grandTotal), x, y, { width: w });
  y += 14;
  doc.font(_FONT_REGULAR).fontSize(9).fillColor(C.dark);
  doc.text('Payment Mode: ' + (bill.paymentMethod || '-'), x, y, { width: w });
  y += 14;

  var statusLabel = 'PAID', statusColor = '#059669';
  if (bill.isVoided) { statusLabel = 'VOIDED'; statusColor = C.voidText; }
  else if (bill.paymentStatus === 'UNPAID') { statusLabel = 'UNPAID'; statusColor = '#D97706'; }
  doc.font(_FONT_BOLD).fontSize(10).fillColor(statusColor).text(statusLabel, x, y, { width: w });
  y += 18;

  if (y < p.height - p.margins.bottom - 20) {
    drawLine(doc, x, y, x + w, y, C.line);
    y += 6;
    doc.font(_FONT_REGULAR).fontSize(8).fillColor(C.light).text('Thank you for your business!', x, y, { width: w, align: 'center' });
    y += 11;
    doc.text('This is a computer generated invoice.', x, y, { width: w, align: 'center' });
    y += 11;
    doc.font(_FONT_BOLD).fontSize(7).fillColor(C.light).text('Powered by BillMitra', x, y, { width: w, align: 'center' });
  }

  doc.end();
  return new Promise(function (resolve, reject) { doc.on('end', function () { resolve(Buffer.concat(chunks)); }); doc.on('error', reject); });
}
function buildReportPdf(data) {
  var type = data.type || 'daily';
  var doc = _newDoc({ size: [PAGE.A4.width, PAGE.A4.height], margin: 0, bufferPages: true });
  var chunks = [];
  doc.on('data', function (c) { chunks.push(c); });
  var p = PAGE.A4;
  var x = p.margins.left;
  var y = p.margins.top;
  var w = p.width - p.margins.left - p.margins.right;

  var titleMap = { daily: 'DAILY SALES REPORT', weekly: 'WEEKLY SALES REPORT', monthly: 'MONTHLY SALES REPORT', custom: 'SALES REPORT' };
  var title = titleMap[type] || 'SALES REPORT';

  doc.font(_FONT_BOLD).fontSize(16).fillColor(C.dark).text(data.businessName || 'Business', x, y, { width: w });
  y += 20;
  doc.font(_FONT_REGULAR).fontSize(8).fillColor(C.medium);
  if (data.businessMeta) { doc.text(data.businessMeta, x, y, { width: w }); y += 11; }
  y += 3;
  doc.font(_FONT_BOLD).fontSize(14).fillColor(C.accent).text(title, x, y, { width: w });
  y += 18;
  doc.font(_FONT_REGULAR).fontSize(8).fillColor(C.medium);
  doc.text('Period: ' + (data.periodLabel || '-'), x, y, { width: w }); y += 11;
  doc.text('Generated: ' + (data.metaLabel || '-'), x, y, { width: w }); y += 6;
  drawLine(doc, x, y, x + w, y, C.accent, 1);
  y += 10;

  var s = data.summary || {};
  var cardData = [
    { label: 'Total Bills', value: String(s.totalBills || 0) },
    { label: 'Items Sold', value: String(s.totalItems || 0) },
    { label: 'Gross Sales', value: formatCurrency(s.grossSales) },
    { label: 'Discount', value: formatCurrency(s.discount) },
    { label: 'Taxable Sales', value: formatCurrency(s.taxableSales) },
    { label: 'CGST', value: formatCurrency(s.cgst) },
    { label: 'SGST', value: formatCurrency(s.sgst) },
    { label: 'IGST', value: formatCurrency(s.igst) },
    { label: 'Net Sales', value: formatCurrency(s.netSales), bold: true },
  ];

  var cardW = (w - 16) / 3;
  var cardH = 28;
  for (var i = 0; i < cardData.length; i++) {
    var col = i % 3;
    var row = Math.floor(i / 3);
    var cxx = x + col * (cardW + 8);
    var cyy = y + row * (cardH + 6);
    doc.save().fillColor(C.headerBg).rect(cxx, cyy, cardW, cardH).fill().restore();
    doc.save().strokeColor(C.line).lineWidth(0.5).rect(cxx, cyy, cardW, cardH).stroke().restore();
    var cd = cardData[i];
    doc.font(cd.bold ? _FONT_BOLD : _FONT_REGULAR).fontSize(7).fillColor(C.medium).text(cd.label, cxx + 5, cyy + 4, { width: cardW - 10 });
    doc.font(_FONT_BOLD).fontSize(cd.bold ? 12 : 10).fillColor(cd.bold ? C.accent : C.dark).text(cd.value, cxx + 5, cyy + 14, { width: cardW - 10 });
  }
  y += Math.ceil(cardData.length / 3) * (cardH + 6) + 8;

  if (data.payments && (data.payments.cash || data.payments.upi || data.payments.card || data.payments.credit)) {
    doc.font(_FONT_BOLD).fontSize(10).fillColor(C.dark).text('Payment Summary', x, y, { width: w });
    y += 15;
    var payCols = [{ label: 'Cash', value: data.payments.cash || 0 }, { label: 'UPI', value: data.payments.upi || 0 }, { label: 'Card', value: data.payments.card || 0 }, { label: 'Credit', value: data.payments.credit || 0 }].filter(function (p) { return p.value > 0; });
    if (payCols.length) {
      var pw = w / payCols.length;
      doc.save().fillColor(C.headerBg).rect(x, y, w, 14).fill().restore();
      doc.font(_FONT_BOLD).fontSize(7.5).fillColor(C.dark);
      for (var pi = 0; pi < payCols.length; pi++) doc.text(payCols[pi].label, x + pi * pw + 3, y + 3, { width: pw - 6, align: 'center' });
      y += 14;
      doc.font(_FONT_BOLD).fontSize(9).fillColor(C.accent);
      for (var pj = 0; pj < payCols.length; pj++) doc.text(formatCurrency(payCols[pj].value), x + pj * pw + 3, y + 2, { width: pw - 6, align: 'center' });
      y += 16;
    }
    y += 5;
  }

  var th = 14;
  if (data.dailyBreakdown && data.dailyBreakdown.length) {
    if (y > p.height - p.margins.bottom - 60) { doc.addPage({ size: [p.width, p.height], margin: 0 }); y = p.margins.top; }
    doc.font(_FONT_BOLD).fontSize(10).fillColor(C.dark).text('Daily Breakdown', x, y, { width: w });
    y += 15;
    var tCols = [{ key: 'Date', w: 0.18 }, { key: 'Bills', w: 0.10, align: 'center' }, { key: 'Items', w: 0.10, align: 'center' }, { key: 'Gross', w: 0.16, align: 'right' }, { key: 'Discount', w: 0.14, align: 'right' }, { key: 'Tax', w: 0.14, align: 'right' }, { key: 'Net Sales', w: 0.18, align: 'right' }];
    doc.save().fillColor(C.headerBg).rect(x, y, w, th).fill().restore();
    doc.font(_FONT_BOLD).fontSize(7.5).fillColor(C.dark);
    var tcx = x;
    for (var tc = 0; tc < tCols.length; tc++) { doc.text(tCols[tc].key, tcx + 2, y + 3, { width: w * tCols[tc].w - 4 }); tcx += w * tCols[tc].w; }
    y += th; drawLine(doc, x, y, x + w, y, C.line);
    for (var di = 0; di < data.dailyBreakdown.length; di++) {
      var row = data.dailyBreakdown[di];
      if (y > p.height - p.margins.bottom - 20) { doc.addPage({ size: [p.width, p.height], margin: 0 }); y = p.margins.top; doc.save().fillColor(C.headerBg).rect(x, y, w, th).fill().restore(); doc.font(_FONT_BOLD).fontSize(7.5).fillColor(C.dark); tcx = x; for (var tc2 = 0; tc2 < tCols.length; tc2++) { doc.text(tCols[tc2].key, tcx + 2, y + 3, { width: w * tCols[tc2].w - 4 }); tcx += w * tCols[tc2].w; } y += th; drawLine(doc, x, y, x + w, y, C.line); }
      if (di % 2 === 1) { doc.save().fillColor('#FAFAFA').rect(x, y, w, 12).fill().restore(); }
      doc.font(_FONT_REGULAR).fontSize(7.5).fillColor(C.dark);
      tcx = x;
      doc.text(row.label || '', tcx, y + 2, { width: w * 0.18 - 2 }); tcx += w * 0.18;
      doc.text(String(row.bills || 0), tcx, y + 2, { width: w * 0.10, align: 'center' }); tcx += w * 0.10;
      doc.text(String(row.items || 0), tcx, y + 2, { width: w * 0.10, align: 'center' }); tcx += w * 0.10;
      doc.text(formatCurrency(row.gross || 0), tcx, y + 2, { width: w * 0.16, align: 'right' }); tcx += w * 0.16;
      doc.text(formatCurrency(row.discount || 0), tcx, y + 2, { width: w * 0.14, align: 'right' }); tcx += w * 0.14;
      doc.text(formatCurrency(row.tax || 0), tcx, y + 2, { width: w * 0.14, align: 'right' }); tcx += w * 0.14;
      doc.text(formatCurrency(row.net || 0), tcx, y + 2, { width: w * 0.18, align: 'right' });
      y += 12;
    }
    y += 8;
  }

  if (data.products && data.products.length) {
    if (y > p.height - p.margins.bottom - 60) { doc.addPage({ size: [p.width, p.height], margin: 0 }); y = p.margins.top; }
    doc.font(_FONT_BOLD).fontSize(10).fillColor(C.dark).text('Product Performance', x, y, { width: w });
    y += 15;
    var pCols = [{ key: '#', w: 0.06, align: 'center' }, { key: 'Product', w: 0.54 }, { key: 'Qty Sold', w: 0.16, align: 'right' }, { key: 'Revenue', w: 0.24, align: 'right' }];
    doc.save().fillColor(C.headerBg).rect(x, y, w, th).fill().restore();
    doc.font(_FONT_BOLD).fontSize(7.5).fillColor(C.dark);
    var pcx = x;
    for (var pc = 0; pc < pCols.length; pc++) { doc.text(pCols[pc].key, pcx + 2, y + 3, { width: w * pCols[pc].w - 4 }); pcx += w * pCols[pc].w; }
    y += th; drawLine(doc, x, y, x + w, y, C.line);
    for (var pp = 0; pp < data.products.length; pp++) {
      var prod = data.products[pp];
      if (y > p.height - p.margins.bottom - 20) { doc.addPage({ size: [p.width, p.height], margin: 0 }); y = p.margins.top; doc.save().fillColor(C.headerBg).rect(x, y, w, th).fill().restore(); doc.font(_FONT_BOLD).fontSize(7.5).fillColor(C.dark); pcx = x; for (var pc2 = 0; pc2 < pCols.length; pc2++) { doc.text(pCols[pc2].key, pcx + 2, y + 3, { width: w * pCols[pc2].w - 4 }); pcx += w * pCols[pc2].w; } y += th; drawLine(doc, x, y, x + w, y, C.line); }
      if (pp % 2 === 1) { doc.save().fillColor('#FAFAFA').rect(x, y, w, 12).fill().restore(); }
      doc.font(_FONT_REGULAR).fontSize(7.5).fillColor(C.dark);
      pcx = x;
      doc.text(String(pp + 1), pcx, y + 2, { width: w * 0.06, align: 'center' }); pcx += w * 0.06;
      doc.text(prod.name || '', pcx + 2, y + 2, { width: w * 0.54 - 4 }); pcx += w * 0.54;
      doc.text(formatQuantity(prod.quantity), pcx, y + 2, { width: w * 0.16, align: 'right' }); pcx += w * 0.16;
      doc.text(formatCurrency(prod.revenue), pcx, y + 2, { width: w * 0.24, align: 'right' });
      y += 12;
    }
    y += 8;
  }

  drawLine(doc, x, y, x + w, y, C.line);
  y += 5;
  doc.font(_FONT_REGULAR).fontSize(7).fillColor(C.light).text('Powered by BillMitra', x, y, { width: w, align: 'center' });

  doc.end();
  return new Promise(function (resolve, reject) { doc.on('end', function () { resolve(Buffer.concat(chunks)); }); doc.on('error', reject); });
}
function buildThermalReportPdf(data) {
  var fs = 7;
  var doc = _newDoc({ size: [PAGE.RECEIPT.width, MM(297)], margin: 0, bufferPages: true });
  var chunks = [];
  doc.on('data', function (c) { chunks.push(c); });
  var p = PAGE.RECEIPT;
  var x = p.margins.left;
  var y = p.margins.top;
  var w = p.width - p.margins.left - p.margins.right;

  doc.font(_FONT_BOLD).fontSize(9).fillColor(C.black).text(data.businessName || 'Business', x, y, { width: w, align: 'center' });
  y += 11;
  doc.font(_FONT_BOLD).fontSize(8).fillColor(C.black).text(data.title || 'REPORT', x, y, { width: w, align: 'center' });
  y += 11;
  doc.font(_FONT_REGULAR).fontSize(fs).fillColor(C.medium).text(data.periodLabel || '', x, y, { width: w, align: 'center' });
  y += 10;
  drawDashedLine(doc, x, y, x + w, y, C.light);
  y += 5;

  var s = data.summary || {};
  var row = function (label, val, bold) { doc.font(bold ? _FONT_BOLD : _FONT_REGULAR).fontSize(bold ? 8 : fs).fillColor(C.dark); doc.text(label, x, y, { width: w * 0.6 }); doc.text(val, x + w * 0.6, y, { width: w * 0.4, align: 'right' }); y += bold ? 11 : 9; };
  row('Total Bills', String(s.totalBills || 0));
  row('Items Sold', String(s.totalItems || 0));
  row('Gross Sales', formatCurrency(s.grossSales));
  row('Discount', formatCurrency(s.discount));
  row('Net Sales', formatCurrency(s.netSales), true);
  y += 2;
  drawDashedLine(doc, x, y, x + w, y, C.light);
  y += 5;

  if (data.payments) {
    var payRows = [['Cash', data.payments.cash], ['UPI', data.payments.upi], ['Card', data.payments.card], ['Credit', data.payments.credit]].filter(function (p) { return p[1] > 0; });
    for (var pi = 0; pi < payRows.length; pi++) { row(payRows[pi][0], formatCurrency(payRows[pi][1])); }
  }

  if (data.dailyBreakdown && data.dailyBreakdown.length) {
    y += 2;
    drawDashedLine(doc, x, y, x + w, y, C.light);
    y += 5;
    doc.font(_FONT_BOLD).fontSize(fs).fillColor(C.dark).text('Daily', x, y, { width: w });
    y += 10;
    for (var di = 0; di < data.dailyBreakdown.length; di++) {
      var d = data.dailyBreakdown[di];
      doc.font(_FONT_REGULAR).fontSize(fs).fillColor(C.dark);
      doc.text(d.label || '', x, y, { width: w * 0.5 });
      doc.text(formatCurrency(d.net || 0), x + w * 0.5, y, { width: w * 0.5, align: 'right' });
      y += 9;
    }
  }

  y += 3;
  drawDashedLine(doc, x, y, x + w, y, C.light);
  y += 5;
  doc.font(_FONT_REGULAR).fontSize(6).fillColor(C.light).text('Powered by BillMitra', x, y, { width: w, align: 'center' });

  doc.end();
  return new Promise(function (resolve, reject) { doc.on('end', function () { resolve(Buffer.concat(chunks)); }); doc.on('error', reject); });
}


function buildThermalBillPdf(args) {
  var opts = args || {};
  var bill = opts.bill;
  var business = opts.business || {};
  var widthMm = Number(opts.widthMm) || 58;
  var lang = opts.lang || "both";
  var h = _calcReceiptHeight(opts.bill, opts.business);
  var doc = _newDoc({ size: [MM(widthMm), h], margin: 0, bufferPages: true });
  var chunks = [];
  doc.on("data", function (c) { chunks.push(c); });
  var p = PAGE.RECEIPT;
  var x = p.margins.left;
  var y = p.margins.top;
  var w = p.width - p.margins.left - p.margins.right;
  var fs = 7;
  doc.font(_FONT_BOLD).fontSize(9).fillColor(C.black).text(business && business.businessName || "Business", x, y, { width: w, align: "center" });
  y += 11;
  if (business && business.address) { doc.font(_FONT_REGULAR).fontSize(fs).fillColor(C.medium).text(business.address, x, y, { width: w, align: "center" }); y += 9; }
  if (business && business.phone) { doc.text("Ph: " + business.phone, x, y, { width: w, align: "center" }); y += 9; }
  if (business && business.gstNumber) { doc.text("GSTIN: " + business.gstNumber, x, y, { width: w, align: "center" }); y += 9; }
  y += 2;
  drawDashedLine(doc, x, y, x + w, y, C.light);
  y += 4;
  doc.font(_FONT_BOLD).fontSize(8).fillColor(C.black).text("TAX INVOICE", x, y, { width: w, align: "center" });
  y += 11;
  drawDashedLine(doc, x, y, x + w, y, C.light);
  y += 5;
  doc.font(_FONT_REGULAR).fontSize(fs).fillColor(C.dark);
  var billNo = bill.billNumber || bill.invoiceNumber || "";
  doc.text("Bill No: " + billNo, x, y, { width: w }); y += 9;
  doc.text("Date: " + formatDate(bill.createdAt), x, y, { width: w }); y += 9;
  doc.text("Time: " + formatTime(bill.createdAt), x, y, { width: w }); y += 9;
  if (bill.customerName) { doc.text("Customer: " + bill.customerName, x, y, { width: w }); y += 9; }
  if (bill.customerPhone) { doc.text("Mobile: " + bill.customerPhone, x, y, { width: w }); y += 9; }
  y += 2;
  drawDashedLine(doc, x, y, x + w, y, C.light);
  y += 5;
  var items = Array.isArray(bill.items) ? bill.items : [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var nameLines = wrapText(it.name || "", fs, w);
    for (var nl = 0; nl < nameLines.length; nl++) { doc.font(_FONT_REGULAR).fontSize(fs).fillColor(C.dark).text(nameLines[nl], x, y, { width: w }); y += 8.5; }
    doc.font(_FONT_REGULAR).fontSize(fs).fillColor(C.medium).text(formatQuantity(it.quantity) + " " + (it.unit || "PCS"), x, y, { width: w }); y += 8.5;
    doc.font(_FONT_REGULAR).fontSize(fs).fillColor(C.dark).text(formatCurrency(it.unitPrice), x, y, { width: w }); y += 8.5;
    doc.font(_FONT_REGULAR).fontSize(fs).fillColor(C.dark).text(formatCurrency(it.lineAmount), x, y, { width: w, align: "right" }); y += 9;
  }
  if (items.length) { y += 1; doc.font(_FONT_REGULAR).fontSize(fs).fillColor(C.medium).text("Items: " + items.length, x, y, { width: w }); y += 9; }
  y += 2;
  drawDashedLine(doc, x, y, x + w, y, C.light);
  y += 5;
  var bord = function (fz, color) { doc.font(_FONT_BOLD).fontSize(fz || 9).fillColor(color || C.dark); };
  var regd = function (fz, color) { doc.font(_FONT_REGULAR).fontSize(fz || fs).fillColor(color || C.dark); };
  var totalW = w / 2;
  bord(10); doc.text("Subtotal:", x, y, { width: totalW }); regd(); doc.text(formatCurrency(bill.subtotal || 0), x + totalW, y, { width: totalW, align: "right" }); y += 10;
  bord(10); doc.text("Discount:", x, y, { width: totalW }); regd(); doc.text(formatCurrency(bill.discount || 0), x + totalW, y, { width: totalW, align: "right" }); y += 10;
  bord(10); doc.text("CGST:", x, y, { width: totalW }); regd(); doc.text(formatCurrency(bill.cgst || 0), x + totalW, y, { width: totalW, align: "right" }); y += 10;
  bord(10); doc.text("SGST:", x, y, { width: totalW }); regd(); doc.text(formatCurrency(bill.sgst || 0), x + totalW, y, { width: totalW, align: "right" }); y += 10;
  bord(11, C.accent); doc.text("TOTAL:", x, y, { width: totalW }); doc.font(_FONT_BOLD).fontSize(11).fillColor(C.accent).text(formatCurrency(bill.grandTotal || 0), x + totalW, y, { width: totalW, align: "right" }); y += 12;
  if (bill.notes) { y += 2; drawDashedLine(doc, x, y, x + w, y, C.light); y += 4;
    var noteLines = wrapText(bill.notes, fs, w);
    for (var ni = 0; ni < noteLines.length; ni++) { doc.font(_FONT_REGULAR).fontSize(fs).fillColor(C.dark).text(noteLines[ni], x, y, { width: w }); y += 8.5; }
  }
  y += 4;
  doc.font(_FONT_REGULAR).fontSize(fs).fillColor(C.medium).text("Thank you! Visit Again.", x, y, { width: w, align: "center" });
  y += 8;
  doc.font(_FONT_REGULAR).fontSize(6).fillColor(C.light).text("Powered by BillMitra", x, y, { width: w, align: "center" });
  doc.end();
  return new Promise(function (resolve, reject) { doc.on("end", function () { resolve(Buffer.concat(chunks)); }); doc.on("error", reject); });
}
module.exports = { buildReceiptPdf: buildReceiptPdf, buildBillPdf: buildBillPdf, buildReportPdf: buildReportPdf, buildThermalReportPdf: buildThermalReportPdf, buildThermalBillPdf: buildThermalBillPdf };
