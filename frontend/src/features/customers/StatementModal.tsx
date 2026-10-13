import React, { useState } from 'react';
import { Card, Badge, Button } from '../../components/ui';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { ApiClient } from '../../api/client';
import { ArrowLeft, Download, Calendar, Filter } from 'lucide-react';

interface StatementModalProps {
  statementData: any;
  onClose: () => void;
  onFilterChange?: (startDate?: string, endDate?: string) => Promise<void>;
}

export function StatementModal({ statementData, onClose, onFilterChange }: StatementModalProps) {
  const [downloading, setDownloading] = useState(false);
  const [startDate, setStartDate] = useState(statementData?.period?.startDate || '');
  const [endDate, setEndDate] = useState(statementData?.period?.endDate || '');
  const [loadingFilter, setLoadingFilter] = useState(false);

  if (!statementData) return null;

  const { customer, openingBalance, totalBilled, totalPaid, currentOutstanding, entries } = statementData;

  const handleApplyFilter = async () => {
    if (onFilterChange) {
      setLoadingFilter(true);
      try {
        await onFilterChange(startDate || undefined, endDate || undefined);
      } finally {
        setLoadingFilter(false);
      }
    }
  };

  const handleResetFilter = async () => {
    setStartDate('');
    setEndDate('');
    if (onFilterChange) {
      setLoadingFilter(true);
      try {
        await onFilterChange(undefined, undefined);
      } finally {
        setLoadingFilter(false);
      }
    }
  };

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      await ApiClient.downloadCustomerStatementPdf(
        customer.id,
        {
          startDate: startDate || undefined,
          endDate: endDate || undefined
        },
        customer.name
      );
    } catch (err: any) {
      alert(`PDF download failed: ${err.message}`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[92vh] overflow-y-auto p-6 shadow-2xl border border-slate-100 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-2 -ml-2 text-slate-400 hover:text-slate-800 rounded-xl hover:bg-slate-100"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h3 className="text-lg font-black text-slate-900">Account Statement</h3>
              <p className="text-xs text-slate-500">{customer.name} · {customer.phone} · {customer.credit_terms_days}d terms</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadPdf}
              disabled={downloading}
              className="border-brand-200 text-brand-700 hover:bg-brand-50"
            >
              <Download className="w-4 h-4 mr-1.5 stroke-[2.5]" />
              {downloading ? 'Exporting...' : 'PDF Statement'}
            </Button>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100 text-slate-400">
              ✕
            </button>
          </div>
        </div>

        {/* Date Filter Bar */}
        <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span className="font-bold text-slate-600 text-[11px] uppercase tracking-wide">Filter Period</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-2.5 py-1 text-xs text-slate-700 outline-none focus:border-brand-500"
            />
            <span className="text-slate-400 text-xs">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-2.5 py-1 text-xs text-slate-700 outline-none focus:border-brand-500"
            />
            <button
              onClick={handleApplyFilter}
              disabled={loadingFilter}
              className="bg-slate-900 hover:bg-black text-white px-3 py-1 rounded-xl font-bold text-xs"
            >
              {loadingFilter ? '...' : 'Apply'}
            </button>
            {(startDate || endDate) && (
              <button
                onClick={handleResetFilter}
                className="text-slate-400 hover:text-slate-600 text-xs font-semibold px-1"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Balance KPI Banner */}
        <div className="grid grid-cols-4 gap-2.5">
          <div className="p-3 bg-slate-50 rounded-2xl text-center">
            <span className="text-[10px] text-slate-400 font-bold uppercase">Opening</span>
            <span className="text-xs font-black text-slate-700 block mt-0.5">{formatCurrency(openingBalance || 0)}</span>
          </div>
          <div className="p-3 bg-slate-50 rounded-2xl text-center">
            <span className="text-[10px] text-slate-500 font-bold uppercase">Invoiced</span>
            <span className="text-xs font-black text-slate-800 block mt-0.5">{formatCurrency(totalBilled)}</span>
          </div>
          <div className="p-3 bg-emerald-50 rounded-2xl text-center">
            <span className="text-[10px] text-emerald-600 font-bold uppercase">Paid</span>
            <span className="text-xs font-black text-emerald-800 block mt-0.5">{formatCurrency(totalPaid)}</span>
          </div>
          <div className="p-3 bg-amber-50 rounded-2xl text-center">
            <span className="text-[10px] text-amber-700 font-bold uppercase">Current Due</span>
            <span className="text-xs font-black text-amber-900 block mt-0.5">{formatCurrency(currentOutstanding)}</span>
          </div>
        </div>

        {/* Ledger Entries */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Ledger Activity</h4>
            <span className="text-[11px] text-slate-400 font-medium">{entries.length} transactions</span>
          </div>
          <div className="border border-slate-100 rounded-2xl overflow-hidden divide-y divide-slate-100 text-xs">
            {openingBalance !== undefined && openingBalance !== 0 && (
              <div className="p-3.5 bg-slate-50/60 flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-700 block">Opening Balance Carried Forward</span>
                  <span className="text-[11px] text-slate-400">Prior to period start</span>
                </div>
                <div className="text-right">
                  <span className="font-extrabold text-slate-800 block">{formatCurrency(openingBalance)}</span>
                  <span className="text-[10px] text-slate-400">Bal: {formatCurrency(openingBalance)}</span>
                </div>
              </div>
            )}

            {entries.length === 0 ? (
              <div className="p-8 text-center text-slate-400">No transactions recorded in this period.</div>
            ) : (
              entries.map((entry: any, i: number) => (
                <div key={i} className="p-3.5 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`font-bold ${entry.type === 'INVOICE' ? 'text-slate-800' : 'text-emerald-700'}`}>
                        {entry.reference_no}
                      </span>
                      <Badge variant={entry.type === 'INVOICE' ? 'default' : 'success'}>
                        {entry.type}
                      </Badge>
                    </div>
                    <span className="text-[11px] text-slate-400 block mt-0.5">
                      {formatDateTime(entry.date)}
                    </span>
                  </div>

                  <div className="text-right">
                    <span className={`font-extrabold ${entry.debit > 0 ? 'text-slate-900' : 'text-emerald-700'}`}>
                      {entry.debit > 0 ? `+${formatCurrency(entry.debit)}` : `-${formatCurrency(entry.credit)}`}
                    </span>
                    <span className="text-[10px] text-slate-400 block font-semibold">
                      Bal: {formatCurrency(entry.running_balance)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex justify-between items-center pt-2 border-t border-slate-100">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadPdf}
            disabled={downloading}
            className="border-slate-200"
          >
            <Download className="w-4 h-4 mr-1.5" />
            {downloading ? 'Preparing...' : 'Download PDF'}
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
