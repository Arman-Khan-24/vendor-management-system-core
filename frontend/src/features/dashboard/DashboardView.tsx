import React from 'react';
import { Card, Badge, Button } from '../../components/ui';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { DashboardSummary } from '../../types';
import {
  TrendingUp,
  PackageCheck,
  Clock,
  AlertCircle,
  Truck,
  Plus,
  ArrowUpRight,
  Receipt,
  Users,
  Package,
  Calendar
} from 'lucide-react';

interface DashboardViewProps {
  summary: DashboardSummary | null;
  onNavigateTab: (tab: string) => void;
  onOpenNewOrder: () => void;
  onOpenRecordPayment: () => void;
}

export function DashboardView({
  summary,
  onNavigateTab,
  onOpenNewOrder,
  onOpenRecordPayment
}: DashboardViewProps) {
  if (!summary) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Greeting & Operational Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Today's Overview</h2>
          <p className="text-xs text-slate-500 mt-0.5">Real-time daily ledger, sales, and collections</p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button variant="secondary" size="sm" onClick={onOpenRecordPayment}>
            Record Payment
          </Button>
          <Button variant="primary" size="sm" onClick={onOpenNewOrder}>
            <Plus className="w-4 h-4 stroke-[2.5]" />
            New Order
          </Button>
        </div>
      </div>

      {/* Primary KPI Cards (Cashew-Style Soft Large Numbers) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Today's Sales */}
        <Card className="border-emerald-100/60 bg-gradient-to-br from-white to-emerald-50/20">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-800/70">Today's Sales</span>
            <div className="w-7 h-7 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 tracking-tight">
            {formatCurrency(summary.todaySales)}
          </div>
          <p className="text-[11px] text-emerald-600 font-semibold mt-1">
            {summary.todayOrdersCount} orders placed today
          </p>
        </Card>

        {/* Total Outstanding Dues */}
        <Card className="border-amber-100/60 bg-gradient-to-br from-white to-amber-50/20">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-800/70">Total Outstanding</span>
            <div className="w-7 h-7 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 tracking-tight">
            {formatCurrency(summary.totalOutstanding)}
          </div>
          <p className="text-[11px] text-amber-600 font-semibold mt-1">
            Overdue: {formatCurrency(summary.totalOverdue || 0)}
          </p>
        </Card>

        {/* Collected Today */}
        <Card className="border-sky-100/60 bg-gradient-to-br from-white to-sky-50/20">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-sky-800/70">Today's Collections</span>
            <div className="w-7 h-7 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center">
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 tracking-tight">
            {formatCurrency(summary.todayCollected)}
          </div>
          <p className="text-[11px] text-sky-600 font-semibold mt-1">
            Total Collected: {formatCurrency(summary.totalCollected)}
          </p>
        </Card>

        {/* Active Orders in Pipeline */}
        <Card className="border-indigo-100/60 bg-gradient-to-br from-white to-indigo-50/20">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-800/70">Active Pipeline</span>
            <div className="w-7 h-7 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
              <Truck className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 tracking-tight">
            {(summary.statusCounts.Received || 0) + (summary.statusCounts.Packed || 0)}
          </div>
          <p className="text-[11px] text-indigo-600 font-semibold mt-1">
            {summary.statusCounts.Received || 0} received, {summary.statusCounts.Packed || 0} packed
          </p>
        </Card>
      </div>

      {/* Sales Trend & Collections Trend Visual Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Sales Trend */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Recent Sales Trend</h3>
            </div>
            <button
              onClick={() => onNavigateTab('reports')}
              className="text-[11px] text-brand-600 hover:text-brand-700 font-bold"
            >
              Full Report →
            </button>
          </div>
          <div className="divide-y divide-slate-100 text-xs">
            {(!summary.salesTrend || summary.salesTrend.length === 0) ? (
              <p className="text-slate-400 py-4 text-center">No recent sales data recorded.</p>
            ) : (
              summary.salesTrend.slice(-4).map((s, idx) => (
                <div key={idx} className="py-2.5 flex items-center justify-between">
                  <span className="font-semibold text-slate-700">{formatDate(s.period)}</span>
                  <div className="text-right">
                    <span className="font-extrabold text-slate-900">{formatCurrency(s.salesAmount)}</span>
                    <span className="text-[10px] text-slate-400 block">{s.orderCount} orders</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Collections Trend */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ArrowUpRight className="w-4 h-4 text-sky-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Recent Collections</h3>
            </div>
            <button
              onClick={() => onNavigateTab('reports')}
              className="text-[11px] text-brand-600 hover:text-brand-700 font-bold"
            >
              Full Report →
            </button>
          </div>
          <div className="divide-y divide-slate-100 text-xs">
            {(!summary.collectionTrend || summary.collectionTrend.length === 0) ? (
              <p className="text-slate-400 py-4 text-center">No recent payments recorded.</p>
            ) : (
              summary.collectionTrend.slice(-4).map((c, idx) => (
                <div key={idx} className="py-2.5 flex items-center justify-between">
                  <span className="font-semibold text-slate-700">{formatDate(c.period)}</span>
                  <div className="text-right">
                    <span className="font-extrabold text-emerald-800">{formatCurrency(c.collectedAmount)}</span>
                    <span className="text-[10px] text-slate-400 block">{c.paymentCount} payments</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Top Customers & Top Products Highlights */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Customers */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-brand-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Top Customers</h3>
            </div>
            <button
              onClick={() => onNavigateTab('customers')}
              className="text-[11px] text-brand-600 hover:text-brand-700 font-bold"
            >
              View All →
            </button>
          </div>
          <div className="divide-y divide-slate-100 text-xs">
            {(!summary.topCustomers || summary.topCustomers.length === 0) ? (
              <p className="text-slate-400 py-4 text-center">No customer data available yet.</p>
            ) : (
              summary.topCustomers.slice(0, 3).map((cust, idx) => (
                <div key={cust.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-slate-900 block">{cust.name}</span>
                    <span className="text-[10px] text-slate-400">{cust.orderCount} orders · Due: {formatCurrency(cust.outstandingBalance)}</span>
                  </div>
                  <span className="font-extrabold text-slate-900">{formatCurrency(cust.totalSales)}</span>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Top Products */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-emerald-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Top Selling Products</h3>
            </div>
            <button
              onClick={() => onNavigateTab('products')}
              className="text-[11px] text-brand-600 hover:text-brand-700 font-bold"
            >
              View Catalog →
            </button>
          </div>
          <div className="divide-y divide-slate-100 text-xs">
            {(!summary.topProducts || summary.topProducts.length === 0) ? (
              <p className="text-slate-400 py-4 text-center">No product data available yet.</p>
            ) : (
              summary.topProducts.slice(0, 3).map((prod) => (
                <div key={prod.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-slate-900 block">{prod.name}</span>
                    <span className="text-[10px] text-slate-400">{prod.totalQuantitySold} {prod.unit} sold</span>
                  </div>
                  <span className="font-extrabold text-slate-900">{formatCurrency(prod.totalRevenue)}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Operational Overdue Warning Banner */}
      {summary.overdueCustomers && summary.overdueCustomers.length > 0 && (
        <Card className="border-rose-100 bg-rose-50/20">
          <div className="flex items-center gap-2 text-rose-800 font-bold text-xs uppercase tracking-wider mb-2">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            <span>Overdue Credit Term Reminders ({summary.overdueCustomers.length})</span>
          </div>
          <p className="text-xs text-rose-600/90 mb-3">
            The following customers have outstanding unpaid balances older than their agreed credit terms:
          </p>
          <div className="divide-y divide-rose-100/60">
            {summary.overdueCustomers.map((c) => (
              <div key={c.id} className="py-2.5 flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold text-slate-900 block">{c.name}</span>
                  <span className="text-slate-500 text-[11px]">
                    Terms: {c.creditTermsDays} days · Phone: {c.phone}
                  </span>
                </div>
                <div className="text-right">
                  <span className="font-black text-rose-700 text-sm block">
                    {formatCurrency(c.balance)}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Since {formatDate(c.oldestInvoiceDate)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
