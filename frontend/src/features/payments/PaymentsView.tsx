import React, { useState } from 'react';
import { Card, Badge, Button, Input } from '../../components/ui';
import { Customer, Payment } from '../../types';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { CreditCard, Plus, ArrowDownLeft, CheckCircle2 } from 'lucide-react';

interface PaymentsViewProps {
  payments: Payment[];
  customers: Customer[];
  onRecordPayment: (data: any) => void;
  showRecordModal: boolean;
  setShowRecordModal: (val: boolean) => void;
}

export function PaymentsView({
  payments,
  customers,
  onRecordPayment,
  showRecordModal,
  setShowRecordModal
}: PaymentsViewProps) {
  const [customerId, setCustomerId] = useState(customers[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('upi');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  const handleRecordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId || !amount) return;
    onRecordPayment({
      customerId,
      amount: parseFloat(amount),
      mode,
      reference,
      notes
    });
    setShowRecordModal(false);
    setAmount('');
    setReference('');
    setNotes('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Payments & Ledger</h2>
          <p className="text-xs text-slate-500 mt-0.5">Automated FIFO settlement applied across customer invoices</p>
        </div>

        <Button variant="primary" size="sm" onClick={() => setShowRecordModal(true)}>
          <Plus className="w-4 h-4" /> Record Payment
        </Button>
      </div>

      {payments.length === 0 ? (
        <Card className="text-center py-12">
          <CreditCard className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h4 className="text-sm font-bold text-slate-700">No payments recorded yet</h4>
          <p className="text-xs text-slate-400 mt-1">Record collections from customers via cash, UPI, or bank transfer.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {payments.map((p) => (
            <Card key={p.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                  <ArrowDownLeft className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">{p.customer_name}</h4>
                  <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                    <span className="font-semibold text-slate-600 uppercase">{p.mode}</span>
                    <span>•</span>
                    <span>{formatDate(p.date)}</span>
                    {p.reference && (
                      <>
                        <span>•</span>
                        <span>Ref: {p.reference}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-4 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                {p.allocations && p.allocations.length > 0 && (
                  <div className="text-right hidden md:block">
                    <p className="text-[10px] text-slate-400 uppercase font-bold">FIFO Settled</p>
                    <p className="text-xs text-slate-600 font-semibold">
                      {p.allocations.map(a => `INV-${String(a.invoice_no).padStart(4, '0')}`).join(', ')}
                    </p>
                  </div>
                )}
                <div className="text-right">
                  <span className="text-base font-black text-emerald-700 block">
                    +{formatCurrency(p.amount)}
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showRecordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Record Customer Payment</h3>
            <p className="text-xs text-slate-500">
              Payment is automatically applied FIFO to the oldest pending invoices.
            </p>

            <form onSubmit={handleRecordSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                  Select Customer
                </label>
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-semibold focus:outline-none"
                  required
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} (Due: {formatCurrency(c.outstanding_balance || 0)})
                    </option>
                  ))}
                </select>
              </div>

              <Input
                label="Payment Amount (₹)"
                type="number"
                step="any"
                min="1"
                placeholder="e.g. 5000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                  Payment Mode
                </label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-semibold"
                >
                  <option value="upi">UPI (GPay / PhonePe / Paytm)</option>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer (NEFT/IMPS)</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>

              <Input
                label="Transaction Reference / Cheque No"
                placeholder="Optional"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setShowRecordModal(false)}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" type="submit">
                  Apply FIFO Payment
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
