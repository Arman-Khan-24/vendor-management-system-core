export interface BusinessBrandInfo {
  name: string;
  slug: string;
  phone?: string;
  address?: string;
}

export interface StatementPdfData {
  business: BusinessBrandInfo;
  customer: {
    id: string;
    name: string;
    phone: string;
    credit_terms_days: number;
  };
  period: {
    startDate?: string;
    endDate?: string;
  };
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

export class PdfService {
  private static browserPromise: Promise<any> | null = null;

  private static async getBrowser(): Promise<any> {
    if (!this.browserPromise) {
      try {
        const modName = 'puppeteer';
        const puppeteer: any = await import(modName);
        const launcher = puppeteer.default || puppeteer;
        this.browserPromise = launcher.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
          ]
        });
      } catch (err: any) {
        throw new Error('Puppeteer is not installed in this environment: ' + err.message);
      }
    }
    return this.browserPromise;
  }

  static generateStatementHtml(data: StatementPdfData): string {
    const formatInr = (n: number) => {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 2
      }).format(n || 0);
    };

    const formatDate = (d: string | Date) => {
      const dt = new Date(d);
      return dt.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    };

    const periodStr = data.period.startDate && data.period.endDate
      ? `${formatDate(data.period.startDate)} — ${formatDate(data.period.endDate)}`
      : 'All-Time Account History';

    const rowsHtml = data.entries.map((entry, idx) => {
      const isInvoice = entry.type === 'INVOICE';
      const badgeClass = isInvoice ? 'badge-invoice' : 'badge-payment';
      const debitStr = entry.debit > 0 ? formatInr(entry.debit) : '—';
      const creditStr = entry.credit > 0 ? formatInr(entry.credit) : '—';
      const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';

      return `
        <tr style="background-color: ${rowBg};">
          <td style="padding: 10px 14px; font-size: 11px; color: #64748B;">${formatDate(entry.date)}</td>
          <td style="padding: 10px 14px; font-size: 11px; font-weight: 700; color: #0F172A;">
            <span class="${badgeClass}">${entry.type}</span>
            <span style="margin-left: 6px;">${entry.reference_no}</span>
          </td>
          <td style="padding: 10px 14px; font-size: 11px; text-align: right; color: #0F172A; font-weight: 600;">${debitStr}</td>
          <td style="padding: 10px 14px; font-size: 11px; text-align: right; color: #059669; font-weight: 600;">${creditStr}</td>
          <td style="padding: 10px 14px; font-size: 11px; text-align: right; font-weight: 800; color: #0F172A;">${formatInr(entry.running_balance)}</td>
        </tr>
      `;
    }).join('');

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Statement - ${data.customer.name}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0F172A;
      background-color: #FFFFFF;
      padding: 32px 36px;
      -webkit-font-smoothing: antialiased;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 24px;
      border-bottom: 2px solid #E2E8F0;
    }
    .brand-title {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #0F172A;
    }
    .brand-sub {
      font-size: 11px;
      color: #64748B;
      margin-top: 4px;
      font-weight: 500;
    }
    .doc-title-block {
      text-align: right;
    }
    .doc-title {
      font-size: 18px;
      font-weight: 800;
      color: #059669;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .period-label {
      font-size: 11px;
      color: #64748B;
      margin-top: 4px;
      font-weight: 600;
    }
    .parties-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-top: 24px;
    }
    .info-card {
      background-color: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 14px;
      padding: 16px 20px;
    }
    .info-label {
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 800;
      letter-spacing: 0.6px;
      color: #64748B;
      margin-bottom: 6px;
    }
    .customer-name {
      font-size: 15px;
      font-weight: 800;
      color: #0F172A;
    }
    .customer-detail {
      font-size: 12px;
      color: #475569;
      margin-top: 4px;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-top: 24px;
    }
    .kpi-card {
      border-radius: 12px;
      padding: 14px;
      text-align: center;
      border: 1px solid #E2E8F0;
      background: #FFFFFF;
    }
    .kpi-card.highlight {
      background: #FEF3C7;
      border-color: #FDE68A;
    }
    .kpi-card-label {
      font-size: 9px;
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: #64748B;
    }
    .kpi-card-value {
      font-size: 16px;
      font-weight: 800;
      color: #0F172A;
      margin-top: 4px;
    }
    .kpi-card.highlight .kpi-card-value {
      color: #B45309;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 28px;
      border: 1px solid #E2E8F0;
      border-radius: 12px;
      overflow: hidden;
    }
    thead {
      background-color: #F1F5F9;
    }
    th {
      padding: 12px 14px;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 700;
      color: #475569;
      border-bottom: 2px solid #CBD5E1;
    }
    th.text-right {
      text-align: right;
    }
    th.text-left {
      text-align: left;
    }
    .badge-invoice {
      display: inline-block;
      padding: 2px 7px;
      font-size: 9px;
      font-weight: 700;
      border-radius: 999px;
      background-color: #E2E8F0;
      color: #334155;
    }
    .badge-payment {
      display: inline-block;
      padding: 2px 7px;
      font-size: 9px;
      font-weight: 700;
      border-radius: 999px;
      background-color: #D1FAE5;
      color: #065F46;
    }
    .footer {
      margin-top: 36px;
      padding-top: 18px;
      border-top: 1px solid #E2E8F0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10px;
      color: #94A3B8;
    }
    .watermark {
      font-size: 10px;
      font-weight: 600;
      color: #64748B;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand-title">${escapeHtml(data.business.name)}</div>
      <div class="brand-sub">B2B Wholesale Ledger Statement · Ref: ${data.business.slug}</div>
    </div>
    <div class="doc-title-block">
      <div class="doc-title">Statement of Account</div>
      <div class="period-label">${periodStr}</div>
    </div>
  </div>

  <div class="parties-grid">
    <div class="info-card">
      <div class="info-label">Customer Details</div>
      <div class="customer-name">${escapeHtml(data.customer.name)}</div>
      <div class="customer-detail">Phone: <strong>${escapeHtml(data.customer.phone)}</strong></div>
      <div class="customer-detail">Credit Terms: <strong>${data.customer.credit_terms_days} Days</strong></div>
    </div>
    <div class="info-card">
      <div class="info-label">Statement Summary</div>
      <div class="customer-detail">Generated: <strong>${new Date().toLocaleString('en-IN')}</strong></div>
      <div class="customer-detail">Total Invoices & Payments: <strong>${data.entries.length} items</strong></div>
      <div class="customer-detail">Settlement Status: <strong>${data.currentOutstanding <= 0 ? 'Fully Paid' : 'Balance Pending'}</strong></div>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-card-label">Opening Balance</div>
      <div class="kpi-card-value">${formatInr(data.openingBalance)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-card-label">Total Invoiced</div>
      <div class="kpi-card-value">${formatInr(data.totalBilled)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-card-label">Total Paid</div>
      <div class="kpi-card-value" style="color: #059669;">${formatInr(data.totalPaid)}</div>
    </div>
    <div class="kpi-card highlight">
      <div class="kpi-card-label">Closing Outstanding</div>
      <div class="kpi-card-value">${formatInr(data.currentOutstanding)}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="text-left" style="width: 16%;">Date</th>
        <th class="text-left" style="width: 32%;">Reference / Activity</th>
        <th class="text-right" style="width: 17%;">Debit (₹)</th>
        <th class="text-right" style="width: 17%;">Credit (₹)</th>
        <th class="text-right" style="width: 18%;">Balance (₹)</th>
      </tr>
    </thead>
    <tbody>
      ${data.openingBalance !== 0 ? `
        <tr style="background-color: #F8FAFC; font-weight: 700;">
          <td style="padding: 10px 14px; font-size: 11px; color: #64748B;">Prior</td>
          <td style="padding: 10px 14px; font-size: 11px; color: #0F172A;" colspan="3">Opening Balance Carried Forward</td>
          <td style="padding: 10px 14px; font-size: 11px; text-align: right; font-weight: 800;">${formatInr(data.openingBalance)}</td>
        </tr>
      ` : ''}
      ${rowsHtml || `
        <tr>
          <td colspan="5" style="padding: 24px; text-align: center; color: #94A3B8; font-size: 12px;">
            No transactions found for this statement period.
          </td>
        </tr>
      `}
    </tbody>
  </table>

  <div class="footer">
    <div class="watermark">OrderLedger Multi-Tenant Cloud Platform</div>
    <div>Page 1 of 1 · Computer-generated authentic ledger statement</div>
  </div>
</body>
</html>
    `;
  }

  static async generateStatementPdf(data: StatementPdfData): Promise<Buffer> {
    const html = this.generateStatementHtml(data);
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pdfUint8Array = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '15mm',
          right: '15mm',
          bottom: '15mm',
          left: '15mm'
        }
      });
      return Buffer.from(pdfUint8Array);
    } finally {
      await page.close();
    }
  }
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
