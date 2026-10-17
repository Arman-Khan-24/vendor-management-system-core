import { useState } from 'react';
import { Download, Plus, ShoppingBag } from 'lucide-react';
import { Badge, Button, EmptyState, PageHeader, SearchBox } from '../../components/ui';
import type { Order, OrderStatus } from '../../types';
import { downloadCsv, formatDate } from '../../utils/formatters';
import { useBusiness } from '../settings/businessSettings';
export function OrdersView({ orders, onSelectOrder, onOpenNewOrder }: { orders: Order[]; onSelectOrder: (order: Order) => void; onOpenNewOrder: () => void }) {
  const { money } = useBusiness();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const filtered = orders.filter(o => (status === 'all' || o.status === status) && (o.customer_name + ' ' + o.order_no).toLowerCase().includes(search.toLowerCase()));
  return <div className="page-stack">
    <PageHeader eyebrow="From first order to front door" title="Orders" description="Know what is received, ready, and on its way." actions={<><Button variant="outline" disabled={!filtered.length} onClick={() => downloadCsv(['Order', 'Customer', 'Date', 'Status', 'Total'], filtered.map(o => [o.order_no, o.customer_name, o.created_at, o.status, o.total_amount]), 'orders.csv')}><Download size={17} aria-hidden="true" />Export</Button><Button onClick={onOpenNewOrder}><Plus size={18} aria-hidden="true" />New order</Button></>} />
    <div className="filter-bar"><SearchBox value={search} onChange={setSearch} label="Search orders" placeholder="Customer name or order number…" /><p className="muted small">{filtered.length} orders</p></div>
    <div className="chips">{['all', 'Received', 'Packed', 'Delivered'].map(s => <button type="button" key={s} className={'chip ' + (status === s ? 'selected' : '')} aria-pressed={status === s} onClick={() => setStatus(s)}>{s === 'all' ? 'All orders' : s}<span className="chip-count">{s === 'all' ? orders.length : orders.filter(o => o.status === s).length}</span></button>)}</div>
    {!filtered.length ? <EmptyState icon={<ShoppingBag size={28} />} title={search || status !== 'all' ? 'No orders here yet' : 'Ready for the first order?'} description={search || status !== 'all' ? 'Try another search or status.' : 'Choose a customer, add products, and we will keep the details together.'} action={<Button onClick={onOpenNewOrder}>Create an order</Button>} /> :
      <div className="records">{filtered.map(order => <div className="record-row" key={order.id}>
        <div className="item-icon tonal"><ShoppingBag size={20} aria-hidden="true" /></div>
        <div className="record-title"><button type="button" className="text-link" onClick={() => onSelectOrder(order)}>Order #{order.order_no}</button><small>{order.customer_name} · {formatDate(order.created_at)}</small></div>
        <OrderBadge status={order.status} /><div className="record-price numeric"><strong>{money(order.total_amount)}</strong><small>{order.items?.length ? order.items.length + ' items' : order.source === 'manual' ? 'Manual order' : 'WhatsApp order'}</small></div>
        <div className="record-actions"><Button variant="secondary" size="sm" onClick={() => onSelectOrder(order)}>View order</Button></div>
      </div>)}</div>}
  </div>;
}
export function OrderBadge({ status }: { status: OrderStatus }) { return <Badge variant={status === 'Delivered' ? 'success' : status === 'Packed' ? 'info' : 'warning'}>{status}</Badge>; }
