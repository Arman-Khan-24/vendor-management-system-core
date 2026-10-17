import { useState } from 'react';
import { Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { Button, EmptyState, ErrorNotice, Input, Modal, Select, Textarea } from '../../components/ui';
import type { Customer, OrderInput, Product } from '../../types';
import { errorMessage } from '../../utils/formatters';
import { useBusiness } from '../settings/businessSettings';

export function NewOrderModal({ isOpen, onClose, customers, products, onSubmit, onSetup }: { isOpen: boolean; onClose: () => void; customers: Customer[]; products: Product[]; onSubmit: (data: OrderInput) => Promise<void>; onSetup: (tab: string) => void }) {
  const { settings, money } = useBusiness();
  const availableCustomers = customers.filter(c => c.active);
  const availableProducts = products.filter(p => p.active);
  const [customerId, setCustomerId] = useState(availableCustomers[0]?.id || '');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<{ key: string; productId: string; quantity: string }[]>([{ key: crypto.randomUUID(), productId: availableProducts[0]?.id || '', quantity: '1' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subtotal = items.reduce((sum, item) => sum + Math.round(Number(availableProducts.find(p => p.id === item.productId)?.current_price || 0) * Number(item.quantity || 0) * 100) / 100, 0);
  const tax = Math.round(subtotal * settings.billing.taxRate) / 100;
  const update = (key: string, data: Partial<typeof items[number]>) => setItems(list => list.map(i => i.key === key ? { ...i, ...data } : i));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      if (!customerId || !availableCustomers.some(c => c.id === customerId)) throw new Error('Choose an active customer.');
      if (items.some(i => !i.productId || !Number.isFinite(Number(i.quantity)) || Number(i.quantity) <= 0)) throw new Error('Each product needs a quantity greater than zero.');
      if (new Set(items.map(i => i.productId)).size !== items.length) throw new Error('A product is listed twice. Combine its quantities in one row.');
      await onSubmit({ customerId, notes: notes.trim(), items: items.map(({ productId, quantity }) => ({ productId, quantity: Number(quantity) })) });
      onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const ready = availableCustomers.length > 0 && availableProducts.length > 0;
  return <Modal isOpen={isOpen} onClose={onClose} title="Create an order" wide busy={busy}>
    {!ready ? <EmptyState icon={<ShoppingBag size={28} />} title={!availableProducts.length ? 'Add your products first' : 'Add your first customer'} description="An order needs an active customer and at least one product." action={<Button onClick={() => { onClose(); onSetup(!availableProducts.length ? 'products' : 'customers'); }}>{!availableProducts.length ? 'Open catalog' : 'Add a customer'}</Button>} /> :
      <form className="stack" onSubmit={submit}>
        <ErrorNotice message={error} />
        <Select label="Customer" value={customerId} required onChange={e => setCustomerId(e.target.value)}><option value="" disabled>Choose a customer</option>{availableCustomers.map(c => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}</Select>
        <div className="row between"><h3>Order items</h3><Button variant="ghost" size="sm" disabled={items.length >= availableProducts.length} onClick={() => setItems(list => [...list, { key: crypto.randomUUID(), productId: availableProducts.find(p => !list.some(i => i.productId === p.id))?.id || '', quantity: '1' }])}><Plus size={17} aria-hidden="true" />Add item</Button></div>
        {items.map((item, index) => {
          const product = availableProducts.find(p => p.id === item.productId);
          return <div key={item.key} className="order-line"><div className="order-line-fields">
            <Select label={'Product ' + (index + 1)} value={item.productId} required onChange={e => update(item.key, { productId: e.target.value })}>{availableProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
            <Input label={'Quantity ' + (index + 1)} type="number" step="0.01" min="0.01" value={item.quantity} required onChange={e => update(item.key, { quantity: e.target.value })} />
            <Button className="icon-button" variant="ghost" aria-label={'Remove item ' + (index + 1)} disabled={items.length === 1} onClick={() => setItems(list => list.filter(i => i.key !== item.key))}><Trash2 size={18} /></Button>
          </div><div className="order-line-total"><span>{money(product?.current_price)} / {product?.unit} · Quantity in {product?.unit}</span><strong>{money(Number(product?.current_price || 0) * Number(item.quantity || 0))}</strong></div></div>;
        })}
        <Textarea label="Order notes" value={notes} maxLength={500} onChange={e => setNotes(e.target.value)} placeholder="Delivery instructions or anything the team should know." rows={2} />
        {tax > 0 && <div className="row between muted small"><span>Subtotal {money(subtotal)} + {settings.billing.taxRate}% tax</span><span>{money(tax)} tax</span></div>}
        <div className="total-box"><div><strong style={{ fontSize: 14 }}>Order total</strong><p className="small">Prices are saved when you place the order.</p></div><strong className="numeric">{money(subtotal + tax)}</strong></div>
        <div className="form-actions"><Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" busy={busy}>Create order</Button></div>
      </form>}
  </Modal>;
}
