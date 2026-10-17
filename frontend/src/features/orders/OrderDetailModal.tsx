import { useState } from 'react';
import { CheckCircle2, PackageCheck, ReceiptText, ShoppingBag, Truck } from 'lucide-react';
import { Button, ErrorNotice, LoadingState, Modal } from '../../components/ui';
import type { Order, OrderStatus } from '../../types';
import { errorMessage, formatDateTime, invoiceNumber } from '../../utils/formatters';
import { useBusiness } from '../settings/businessSettings';
import { OrderBadge } from './OrdersView';
export function OrderDetailModal({ order, loading = false, loadError, onClose, onUpdateStatus, onInvoice }: { order: Order; loading?: boolean; loadError?: string | null; onClose: () => void; onUpdateStatus: (id: string, status: OrderStatus) => Promise<void>; onInvoice: (id: string) => void }) {
  const { money, settings } = useBusiness();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const advance = async (status: OrderStatus) => {
    setBusy(true); setError(null);
    try { await onUpdateStatus(order.id, status); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const stages = [{ name: 'Received', date: order.created_at, done: true, icon: ShoppingBag }, { name: 'Packed', date: order.packed_at, done: order.status !== 'Received', icon: PackageCheck }, { name: 'Delivered', date: order.delivered_at, done: order.status === 'Delivered', icon: Truck }];
  return <Modal isOpen title={'Order #' + order.order_no} onClose={onClose} wide busy={busy}>
    {loading ? <LoadingState label="Loading order details…" /> : <div className="stack">
      <ErrorNotice message={loadError || error} />
      <div className="row between wrap"><div><h3>{order.customer_name}</h3><a className="muted small" href={'tel:' + (order.customer_phone || '').replace(/[^\d+]/g, '')}>{order.customer_phone}</a></div><OrderBadge status={order.status} /></div>
      <div className="status-steps">{stages.map(({ name, date, done, icon: Icon }) => <div key={name} className={'status-step ' + (done ? 'done' : '')}><Icon size={20} aria-hidden="true" /><strong>{name}</strong><small>{date ? formatDateTime(date) : 'Not yet'}</small></div>)}</div>
      <div><div className="row between"><h3>Order items</h3><span className="small muted">Prices at time of order</span></div><div className="detail-lines" style={{ marginTop: 14 }}>{order.items?.map(item => <div className="detail-line" key={item.id}><div><strong>{item.product_name}</strong><small>{Number(item.quantity)} {item.unit} × {money(item.unit_price_at_order)}</small></div><strong className="numeric">{money(item.total_price)}</strong></div>)}</div></div>
      {Number(order.tax) > 0 && <div className="row between muted small"><span>Tax ({order.tax_rate}%)</span><span>{money(order.tax)}</span></div>}
      <div className="total-box"><span>Order total</span><strong className="numeric">{money(order.total_amount)}</strong></div>
      {order.notes && <div className="form-note"><strong>Order notes</strong><p style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{order.notes}</p></div>}
      {order.invoice_id && order.invoice_no && <Button variant="secondary" onClick={() => onInvoice(order.invoice_id!)}><ReceiptText size={18} aria-hidden="true" />Open {invoiceNumber({ invoice_no: order.invoice_no, invoice_prefix: order.invoice_prefix }, settings.billing.invoicePrefix)}</Button>}
      <div className="form-actions"><Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>{order.status !== 'Delivered' && !loadError && <Button busy={busy} onClick={() => advance(order.status === 'Received' ? 'Packed' : 'Delivered')}>{order.status === 'Received' ? <PackageCheck size={18} aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />}{order.status === 'Received' ? 'Mark as packed' : 'Mark as delivered'}</Button>}</div>
    </div>}
  </Modal>;
}
