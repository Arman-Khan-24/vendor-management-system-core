import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, CheckCircle2, Clock3, Package, ReceiptText, ShoppingBag, Users } from 'lucide-react';
import { Badge, Button, Card, EmptyState, PageHeader, SectionHeading, TextLink } from '../../components/ui';
import type { Customer, DashboardSummary, Invoice, Order, Payment, Product } from '../../types';
import { formatDate, invoiceNumber } from '../../utils/formatters';
import { useBusiness } from '../settings/businessSettings';
import { paymentLabels } from '../payments/PaymentsView';

export function DashboardView({ summary, customers, products, orders, payments, invoices, userName, onNavigateTab, onOpenNewOrder, onOpenRecordPayment, onSelectOrder, onStatement, onInvoice }: {
  summary: DashboardSummary; customers: Customer[]; products: Product[]; orders: Order[]; payments: Payment[]; invoices: Invoice[]; userName: string;
  onNavigateTab: (tab: string) => void; onOpenNewOrder: () => void; onOpenRecordPayment: (customerId?: string) => void;
  onSelectOrder: (order: Order) => void; onStatement: (id: string) => void; onInvoice: (id: string) => void;
}) {
  const { settings, money } = useBusiness();
  const [activity, setActivity] = useState('all');
  const dateLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const ready = products.some(p => p.active) && customers.some(c => c.active) && orders.length > 0;
  const activeOrders = Number(summary.statusCounts.Received || 0) + Number(summary.statusCounts.Packed || 0);
  const totalOrders = activeOrders + Number(summary.statusCounts.Delivered || 0);
  const outstanding = Math.max(0, Number(summary.totalOutstanding));
  const overdue = Math.min(outstanding, Math.max(0, Number(summary.totalOverdue || 0)));
  const collected = Math.max(0, Number(summary.totalCollected));
  const ringTotal = collected + outstanding;
  const ring = [
    { label: 'Collected', value: collected, className: 'ring-collected' },
    { label: 'Due', value: outstanding - overdue, className: 'ring-due' },
    { label: 'Overdue', value: overdue, className: 'ring-overdue' },
  ];
  const activityRows = useMemo(() => [
    ...orders.slice(0, 12).map(order => ({ id: order.id, kind: 'Order', date: order.created_at, name: order.customer_name, reference: '#' + order.order_no, amount: order.total_amount, status: order.status, action: () => onSelectOrder(order) })),
    ...invoices.slice(0, 12).map(invoice => ({ id: invoice.id, kind: 'Invoice', date: invoice.created_at, name: invoice.customer_name, reference: invoiceNumber(invoice, settings.billing.invoicePrefix), amount: invoice.total, status: invoice.status === 'Pending' ? 'Unpaid' : invoice.status, action: () => onInvoice(invoice.id) })),
    ...payments.slice(0, 12).map(payment => ({ id: payment.id, kind: 'Payment', date: payment.date, name: payment.customer_name, reference: payment.reference || paymentLabels[payment.mode], amount: payment.amount, status: 'Received', action: () => onStatement(payment.customer_id) })),
  ].sort((a, b) => b.date.localeCompare(a.date)), [orders, invoices, payments, settings.billing.invoicePrefix, onSelectOrder, onInvoice, onStatement]);
  const visibleActivity = activityRows.filter(row => activity === 'all' || row.kind === activity).slice(0, 6);
  const waiting = invoices.filter(invoice => Number(invoice.remaining_amount) > 0).slice(0, 2);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(); date.setUTCDate(date.getUTCDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);
    return { date: key, label: date.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }), amount: (summary.salesTrend || []).filter(point => point.period.slice(0, 10) === key).reduce((sum, point) => sum + Number(point.salesAmount), 0) };
  });
  const maxSales = Math.max(1, ...days.map(day => day.amount));
  let ringOffset = 0;

  return <div className="page-stack dashboard-page">
    <PageHeader eyebrow={dateLabel} title="Your business, in balance." description={'Welcome back, ' + (userName.split(' ')[0] || 'there') + '. Here’s what needs your attention.'} />
    {!ready && <Card className="setup-card"><SectionHeading title="A little setup goes a long way" description="Your first order starts with these three steps." /><div className="checklist">{[
      { title: 'Build your catalog', description: 'Products, units and prices', done: products.some(p => p.active), action: () => onNavigateTab('products'), icon: Package },
      { title: 'Add a customer', description: 'Contact and payment terms', done: customers.some(c => c.active), action: () => onNavigateTab('customers'), icon: Users },
      { title: 'Take the first order', description: 'Create your first invoice', done: orders.length > 0, action: onOpenNewOrder, icon: ShoppingBag },
    ].map(({ title, description, done, action, icon: Icon }) => <button type="button" key={title} onClick={action}><span className="item-icon tonal">{done ? <Check size={20} aria-hidden="true" /> : <Icon size={20} aria-hidden="true" />}</span><span><strong>{title}</strong><small>{description}</small></span><ArrowUpRight size={16} aria-hidden="true" /></button>)}</div></Card>}
    <div className="billing-dashboard">
      <aside className="dashboard-summary">
        <div className="balance-ring-panel">
          <div className="balance-ring">
            <svg viewBox="0 0 240 240" role="img" aria-label={'Payments: ' + ring.map(segment => segment.label + ' ' + money(segment.value)).join(', ')}><circle cx="120" cy="120" r="97" pathLength="100" className="ring-track" />{ringTotal > 0 && ring.map(segment => {
              const length = segment.value / ringTotal * 100;
              const offset = ringOffset; ringOffset += length;
              return length > 0 ? <circle key={segment.label} cx="120" cy="120" r="97" pathLength="100" className={segment.className} strokeDasharray={Math.max(0.05, length - 2.5) + ' 100'} strokeDashoffset={-offset} /> : null;
            })}</svg>
            <div className="ring-center"><ReceiptText size={20} aria-hidden="true" /><span>Total outstanding</span><strong className="numeric">{money(outstanding)}</strong><button type="button" onClick={() => onNavigateTab('invoices')}>View invoices<ArrowUpRight size={13} aria-hidden="true" /></button></div>
          </div>
          <div className="ring-legend">{ring.map(segment => <span key={segment.label}><i className={segment.className} />{segment.label}</span>)}</div>
        </div>
        <div className="metric-card metric-pink"><div className="metric-heading"><span className="metric-icon"><ArrowDownLeft size={17} aria-hidden="true" /></span><h2>Payments received</h2></div><strong className="metric-value numeric">{money(collected)}</strong><p>{money(summary.todayCollected)} collected today</p></div>
        <div className="metric-card metric-blue"><div className="metric-heading"><span className="metric-icon"><Clock3 size={17} aria-hidden="true" /></span><h2>Payments outstanding</h2></div><strong className="metric-value numeric">{money(outstanding)}</strong><p>{money(overdue)} past payment terms</p></div>
        <div className="metric-card metric-yellow"><div className="metric-heading"><span className="metric-icon"><ShoppingBag size={17} aria-hidden="true" /></span><h2>Sales today</h2></div><strong className="metric-value numeric">{money(summary.todaySales)}</strong><p>{summary.todayOrdersCount} {summary.todayOrdersCount === 1 ? 'order' : 'orders'} placed today</p></div>
      </aside>
      <div className="dashboard-work">
        <section><SectionHeading title="Waiting for payment" action={<TextLink onClick={() => onNavigateTab('invoices')}>All invoices</TextLink>} /><div className="waiting-grid">{waiting.length ? waiting.map((invoice, index) => <div className="waiting-card" key={invoice.id}><div className="row"><span className={'item-icon ' + (index ? 'tonal-pink' : 'tonal-sky')}><ReceiptText size={18} aria-hidden="true" /></span><div className="grow"><strong>{invoice.customer_name}</strong><p>{invoiceNumber(invoice, settings.billing.invoicePrefix)}</p></div><Badge variant={invoice.status === 'Partial' ? 'info' : 'warning'}>{invoice.status === 'Partial' ? 'Partial' : 'Unpaid'}</Badge></div><div className="waiting-actions"><strong className="numeric">{money(invoice.remaining_amount)}</strong><Button size="sm" onClick={() => settings.modules.payments ? onOpenRecordPayment(invoice.customer_id) : onInvoice(invoice.id)}>{settings.modules.payments ? 'Record payment' : 'View invoice'}</Button></div></div>) : <div className="waiting-empty"><CheckCircle2 size={22} aria-hidden="true" /><div><strong>No payments waiting</strong><p>Your unpaid invoices will appear here.</p></div></div>}</div></section>
        <section><SectionHeading title="Latest collections" action={settings.modules.payments ? <TextLink onClick={() => onNavigateTab('payments')}>All payments</TextLink> : undefined} /><div className="collection-strip">{payments.length ? payments.slice(0, 3).map(payment => <button type="button" className="collection-card" key={payment.id} onClick={() => onStatement(payment.customer_id)}><div className="collection-heading"><strong>{payment.customer_name}</strong><span className="collection-amount numeric">+ {money(payment.amount)}</span></div><p>{paymentLabels[payment.mode]} · {payment.reference || 'No reference'}</p><div className="row between"><span>{formatDate(payment.date)}</span><ArrowUpRight size={16} aria-hidden="true" /></div></button>) : <div className="inline-empty">Record a payment to see your latest collections.</div>}</div></section>
        <section className="dashboard-activity"><div className="filter-bar"><h2>Recent activity</h2><div className="chips" aria-label="Activity filters">{[['all', 'All'], ['Order', 'Orders'], ['Invoice', 'Invoices'], ['Payment', 'Payments']].map(([id, label]) => <button type="button" key={id} className={'chip ' + (activity === id ? 'selected' : '')} aria-pressed={activity === id} onClick={() => setActivity(id)}>{label}</button>)}</div></div>
          {!visibleActivity.length ? <EmptyState title="Your activity starts here" description="Orders, invoices, and payments will appear as you work." action={<Button onClick={onOpenNewOrder}>Create an order</Button>} /> : <div className="dashboard-table"><table><thead><tr><th>Type / reference</th><th>Customer</th><th>Date</th><th className="right">Amount</th><th>Status</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{visibleActivity.map(row => <tr key={row.kind + row.id}><td><strong>{row.kind}</strong><small>{row.reference}</small></td><td>{row.name}</td><td>{formatDate(row.date)}</td><td className="right numeric">{money(row.amount)}</td><td><Badge variant={row.status === 'Paid' || row.kind === 'Payment' || row.status === 'Delivered' ? 'success' : row.status === 'Packed' || row.status === 'Partial' ? 'info' : 'warning'}>{row.status}</Badge></td><td><Button variant="ghost" className="icon-button" aria-label={'Open ' + row.kind.toLowerCase() + ' ' + row.reference} onClick={row.action}><ArrowUpRight size={18} /></Button></td></tr>)}</tbody></table></div>}
        </section>
        <div className="dashboard-lower"><Card><SectionHeading title="Orders in motion" action={<Badge>{activeOrders} active</Badge>} /><div className="progress-rail" aria-label={activeOrders + ' active orders and ' + (summary.statusCounts.Delivered || 0) + ' delivered'}>{(['Received', 'Packed', 'Delivered'] as const).map((status, index) => <span key={status} className={['tonal-yellow', 'tonal-sky', 'tonal-pink'][index]} style={{ width: totalOrders ? Number(summary.statusCounts[status] || 0) / totalOrders * 100 + '%' : '0%' }} />)}</div><div className="progress-labels">{(['Received', 'Packed', 'Delivered'] as const).map(status => <div key={status}><strong>{summary.statusCounts[status] || 0}</strong>{status}</div>)}</div><TextLink onClick={() => onNavigateTab('orders')}>Open orders</TextLink></Card><Card><SectionHeading title="Your week in sales" /><strong className="week-total numeric">{money(days.reduce((sum, day) => sum + day.amount, 0))}</strong><div className="mini-chart" role="img" aria-label={'Sales in UTC calendar days: ' + days.map(day => day.label + ' ' + money(day.amount)).join(', ')}>{days.map(day => <div className="chart-column" key={day.date} title={day.label + ': ' + money(day.amount)}><div className="bar" style={{ height: day.amount > 0 ? Math.max(3, day.amount / maxSales * 100) + '%' : '0%' }} /><span>{day.label}</span></div>)}</div></Card></div>
      </div>
    </div>
    <Card><SectionHeading title="Past payment terms" description="Open a statement before following up with a customer." action={settings.modules.reports ? <TextLink onClick={() => onNavigateTab('reports')}>View dues</TextLink> : undefined} />{!summary.overdueCustomers?.length ? <div className="row"><CheckCircle2 size={22} aria-hidden="true" /><p className="muted small">No overdue customers. Keep recording collections as they arrive.</p></div> : summary.overdueCustomers.slice(0, 4).map(customer => <div className="activity-row" key={customer.id}><div className="item-icon tonal-yellow"><Clock3 size={19} aria-hidden="true" /></div><div className="grow"><strong>{customer.name}</strong><p>{customer.creditTermsDays} day payment terms</p></div><strong className="numeric">{money(customer.overdueAmount ?? customer.balance)}</strong><Button variant="outline" size="sm" onClick={() => onStatement(customer.id)}>Statement</Button></div>)}</Card>
  </div>;
}
