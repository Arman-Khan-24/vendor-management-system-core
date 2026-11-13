import { useEffect, useState } from 'react';
import { Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { Button, EmptyState, ErrorNotice, Input, LoadingState, Modal, Select, Textarea } from '../../components/ui';
import type { Customer, CustomerInput, OrderInput, OrderImportResult, Product } from '../../types';
import { CustomerModal } from '../customers/CustomerModal';
import { ProviderConnections } from '../settings/ConnectionSettings';
import { OrderImportPanel } from './OrderImportPanel';
import { errorMessage } from '../../utils/formatters';
import { useBusiness } from '../settings/businessSettings';

export function NewOrderModal({ isOpen, onClose, customers, products, loading = false, onSubmit, onSetup, onCreateCustomer }: { isOpen: boolean; onClose: () => void; customers: Customer[]; products: Product[]; loading?: boolean; onSubmit: (data: OrderInput) => Promise<void>; onSetup: (tab: string) => void; onCreateCustomer: (data: CustomerInput) => Promise<Customer> }) {
  const { settings, money } = useBusiness();
  const availableCustomers = customers.filter(c => c.active);
  const availableProducts = products.filter(p => p.active);
  const [customerId, setCustomerId] = useState(availableCustomers[0]?.id || '');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<{ key: string; productId: string; quantity: string; source?: string }[]>([{ key: crypto.randomUUID(), productId: availableProducts[0]?.id || '', quantity: '1' }]);
  const [mode, setMode] = useState<'manual' | 'import'>('manual');
  const [importBusy, setImportBusy] = useState(false);
  const [imported, setImported] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [aiSettings, setAiSettings] = useState(false);
  const [aiDirty, setAiDirty] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const firstCustomerId = availableCustomers[0]?.id;
  const firstProductId = availableProducts[0]?.id;
  useEffect(() => {
    if (firstCustomerId) setCustomerId(id => id || firstCustomerId);
    if (firstProductId) setItems(list => list.some(item => !item.productId && !item.source) ? list.map(item => item.productId || item.source ? item : { ...item, productId: firstProductId }) : list);
  }, [firstCustomerId, firstProductId]);
  const subtotal = items.reduce((sum, item) => sum + Math.round(Number(availableProducts.find(p => p.id === item.productId)?.current_price || 0) * Number(item.quantity || 0) * 100) / 100, 0);
  const tax = Math.round(subtotal * settings.billing.taxRate) / 100;
  const update = (key: string, data: Partial<typeof items[number]>) => setItems(list => list.map(i => i.key === key ? { ...i, ...data } : i));
  const extracted = (result: OrderImportResult) => {
    setItems(result.items.map(item => ({ key: crypto.randomUUID(), productId: item.productId, quantity: item.quantity === null ? '' : String(item.quantity), source: item.productId ? undefined : `${item.inputProduct}: ${item.inputQuantity} ${item.inputUnit}` })));
    setWarnings(result.warnings); setImported(true); setError(null);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || importBusy) return; setBusy(true); setError(null);
    try {
      if (!customerId || !availableCustomers.some(c => c.id === customerId)) throw new Error('Choose an active customer.');
      if (items.some(i => !availableProducts.some(p => p.id === i.productId))) throw new Error('Choose an active product for each item.');
      if (items.some(i => !Number.isFinite(Number(i.quantity)) || Number(i.quantity) <= 0)) throw new Error('Each product needs a quantity greater than zero.');
      if (new Set(items.map(i => i.productId)).size !== items.length) throw new Error('A product is listed twice. Combine its quantities in one row.');
      await onSubmit({ customerId, notes: notes.trim(), items: items.map(({ productId, quantity }) => ({ productId, quantity: Number(quantity) })) });
      onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const ready = availableCustomers.length > 0 && availableProducts.length > 0;
  return <><Modal isOpen={isOpen} onClose={onClose} title="Create an order" wide busy={busy || importBusy || addingCustomer || aiSettings}>
    {!ready ? loading ? <LoadingState label="Loading customers and products…" /> : <EmptyState icon={<ShoppingBag size={28} />} title={!availableProducts.length ? 'Add your products first' : 'Add your first customer'} description="An order needs an active customer and at least one product." action={<Button onClick={() => { if (!availableProducts.length) { onClose(); onSetup('products'); } else setAddingCustomer(true); }}>{!availableProducts.length ? 'Open catalog' : 'Add a customer'}</Button>} /> :
      <form className="stack" onSubmit={submit}>
        <ErrorNotice message={error} focus />
        <Select label="Customer" value={customerId} disabled={busy || importBusy} required onChange={e => setCustomerId(e.target.value)}><option value="" disabled>Choose a customer</option>{availableCustomers.map(c => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}</Select>
        <Button variant="outline" size="sm" disabled={busy || importBusy} onClick={() => setAddingCustomer(true)}><Plus size={17} aria-hidden="true" />New customer</Button>
        <div className="chips" aria-label="Order entry method"><button type="button" className={'chip ' + (mode === 'manual' ? 'selected' : '')} aria-pressed={mode === 'manual'} disabled={busy || importBusy} onClick={() => setMode('manual')}>Manual entry</button><button type="button" className={'chip ' + (mode === 'import' ? 'selected' : '')} aria-pressed={mode === 'import'} disabled={busy || importBusy} onClick={() => setMode('import')}>From text or photo</button></div>
        <div hidden={mode !== 'import'}><OrderImportPanel disabled={busy} onExtracted={extracted} onBusyChange={setImportBusy} onOpenConnections={() => setAiSettings(true)} /></div>
        {imported && <div className="form-note" role="status"><strong>Draft filled. Review products and quantities below.</strong>{warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
        <div className="row between"><h3>Order items</h3><Button variant="ghost" size="sm" disabled={busy || importBusy || items.length >= availableProducts.length} onClick={() => setItems(list => [...list, { key: crypto.randomUUID(), productId: availableProducts.find(p => !list.some(i => i.productId === p.id))?.id || '', quantity: '1' }])}><Plus size={17} aria-hidden="true" />Add item</Button></div>
        {items.map((item, index) => {
          const product = availableProducts.find(p => p.id === item.productId);
          return <div key={item.key} className="order-line"><div className="order-line-fields">
            <Select label={'Product ' + (index + 1)} value={item.productId} disabled={busy || importBusy} required onChange={e => update(item.key, { productId: e.target.value })}><option value="" disabled>Choose a product</option>{availableProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
            <Input label={'Quantity ' + (index + 1)} disabled={busy || importBusy} type="number" inputMode="decimal" step="0.01" min="0.01" value={item.quantity} required onChange={e => update(item.key, { quantity: e.target.value })} />
            <Button className="icon-button" variant="ghost" aria-label={'Remove item ' + (index + 1)} disabled={busy || importBusy || items.length === 1} onClick={() => setItems(list => list.filter(i => i.key !== item.key))}><Trash2 size={18} /></Button>
          </div>{item.source && <p className="form-note">Read from the order: {item.source}. Choose the intended product and enter its quantity in the catalog unit.</p>}<div className="order-line-total"><span>{product ? `${money(product.current_price)} / ${product.unit} · Quantity in ${product.unit}` : 'Choose a product to see its unit and price.'}</span><strong>{money(Number(product?.current_price || 0) * Number(item.quantity || 0))}</strong></div></div>;
        })}
        <Textarea label="Order notes" value={notes} disabled={busy || importBusy} maxLength={500} onChange={e => setNotes(e.target.value)} placeholder="Delivery instructions or anything the team should know." rows={2} />
        {tax > 0 && <div className="row between muted small"><span>Subtotal {money(subtotal)} + {settings.billing.taxRate}% tax</span><span>{money(tax)} tax</span></div>}
        <div className="total-box"><div><strong style={{ fontSize: 14 }}>Order total</strong><p className="small">Prices are saved when you place the order.</p></div><strong className="numeric">{money(subtotal + tax)}</strong></div>
        <div className="form-actions"><Button variant="ghost" disabled={busy || importBusy} onClick={onClose}>Cancel</Button><Button type="submit" busy={busy} disabled={importBusy}>Create order</Button></div>
      </form>}
  </Modal>
    {addingCustomer && <CustomerModal onClose={() => setAddingCustomer(false)} onSubmit={async data => { const customer = await onCreateCustomer(data); setCustomerId(customer.id); }} />}
    {aiSettings && <Modal isOpen title="AI connections" onClose={() => setAiSettings(false)} busy={aiDirty || aiBusy}>
      <div className="stack"><p className="form-note">Your order draft is kept while you connect Gemini or Groq.</p><ProviderConnections onDirtyChange={setAiDirty} onBusyChange={setAiBusy} /><Button variant="outline" disabled={aiDirty || aiBusy} onClick={() => setAiSettings(false)}>Back to order</Button></div>
    </Modal>}
  </>;
}
