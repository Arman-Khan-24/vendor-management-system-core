import { ArrowDownLeft, ArrowUpRight, Check, CheckCircle2, Clock3, Package, Plus, ReceiptText, ShoppingBag, Truck, Users } from 'lucide-react';
import { Badge, Button, Card, EmptyState, PageHeader, SectionHeading, TextLink } from '../../components/ui';
import type { Customer, DashboardSummary, Order, Product } from '../../types';
import { formatDate, localDate } from '../../utils/formatters';
import { useBusiness } from '../settings/businessSettings';
import { OrderBadge } from '../orders/OrdersView';

export function DashboardView({ summary, customers, products, orders, userName, onNavigateTab, onOpenNewOrder, onOpenRecordPayment, onSelectOrder, onStatement }: {
  summary: DashboardSummary; customers: Customer[]; products: Product[]; orders: Order[]; userName: string;
  onNavigateTab: (tab: string) => void; onOpenNewOrder: () => void; onOpenRecordPayment: () => void;
  onSelectOrder: (order: Order) => void; onStatement: (id: string) => void;
}) {
  const { settings, money } = useBusiness();
  const dateLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const activeOrders = Number(summary.statusCounts.Received || 0) + Number(summary.statusCounts.Packed || 0);
  const allOrders = activeOrders + Number(summary.statusCounts.Delivered || 0);
  const ready = products.some(p => p.active) && customers.some(c => c.active) && orders.length > 0;
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(); date.setDate(date.getDate() - (6 - index));
    const amount = (summary.salesTrend || []).filter(p => p.period.slice(0, 10) === localDate(date)).reduce((sum, p) => sum + Number(p.salesAmount), 0);
    return { label: date.toLocaleDateString('en-IN', { weekday: 'short' }), amount, date: localDate(date) };
  });
  const max = Math.max(...days.map(d => d.amount), 1);
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';
  return <div className="page-stack">
    <PageHeader eyebrow={dateLabel} title={greeting + ', ' + (userName.split(' ')[0] || 'there') + '.'} description="Here’s how your business is doing today." actions={settings.modules.payments ? <Button variant="secondary" onClick={onOpenRecordPayment}><Plus size={18} aria-hidden="true" />Record payment</Button> : undefined} />
    {!ready && <Card><SectionHeading title="A little setup goes a long way" description="Three simple steps to your first completed order." /><div className="checklist">{[
      { title: 'Build your catalog', description: 'Products, units and prices', done: products.some(p => p.active), action: () => onNavigateTab('products'), icon: Package },
      { title: 'Add a customer', description: 'Contact and payment terms', done: customers.some(c => c.active), action: () => onNavigateTab('customers'), icon: Users },
      { title: 'Take the first order', description: 'Bring it all together', done: orders.length > 0, action: onOpenNewOrder, icon: ShoppingBag },
    ].map(({ title, description, done, action, icon: Icon }) => <button key={title} onClick={action}><span className="item-icon tonal">{done ? <Check size={21} aria-hidden="true" /> : <Icon size={21} aria-hidden="true" />}</span><span><strong>{title}</strong><small>{description}</small></span></button>)}</div></Card>}
    <div className="dashboard-grid">
      <div className="card tonal overview-hero"><h2>Total outstanding</h2><div className="hero-icon"><ReceiptText size={21} aria-hidden="true" /></div><div className="hero-value numeric">{money(summary.totalOutstanding)}</div><p className="small">Waiting to come back to your business.</p><div className="hero-detail"><div><span>Overdue</span><strong className="numeric">{money(summary.totalOverdue || 0)}</strong></div><div><span>Received so far</span><strong className="numeric">{money(summary.totalCollected)}</strong></div><Button variant="ghost" className="ml-auto" onClick={() => onNavigateTab('invoices')}>View invoices<ArrowUpRight size={17} aria-hidden="true" /></Button></div></div>
      <Card><SectionHeading title="Orders in motion" description="Every stage, at a glance." action={<Badge>{activeOrders} active</Badge>} /><div className="progress-rail" aria-label={activeOrders + ' active orders and ' + (summary.statusCounts.Delivered || 0) + ' delivered'}>
        <span className="tonal-peach" style={{ width: allOrders ? (summary.statusCounts.Received / allOrders * 100) + '%' : '0%' }} />
        <span className="tonal-sky" style={{ width: allOrders ? (summary.statusCounts.Packed / allOrders * 100) + '%' : '0%' }} />
        <span className="tonal" style={{ width: allOrders ? (summary.statusCounts.Delivered / allOrders * 100) + '%' : '0%' }} />
      </div><div className="progress-labels"><div><strong>{summary.statusCounts.Received || 0}</strong>Received</div><div><strong>{summary.statusCounts.Packed || 0}</strong>Packed</div><div><strong>{summary.statusCounts.Delivered || 0}</strong>Delivered</div></div><div style={{ marginTop: 20 }}><TextLink onClick={() => onNavigateTab('orders')}>Open orders</TextLink></div></Card>
    </div>
    <div className="stat-grid">
      <div className="stat-card tonal-peach"><div className="stat-label"><span>Sales today</span><ShoppingBag size={20} aria-hidden="true" /></div><strong className="stat-value numeric">{money(summary.todaySales)}</strong><p className="stat-foot">{summary.todayOrdersCount} orders placed today</p></div>
      <div className="stat-card tonal-lavender"><div className="stat-label"><span>Collected today</span><ArrowDownLeft size={20} aria-hidden="true" /></div><strong className="stat-value numeric">{money(summary.todayCollected)}</strong><p className="stat-foot">By the payment date you recorded</p></div>
      <div className="stat-card tonal-sky"><div className="stat-label"><span>Ready to deliver</span><Truck size={20} aria-hidden="true" /></div><strong className="stat-value numeric">{summary.statusCounts.Packed || 0}</strong><p className="stat-foot">{summary.statusCounts.Received || 0} more waiting to be packed</p></div>
    </div>
    <div className="dashboard-grid">
      <Card><SectionHeading title="Recent orders" description="The latest activity in your ledger." action={<TextLink onClick={() => onNavigateTab('orders')}>View all</TextLink>} />
        {!orders.length ? <EmptyState title="A fresh start" description="Your first order will show up here." action={<Button variant="secondary" onClick={onOpenNewOrder}>New order</Button>} /> : orders.slice(0, 4).map(order => <div className="activity-row" key={order.id}><div className="item-icon tonal"><ShoppingBag size={19} aria-hidden="true" /></div><div className="grow"><button type="button" className="text-link" style={{ minHeight: 24, padding: 0 }} onClick={() => onSelectOrder(order)}>{order.customer_name}</button><p>#{order.order_no} · {formatDate(order.created_at)}</p></div><div className="right"><strong className="numeric">{money(order.total_amount)}</strong><div style={{ marginTop: 5 }}><OrderBadge status={order.status} /></div></div></div>)}
      </Card>
      <Card><SectionHeading title="Your week in sales" description="The past seven days, including today." /><strong className="stat-value numeric" style={{ fontSize: 28 }}>{money(days.reduce((sum, d) => sum + d.amount, 0))}</strong><div className="mini-chart" role="img" aria-label={'Sales for the past seven days: ' + days.map(d => d.label + ' ' + money(d.amount)).join(', ')}>{days.map(d => <div className="chart-column" key={d.date} title={d.label + ': ' + money(d.amount)}><div className="bar" style={{ height: Math.max(4, d.amount / max * 100) + '%' }} /><span>{d.label}</span></div>)}</div>{settings.modules.reports && <div style={{ marginTop: 14 }}><TextLink onClick={() => onNavigateTab('reports')}>Explore reports</TextLink></div>}</Card>
    </div>
    <Card><SectionHeading title="A gentle nudge" description="Customers with invoices past their payment terms." action={settings.modules.reports ? <TextLink onClick={() => onNavigateTab('reports')}>View dues</TextLink> : undefined} />
      {!summary.overdueCustomers?.length ? <div className="row" style={{ padding: '12px 0' }}><div className="item-icon tonal"><CheckCircle2 size={22} aria-hidden="true" /></div><div><strong className="small">No overdue customers</strong><p className="muted small">A good place to be. Keep the ledger up to date.</p></div></div> : summary.overdueCustomers.slice(0, 4).map(customer => <div className="activity-row" key={customer.id}><div className="item-icon tonal-peach"><Clock3 size={20} aria-hidden="true" /></div><div className="grow"><strong>{customer.name}</strong><p>{customer.creditTermsDays} day payment terms</p></div><strong className="numeric">{money(customer.overdueAmount ?? customer.balance)}</strong><Button variant="secondary" size="sm" onClick={() => onStatement(customer.id)}>Statement</Button></div>)}
    </Card>
  </div>;
}
