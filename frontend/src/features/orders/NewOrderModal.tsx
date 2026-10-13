import React, { useState } from 'react';
import { Button, Input } from '../../components/ui';
import { Customer, Product } from '../../types';
import { formatCurrency } from '../../utils/formatters';
import { Plus, Trash2, ShoppingCart } from 'lucide-react';

interface NewOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  customers: Customer[];
  products: Product[];
  onSubmit: (data: { customerId: string; notes?: string; items: { productId: string; quantity: number }[] }) => void;
}

export function NewOrderModal({
  isOpen,
  onClose,
  customers,
  products,
  onSubmit
}: NewOrderModalProps) {
  if (!isOpen) return null;

  const [customerId, setCustomerId] = useState<string>(customers[0]?.id || '');
  const [notes, setNotes] = useState<string>('');
  const [selectedItems, setSelectedItems] = useState<Array<{ productId: string; quantity: number }>>([
    { productId: products[0]?.id || '', quantity: 1 }
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addItemRow = () => {
    if (products.length > 0) {
      setSelectedItems([...selectedItems, { productId: products[0].id, quantity: 1 }]);
    }
  };

  const removeItemRow = (idx: number) => {
    if (selectedItems.length > 1) {
      setSelectedItems(selectedItems.filter((_, i) => i !== idx));
    }
  };

  const updateItemRow = (idx: number, field: 'productId' | 'quantity', val: any) => {
    const updated = [...selectedItems];
    updated[idx] = { ...updated[idx], [field]: val };
    setSelectedItems(updated);
  };

  // Live order total preview
  const liveTotal = selectedItems.reduce((acc, it) => {
    const p = products.find(prod => prod.id === it.productId);
    const price = p ? p.current_price : 0;
    return acc + (price * (it.quantity || 0));
  }, 0);

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId) return;
    setIsSubmitting(true);
    try {
      await onSubmit({
        customerId,
        notes,
        items: selectedItems.filter(it => it.quantity > 0)
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-lg w-full max-h-[92vh] overflow-y-auto p-6 shadow-2xl border border-slate-100">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
              <ShoppingCart className="w-4 h-4" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Create New Order</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100 text-slate-400">
            ✕
          </button>
        </div>

        <form onSubmit={handleFormSubmit} className="space-y-5">
          {/* Customer Selection */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
              Select Customer
            </label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              required
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.phone})
                </option>
              ))}
            </select>
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                Order Items
              </label>
              <button
                type="button"
                onClick={addItemRow}
                className="text-xs font-bold text-brand-600 hover:text-brand-700 flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add Product
              </button>
            </div>

            <div className="space-y-2.5">
              {selectedItems.map((item, idx) => {
                const prod = products.find(p => p.id === item.productId);
                return (
                  <div key={idx} className="flex items-center gap-2 p-2.5 bg-slate-50 rounded-2xl border border-slate-100">
                    <select
                      value={item.productId}
                      onChange={(e) => updateItemRow(idx, 'productId', e.target.value)}
                      className="flex-1 bg-white px-3 py-2 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none"
                    >
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({formatCurrency(p.current_price)}/{p.unit})
                        </option>
                      ))}
                    </select>

                    <input
                      type="number"
                      step="any"
                      min="0.1"
                      value={item.quantity}
                      onChange={(e) => updateItemRow(idx, 'quantity', parseFloat(e.target.value) || 0)}
                      className="w-20 bg-white px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-center focus:outline-none"
                      placeholder="Qty"
                      required
                    />

                    <span className="text-xs font-medium text-slate-500 w-12 text-center">
                      {prod?.unit || ''}
                    </span>

                    {selectedItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItemRow(idx)}
                        className="p-1.5 text-slate-400 hover:text-rose-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Notes */}
          <Input
            label="Order Notes (Optional)"
            placeholder="e.g. Deliver before 7:00 AM"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          {/* Live Preview Card */}
          <div className="p-4 bg-emerald-50/60 border border-emerald-100 rounded-2xl flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-900 uppercase tracking-wider">Estimated Total</span>
            <span className="text-xl font-black text-emerald-900">{formatCurrency(liveTotal)}</span>
          </div>

          {/* Submit Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3">
            <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button variant="primary" size="md" type="submit" disabled={isSubmitting || liveTotal <= 0}>
              {isSubmitting ? 'Creating Order...' : 'Create Order'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
