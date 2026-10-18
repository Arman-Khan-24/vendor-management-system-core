import { useMemo, useState } from 'react';
import { BookOpen, Download, Printer, ReceiptText } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorNotice, LoadingState, Modal, PageHeader, Pagination, SearchBox, usePagination } from '../../components/ui';
import type { Invoice } from '../../types';
import { downloadCsv, formatDate, invoiceNumber } from '../../utils/formatters';
import { useBusiness } from '../settings/businessSettings';

export function InvoicesView({ invoices, onSelect }: { invoices: Invoice[]; onSelect: (invoice: Invoice) => void }) {
  const { settings, money, business } = useBusiness();
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => invoices.filter(i => (status === 'all' || (status === 'unpaid' ? i.status !== 'Paid' : i.status === 'Paid')) && (i.customer_name + ' ' + invoiceNumber(i, settings.billing.invoicePrefix)).toLowerCase().includes(search.toLowerCase())), [invoices, status, search, settings.billing.invoicePrefix]);
  const pages = usePagination(filtered, status + '|' + search);
  const number = (i: Invoice) => invoiceNumber(i, settings.billing.invoicePrefix);
  return <div className="page-stack">
    <PageHeader eyebrow="Billing" title="Your invoices." description="Find an invoice, check its balance, or save a copy for your customer." actions={<Button variant="outline" disabled={!filtered.length} onClick={() => downloadCsv(['Invoice', 'Customer', 'Date', 'Subtotal', 'Tax', 'Total', 'Paid', 'Remaining', 'Status'], filtered.map(i => [number(i), i.customer_name, i.created_at, i.subtotal, i.tax, i.total, i.allocated_amount, i.remaining_amount, i.status]), 'invoices.csv')}><Download size={17} aria-hidden="true" />Export invoices</Button>} />
    <div className="stat-grid ledger-stats"><div className="metric-card metric-pink"><p>Total invoiced</p><strong className="metric-value numeric">{money(invoices.reduce((sum, i) => sum + Number(i.total), 0))}</strong><small>{invoices.length} invoices in your ledger</small></div><div className="metric-card metric-blue"><p>Balance to collect</p><strong className="metric-value numeric">{money(invoices.reduce((sum, i) => sum + Number(i.remaining_amount), 0))}</strong><small>{invoices.filter(i => i.status !== 'Paid').length} unpaid or partially paid</small></div><div className="metric-card metric-yellow"><p>Fully paid</p><strong className="metric-value numeric">{invoices.filter(i => i.status === 'Paid').length}</strong><small>Invoices with no remaining balance</small></div></div>
    <div className="filter-bar"><SearchBox label="Search invoices" value={search} onChange={setSearch} placeholder="Invoice number or customer…" /><div className="chips">{[['all', 'All invoices'], ['unpaid', 'Unpaid'], ['paid', 'Paid']].map(([id, label]) => <button type="button" key={id} className={'chip ' + (status === id ? 'selected' : '')} aria-pressed={status === id} onClick={() => setStatus(id)}>{label}</button>)}</div></div>
    {!filtered.length ? <EmptyState icon={<ReceiptText size={28} />} title={search || status !== 'all' ? 'No matching invoices' : 'Your invoices will appear here'} description={search || status !== 'all' ? 'Try another search or filter.' : 'Invoices are created automatically when orders are marked ' + (business?.invoice_trigger || 'Delivered').toLowerCase() + '.'} /> :
      <div className="records">{pages.items.map(invoice => <div className="record-row" key={invoice.id}>
        <div className="item-icon tonal-lavender"><ReceiptText size={21} aria-hidden="true" /></div>
        <div className="record-title"><button type="button" className="text-link" onClick={() => onSelect(invoice)}>{number(invoice)}</button><small>{invoice.customer_name} · {formatDate(invoice.created_at)}</small></div>
        <Badge variant={invoice.status === 'Paid' ? 'success' : invoice.status === 'Partial' ? 'info' : 'warning'}>{invoice.status === 'Pending' ? 'Unpaid' : invoice.status}</Badge>
        <div className="record-price numeric"><strong>{money(invoice.total)}</strong><small>{money(invoice.remaining_amount)} remaining</small></div>
        <div className="record-actions"><Button size="sm" variant="secondary" onClick={() => onSelect(invoice)}>View invoice</Button></div>
      </div>)}</div>}
    <Pagination {...pages} />
    <p className="muted small">{filtered.length} matching invoices</p>
  </div>;
}
export function InvoiceModal({ invoice, loading, loadError, onClose, onPayment, onStatement }: { invoice: Invoice; loading?: boolean; loadError?: string | null; onClose: () => void; onPayment: (id: string) => void; onStatement: (id: string) => void }) {
  const { settings, business, money } = useBusiness();
  const due = new Date(invoice.created_at);
  due.setDate(due.getDate() + (invoice.credit_terms_days ?? settings.billing.defaultCreditTermsDays));
  return <Modal isOpen title={invoiceNumber(invoice, settings.billing.invoicePrefix)} onClose={onClose} wide className="invoice-modal">
    {loading ? <LoadingState label="Loading invoice…" /> : <div className="invoice-workspace">
      <ErrorNotice message={loadError || null} />
      <article className="invoice-sheet" aria-label={'Invoice ' + invoiceNumber(invoice, settings.billing.invoicePrefix)}>
        <img className="invoice-banner" src="/invoice-landscape.webp" width="687" height="157" alt="" decoding="async" />
        <div className="invoice-identity"><div className="invoice-wordmark">{business?.logo_url ? <img src={business.logo_url} alt="" width="32" height="32" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = 'none'; }} /> : <BookOpen size={26} strokeWidth={1.8} aria-hidden="true" />}<span>{settings.branding.appName}</span></div><strong>{invoiceNumber(invoice, settings.billing.invoicePrefix)}</strong></div>
        <h2 className="invoice-heading">INVOICE</h2>
        <div className="invoice-parties"><section><p className="invoice-label">From</p><h3>{business?.name}</h3>{settings.profile.email && <p>{settings.profile.email}</p>}{settings.profile.address && <p className="invoice-address">{settings.profile.address}</p>}{business?.phone && <p>{business.phone}</p>}{settings.profile.taxId && <p>Tax ID: {settings.profile.taxId}</p>}</section><section><p className="invoice-label">Bill to</p><h3>{invoice.customer_name}</h3><p>{invoice.customer_phone}</p>{invoice.order_no && <p>Order #{invoice.order_no}</p>}</section><section className="invoice-dates"><p className="invoice-label">Issued</p><p>{formatDate(invoice.created_at)}</p><p className="invoice-label">Due</p><p>{formatDate(due.toISOString())}</p></section></div>
        <table className="invoice-table"><caption className="sr-only">Invoice items</caption><thead><tr><th scope="col">Description</th><th scope="col" className="right">Qty</th><th scope="col" className="right">Rate</th><th scope="col" className="right">Amount</th></tr></thead><tbody>{invoice.items?.map((item, index) => <tr key={index}><td><span>{item.product_name}</span><small>per {item.unit}</small></td><td className="right numeric">{Number(item.quantity)}</td><td className="right numeric">{money(item.unit_price)}</td><td className="right numeric">{money(item.total)}</td></tr>)}</tbody></table>
        <dl className="invoice-totals"><div><dt>Subtotal</dt><dd>{money(invoice.subtotal)}</dd></div><div><dt>Tax{invoice.tax_rate ? ' (' + invoice.tax_rate + '%)' : ''}</dt><dd>{money(invoice.tax)}</dd></div><div className="invoice-grand-total"><dt>Total</dt><dd>{money(invoice.total)}</dd></div><div><dt>Paid</dt><dd>{money(invoice.allocated_amount)}</dd></div><div className="invoice-balance"><dt>Balance due</dt><dd>{money(invoice.remaining_amount)}</dd></div></dl>
        <div className="invoice-notes"><section><p className="invoice-label">Payment information</p><p>{Number(invoice.remaining_amount) > 0 ? 'Please include ' + invoiceNumber(invoice, settings.billing.invoicePrefix) + ' with your payment reference.' : 'This invoice is fully paid. Thank you.'}</p><p>Status: {invoice.status === 'Pending' ? 'Unpaid' : invoice.status}</p></section>{(invoice.billing_footer ?? settings.billing.footer) && <section><p className="invoice-label">Notes</p><p>{invoice.billing_footer ?? settings.billing.footer}</p></section>}</div>
      </article>
      <div className="invoice-dock no-print"><Badge variant={invoice.status === 'Paid' ? 'success' : 'warning'}>{invoice.status === 'Pending' ? 'Unpaid' : invoice.status}</Badge><Button variant="ghost" onClick={() => onStatement(invoice.customer_id)}>Statement</Button><Button variant="outline" disabled={!!loadError} onClick={() => window.print()}><Printer size={17} aria-hidden="true" />Print / Save PDF</Button>{settings.modules.payments && Number(invoice.remaining_amount) > 0 && <Button onClick={() => onPayment(invoice.customer_id)}>Record payment</Button>}</div>
    </div>}
  </Modal>;
}
