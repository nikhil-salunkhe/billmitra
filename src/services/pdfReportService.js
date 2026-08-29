'use strict';

/**
 * Minimal dependency-free PDF builder for report export.
 *
 * Builds a single-page, text-only PDF with a hand-rolled content stream
 * (PDF is a text format; Helvetica type-1 is always available), so no binary
 * fonts or third-party libraries are required. Content is ASCII-only so the
 * output is valid in every viewer.
 */

/** Escapes a string for a PDF literal string (parens, backslash). */
function escapeText(value) {
  const str = String(value ?? '')
    .replace(/\u20B9/g, 'Rs.') // rupee sign -> ASCII
    .replace(/[^\x20-\x7E]/g, '?'); // keep printable ASCII
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function fmtAmount(value) {
  const num = Number(value || 0);
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num).toFixed(2);
  const [int, dec] = abs.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}Rs. ${grouped}.${dec}`;
}

function fmtInt(value) {
  return String(Number(value || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Assembles a PDF document and returns a Buffer.
 */
function buildReportPdf({ title, businessName, periodLabel, headerLines, rows, summaryLines }) {
  const W = 612; // points (US Letter)
  const H = 792;
  const leftX = 48;
  const rightX = W - 48; // right-aligned column 3 x
  const headerY = 682;
  const col2X = 320; // start of column 3
  const lineH = 15;

  const content = [];

  // --- Title block ---
  content.push(`BT /F2 18 Tf ${leftX} 740 Td (${escapeText(title)}) Tj ET`);
  content.push(`BT /F1 11 Tf ${leftX} 724 Td (${escapeText(businessName)}) Tj ET`);
  content.push(`BT /F2 10 Tf ${leftX} 708 Td (Period: ${escapeText(periodLabel)}) Tj ET`);
  content.push('q 48 694.5 516 0.6 re f Q'); // thin rule

  // --- Header ---
  content.push(`BT /F2 9 Tf ${leftX} ${headerY} Td (${escapeText(headerLines?.[0] || '')}) Tj ET`);
  content.push(`BT /F2 9 Tf ${rightX} ${headerY} Td (${escapeText(headerLines?.[2] || '')}) Tj ET`);
  content.push('q 48 ' + (headerY - 8) + ' 516 0.6 re f Q');

  // --- Body rows (3 columns: left, then the right alignment picks cell 2) ---
  let y = headerY - 16 - lineH;
  for (const row of rows || []) {
    if (!row || row.length === 0) continue;
    // Catch page overflow: if we hit the bottom margins, stop.
    if (y < 60) break;
    content.push(`BT /F1 10 Tf ${leftX} ${y} Td (${escapeText(row[0])}) Tj ET`);
    content.push(`BT /F1 10 Tf ${rightX} ${y} Td (${escapeText(row[2] === undefined ? '' : row[2])}) Tj ET`);
    y -= lineH;
  }

  // --- Summary (bold) ---
  y -= 6;
  for (const s of summaryLines || []) {
    if (y < 40) break;
    content.push(`BT /F2 10 Tf ${leftX} ${y} Td (${escapeText(s)}) Tj ET`);
    y -= lineH;
  }

  // ---- Assemble the PDF file ----
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

module.exports = { buildReportPdf, fmtAmount, fmtInt };