import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PdfService, type StatementPdfData } from '../services/pdf.service.js';

const statement: StatementPdfData = {
  business: { name: 'आशा किराना', slug: 'asha-store', phone: '9876543210', currency: 'USD', address: 'नागपूर, महाराष्ट्र', footer: 'धन्यवाद. Please retain this statement for your records.' },
  customer: { id: 'customer-test', name: 'श्री गणेश भोजनालय', phone: '9000000000', credit_terms_days: 14 },
  period: { startDate: '2026-10-01', endDate: '2026-10-17' },
  openingBalance: 125, closingBalance: 200, totalBilled: 100, totalPaid: 25, currentOutstanding: 350,
  entries: [
    { type: 'INVOICE', reference_no: 'ML-0001', date: '2026-10-10', debit: 100, credit: 0, running_balance: 225 },
    { type: 'PAYMENT', reference_no: 'PAY-0001', date: '2026-10-12', debit: 0, credit: 25, running_balance: 200 }
  ]
};

test('server statement produces valid PDF bytes with an embedded font', async () => {
  const pdf = await PdfService.generateStatementPdf(statement);
  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.match(pdf.toString('latin1'), /\/FontFile2\b/);
  assert.match(pdf.subarray(-20).toString('ascii'), /%%EOF/);
});

test('a long statement paginates without requiring a browser or network', async () => {
  const entries = Array.from({ length: 100 }, (_, index) => ({
    type: 'INVOICE', reference_no: `ML-${String(index + 1).padStart(4, '0')}`, date: '2026-10-12',
    debit: 100, credit: 0, running_balance: 125 + (index + 1) * 100
  }));
  const pdf = await PdfService.generateStatementPdf({ ...statement, entries, totalBilled: 10000, totalPaid: 0, closingBalance: 10125 });
  const pages = pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? [];
  assert.ok(pages.length > 1 && pages.length < 15, `Expected a paginated statement; received ${pages.length} pages`);
});

test('bundled statement font supports Hindi shaping, Latin labels, digits and INR symbol', () => {
  const require = createRequire(import.meta.url);
  const fontkit = require('fontkit') as { openSync(path: string): { hasGlyphForCodePoint(point: number): boolean; layout(text: string): { glyphs: { id: number }[] } } };
  const fontPath = fileURLToPath(new URL('../assets/fonts/NotoSansDevanagari.ttf', import.meta.url));
  const font = fontkit.openSync(fontPath);
  const text = 'श्री गणेश भोजनालय आशा किराना नागपूर महाराष्ट्र धन्यवाद INR USD ₹ 0123456789';
  for (const character of text) assert.equal(font.hasGlyphForCodePoint(character.codePointAt(0)!), true, `Missing glyph: ${character}`);
  assert.ok(font.layout(text).glyphs.every(glyph => glyph.id !== 0));
});
