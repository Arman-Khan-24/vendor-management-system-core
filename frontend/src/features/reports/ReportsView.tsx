import React, { useState, useEffect } from 'react';
import { Card, Badge, Button } from '../../components/ui';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { ApiClient } from '../../api/client';
import {
  TrendingUp,
  Receipt,
  Users,
  Package,
  Calendar,
  AlertTriangle,
  ArrowUpRight,
  Filter,
  CheckCircle2,
  Clock
} from 'lucide-react';

interface ReportsViewProps {
  onOpenStatement?: (customerId: string) => void;
}

export function ReportsView({ onOpenStatement }: ReportsViewProps) {
  const [activeTab, setActiveTab] = useState<'dues' | 'sales' | 'collections' | 'rankings'>('dues');
  const [loading, setLoading] = useState(true);

  // Date filters
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [interval, setInterval] = useState<'day' | 'week' | 'month'>('day');

  // Report Data
  const [duesData, setDuesData] = useState<any>(null);
  const [salesData, setSalesData] = useState<any>(null);
  const [collectionData, setCollectionData] = useState<any>(null);
  const [topCustomers, setTopCustomers] = useState<any[]>([]);
  const [topProducts, setTopProducts] = useState<any[]>([]);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const dateParams = {
        startDate: startDate || undefined,
        endDate: endDate || undefined
      };

      if (activeTab === 'dues') {
        const dues = await ApiClient.getDuesReport();
        setDuesData(dues);
      } else if (activeTab === 'sales') {
        const sales = await ApiClient.getSalesReport({ ...dateParams, interval });
        setSalesData(sales);
      } else if (activeTab === 'collections') {
        const collections = await ApiClient.getCollectionReport({ ...dateParams, interval });
        setCollectionData(collections);
      } else if (activeTab === 'rankings') {
        const [custs, prods] = await Promise.all([
          ApiClient.getTopCustomers({ ...dateParams, limit: 10 }),
          ApiClient.getTopProducts({ ...dateParams, limit: 10 })
        ]);
        setTopCustomers(custs);
        setTopProducts(prods);
      }
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [activeTab, interval]);

  const handleApplyFilter = () => {
    fetchReports();
  };

  const handleClearFilter = () => {
    setStartDate('');
    setEndDate('');
    fetchReports();
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Financial & Sales Reports</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Tenant-scoped dues aging, sales volume, collections, and rankings
          </p>
        </div>

        {/* Tab Switcher Pills */}
        <div className="flex items-center p-1 bg-slate-100 rounded-2xl gap-1 self-start sm:self-auto overflow-x-auto max-w-full">
          {[
            { id: 'dues', label: 'Dues & Aging', icon: Receipt },
            { id: 'sales', label: 'Sales Report', icon: TrendingUp },
            { id: 'collections', label: 'Collections', icon: ArrowUpRight },
            { id: 'rankings', label: 'Top Insights', icon: Users },
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  isActive
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Date Filter Bar for Sales, Collections, Rankings */}
      {activeTab !== 'dues' && (
        <div className="bg-white p-3.5 rounded-3xl border border-slate-100 shadow-sm flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span className="font-bold text-slate-600 text-xs uppercase tracking-wide">Time Filter</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {(activeTab === 'sales' || activeTab === 'collections') && (
              <select
                value={interval}
                onChange={(e) => setInterval(e.target.value as any)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1 text-xs text-slate-700 outline-none"
              >
                <option value="day">Daily Aggregate</option>
                <option value="week">Weekly Aggregate</option>
                <option value="month">Monthly Aggregate</option>
              </select>
            )}

            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1 text-xs text-slate-700 outline-none"
            />
            <span className="text-slate-400 text-xs">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1 text-xs text-slate-700 outline-none"
            />

            <button
              onClick={handleApplyFilter}
              className="bg-slate-900 hover:bg-black text-white px-3 py-1 rounded-xl font-bold text-xs"
            >
              Filter
            </button>
            {(startDate || endDate) && (
              <button
                onClick={handleClearFilter}
                className="text-slate-400 hover:text-slate-600 text-xs font-semibold px-1"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* TAB 1: DUES & AGING */}
          {activeTab === 'dues' && duesData && (
            <div className="space-y-6">
              {/* Summary KPIs */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card className="border-amber-100 bg-amber-50/20">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-800">Total Outstanding</span>
                  <div className="text-2xl font-black text-slate-900 mt-1">
                    {formatCurrency(duesData.totalOutstanding)}
                  </div>
                  <p className="text-[11px] text-amber-700 font-semibold mt-1">
                    Across {duesData.customerCountWithDues} customers with balance
                  </p>
                </Card>

                <Card className="border-rose-100 bg-rose-50/20">
                  <span className="text-xs font-bold uppercase tracking-wider text-rose-800">Overdue Past Credit Terms</span>
                  <div className="text-2xl font-black text-rose-900 mt-1">
                    {formatCurrency(duesData.totalOverdue)}
                  </div>
                  <p className="text-[11px] text-rose-600 font-semibold mt-1">
                    Requires immediate vendor follow-up
                  </p>
                </Card>

                <Card className="border-slate-100">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Unpaid Invoices</span>
                  <div className="text-2xl font-black text-slate-900 mt-1">
                    {duesData.unpaidInvoiceCount}
                  </div>
                  <p className="text-[11px] text-slate-500 font-semibold mt-1">
                    Pending or partially paid invoices
                  </p>
                </Card>
              </div>

              {/* Aging Breakdown Bar */}
              <Card>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Receivables Aging Brackets</h3>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div className="p-3 bg-emerald-50/50 rounded-2xl border border-emerald-100/60 text-center">
                    <span className="text-[10px] font-bold text-emerald-800 uppercase block">Not Yet Due</span>
                    <span className="text-sm font-black text-emerald-900 mt-0.5 block">{formatCurrency(duesData.agingBuckets.current)}</span>
                  </div>
                  <div className="p-3 bg-amber-50/50 rounded-2xl border border-amber-100/60 text-center">
                    <span className="text-[10px] font-bold text-amber-800 uppercase block">1 - 7 Days</span>
                    <span className="text-sm font-black text-amber-900 mt-0.5 block">{formatCurrency(duesData.agingBuckets.overdue_1_7)}</span>
                  </div>
                  <div className="p-3 bg-orange-50/50 rounded-2xl border border-orange-100/60 text-center">
                    <span className="text-[10px] font-bold text-orange-800 uppercase block">8 - 15 Days</span>
                    <span className="text-sm font-black text-orange-900 mt-0.5 block">{formatCurrency(duesData.agingBuckets.overdue_8_15)}</span>
                  </div>
                  <div className="p-3 bg-rose-50/50 rounded-2xl border border-rose-100/60 text-center">
                    <span className="text-[10px] font-bold text-rose-800 uppercase block">16 - 30 Days</span>
                    <span className="text-sm font-black text-rose-900 mt-0.5 block">{formatCurrency(duesData.agingBuckets.overdue_16_30)}</span>
                  </div>
                  <div className="p-3 bg-red-100/50 rounded-2xl border border-red-200 text-center col-span-2 sm:col-span-1">
                    <span className="text-[10px] font-bold text-red-900 uppercase block">30+ Days Overdue</span>
                    <span className="text-sm font-black text-red-900 mt-0.5 block">{formatCurrency(duesData.agingBuckets.overdue_30_plus)}</span>
                  </div>
                </div>
              </Card>

              {/* Customer-wise Outstanding List */}
              <div className="bg-white rounded-3xl border border-slate-100 p-5 shadow-sm space-y-4">
                <h3 className="text-sm font-bold text-slate-900">Customer Dues Breakdown</h3>
                <div className="divide-y divide-slate-100">
                  {duesData.customers.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400">All customer dues are completely settled!</div>
                  ) : (
                    duesData.customers.map((c: any) => (
                      <div key={c.customerId} className="py-3.5 flex items-center justify-between text-xs">
                        <div>
                          <span className="font-bold text-slate-900 text-sm block">{c.customerName}</span>
                          <span className="text-slate-400 text-[11px] block mt-0.5">
                            {c.customerPhone} · {c.creditTermsDays} days credit · {c.invoiceCount} open invoices
                          </span>
                        </div>
                        <div className="text-right flex items-center gap-4">
                          <div>
                            <span className="font-black text-slate-900 text-sm block">{formatCurrency(c.totalOutstanding)}</span>
                            {c.totalOverdue > 0 ? (
                              <span className="text-[10px] font-bold text-rose-600 block">
                                Overdue: {formatCurrency(c.totalOverdue)}
                              </span>
                            ) : (
                              <span className="text-[10px] font-semibold text-emerald-600 block">Within terms</span>
                            )}
                          </div>
                          {onOpenStatement && (
                            <button
                              onClick={() => onOpenStatement(c.customerId)}
                              className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1 rounded-xl text-xs font-bold"
                            >
                              Statement
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SALES REPORT */}
          {activeTab === 'sales' && salesData && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card className="border-emerald-100 bg-emerald-50/20">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">Total Period Sales</span>
                  <div className="text-2xl font-black text-slate-900 mt-1">{formatCurrency(salesData.totalSales)}</div>
                </Card>
                <Card className="border-slate-100">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Total Orders Fulfilled</span>
                  <div className="text-2xl font-black text-slate-900 mt-1">{salesData.totalOrders}</div>
                </Card>
                <Card className="border-slate-100">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Invoices Generated</span>
                  <div className="text-2xl font-black text-slate-900 mt-1">{salesData.totalInvoices}</div>
                </Card>
              </div>

              {/* Time Series Table */}
              <div className="bg-white rounded-3xl border border-slate-100 p-5 shadow-sm space-y-3">
                <h3 className="text-sm font-bold text-slate-900">Sales Trend Breakdown ({salesData.interval})</h3>
                <div className="divide-y divide-slate-100 text-xs">
                  {salesData.series.length === 0 ? (
                    <div className="py-8 text-center text-slate-400">No sales recorded for this date range.</div>
                  ) : (
                    salesData.series.map((s: any, idx: number) => (
                      <div key={idx} className="py-3 flex items-center justify-between">
                        <div>
                          <span className="font-bold text-slate-800 block">{formatDate(s.period)}</span>
                          <span className="text-slate-400 text-[11px]">{s.orderCount} orders</span>
                        </div>
                        <span className="font-black text-slate-900 text-sm">{formatCurrency(s.salesAmount)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: COLLECTIONS REPORT */}
          {activeTab === 'collections' && collectionData && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Card className="border-sky-100 bg-sky-50/20">
                  <span className="text-xs font-bold uppercase tracking-wider text-sky-800">Total Collected</span>
                  <div className="text-2xl font-black text-slate-900 mt-1">{formatCurrency(collectionData.totalCollected)}</div>
                  <p className="text-[11px] text-sky-600 font-semibold mt-1">{collectionData.paymentCount} payments received</p>
                </Card>
                <Card>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2">Payment Modes</span>
                  <div className="grid grid-cols-2 gap-2">
                    {collectionData.modeBreakdown.map((m: any) => (
                      <div key={m.mode} className="p-2.5 bg-slate-50 rounded-2xl">
                        <span className="text-[10px] font-bold text-slate-500 uppercase block">{m.mode}</span>
                        <span className="text-xs font-extrabold text-slate-900 block mt-0.5">{formatCurrency(m.amount)}</span>
                        <span className="text-[10px] text-slate-400">({m.count} txns)</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              {/* Collections series */}
              <div className="bg-white rounded-3xl border border-slate-100 p-5 shadow-sm space-y-3">
                <h3 className="text-sm font-bold text-slate-900">Collections History</h3>
                <div className="divide-y divide-slate-100 text-xs">
                  {collectionData.series.length === 0 ? (
                    <div className="py-8 text-center text-slate-400">No payments received for this date range.</div>
                  ) : (
                    collectionData.series.map((s: any, idx: number) => (
                      <div key={idx} className="py-3 flex items-center justify-between">
                        <div>
                          <span className="font-bold text-slate-800 block">{formatDate(s.period)}</span>
                          <span className="text-slate-400 text-[11px]">{s.paymentCount} payments</span>
                        </div>
                        <span className="font-black text-emerald-800 text-sm">{formatCurrency(s.collectedAmount)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: RANKINGS (TOP CUSTOMERS & TOP PRODUCTS) */}
          {activeTab === 'rankings' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Top Customers */}
              <div className="bg-white rounded-3xl border border-slate-100 p-5 shadow-sm space-y-4">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-brand-600" />
                  <h3 className="text-sm font-black text-slate-900">Top Customers by Revenue</h3>
                </div>
                <div className="divide-y divide-slate-100 text-xs">
                  {topCustomers.length === 0 ? (
                    <div className="py-8 text-center text-slate-400">No customer sales recorded yet.</div>
                  ) : (
                    topCustomers.map((c, idx) => (
                      <div key={c.id} className="py-3 flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 font-extrabold text-[10px] flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <div>
                            <span className="font-bold text-slate-900 block">{c.name}</span>
                            <span className="text-[11px] text-slate-400">{c.orderCount} orders · Paid: {formatCurrency(c.totalPaid)}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="font-black text-slate-900 text-sm block">{formatCurrency(c.totalSales)}</span>
                          <span className="text-[10px] text-amber-700 font-semibold">Due: {formatCurrency(c.outstandingBalance)}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Top Products */}
              <div className="bg-white rounded-3xl border border-slate-100 p-5 shadow-sm space-y-4">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-emerald-600" />
                  <h3 className="text-sm font-black text-slate-900">Top Selling Products</h3>
                </div>
                <div className="divide-y divide-slate-100 text-xs">
                  {topProducts.length === 0 ? (
                    <div className="py-8 text-center text-slate-400">No product sales recorded yet.</div>
                  ) : (
                    topProducts.map((p, idx) => (
                      <div key={p.id} className="py-3 flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 font-extrabold text-[10px] flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <div>
                            <span className="font-bold text-slate-900 block">{p.name}</span>
                            <span className="text-[11px] text-slate-400">{p.totalQuantitySold} {p.unit} sold ({p.orderFrequency} orders)</span>
                          </div>
                        </div>
                        <span className="font-black text-slate-900 text-sm">{formatCurrency(p.totalRevenue)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
