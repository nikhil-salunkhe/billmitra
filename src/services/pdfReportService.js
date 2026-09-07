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
    bill: {
      invoice: 'TAX INVOICE',
      billNo: 'Bill No',
      date: 'Date',
      customer: 'Customer',
      phone: 'Phone',
      itemsLabel: 'Items',
      sl: '#',
      item: 'Item',
      qty: 'Qty',
      rate: 'Rate',
      gst: 'GST',
      amount: 'Amount',
      subtotal: 'Subtotal',
      discount: 'Discount',
      taxable: 'Taxable Amount',
      cgst: 'CGST',
      sgst: 'SGST',
      igst: 'IGST',
      totalTax: 'Total Tax',
      total: 'TOTAL',
      amountInWords: 'Amount in Words',
      payment: 'Payment',
      status: 'Status',
      paid: 'PAID',
      unpaid: 'UNPAID',
      voided: 'VOIDED',
      voidedNote: 'This bill has been cancelled.',
      thankYou: 'Thank you for your business!',
      computerNote: 'This is a computer generated invoice.',
      poweredBy: 'Powered by BillMitra',
      walkIn: 'Walk-in Customer',
      cash: 'Cash',
      upi: 'UPI',
      card: 'Card',
      other: 'Other',
      rupees: 'Rupees',
      paise: 'Paise',
      only: 'Only',
    },
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
    bill: {
      invoice: 'टॅक्स इनव्हॉइस',
      billNo: 'बिल क्र.',
      date: 'दिनांक',
      customer: 'ग्राहक',
      phone: 'मोबाईल',
      itemsLabel: 'वस्तू',
      sl: 'क्र.',
      item: 'वस्तू',
      qty: 'प्रमाण',
      rate: 'दर',
      gst: 'जीएसटी',
      amount: 'रक्कम',
      subtotal: 'एकूण रक्कम',
      discount: 'सूट',
      taxable: 'करपात्र रक्कम',
      cgst: 'सीजीएसटी',
      sgst: 'एसजीएसटी',
      igst: 'आयजीएसटी',
      totalTax: 'एकूण कर',
      total: 'एकूण',
      amountInWords: 'रक्कम अक्षरी',
      payment: 'पेमेंट',
      status: 'स्थिती',
      paid: 'पैसे दिले',
      unpaid: 'बाकी',
      voided: 'रद्द',
      voidedNote: 'हे बिल रद्द करण्यात आले आहे.',
      thankYou: 'व्यवसायाबद्दल धन्यवाद!',
      computerNote: 'ही संगणकावर तयार केलेली पावती आहे.',
      poweredBy: 'बिलमित्र द्वारे समर्थित',
      walkIn: 'सामान्य ग्राहक',
      cash: 'रोख',
      upi: 'यूपीआय',
      card: 'कार्ड',
      other: 'इतर',
      rupees: 'रुपये',
      paise: 'पैसे',
      only: 'फक्त',
    },
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

/** Resolve a bill label for the requested language (bill section of T). */
function bt(lang, key) {
  const en = T.en.bill[key] || key;
  const mr = T.mr.bill[key];
  if (!mr || mr === en) return en;
  if (lang === 'mr') return mr;
  if (lang === 'both') return `${en} (${mr})`;
  return en;
}

// ---------------------------------------------------------------------------
// Amount in words (Indian numbering) — English + Marathi (Devanagari).
// ---------------------------------------------------------------------------
const EN_ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const EN_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function enTwo(n) {
  if (n < 20) return EN_ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return EN_TENS[t] + (o ? ' ' + EN_ONES[o] : '');
}
function enThree(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return (h ? EN_ONES[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? enTwo(r) : '');
}
function integerToEnWords(num) {
  if (num === 0) return 'Zero';
  let n = Math.abs(Math.trunc(num));
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const parts = [];
  if (crore) parts.push(enTwo(crore) + ' Crore');
  if (lakh) parts.push(enTwo(lakh) + ' Lakh');
  if (thousand) parts.push(enTwo(thousand) + ' Thousand');
  if (n) parts.push(enThree(n));
  return parts.join(' ');
}

const MR_1_99 = [
  '', 'एक', 'दोन', 'तीन', 'चार', 'पाच', 'सहा', 'सात', 'आठ', 'नऊ', 'दहा',
  'अकरा', 'बारा', 'तेरा', 'चौदा', 'पंधरा', 'सोळा', 'सतरा', 'अठरा', 'एकोणीस',
  'वीस', 'एकवीस', 'बावीस', 'तेवीस', 'चोवीस', 'पंचवीस', 'सव्वीस', 'सत्तावीस', 'अठ्ठावीस', 'एकोणतीस',
  'तीस', 'एकतीस', 'बत्तीस', 'तेहतीस', 'चौतीस', 'पस्तीस', 'छत्तीस', 'सदतीस', 'अडतीस', 'एकोणचाळीस',
  'चाळीस', 'एकेचाळीस', 'बेचाळीस', 'त्रेचाळीस', 'चव्वेचाळीस', 'पंचेचाळीस', 'सेचाळीस', 'सत्तेचाळीस', 'अठ्ठेचाळीस', 'एकोणपन्नास',
  'पन्नास', 'एक्कावन्न', 'बावन्न', 'त्रेपन्न', 'चोपन्न', 'पंचावन्न', 'छप्पन्न', 'सत्तावन्न', 'अठ्ठावन्न', 'एकोणसाठ',
  'साठ', 'एकसष्ट', 'बासष्ट', 'त्रेसष्ट', 'चौसष्ट', 'पासष्ट', 'सहासष्ट', 'सदुसष्ट', 'अडुसष्ट', 'एकोणसत्तर',
  'सत्तर', 'एक्काहत्तर', 'बाहत्तर', 'त्र्याहत्तर', 'चौर्याहत्तर', 'पंच्याहत्तर', 'शहात्तर', 'सत्याहत्तर', 'अठ्ठ्याहत्तर', 'एकोणऐंशी',
  'ऐंशी', 'एक्क्याऐंशी', 'ब्याऐंशी', 'त्र्याऐंशी', 'चौऱ्याऐंशी', 'पंच्याऐंशी', 'शहाऐंशी', 'सत्त्याऐंशी', 'अठ्ठ्याऐंशी', 'एकोणनव्वद',
  'नव्वद', 'एक्क्याण्णव', 'ब्याण्णव', 'त्र्याण्णव', 'चौऱ्याण्णव', 'पंच्याण्णव', 'शहाण्णव', 'सत्त्याण्णव', 'अठ्ठ्याण्णव', 'नव्व्याण्णव',
];
const MR_HUNDREDS = ['', 'शंभर', 'दोनशे', 'तीनशे', 'चारशे', 'पाचशे', 'सहाशे', 'सातशे', 'आठशे', 'नऊशे'];

function integerToMrWords(num) {
  if (num === 0) return 'शून्य';
  let n = Math.abs(Math.trunc(num));
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundred = Math.floor(n / 100); n %= 100;
  const parts = [];
  if (crore) parts.push(MR_1_99[crore] + ' कोटी');
  if (lakh) parts.push(MR_1_99[lakh] + ' लाख');
  if (thousand) parts.push(MR_1_99[thousand] + ' हजार');
  if (hundred) parts.push(MR_HUNDREDS[hundred]);
  if (n) parts.push(MR_1_99[n]);
  return parts.join(' ');
}

function amountToWordsEn(value) {
  const num = Math.round(Number(value || 0) * 100) / 100;
  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);
  let s = 'Rupees ' + integerToEnWords(rupees);
  if (paise > 0) s += ' and ' + integerToEnWords(paise) + ' Paise';
  return s + ' Only';
}

function amountToWordsMr(value) {
  const num = Math.round(Number(value || 0) * 100) / 100;
  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);
  let s = 'रुपये ' + integerToMrWords(rupees);
  if (paise > 0) s += ' आणि ' + integerToMrWords(paise) + ' पैसे';
  return s + ' फक्त';
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

// ---------------------------------------------------------------------------
// Bill / invoice PDF builder (product name + qty + clear amounts), bilingual.
// ---------------------------------------------------------------------------
const BILL_PDF_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', 'Devanagari', Arial, sans-serif; color: #1F2937; font-size: 12px; -webkit-print-color-adjust: exact; }
@page { size: A4; margin: 10mm; }
.sheet { max-width: 190mm; margin: 0 auto; }
.topbar { background: linear-gradient(90deg, #064E3B, #059669); color: #FFFFFF; border-radius:  10px; padding: 14px 18px; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.bizname { font-size: 20px; font-weight: 800; letter-spacing: .3px; }
.bizmeta { font-size: 11px; opacity: .95; margin-top: 3px; line-height: 1.5; }
.doctitle { text-align: right; font-size: 15px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; }
.docsub { text-align: right; font-size: 11px; opacity: .95; margin-top: 3px; }
.meta { display: flex; gap: 8px; margin: 12px 0; }
.metabox { flex:  1; background: #F9FAFB; border:  1px solid #E5E7EB; border-radius: 8px; padding: 7px 10px; }
.metabox .k { font-size:  10px; color: #6B7280; text-transform: uppercase; letter-spacing: .4px; }
.metabox .v { font-size:  13px; font-weight: 700; margin-top: 2px; }
.cust { background: #F0FDF4; border:  1px solid #BBF7D0; border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; font-size: 12.5px; }
table { width: 100%; border-collapse: collapse; }
thead th { background: #064E3B; color: #FFFFFF; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; padding: 7px 8px; text-align: left; }
thead th.r, td.r { text-align: right; }
thead th.c, td.c { text-align: center; }
tbody td { padding: 7px 8px; border-bottom: 1px solid #F3F4F6; vertical-align: top; }
tbody tr:nth-child(even) { background: #F9FAFB; }
.pname { font-weight: 700; font-size: 12.5px; }
.psub { font-size: 10px; color: #9CA3AF; margin-top: 1px; }
.amt { font-weight: 700; }
.totals { margin-top: 12px; display: flex; justify-content: flex-end; }
.totbox { width: 64mm; }
.totrow { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px; }
.totrow .r { font-weight: 600; }
.grand { display: flex; justify-content: space-between; align-items: center; background: #059669; color: #FFFFFF; border-radius: 8px; padding: 10px 14px; margin-top: 6px; }
.grand .k { font-size: 13px; font-weight: 800; letter-spacing: .5px; }
.grand .v { font-size: 19px; font-weight: 800; }
.words { margin-top: 12px; background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px; padding: 8px 12px; font-size: 12px; line-height: 1.6; }
.words .k { font-size: 10px; color: #92400E; text-transform: uppercase; letter-spacing: .4px; font-weight: 700; }
.foot { margin-top: 14px; text-align: center; color: #6B7280; font-size: 11px; line-height: 1.6; }
.voidbanner { margin-bottom: 10px; background: #FEF2F2; border: 2px solid #DC2626; color: #DC2626; text-align: center; font-weight: 800; font-size: 14px; padding: 8px; border-radius: 8px; }
.st-paid { color: #059669; } .st-unpaid { color: #D97706; } .st-void { color: #DC2626; }
`;
/** HTML for a professional A4 TAX INVOICE (product name, qty, rate, GST,
 * amount columns + clear totals + amount-in-words English & Marathi). */
function buildBillHtml({ business, bill, lang = 'en' }) {
  const fontFace = getDevanagariFontFace();
  const isMr = lang === 'mr';
  const both = lang === 'both';
  const B = (en, mr) => (isMr ? mr : both ? `${en} (${mr})` : en);

  const bizName = business?.businessName || 'BillMitra';
 const addr = [
    business?.addressLine,
    [business?.city, business?.pincode].filter(Boolean).join(' - '),
  ].filter(Boolean).join(', ');
  const phone = business?.phone ? `Ph: ${business.phone}` : '';
 const gst = business?.gstNumber ? `GSTIN: ${business.gstNumber}` : '';

  const dt = bill.createdAt ? new Date(bill.createdAt) : new Date();
 let dateStr = '';
 if (!Number.isNaN(dt.getTime())) {
    dateStr = dt.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  const methodKey = String(bill.paymentMethod || 'OTHER').toUpperCase();
 const methodLabel = bt(lang, { CASH: 'cash', UPI: 'upi', CARD: 'card', OTHER: 'other' }[methodKey] || 'other');

  let statusLabel;
  let statusClass = '';
 if (bill.isVoided) {
    statusLabel = B('VOIDED', 'रद्द');
    statusClass = 'st-void';
  } else if (Number(bill.dueAmount || 0) > 0) {
    statusLabel = B('UNPAID', 'बाकी');
    statusClass = 'st-unpaid';
  } else {
    statusLabel = B('PAID', 'पैसे दिले');
    statusClass = 'st-paid';
  }

  const items = Array.isArray(bill.items) ? bill.items : [];
 const itemRows = items
    .map((it, i) => {
      const amt = Number(it.lineAmount ?? Number(it.quantity || 0) * Number(it.unitPrice || 0));
      const gstPct = Number(it.taxRate || 0);
      return `<tr>
        <td class="c">${i + 1}</td>
        <td><div class="pname">${escHtml(it.name)}</div>${it.sku ? `<div class="psub">${escHtml(it.sku)}${it.unit && it.unit !== 'PCS' ? ' · ' + escHtml(it.unit) : ''}</div>` : ''}</td>
        <td class="c">${fmtInt(it.quantity)}</td>
        <td class="r">${fmtAmount(it.unitPrice)}</td>
        <td class="c">${gstPct ? gstPct + '%' : '—'}</td>
        <td class="r amt">${fmtAmount(amt)}</td>
      </tr>`;
    })
    .join('\n');

  const taxRows = [];
 if (Number(bill.cgst || 0) > 0) taxRows.push(`<div class="totrow"><span>${escHtml(bt(lang, 'cgst'))}</span><span class="r">${fmtAmount(bill.cgst)}</span></div>`);
 if (Number(bill.sgst || 0) > 0) taxRows.push(`<div class="totrow"><span>${escHtml(bt(lang, 'sgst'))}</span><span class="r">${fmtAmount(bill.sgst)}</span></div>`);
 if (Number(bill.igst || 0) > 0) taxRows.push(`<div class="totrow"><span>${escHtml(bt(lang, 'igst'))}</span><span class="r">${fmtAmount(bill.igst)}</span></div>`);

 const hasDiscount = Number(bill.discount || 0) > 0;
 const discountLabel = hasDiscount
    ? (bill.discountType === 'PERCENT' ? `${bt(lang, 'discount')} (${Number(bill.discount)}%)` : bt(lang, 'discount'))
    : bt(lang, 'discount');

  const grandTotal = Number(bill.totalAmount ?? bill.grandTotal ?? (bill.subtotal || 0));
 let wordsHtml;
  if (isMr) wordsHtml = escHtml(amountToWordsMr(grandTotal));
 else if (both) wordsHtml = escHtml(amountToWordsEn(grandTotal)) + '<br/>' + escHtml(amountToWordsMr(grandTotal));
  else wordsHtml = escHtml(amountToWordsEn(grandTotal));

  const voidBanner = bill.isVoided
    ? `<div class="voidbanner">${escHtml(B('VOIDED', 'रद्द'))} — ${escHtml(B('This bill has been cancelled.', 'हे बिल रद्द करण्यात आले आहे.'))}</div>`
    : '';

  const billNo = escHtml(bill.billNumber || bill.invoiceNumber || '—');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><style>
${fontFace}
${BILL_PDF_CSS}
</style></head><body><div class="sheet">
  ${voidBanner}
  <div class="topbar">
    <div>
      <div class="bizname">${escHtml(bizName)}</div>
      ${addr ? `<div class="bizmeta">${escHtml(addr)}</div>` : ''}
      ${phone ? `<div class="bizmeta">${escHtml(phone)}</div>` : ''}
      ${gst ? `<div class="bizmeta">${escHtml(gst)}</div>` : ''}
    </div>
    <div>
      <div class="doctitle">${escHtml(B('TAX INVOICE', 'टॅक्स इनव्हॉइस'))}</div>
      <div class="docsub">${escHtml(bt(lang, 'billNo'))}: ${billNo}</div>
    </div>
  </div>
  <div class="meta">
    <div class="metabox"><div class="k">${escHtml(bt(lang, 'billNo'))}</div><div class="v">${billNo}</div></div>
    <div class="metabox"><div class="k">${escHtml(bt(lang, 'date'))}</div><div class="v">${escHtml(dateStr)}</div></div>
    <div class="metabox"><div class="k">${escHtml(bt(lang, 'payment'))}</div><div class="v">${escHtml(methodLabel)}</div></div>
    <div class="metabox"><div class="k">${escHtml(bt(lang, 'status'))}</div><div class="v ${statusClass}">${escHtml(statusLabel)}</div></div>
  </div>
  <div class="cust"><b>${escHtml(bt(lang, 'customer'))}:</b> ${escHtml(bill.customerName || B('Walk-in Customer', 'सामान्य ग्राहक'))}${bill.customerPhone ? ' &nbsp;·&nbsp; ' + escHtml(bill.customerPhone) : ''}</div>
  <table>
    <thead><tr>
      <th class="c" style="width:6%">${escHtml(B('#', 'क्र.'))}</th>
      <th>${escHtml(B('Item', 'वस्तू'))}</th>
      <th class="c" style="width:9%">${escHtml(B('Qty', 'प्रमाण'))}</th>
      <th class="r" style="width:14%">${escHtml(B('Rate', 'दर'))}</th>
      <th class="c" style="width:9%">${escHtml(B('GST', 'जीएसटी'))}</th>
      <th class="r" style="width:16%">${escHtml(B('Amount', 'रक्कम'))}</th>
    </tr></thead>
    <tbody>${itemRows}</tbody>
  </table>
  <div class="totals"><div class="totbox">
    <div class="totrow"><span>${escHtml(bt(lang, 'subtotal'))}</span><span class="r">${fmtAmount(bill.subtotal)}</span></div>
    ${hasDiscount ? `<div class="totrow"><span>${escHtml(discountLabel)}</span><span class="r">- ${fmtAmount(bill.discount)}</span></div>` : ''}
    <div class="totrow"><span>${escHtml(bt(lang, 'taxable'))}</span><span class="r">${fmtAmount(bill.taxableAmount)}</span></div>
    ${taxRows.join('\n')}
    <div class="totrow"><span>${escHtml(bt(lang, 'totalTax'))}</span><span class="r">${fmtAmount(bill.totalTax)}</span></div>
    <div class="grand"><span class="k">${escHtml(B('TOTAL', 'एकूण'))}</span><span class="v">${fmtAmount(grandTotal)}</span></div>
  </div></div>
  <div class="words"><div class="k">${escHtml(B('Amount in Words', 'रक्कम अक्षरी'))}</div>${wordsHtml}</div>
  <div class="foot">
    ${escHtml(B('Thank you for your business!', 'व्यवसायाबद्दल धन्यवाद!'))}<br/>
    ${escHtml(B('This is a computer generated invoice.', 'ही संगणकावर तयार केलेली पावती आहे.'))}<br/>
    <b>${escHtml(B('Powered by BillMitra', 'बिलमित्र द्वारे समर्थित'))}</b>
  </div>
</div></body></html>`;
}

/** ASCII fallback invoice (servers without a browser). */
function buildBillAsciiFallback({ business, bill }) {
  const W = 612;
  const H = 792;
  const leftX = 48;
  const rightX = W - 48;
  let y = 760;
  const lineH = 14;
  const content = [];
  content.push(`BT /F2 16 Tf ${leftX} ${y} Td (${escapeText(business?.businessName || 'BillMitra')}) Tj ET`);
  y -= 24;
  content.push(`BT /F1 11 Tf ${leftX} ${y} Td (TAX INVOICE - ${escapeText(bill.billNumber || bill.invoiceNumber || '')}) Tj ET`);
  y -= 18;
  content.push(`BT /F1 9 Tf ${leftX} ${y} Td (${escapeText(new Date(bill.createdAt).toLocaleDateString('en-IN'))}) Tj ET`);
  y -= 22;
  content.push('q 48 ' + (y + 4) + ' 516 0.6 re f Q');
  for (const it of bill.items || []) {
    if (y < 80) break;
    const lineTotal = Number(it.lineAmount ?? Number(it.quantity) * Number(it.unitPrice));
    content.push(`BT /F1 10 Tf ${leftX} ${y} Td (${escapeText(it.name)}) Tj ET`);
    content.push(`BT /F1 10 Tf ${rightX} ${y} Td (${escapeText('Rs ' + lineTotal.toFixed(2))}) Tj ET`);
    y -= 14;
    content.push(`BT /F1 9 Tf ${leftX} ${y} Td (  ${escapeText(String(it.quantity) + ' x Rs ' + Number(it.unitPrice).toFixed(2))}) Tj ET`);
    y -= 18;
  }
  content.push('q 48 ' + (y + 4) + ' 516 0.6 re f Q');
  content.push(`BT /F2 12 Tf ${leftX} ${y} Td (TOTAL: ${escapeText('Rs ' + Number(bill.totalAmount ?? bill.grandTotal).toFixed(2))}) Tj ET`);
  const objects = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  objects.push('<< /Length ' + Buffer.byteLength(content.join('\n'), 'latin1') + ' >>\nstream\n' + content.join('\n') + '\nendstream');
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += (i + 1) + ' 0 obj\n' + obj + '\nendobj\n';
  });
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF';
  return Buffer.from(pdf, 'latin1');
}

/**
 * Build a PDF bill (TAX INVOICE). Preferred renderer: headless Edge with the
 * Devanagari font embedded; falls back to an ASCII invoice.
 * @param {object} opts  { business, bill, lang }
 * @returns {Promise<Buffer>}
 */
async function buildBillPdf({ business, bill, lang = 'en' }) {
  try {
    const html = buildBillHtml({ business, bill, lang });
    return await renderHtmlToPdf(html);
  } catch (e) {
    console.error('[pdfReportService] bill Edge render failed:', e && e.message ? e.message : e);
    return buildBillAsciiFallback({ business, bill });
  }
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

module.exports = { buildReportPdf, buildReportHtml, buildBillPdf, buildBillHtml, fmtAmount, fmtInt, t };