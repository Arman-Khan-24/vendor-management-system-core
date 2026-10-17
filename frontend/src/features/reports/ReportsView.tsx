import { useEffect, useState } from 'react';
import { BarChart3, Download, ReceiptText } from 'lucide-react';
import { ApiClient } from '../../api/client';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, LoadingState, PageHeader, SectionHeading, Select } from '../../components/ui';
import { downloadCsv, errorMessage, formatDate, localDate } from '../../utils/formatters';
import { useBusiness } from '../settings/businessSettings';
import { paymentLabels } from '../payments/PaymentsView';
import type { PaymentMode } from '../../types';

export function ReportsView({ onOpenStatement }: { onOpenStatement: (id: string) => void }) {
  const { money } = useBusiness();
  const [tab, setTab] = useState('dues');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [interval, setInterval] = useState<'day' | 'week' | 'month'>('day');
  const [filter, setFilter] = useState({ startDate: '', endDate: '', interval: 'day' as 'day' | 'week' | 'month' });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(null); setData(null);
    const fetchData = async () => {
      try {
        const result = tab === 'dues' ? await ApiClient.getDuesReport(filter.endDate || undefined) :
          tab === 'sales' ? await ApiClient.getSalesReport(filter) : tab === 'collections' ? await ApiClient.getCollectionReport(filter) :
          { customers: await ApiClient.getTopCustomers({ ...filter, limit: 10 }), products: await ApiClient.getTopProducts({ ...filter, limit: 10 }) };
        if (current) setData(result);
      } catch (e) { if (current) setError(errorMessage(e)); } finally { if (current) setLoading(false); }
    };
    void fetchData();
    return () => { current = false; };
  }, [tab, filter, retry]);
  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    if (start && end && start > end && tab !== 'dues') { setError('The start date must be on or before the end date.'); return; }
    setFilter({ startDate: start, endDate: end, interval });
  };
  const clear = () => { setStart(''); setEnd(''); setInterval('day'); setFilter({ startDate: '', endDate: '', interval: 'day' }); };
  const exportReport = () => {
    if (!data) return;
    if (tab === 'dues') downloadCsv(['Customer', 'Phone', 'Outstanding', 'Overdue', 'Unpaid invoices'], data.customers.map((c: any) => [c.customerName, c.customerPhone, c.totalOutstanding, c.totalOverdue, c.invoiceCount]), 'dues-report.csv');
    else if (tab === 'sales') downloadCsv(['Period', 'Orders', 'Sales'], data.series.map((p: any) => [p.period, p.orderCount, p.salesAmount]), 'sales-report.csv');
    else if (tab === 'collections') downloadCsv(['Period', 'Payments', 'Collected'], data.series.map((p: any) => [p.period, p.paymentCount, p.collectedAmount]), 'collections-report.csv');
    else downloadCsv(['Customer', 'Orders', 'Sales'], data.customers.map((c: any) => [c.name, c.orderCount, c.totalSales]), 'top-customers.csv');
  };
  return <div className="page-stack">
    <PageHeader eyebrow="See the bigger picture" title="Business reports" description="A clear view of sales, collections, and what is still due." actions={<Button variant="outline" disabled={!data || loading} onClick={exportReport}><Download size={17} aria-hidden="true" />{tab === 'rankings' ? 'Export customers' : 'Export report'}</Button>} />
    <div className="chips">{[['dues', 'Dues & aging'], ['sales', 'Sales'], ['collections', 'Collections'], ['rankings', 'Top customers & products']].map(([id, label]) => <button type="button" key={id} className={'chip ' + (tab === id ? 'selected' : '')} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
    <Card><form className="date-filter" onSubmit={apply}>{tab !== 'dues' && <Input label="From date" type="date" value={start} max={end || undefined} onChange={e => setStart(e.target.value)} />}<Input label={tab === 'dues' ? 'Balances as of' : 'To date'} type="date" value={end} max={tab === 'dues' ? localDate() : undefined} onChange={e => setEnd(e.target.value)} />{['sales', 'collections'].includes(tab) && <Select label="Group by" value={interval} onChange={e => setInterval(e.target.value as typeof interval)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></Select>}<Button type="submit" variant="secondary">Apply</Button><Button variant="ghost" onClick={clear}>Clear</Button></form>{tab === 'dues' && <p className="muted small" style={{ marginTop: 12 }}>Leave blank for current balances.</p>}</Card>
    <ErrorNotice message={error} retry={() => setRetry(n => n + 1)} />
    {loading ? <LoadingState label="Preparing your report…" /> : data && <>
      {tab === 'dues' && <>
        <div className="report-totals"><div className="report-total tonal"><span>Total outstanding</span><strong className="numeric">{money(data.totalOutstanding)}</strong><small>{data.customerCountWithDues} customers with dues</small></div><div className="report-total tonal-peach"><span>Past payment terms</span><strong className="numeric">{money(data.totalOverdue)}</strong><small>Overdue invoices</small></div><div className="report-total tonal-lavender"><span>Unpaid invoices</span><strong>{data.unpaidInvoiceCount}</strong><small>Including partial payments</small></div></div>
        <Card><SectionHeading title="How long has it been due?" /><div className="chips">{[['current', 'Within terms'], ['overdue_1_7', '1–7 days'], ['overdue_8_15', '8–15 days'], ['overdue_16_30', '16–30 days'], ['overdue_30_plus', '30+ days']].map(([key, label]) => <div className="form-note grow" key={key}><p>{label}</p><strong className="numeric">{money(data.agingBuckets?.[key])}</strong></div>)}</div></Card>
        {!data.customers?.length ? <EmptyState icon={<ReceiptText size={27} />} title="No outstanding dues" description="All invoices are settled for this period." /> : <div className="records">{data.customers.map((c: any) => <div className="record-row" key={c.customerId}><div className="record-title"><strong>{c.customerName}</strong><small>{c.creditTermsDays} day terms · {c.invoiceCount} open invoices</small></div><div className="record-price numeric"><strong>{money(c.totalOutstanding)}</strong><small>{money(c.totalOverdue)} overdue</small></div><Button variant="secondary" size="sm" onClick={() => onOpenStatement(c.customerId)}>Statement</Button></div>)}</div>}
      </>}
      {['sales', 'collections'].includes(tab) && <>
        <div className="report-totals"><div className="report-total tonal"><span>{tab === 'sales' ? 'Total sales' : 'Total collected'}</span><strong className="numeric">{money(tab === 'sales' ? data.totalSales : data.totalCollected)}</strong><small>{filter.startDate || filter.endDate ? 'For the selected period' : 'Across all dates'}</small></div><div className="report-total tonal-lavender"><span>{tab === 'sales' ? 'Orders' : 'Payments'}</span><strong>{tab === 'sales' ? data.orderCount : data.paymentCount}</strong></div><div className="report-total tonal-sky"><span>{tab === 'sales' ? 'Average order' : 'Average payment'}</span><strong className="numeric">{money(tab === 'sales' ? data.averageOrderValue ?? (data.orderCount ? data.totalSales / data.orderCount : 0) : data.paymentCount ? data.totalCollected / data.paymentCount : 0)}</strong></div></div>
        {tab === 'collections' && data.modeBreakdown?.length > 0 && <Card><SectionHeading title="How customers paid" /><div className="chips">{data.modeBreakdown.map((m: any) => <div className="form-note grow" key={m.mode}><p>{paymentLabels[m.mode as PaymentMode] || m.mode}</p><strong>{money(m.amount)}</strong><p className="small">{m.count} payments</p></div>)}</div></Card>}
        {!data.series?.length ? <EmptyState icon={<BarChart3 size={28} />} title="No activity in this period" description="Choose another date range to see your report." /> : <div className="table-scroll"><table><thead><tr><th>Period</th><th>{tab === 'sales' ? 'Orders' : 'Payments'}</th><th className="right">{tab === 'sales' ? 'Sales' : 'Collected'}</th></tr></thead><tbody>{data.series.map((p: any) => <tr key={p.period}><td>{formatDate(p.period)}</td><td>{tab === 'sales' ? p.orderCount : p.paymentCount}</td><td className="right numeric"><strong>{money(tab === 'sales' ? p.salesAmount : p.collectedAmount)}</strong></td></tr>)}</tbody></table></div>}
      </>}
      {tab === 'rankings' && <div className="dashboard-grid"><Card><SectionHeading title="Top customers" description="By sales in the selected period." />{!data.customers?.length ? <p className="muted">No customer activity yet.</p> : data.customers.map((c: any, index: number) => <div className="activity-row" key={c.id}><Badge>{index + 1}</Badge><div className="grow"><button type="button" className="text-link" onClick={() => onOpenStatement(c.id)}>{c.name}</button><p>{c.orderCount} orders</p></div><strong className="numeric">{money(c.totalSales)}</strong></div>)}</Card><Card><SectionHeading title="Top products" description="By product revenue." action={<Button variant="ghost" className="icon-button" aria-label="Export top products" disabled={!data.products?.length} onClick={() => downloadCsv(['Product', 'Quantity', 'Unit', 'Revenue'], data.products.map((p: any) => [p.name, p.totalQuantitySold, p.unit, p.totalRevenue]), 'top-products.csv')}><Download size={18} /></Button>} />{!data.products?.length ? <p className="muted">No product activity yet.</p> : data.products.map((p: any, index: number) => <div className="activity-row" key={p.id}><Badge>{index + 1}</Badge><div className="grow"><strong>{p.name}</strong><p>{p.totalQuantitySold} {p.unit} sold</p></div><strong className="numeric">{money(p.totalRevenue)}</strong></div>)}</Card></div>}
    </>}
  </div>;
}
