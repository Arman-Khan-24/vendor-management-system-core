import { useState } from 'react';
import { Archive, Check, Download, Package, Pencil, Plus, RotateCcw, Settings2 } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorNotice, Input, Modal, PageHeader, SearchBox, Select } from '../../components/ui';
import type { Product, ProductInput } from '../../types';
import { downloadCsv, errorMessage } from '../../utils/formatters';
import { useBusiness } from '../settings/businessSettings';

interface Props {
  products: Product[];
  onCreateProduct: (data: ProductInput) => Promise<void>;
  onUpdateProduct: (id: string, data: Partial<ProductInput> & { active?: boolean }) => Promise<void>;
  onCustomize: () => void;
}
export function ProductsView({ products, onCreateProduct, onUpdateProduct, onCustomize }: Props) {
  const { settings, money } = useBusiness();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('active');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('name');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [archive, setArchive] = useState<Product | null>(null);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState(settings.catalog.defaultUnit);
  const [price, setPrice] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const categories = [...new Set([...settings.catalog.categories, ...products.map(p => p.category || '').filter(Boolean)])].sort();
  const filtered = products.filter(p => (filter === 'all' || (filter === 'active' ? p.active : !p.active)) && (!category || p.category === category) && (p.name + ' ' + (p.category || '')).toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sort === 'price' ? Number(a.current_price) - Number(b.current_price) : a.name.localeCompare(b.name));
  const open = (product: Product | 'new') => {
    setEditing(product); setError(null);
    setName(product === 'new' ? '' : product.name);
    setUnit(product === 'new' ? settings.catalog.defaultUnit : product.unit);
    setPrice(product === 'new' ? '' : String(product.current_price));
    setFormCategory(product === 'new' ? '' : product.category || '');
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const data = { name: name.trim(), unit, currentPrice: Number(price), category: formCategory.trim() };
      if (!data.name) throw new Error('Enter a product name.');
      if (!Number.isFinite(data.currentPrice) || data.currentPrice < 0) throw new Error('Enter a valid price.');
      if (editing === 'new') await onCreateProduct(data);
      else if (editing) await onUpdateProduct(editing.id, data);
      setEditing(null);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const changeActive = async (product: Product, active: boolean) => {
    setBusy(true); setActionError(null);
    try { await onUpdateProduct(product.id, { active }); setArchive(null); }
    catch (e) { setActionError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <div className="page-stack">
    <PageHeader eyebrow="Your everyday essentials" title={settings.catalog.productLabel === 'Products' ? 'Your catalog' : settings.catalog.productLabel} description="Keep prices current and every order a little easier." actions={<>
      <Button variant="outline" onClick={() => downloadCsv(['Name', 'Category', 'Unit', 'Price', 'Active'], filtered.map(p => [p.name, p.category, p.unit, p.current_price, p.active]), 'catalog.csv')} disabled={!filtered.length}><Download size={17} aria-hidden="true" />Export</Button>
      <Button onClick={() => open('new')}><Plus size={18} aria-hidden="true" />Add product</Button>
    </>} />
    <ErrorNotice message={actionError} />
    <div className="filter-bar">
      <SearchBox label="Search catalog" placeholder="Search names or categories…" value={search} onChange={setSearch} />
      <div className="row wrap"><Select aria-label="Filter by category" value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}</Select><Button variant="ghost" onClick={onCustomize}><Settings2 size={18} aria-hidden="true" />Customize</Button></div>
    </div>
    <div className="filter-bar">
      <div className="chips">{[['active', 'Active', products.filter(p => p.active).length], ['archived', 'Archived', products.filter(p => !p.active).length], ['all', 'All', products.length]].map(([id, label, count]) => <button type="button" key={id} className={'chip ' + (filter === id ? 'selected' : '')} aria-pressed={filter === id} onClick={() => setFilter(String(id))}>{label}<span className="chip-count">{count}</span></button>)}</div>
      <Select aria-label="Sort catalog" value={sort} onChange={e => setSort(e.target.value)}><option value="name">Name A–Z</option><option value="price">Price: low to high</option></Select>
    </div>
    {!filtered.length ? <EmptyState icon={<Package size={28} />} title={search || category ? 'No matching products' : filter === 'archived' ? 'Nothing archived' : 'Your catalog starts here'} description={search || category ? 'Try another name or clear the filters.' : filter === 'archived' ? 'Archived products will appear here. You can restore them anytime.' : 'Add the items you sell, their units, and your current prices.'} action={search || category ? <Button variant="secondary" onClick={() => { setSearch(''); setCategory(''); }}>Clear filters</Button> : filter !== 'archived' ? <Button onClick={() => open('new')}>Add your first product</Button> : undefined} /> :
      <div className="records">{filtered.map((product, i) => <div key={product.id} className={'record-row ' + (!product.active ? 'archived' : '')}>
        <div className={'item-icon ' + ['tonal', 'tonal-peach', 'tonal-lavender', 'tonal-sky'][i % 4]}><Package size={21} aria-hidden="true" /></div>
        <div className="record-title"><strong>{product.name}</strong><small>{product.category || 'Uncategorized'} · Sold by {product.unit}</small></div>
        {!product.active && <Badge>Archived</Badge>}
        <div className="record-price numeric"><strong>{money(product.current_price)}</strong><small>per {product.unit}</small></div>
        <div className="record-actions"><Button variant="ghost" className="icon-button" aria-label={'Edit ' + product.name} onClick={() => open(product)}><Pencil size={18} /></Button>
          {product.active ? <Button variant="ghost" className="icon-button" aria-label={'Archive ' + product.name} onClick={() => { setArchive(product); setActionError(null); }}><Archive size={18} /></Button> : <Button variant="secondary" size="sm" disabled={busy} onClick={() => changeActive(product, true)}><RotateCcw size={16} aria-hidden="true" />Restore</Button>}
        </div>
      </div>)}</div>}
    <p className="list-caption"><span>{filtered.length} of {products.length} products</span><span>Price changes apply to new orders.</span></p>
    <Modal isOpen={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add a product' : 'Edit product'} busy={busy}>
      <form className="stack" onSubmit={save}>
        <ErrorNotice message={error} />
        <Input label="Product name" autoFocus value={name} maxLength={255} required onChange={e => setName(e.target.value)} placeholder="e.g. Fresh tomatoes" />
        <div className="form-grid"><Input label="Price per unit" type="number" step="0.01" min="0" value={price} required onChange={e => setPrice(e.target.value)} placeholder="0.00" />
          <Select label="Unit" value={unit} onChange={e => setUnit(e.target.value)}>{[...new Set([...settings.catalog.units, unit])].map(u => <option key={u}>{u}</option>)}</Select></div>
        <Input label="Category" value={formCategory} maxLength={100} onChange={e => setFormCategory(e.target.value)} list="product-categories" placeholder="Optional" />
        <datalist id="product-categories">{categories.map(c => <option value={c} key={c} />)}</datalist>
        <p className="form-note">Existing orders keep their original product details and prices.</p>
        <div className="form-actions"><Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" busy={busy}><Check size={17} aria-hidden="true" />Save product</Button></div>
      </form>
    </Modal>
    <Modal isOpen={!!archive} title="Archive product?" onClose={() => setArchive(null)} busy={busy}>
      <div className="stack"><p><strong>{archive?.name}</strong> will be hidden from new orders. Past orders and invoices stay available.</p><ErrorNotice message={actionError} /><div className="form-actions"><Button variant="ghost" disabled={busy} onClick={() => setArchive(null)}>Keep product</Button><Button variant="danger" busy={busy} onClick={() => archive && changeActive(archive, false)}>Archive product</Button></div></div>
    </Modal>
  </div>;
}
