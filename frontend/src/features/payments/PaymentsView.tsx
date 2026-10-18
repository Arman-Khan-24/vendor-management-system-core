import { useState } from 'react';
import { ArrowDownLeft, CreditCard, Download, Plus } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorNotice, Input, Modal, PageHeader, Pagination, SearchBox, Select, Textarea, usePagination } from '../../components/ui';
import type { Customer, Payment, PaymentInput, PaymentMode } from '../../types';
import { downloadCsv, errorMessage, formatDate, localDate } from '../../utils/formatters';
import { useBusiness } from '../settings/businessSettings';

export const paymentLabels: Record<PaymentMode, string> = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank transfer', cheque: 'Cheque' };
export function PaymentsView({ payments, onOpenRecord, onStatement }: { payments: Payment[]; onOpenRecord: () => void; onStatement: (id: string) => void }) {
  const { money } = useBusiness();
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState('');
  const [detail, setDetail] = useState<Payment | null>(null);
  const visible = payments.filter(p => (!mode || p.mode === mode) && (p.customer_name + ' ' + (p.reference || '')).toLowerCase().includes(search.toLowerCase()));
  const total = visible.reduce((sum, p) => sum + Number(p.amount), 0);
  const pages = usePagination(visible, JSON.stringify([mode, search]));
  return <div className="page-stack">
    <PageHeader eyebrow="Money in, peace of mind" title="Payments" description="A clear record of every collection, on the date it happened." actions={<><Button variant="outline" disabled={!visible.length} onClick={() => downloadCsv(['Date', 'Customer', 'Amount', 'Method', 'Reference', 'Notes'], visible.map(p => [p.date, p.customer_name, p.amount, paymentLabels[p.mode], p.reference, p.notes]), 'payments.csv')}><Download size={17} aria-hidden="true" />Export</Button><Button onClick={onOpenRecord}><Plus size={18} aria-hidden="true" />Record payment</Button></>} />
    <div className="card tonal"><div className="row between"><div><p className="small">Total in this view</p><p className="stat-value numeric" style={{ marginTop: 10 }}>{money(total)}</p><p className="small" style={{ marginTop: 8 }}>{visible.length} recorded payments</p></div><div className="hero-icon" style={{ position: 'static' }}><ArrowDownLeft size={24} aria-hidden="true" /></div></div></div>
    <div className="filter-bar"><SearchBox value={search} onChange={setSearch} label="Search payments" placeholder="Customer or payment reference…" /><Select aria-label="Filter by payment method" value={mode} onChange={e => setMode(e.target.value)}><option value="">All payment methods</option>{(Object.keys(paymentLabels) as PaymentMode[]).map(m => <option value={m} key={m}>{paymentLabels[m]}</option>)}</Select></div>
    {!visible.length ? <EmptyState icon={<CreditCard size={28} />} title={search || mode ? 'No matching payments' : 'Record your first collection'} description={search || mode ? 'Try another search or payment method.' : 'Money received is applied to the customer’s oldest unpaid invoices.'} action={<Button onClick={onOpenRecord}>Record a payment</Button>} /> :
      <div className="records">{pages.items.map(p => <div className="record-row" key={p.id}><div className="item-icon tonal"><ArrowDownLeft size={21} aria-hidden="true" /></div><div className="record-title"><strong>{p.customer_name}</strong><small>{formatDate(p.date)} · {p.reference || 'No reference'}</small></div><Badge>{paymentLabels[p.mode]}</Badge><div className="record-price numeric"><strong>{money(p.amount)}</strong><small>Received</small></div><div className="record-actions"><Button variant="secondary" size="sm" onClick={() => setDetail(p)}>Details</Button></div></div>)}</div>}
    <Pagination {...pages} />
    <Modal isOpen={!!detail} title="Payment details" onClose={() => setDetail(null)}>
      {detail && <div className="stack"><div className="total-box"><span>Payment received</span><strong>{money(detail.amount)}</strong></div><div className="detail-lines">{[['Customer', detail.customer_name], ['Payment date', formatDate(detail.date)], ['Method', paymentLabels[detail.mode]], ['Reference', detail.reference || 'Not provided']].map(([label, value]) => <div className="detail-line" key={label}><span className="muted">{label}</span><strong>{value}</strong></div>)}</div>{detail.notes && <p className="form-note">{detail.notes}</p>}<p className="muted small">Payments settle the oldest unpaid invoices first. Any remainder stays as customer credit.</p><div className="form-actions"><Button variant="ghost" onClick={() => setDetail(null)}>Close</Button><Button onClick={() => { setDetail(null); onStatement(detail.customer_id); }}>View customer statement</Button></div></div>}
    </Modal>
  </div>;
}
export function RecordPaymentModal({ customers, initialCustomerId, onClose, onSubmit, onSetup }: { customers: Customer[]; initialCustomerId?: string; onClose: () => void; onSubmit: (data: PaymentInput) => Promise<void>; onSetup: () => void }) {
  const { money, settings } = useBusiness();
  const [customerId, setCustomerId] = useState(initialCustomerId || customers.find(c => c.active)?.id || customers[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<PaymentMode>(settings.billing.paymentMethods[0] || 'cash');
  const [date, setDate] = useState(localDate());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customer = customers.find(c => c.id === customerId);
  const outstanding = Math.max(0, Number(customer?.outstanding_balance || 0));
  const credit = Math.max(0, Number(amount || 0) - outstanding);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError(null);
    try {
      if (!customerId || !customer) throw new Error('Choose a customer.');
      if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) throw new Error('Enter an amount greater than zero.');
      await onSubmit({ customerId, amount: Number(amount), mode, date, reference: reference.trim(), notes: notes.trim() });
      onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <Modal isOpen title="Record a payment" onClose={onClose} busy={busy}>
    {!customers.length ? <EmptyState title="Add a customer first" description="Payments are linked to a customer account." action={<Button onClick={onSetup}>Open customers</Button>} /> :
      <form className="stack" onSubmit={submit}><ErrorNotice message={error} focus /><Select label="Customer" value={customerId} required onChange={e => setCustomerId(e.target.value)}><option value="" disabled>Choose a customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}{!c.active ? ' (archived)' : ''}</option>)}</Select>
        <div className="form-note row between"><span>Current balance due</span><strong>{money(outstanding)}</strong></div>
        <Input label="Amount received" type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} required onChange={e => setAmount(e.target.value)} placeholder="0.00" autoFocus />
        <div className="form-grid"><Input label="Payment date" type="date" max={localDate()} value={date} required onChange={e => setDate(e.target.value)} /><Select label="Payment method" value={mode} onChange={e => setMode(e.target.value as PaymentMode)}>{settings.billing.paymentMethods.map(m => <option value={m} key={m}>{paymentLabels[m]}</option>)}</Select></div>
        <Input label="Reference number" value={reference} maxLength={100} onChange={e => setReference(e.target.value)} placeholder="UPI, bank or cheque reference (optional)" />
        <Textarea label="Notes" rows={2} value={notes} maxLength={500} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
        <p className="form-note">Applied to the oldest unpaid invoices first.{credit > 0 ? ' ' + money(credit) + ' will remain as customer credit for future invoices.' : ''}</p>
        <div className="form-actions"><Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" busy={busy}>Save payment</Button></div>
      </form>}
  </Modal>;
}
