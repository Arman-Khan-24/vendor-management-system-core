import { useState } from 'react';
import { Download, Printer, ReceiptText } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorNotice, LoadingState, Modal, PageHeader, SearchBox } from '../../components/ui';
import type { Invoice } from '../../types';
import { downloadCsv, formatDate, invoiceNumber } from '../../utils/formatters';
import { useBusiness } from '../settings/businessSettings';

export function InvoicesView({ invoices, onSelect }: { invoices: Invoice[]; onSelect: (invoice: Invoice) => void }) {
  const { settings, money, business } = useBusiness();
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const filtered = invoices.filter(i => (status === 'all' || (status === 'unpaid' ? i.status !== 'Paid' : i.status === 'Paid')) && (i.customer_name + ' ' + invoiceNumber(i, settings.billing.invoicePrefix)).toLowerCase().includes(search.toLowerCase()));
  const number = (i: Invoice) => invoiceNumber(i, settings.billing.invoicePrefix);
  return <div className="page-stack">
    <PageHeader eyebrow="Every order, accounted for" title="Invoices" description="Find, print, and track every invoice in your business." actions={<Button variant="outline" disabled={!filtered.length} onClick={() => downloadCsv(['Invoice', 'Customer', 'Date', 'Subtotal', 'Tax', 'Total', 'Paid', 'Remaining', 'Status'], filtered.map(i => [number(i), i.customer_name, i.created_at, i.subtotal, i.tax, i.total, i.allocated_amount, i.remaining_amount, i.status]), 'invoices.csv')}><Download size={17} aria-hidden="true" />Export invoices</Button>} />
    <div className="filter-bar"><SearchBox label="Search invoices" value={search} onChange={setSearch} placeholder="Invoice number or customer…" /><div className="chips">{[['all', 'All invoices'], ['unpaid', 'Unpaid'], ['paid', 'Paid']].map(([id, label]) => <button type="button" key={id} className={'chip ' + (status === id ? 'selected' : '')} aria-pressed={status === id} onClick={() => setStatus(id)}>{label}</button>)}</div></div>
    {!filtered.length ? <EmptyState icon={<ReceiptText size={28} />} title={search || status !== 'all' ? 'No matching invoices' : 'Your invoices will appear here'} description={search || status !== 'all' ? 'Try another search or filter.' : 'Invoices are created automatically when orders are marked ' + (business?.invoice_trigger || 'Delivered').toLowerCase() + '.'} /> :
      <div className="records">{filtered.map(invoice => <div className="record-row" key={invoice.id}>
        <div className="item-icon tonal-lavender"><ReceiptText size={21} aria-hidden="true" /></div>
        <div className="record-title"><button type="button" className="text-link" onClick={() => onSelect(invoice)}>{number(invoice)}</button><small>{invoice.customer_name} · {formatDate(invoice.created_at)}</small></div>
        <Badge variant={invoice.status === 'Paid' ? 'success' : invoice.status === 'Partial' ? 'info' : 'warning'}>{invoice.status === 'Pending' ? 'Unpaid' : invoice.status}</Badge>
        <div className="record-price numeric"><strong>{money(invoice.total)}</strong><small>{money(invoice.remaining_amount)} remaining</small></div>
        <div className="record-actions"><Button size="sm" variant="secondary" onClick={() => onSelect(invoice)}>View invoice</Button></div>
      </div>)}</div>}
    <p className="muted small">{filtered.length} invoices shown</p>
  </div>;
}
export function InvoiceModal({ invoice, loading, loadError, onClose, onPayment, onStatement }: { invoice: Invoice; loading?: boolean; loadError?: string | null; onClose: () => void; onPayment: (id: string) => void; onStatement: (id: string) => void }) {
  const { settings, business, money } = useBusiness();
  const due = new Date(invoice.created_at);
  due.setDate(due.getDate() + (invoice.credit_terms_days ?? settings.billing.defaultCreditTermsDays));
  return <Modal isOpen title={invoiceNumber(invoice, settings.billing.invoicePrefix)} onClose={onClose} wide>
    {loading ? <LoadingState label="Loading invoice…" /> : <div className="stack">
      <ErrorNotice message={loadError || null} />
      <div className="invoice-sheet">
        <div className="invoice-brand row between wrap"><div><h3>{business?.name}</h3>{settings.profile.address && <p className="muted small" style={{ whiteSpace: 'pre-wrap' }}>{settings.profile.address}</p>}<p className="muted small">{[business?.phone, settings.profile.email].filter(Boolean).join(' · ')}</p>{settings.profile.taxId && <p className="muted small">Tax ID: {settings.profile.taxId}</p>}</div><div className="right"><p className="eyebrow">INVOICE</p><strong>{invoiceNumber(invoice, settings.billing.invoicePrefix)}</strong><p className="muted small">{formatDate(invoice.created_at)}</p></div></div>
        <div className="row between wrap"><div><p className="eyebrow">BILLED TO</p><h3>{invoice.customer_name}</h3><p className="muted small">{invoice.customer_phone}</p></div><div className="right"><Badge variant={invoice.status === 'Paid' ? 'success' : 'warning'}>{invoice.status}</Badge><p className="muted small" style={{ marginTop: 8 }}>Due {formatDate(due.toISOString())}</p></div></div>
        <div className="detail-lines" style={{ marginTop: 24 }}>{invoice.items?.map((item, index) => <div className="detail-line" key={index}><div><strong>{item.product_name}</strong><small>{Number(item.quantity)} {item.unit} × {money(item.unit_price)}</small></div><strong>{money(item.total)}</strong></div>)}</div>
        <div className="detail-line"><span>Subtotal</span><strong>{money(invoice.subtotal)}</strong></div>
        <div className="detail-line"><span>Tax{invoice.tax_rate ? ' (' + invoice.tax_rate + '%)' : ''}</span><strong>{money(invoice.tax)}</strong></div>
        <div className="detail-line"><strong>Total</strong><strong>{money(invoice.total)}</strong></div>
        <div className="detail-line"><span>Paid</span><strong>{money(invoice.allocated_amount)}</strong></div>
        <div className="total-box" style={{ marginTop: 20 }}><span>Balance due</span><strong>{money(invoice.remaining_amount)}</strong></div>
        <p className="invoice-footer">{invoice.billing_footer ?? settings.billing.footer}</p>
      </div>
      <div className="form-actions no-print"><Button variant="ghost" onClick={() => onStatement(invoice.customer_id)}>Statement</Button><Button variant="outline" disabled={!!loadError} onClick={() => window.print()}><Printer size={17} aria-hidden="true" />Print / Save PDF</Button>{settings.modules.payments && Number(invoice.remaining_amount) > 0 && <Button onClick={() => onPayment(invoice.customer_id)}>Record payment</Button>}</div>
    </div>}
  </Modal>;
}
