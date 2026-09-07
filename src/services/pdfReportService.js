'use strict';

/**
 * Beautiful bilingual (English + मराठी) PDF report builder.
 *
 * Primary renderer: headless Microsoft Edge (bundled on Windows) converts a
 * fully-styled HTML report to a PDF. HTML/CSS give us proper Devanagari text
 * shaping (conjuncts + matras), a correct multi-column table, Indian number
 * grouping and a professional look — no binary PDF libraries needed.
 *
 * Fallback renderer: a dependency-free ASCII PDF writer (only used when no
 * Chromium/Edge is found), so the API is resilient on servers without a browser.
 */

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Language strings (English + Marathi). 'both' joins them as "en (मराठी)".
// ---------------------------------------------------------------------------
const T = {
  en: {
    report: 'Report',
    salesReport: 'Sales Report',
    paymentReport: 'Payment Report',
    topProducts: 'Top Products Report',
    period: 'Period',
    generatedOn: 'Generated on',
    description: 'Description',
    details: 'Details',
    amount: 'Amount',
    grossSales: 'Gross Sales',
    discounts: 'Discount',
    tax: 'Tax (GST)',
    netSales: 'Net Sales',
    bills: 'Bills',
    itemsSold: 'Items Sold',
    product: 'Product',
    qty: 'Qty',
    revenue: 'Revenue',
    dateDay: 'Date / Day',
    totalBills: 'Total Bills',
    count: 'Count',
    noPayments: 'No payments in this period',
    noProducts: 'No products sold in this period',
    thisWeek: 'This Week',
    today: 'Today',
    thisMonth: 'This Month',
  },
  mr: {
    report: 'अहवाल',
    salesReport: 'विक्री अहवाल',
    paymentReport: 'पेमेंट अहवाल',
    topProducts: 'सर्वोत्तम उत्पादने अहवाल',
    period: 'कालावधी',
    generatedOn: 'तारीख',
    description: 'वर्णन',
    details: 'तपशील',
    amount: 'रक्कम',
    grossSales: 'एकूण विक्री',
    discounts: 'सूट',
    tax: 'कर (जीएसटी)',
    netSales: 'निव्वळ विक्री',
    bills: 'बिले',
    itemsSold: 'विक्री झालेल्या वस्तू',
    product: 'उत्पादन',
    qty: 'प्रमाण',
    revenue: 'एकूण कमाई',
    dateDay: 'तारीख / दिवस',
    totalBills: 'एकूण बिले',
    count: 'संख्ये',
    noPayments: 'या कालावधीत पेमेंट नाही',
    noProducts: 'या कालावधीत विक्री नाही',
    thisWeek: 'हा आठवडा',
    today: 'आज',
    thisMonth: 'हा महिना',
  },
};

/** Resolve a label for the requested language. */
function t(lang, key) {
  const en = T.en[key] || key;
  const mr = T.mr[key];
  if (!mr || mr === en) return en;
  if (lang === 'mr') return mr;
  if (lang === 'both') return `${en} (${mr})`;
  return en;
}

// ---------------------------------------------------------------------------
// Number formatting (Indian grouping: 1,23,456.78)
// ---------------------------------------------------------------------------
function groupIndian(intStr) {
  if (!intStr) return '0';
  const sign = intStr.startsWith('-') ? '-' : '';
  let rest = intStr.replace('-', '');
  if (rest.length <= 3) return sign + rest;
  const last3 = rest.slice(-3);
  rest = rest.slice(0, -3);
  const parts = [last3];
  while (rest.length > 0) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  return sign + parts.join(',');
}

function fmtAmount(value, symbol = true) {
  const num = Number(value || 0);
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num).toFixed(2);
  const [int, dec] = abs.split('.');
  return `${sign}${symbol ? '₹' : 'Rs. '}${groupIndian(int)}.${dec}`;
}

function fmtInt(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  return groupIndian(String(Math.trunc(n)));
}

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------
function escHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
// ---------------------------------------------------------------------------
// Devanagari font (Mangal) embedded as a data URI so rendering is portable.
// Cached after first read.
// ---------------------------------------------------------------------------
let devanagariFontCss = null;
const FONT_CANDIDATES = [
  'C:\\Windows\\Fonts\\Mangal.ttf',
  'C:\\Windows\\Fonts\\Nirmala.ttf',
  'C:\\Windows\\Fonts\\Aparajita.ttf',
  '/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf',
];

function getDevanagariFontFace() {
  if (devanagariFontCss !== null) return devanagariFontCss;
  for (const candidate of FONT_CANDIDATES) {
    try {
      const bytes = fs.readFileSync(candidate);
      const b64 = Buffer.from(bytes).toString('base64');
      devanagariFontCss = `@font-face{font-family:'Devanagari';src:url(data:font/ttf;base64,${b64}) format('truetype');}`;
      return devanagariFontCss;
    } catch {
      /* try next */
    }
  }
  devanagariFontCss = '';
  return devanagariFontCss;
}

// ---------------------------------------------------------------------------
// Look for a Chromium-family browser (Edge ships on Windows).
// ---------------------------------------------------------------------------
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

let cachedBrowserPath = null;
let browserProbed = false;

function findBrowser() {
  if (browserProbed) return cachedBrowserPath;
  browserProbed = true;
  for (const candidate of EDGE_CANDIDATES) {
    try {
      fs.statSync(candidate);
      cachedBrowserPath = candidate;
      break;
    } catch {
      /* not here */
    }
  }
  return cachedBrowserPath;
}

// ---------------------------------------------------------------------------
// HTML report builder (primary renderer)
// ---------------------------------------------------------------------------
/**
 * rows: array of either a 3-cell array ([c1, c2, c3]) or { type: 'separator' }.
 * The table column widths: description flexible, middle narrow/right-aligned.
 */
function buildReportHtml({ title, businessName, periodLabel, metaLabel, headerLines, rows, summaryLines, lang }) {
  const fontFace = getDevanagariFontFace();
  const header = headerLines || [t(lang, 'description'), t(lang, 'details'), t(lang, 'amount')];

  const bodyRows = (rows || []).map((row) => {
    if (row && typeof row === 'object' && row.type === 'separator') {
      return '<tr class="sep"><td colspan="3"></td></tr>';
    }
    const [a, b, c] = row || [];
    return `<tr><td>${escHtml(a)}</td><td class="mid">${escHtml(b)}</td><td class="amt">${escHtml(c)}</td></tr>`;
  }).join('\n');

  const summaryHtml = (summaryLines || [])
    .map((s) => `<div class="summary-line">${escHtml(s)}</div>`)
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><style>
  ${fontFace}
  @page { size: A4; margin: 14mm 12mm 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Devanagari', 'Segoe UI', 'Noto Sans', Arial, sans-serif; color: #111827; font-size: 10.5px; margin: 0; }
  .brand { font-size: 15px; font-weight: 800; letter-spacing: .3px; }
  .brand span { color: #059669; }
  .head-meta { font-size: 10px; color: #6b7280; margin-top: 1px; }
  .title { font-size: 14px; font-weight: 700; color: #1f2937; margin-top: 8px; }
  .rule { border-bottom: 2px solid #059669; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  thead th { background: #059669; color: #fff; font-weight: 700; padding: 6px 8px; text-align: left; font-size: 10px; }
  thead th.mid, thead th.amt { text-align: right; }
  tbody td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; }
  tbody .amt, tbody .mid { text-align: right; font-variant-numeric: tabular-nums; }
  tbody .mid { color: #374151; }
  tbody tr.sep td { padding: 4px 0; border-bottom: none; }
  tbody tr:last-child td { border-bottom: none; }
  .summary { margin-top: 12px; border-left: 4px solid #059669; background: #f0fdf4; padding: 8px 12px; border-radius: 6px; }
  .summary-line { font-size: 10.5px; font-weight: 600; margin: 0 0 3px 0; }
</style></head><body>
  <div class="brand">Bill<span>Mitra</span> &middot; ${escHtml(t(lang, 'report'))}</div>
  <div class="head-meta">${escHtml(businessName)}</div>
  <div class="head-meta">${escHtml(t(lang, 'period'))}: ${escHtml(periodLabel)} &nbsp;|&nbsp; ${escHtml(t(lang, 'generatedOn'))}: ${escHtml(metaLabel)}</div>
  <div class="title">${escHtml(title)}</div>
  <div class="rule"></div>
  <table>
    <thead><tr><th>${escHtml(header[0])}</th><th class="mid">${escHtml(header[1] || '')}</th><th class="amt">${escHtml(header[2] || '')}</th></tr></thead>
    <tbody>
${bodyRows}
    </tbody>
  </table>
  ${summaryHtml ? `<div class="summary">${summaryHtml}</div>` : ''}
</body></html>`;

  return html;
}
// ---------------------------------------------------------------------------
// Headless-browser PDF renderer
// ---------------------------------------------------------------------------
function cleanupDir(dir) {
  if (!dir) return;
  try {
    // fs.rmSync is available on Node >= 14.14 and removes nested dirs.
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renderHtmlToPdf(html) {
  const browser = findBrowser();
  if (!browser) throw new Error('No Chromium/Edge browser available');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'billmitra-pdf-'));
  const htmlPath = path.join(dir, 'report.html');
  const outPath = path.join(dir, 'report.pdf');
  const profileDir = path.join(dir, 'profile');
  fs.mkdirSync(profileDir, { recursive: true });

  fs.writeFileSync(htmlPath, html, 'utf8');

  const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profileDir}`,
    '--no-pdf-header-footer',
    '--print-background',
    `--print-to-pdf=${outPath}`,
    fileUrl,
  ];

  try {
    await childProcess.execFile(browser, args, { timeout: 120000 });
    // Edge backs the write with a child that may finish AFTER the parent exits.
    // Poll for the output for up to 30s instead of assuming it appears instantly.
    let waited = 0;
    while (!fs.existsSync(outPath) && waited < 30000) {
      await sleepMs(500);
      waited += 500;
    }
    if (!fs.existsSync(outPath)) {
      throw new Error('Browser produced no PDF file (html=' + htmlPath + ' out=' + outPath + ' url=' + fileUrl + ')');
    }
    const buf = Buffer.from(fs.readFileSync(outPath));
    cleanupDir(dir);
    return buf;
  } catch (e) {
    console.error('[pdfReportService] renderHtmlToPdf error:', e && e.message ? e.message : e);
    cleanupDir(dir);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Minimal ASCII fallback PDF (kept for servers without a browser).
// Renders a correct multi-column layout using Helvetica.
// ---------------------------------------------------------------------------
function escapeText(value) {
  return String(value ?? '')
    .replace(/\u20B9/g, 'Rs. ')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildAsciiPdfFallback({ businessName, periodLabel, rows }) {
  const W = 612;
  const H = 792;
  const leftX = 48;
  const col2X = 320;
  const rightX = W - 48;
  const topY = 760;
  const lineH = 15;

  const content = [];
  content.push(`BT /F2 16 Tf ${leftX} ${topY} Td (BillMitra Report) Tj ET`);
  content.push(`BT /F2 12 Tf ${leftX} ${topY - 22} Td (${escapeText(businessName)}) Tj ET`);
  content.push(`BT /F1 10 Tf ${leftX} ${topY - 40} Td (Period: ${escapeText(periodLabel)}) Tj ET`);
  content.push('q 48 ' + (topY - 50) + ' 516 0.6 re f Q');

  let y = topY - 66;
  for (const row of rows || []) {
    if (row && typeof row === 'object' && row.type === 'separator') {
      y -= 8;
      continue;
    }
    const [a, b, c] = row || [];
    if (y < 60) break;
    content.push(`BT /F1 10 Tf ${leftX} ${y} Td (${escapeText(a)}) Tj ET`);
    if (b) content.push(`BT /F1 10 Tf ${col2X} ${y} Td (${escapeText(b)}) Tj ET`);
    if (c) content.push(`BT /F1 10 Tf ${rightX} ${y} Td (${escapeText(c)}) Tj ET`);
    y -= lineH;
  }

  const stream = content.join('\n');
  const objects = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] ' +
      '/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>'
  );
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  objects.push('<< /Length ' + Buffer.byteLength(stream, 'latin1') + ' >>\nstream\n' + stream + '\nendstream');

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += (i + 1) + ' 0 obj\n' + obj + '\nendobj\n';
  });

  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n';
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\n';
  pdf += 'startxref\n' + xrefStart + '\n%%EOF';

  return Buffer.from(pdf, 'latin1');
}

/**
 * Build a PDF report. Preferred: rich bilingual HTML rendered by headless Edge.
 * Falls back to an ASCII PDF when no browser is available.
 *
 * @param {object} opts
 * @param {string} opts.title       - localized title (use t(lang, key))
 * @param {string} opts.businessName
 * @param {string} opts.periodLabel
 * @param {string} [opts.metaLabel] - generated-on timestamp
 * @param {string[]} [opts.headerLines] - [h1, h2, h3] localized
 * @param {Array<Array|null|{type:'separator'}>} opts.rows
 * @param {string[]} [opts.summaryLines] - localized summary lines
 * @param {string} [opts.lang]      - 'en' | 'mr' | 'both'
 * @returns {Promise<Buffer>}
 */
async function buildReportPdf({ title, businessName, periodLabel, metaLabel = '', headerLines, rows, summaryLines = [], lang = 'en' }) {
  try {
    const html = buildReportHtml({
      title,
      businessName,
      periodLabel,
      metaLabel,
      headerLines,
      rows,
      summaryLines,
      lang,
    });
    return await renderHtmlToPdf(html);
  } catch (e) {
    // TEMP-DEBUG: log the render failure so the fallback reason is visible.
    console.error('[pdfReportService] Edge render failed:', e && e.message ? e.message : e);
    // The fallback keeps the full row set (English text only).
    return buildAsciiPdfFallback({ businessName, periodLabel, rows });
  }
}

module.exports = { buildReportPdf, buildReportHtml, fmtAmount, fmtInt, t };