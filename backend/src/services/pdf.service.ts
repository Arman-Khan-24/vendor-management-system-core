import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';

export interface BusinessBrandInfo {
  name: string;
  slug: string;
  phone?: string;
  address?: string;
  currency?: string;
  footer?: string;
}

export interface StatementPdfData {
  business: BusinessBrandInfo;
  customer: { id: string; name: string; phone: string; credit_terms_days: number };
  period: { startDate?: string; endDate?: string };
  openingBalance: number;
  closingBalance: number;
  totalBilled: number;
  totalPaid: number;
  currentOutstanding: number;
  entries: Array<{
    type: string;
    reference_no: string;
    date: string | Date;
    debit: number;
    credit: number;
    running_balance: number;
    status?: string;
  }>;
}

const fontPath = fileURLToPath(new URL('../assets/fonts/NotoSansDevanagari.ttf', import.meta.url));
const colors = { ink: '#273329', muted: '#63715F', accent: '#597451', soft: '#EDF2E9', border: '#D8E1D5', row: '#F7F9F5' };
const compact = (value: string | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

export class PdfService {
  static async generateStatementPdf(data: StatementPdfData): Promise<Buffer> {
    const currency = data.business.currency || 'INR';
    const numbers = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const amount = (value: number) => {
      if (!Number.isFinite(Number(value))) throw new Error('Statement contains an invalid amount');
      return `${currency} ${numbers.format(Number(value))}`;
    };
    const date = (value: string | Date) => new Intl.DateTimeFormat('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'
    }).format(new Date(value));
    const period = data.period.startDate && data.period.endDate
      ? `${date(data.period.startDate)} to ${date(data.period.endDate)}`
      : data.period.startDate ? `From ${date(data.period.startDate)}`
        : data.period.endDate ? `Through ${date(data.period.endDate)}` : 'All account history';

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4', margin: 40, bufferPages: true,
        info: { Title: `Statement - ${data.customer.name}`, Author: data.business.name, Creator: data.business.name, Subject: `${currency} account statement: ${period}` }
      });
      const chunks: Buffer[] = [];
      doc.on('data', chunk => chunks.push(Buffer.from(chunk)));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      try {
        doc.registerFont('Statement', fontPath);
        doc.font('Statement');
        const margin = 40;
        const width = doc.page.width - margin * 2;
        const bottom = () => doc.page.height - 70;
        const text = (value: string, x: number, y: number, textWidth: number, size = 9, color = colors.ink, align: 'left' | 'right' = 'left') => {
          if (!value) return 0;
          doc.font('Statement').fontSize(size).fillColor(color);
          const options = { width: textWidth, align, lineGap: 2 };
          const height = doc.heightOfString(value, options);
          doc.text(value, x, y, options);
          return height;
        };
        const header = (continued = false) => {
          doc.roundedRect(margin, 40, 4, 23, 2).fill(colors.accent);
          let y = 39;
          const nameHeight = text(compact(data.business.name), margin + 13, y, width - 170, continued ? 13 : 19);
          text('STATEMENT OF ACCOUNT', margin + width - 154, y + 4, 154, 8.5, colors.accent, 'right');
          y += Math.max(27, nameHeight) + 8;
          if (continued) {
            y += text(`${compact(data.customer.name)} | ${period}`, margin, y, width, 8.5, colors.muted);
            return y + 16;
          }
          const contact = [compact(data.business.phone), compact(data.business.address)].filter(Boolean).join(' | ');
          y += text(contact, margin + 13, y, width - 13, 8.5, colors.muted) + 17;
          doc.moveTo(margin, y).lineTo(margin + width, y).strokeColor(colors.border).lineWidth(1).stroke();
          y += 18;
          let leftY = y;
          text('ACCOUNT HOLDER', margin, leftY, 290, 8, colors.muted);
          leftY += 16;
          leftY += text(compact(data.customer.name), margin, leftY, 295, 13) + 4;
          if (data.customer.phone) leftY += text(compact(data.customer.phone), margin, leftY, 295, 9, colors.muted) + 3;
          leftY += text(`Credit terms: ${data.customer.credit_terms_days} days`, margin, leftY, 295, 9, colors.muted);
          let rightY = y;
          text('PERIOD', margin + width - 190, rightY, 190, 8, colors.muted, 'right');
          rightY += 16;
          rightY += text(period, margin + width - 190, rightY, 190, 9, colors.ink, 'right') + 6;
          rightY += text(`Prepared ${date(new Date())}`, margin + width - 190, rightY, 190, 8.5, colors.muted, 'right');
          y = Math.max(leftY, rightY) + 20;
          const cards = [
            ['Opening balance', data.openingBalance], ['Billed in period', data.totalBilled],
            ['Paid in period', data.totalPaid], ['Closing balance', data.closingBalance]
          ] as const;
          const cardWidth = (width - 24) / 4;
          cards.forEach(([label, value], index) => {
            const x = margin + index * (cardWidth + 8);
            doc.roundedRect(x, y, cardWidth, 67, 8).fill(index === 3 ? colors.soft : colors.row);
            text(label, x + 10, y + 10, cardWidth - 20, 7.5, colors.muted);
            text(amount(value), x + 10, y + 29, cardWidth - 20, 10, index === 2 ? colors.accent : colors.ink);
          });
          return y + 85;
        };

        const columns = [78, 145, 92, 92, width - 407];
        const tableHeader = (y: number) => {
          doc.roundedRect(margin, y, width, 30, 5).fill(colors.soft);
          let x = margin;
          ['Date', 'Reference', 'Debit', 'Credit', 'Balance'].forEach((label, index) => {
            text(label, x + 8, y + 9, columns[index] - 16, 8, colors.muted, index >= 2 ? 'right' : 'left');
            x += columns[index];
          });
          return y + 30;
        };
        let y = tableHeader(header());
        let rowIndex = 0;
        const row = (cells: string[]) => {
          doc.font('Statement').fontSize(8.5);
          const height = Math.max(34, ...cells.map((cell, index) => doc.heightOfString(cell, { width: columns[index] - 16, lineGap: 2 }) + 16));
          if (y + height > bottom()) {
            doc.addPage();
            y = tableHeader(header(true));
          }
          if (rowIndex % 2 === 0) doc.rect(margin, y, width, height).fill(colors.row);
          let x = margin;
          cells.forEach((cell, index) => {
            text(cell, x + 8, y + 8, columns[index] - 16, 8.5, index === 3 ? colors.accent : colors.ink, index >= 2 ? 'right' : 'left');
            x += columns[index];
          });
          y += height;
          doc.moveTo(margin, y).lineTo(margin + width, y).strokeColor(colors.border).lineWidth(0.35).stroke();
          rowIndex++;
        };

        row(['Opening', 'Balance brought forward', '-', '-', amount(data.openingBalance)]);
        for (const entry of data.entries) {
          const activity = entry.type === 'INVOICE' ? 'Invoice' : entry.type === 'PAYMENT' ? 'Payment' : compact(entry.type);
          row([
            date(entry.date), `${activity}\n${compact(entry.reference_no)}`,
            entry.debit === 0 ? '-' : amount(entry.debit), entry.credit === 0 ? '-' : amount(entry.credit), amount(entry.running_balance)
          ]);
        }
        if (!data.entries.length) {
          y += 15;
          y += text('No transactions in this period.', margin + 8, y, width - 16, 9, colors.muted);
        }

        const footer = compact(data.business.footer);
        doc.font('Statement').fontSize(9);
        const closingHeight = 90 + (footer ? doc.heightOfString(footer, { width, lineGap: 2 }) + 15 : 0);
        if (y + closingHeight > bottom()) {
          doc.addPage();
          y = header(true);
        }
        y += 16;
        doc.roundedRect(margin, y, width, 65, 8).fill(colors.soft);
        text('Closing balance for this period', margin + 13, y + 12, width - 180, 9);
        text(amount(data.closingBalance), margin + width - 163, y + 10, 150, 11, colors.ink, 'right');
        text('Current outstanding (all time)', margin + 13, y + 39, width - 180, 8, colors.muted);
        text(amount(data.currentOutstanding), margin + width - 163, y + 37, 150, 9, colors.muted, 'right');
        y += 81;
        if (footer) text(footer, margin, y, width, 9, colors.muted);

        const pages = doc.bufferedPageRange();
        for (let index = pages.start; index < pages.start + pages.count; index++) {
          doc.switchToPage(index);
          // Footers sit outside the content margin and must never create another page.
          const savedBottom = doc.page.margins.bottom;
          doc.page.margins.bottom = 0;
          doc.moveTo(margin, doc.page.height - 48).lineTo(margin + width, doc.page.height - 48).strokeColor(colors.border).lineWidth(0.5).stroke();
          text(`Account statement | ${currency}`, margin, doc.page.height - 38, width - 100, 8, colors.muted);
          text(`Page ${index + 1} of ${pages.count}`, margin + width - 100, doc.page.height - 38, 100, 8, colors.muted, 'right');
          doc.page.margins.bottom = savedBottom;
        }
        doc.end();
      } catch (error) {
        doc.destroy();
        reject(error);
      }
    });
  }
}
