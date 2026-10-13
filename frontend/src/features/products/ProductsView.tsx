import React, { useState } from 'react';
import { Card, Badge, Button, Input } from '../../components/ui';
import { Product } from '../../types';
import { formatCurrency } from '../../utils/formatters';
import { Package, Plus, Search, Tag } from 'lucide-react';

interface ProductsViewProps {
  products: Product[];
  onCreateProduct: (data: { name: string; unit: string; currentPrice: number }) => void;
}

export function ProductsView({ products, onCreateProduct }: ProductsViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('kg');
  const [price, setPrice] = useState('');

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !price) return;
    onCreateProduct({
      name,
      unit,
      currentPrice: parseFloat(price) || 0
    });
    setShowAddModal(false);
    setName('');
    setPrice('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Product Catalog</h2>
          <p className="text-xs text-slate-500 mt-0.5">Manage custom items, current prices, and configurable units</p>
        </div>

        <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)}>
          <Plus className="w-4 h-4" /> Add Product
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          placeholder="Search products..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200/80 rounded-2xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {filtered.map((product) => (
          <Card key={product.id} className="p-4 flex flex-col justify-between hover:border-slate-300">
            <div>
              <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 mb-2">
                <Tag className="w-4 h-4" />
              </div>
              <h4 className="text-sm font-bold text-slate-900 leading-snug">{product.name}</h4>
              <span className="text-[11px] text-slate-400 font-medium">Unit: {product.unit}</span>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Current Price</span>
              <span className="text-sm font-black text-slate-900">
                {formatCurrency(product.current_price)} / {product.unit}
              </span>
            </div>
          </Card>
        ))}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Add New Product</h3>
            <form onSubmit={handleAddSubmit} className="space-y-4">
              <Input
                label="Product Name"
                placeholder="e.g. Tomato (Hybrid)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                  Unit
                </label>
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-semibold"
                >
                  <option value="kg">kg (Kilogram)</option>
                  <option value="gram">gram</option>
                  <option value="piece">piece</option>
                  <option value="dozen">dozen</option>
                  <option value="box">box</option>
                  <option value="tray">tray</option>
                  <option value="litre">litre</option>
                  <option value="packet">packet</option>
                  <option value="tin">tin</option>
                  <option value="bag">bag</option>
                </select>
              </div>

              <Input
                label="Current Price (₹)"
                type="number"
                step="any"
                min="0"
                placeholder="e.g. 40"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
              />

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" type="submit">
                  Save Product
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
