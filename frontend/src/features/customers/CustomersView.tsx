import React, { useState } from 'react';
import { Card, Badge, Button, Input } from '../../components/ui';
import { Customer } from '../../types';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { Users, Phone, Calendar, ArrowRight, Plus, Search, FileText } from 'lucide-react';

interface CustomersViewProps {
  customers: Customer[];
  onSelectCustomer: (customer: Customer) => void;
  onCreateCustomer: (data: { name: string; phone: string; creditTermsDays: number }) => void;
}

export function CustomersView({
  customers,
  onSelectCustomer,
  onCreateCustomer
}: CustomersViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [creditTermsDays, setCreditTermsDays] = useState(7);

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.phone.includes(searchTerm)
  );

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !phone) return;
    onCreateCustomer({ name, phone, creditTermsDays });
    setShowAddModal(false);
    setName('');
    setPhone('');
    setCreditTermsDays(7);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Customers</h2>
          <p className="text-xs text-slate-500 mt-0.5">Manage accounts, credit terms, and ledger balances</p>
        </div>

        <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)}>
          <Plus className="w-4 h-4" /> Add Customer
        </Button>
      </div>

      {/* Search Input */}
      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          placeholder="Search by restaurant name or phone..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200/80 rounded-2xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
        />
      </div>

      {/* Customers Cards Grid */}
      {filtered.length === 0 ? (
        <Card className="text-center py-12">
          <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h4 className="text-sm font-bold text-slate-700">No customers found</h4>
          <p className="text-xs text-slate-400 mt-1">Add your restaurant or wholesale clients to get started.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((customer) => {
            const outstanding = customer.outstanding_balance || 0;
            const hasDue = outstanding > 0;
            return (
              <Card
                key={customer.id}
                className="hover:border-slate-300 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <h4 className="text-base font-bold text-slate-900 leading-tight">{customer.name}</h4>
                      <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-1 font-medium">
                        <Phone className="w-3.5 h-3.5 text-slate-400" /> {customer.phone}
                      </p>
                    </div>
                    <Badge variant={hasDue ? 'warning' : 'success'}>
                      {hasDue ? 'Outstanding' : 'Clear'}
                    </Badge>
                  </div>

                  {/* Balance details */}
                  <div className="p-3 bg-slate-50 rounded-2xl space-y-1.5 my-3">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Outstanding:</span>
                      <span className={`font-extrabold ${hasDue ? 'text-amber-700' : 'text-slate-800'}`}>
                        {formatCurrency(outstanding)}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>Total Billed:</span>
                      <span>{formatCurrency(customer.total_billed || 0)}</span>
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>Credit Terms:</span>
                      <span>{customer.credit_terms_days} days</span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">
                    Last: {customer.last_order_date ? formatDate(customer.last_order_date) : 'Never'}
                  </span>
                  <button
                    onClick={() => onSelectCustomer(customer)}
                    className="text-xs font-bold text-brand-600 hover:text-brand-700 flex items-center gap-1"
                  >
                    Statement <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add Customer Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Add New Customer</h3>
            <form onSubmit={handleAddSubmit} className="space-y-4">
              <Input
                label="Customer / Business Name"
                placeholder="e.g. Royal Orchid Hotel"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <Input
                label="WhatsApp Phone Number"
                placeholder="e.g. 9876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                  Credit Terms (Days)
                </label>
                <input
                  type="number"
                  min="0"
                  max="180"
                  value={creditTermsDays}
                  onChange={(e) => setCreditTermsDays(parseInt(e.target.value, 10) || 7)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-semibold"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" type="submit">
                  Save Customer
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
