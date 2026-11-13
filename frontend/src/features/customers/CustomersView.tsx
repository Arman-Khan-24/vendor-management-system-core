import { useState } from 'react';
import { Archive, ArrowUpRight, Download, Pencil, Plus, RotateCcw, Users } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorNotice, Modal, PageHeader, Pagination, SearchBox, usePagination } from '../../components/ui';
import { CustomerModal } from './CustomerModal';
import type { Customer, CustomerInput } from '../../types';
import { downloadCsv, errorMessage } from '../../utils/formatters';
import { useBusiness } from '../settings/businessSettings';
interface Props {
  customers: Customer[];
  onSelectCustomer: (customer: Customer) => void;
  onCreateCustomer: (data: CustomerInput) => Promise<void>;
  onUpdateCustomer: (id: string, data: Partial<CustomerInput> & { active?: boolean }) => Promise<void>;
  onRecordPayment: (id: string) => void;
}
export function CustomersView({ customers, onSelectCustomer, onCreateCustomer, onUpdateCustomer, onRecordPayment }: Props) {
  const { settings, money } = useBusiness();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('active');
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [archive, setArchive] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const visible = customers.filter(c => (filter === 'archived' ? !c.active : c.active) && (filter !== 'dues' || Number(c.outstanding_balance) > 0) && (c.name + ' ' + c.phone).toLowerCase().includes(search.toLowerCase()));
  const pages = usePagination(visible, JSON.stringify([filter, search]));
  const open = (customer: Customer | 'new') => {
    setEditing(customer);
  };
  const changeActive = async (customer: Customer, active: boolean) => {
    setBusy(true); setActionError(null);
    try { await onUpdateCustomer(customer.id, { active }); setArchive(null); }
    catch (e) { setActionError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <div className="page-stack">
    <PageHeader eyebrow="People behind the orders" title={settings.catalog.customerLabel} description="Their orders, payment terms, and balances. All together." actions={<><Button variant="outline" disabled={!visible.length} onClick={() => downloadCsv(['Name', 'Phone', 'Credit days', 'Billed', 'Paid', 'Balance'], visible.map(c => [c.name, c.phone, c.credit_terms_days, c.total_billed, c.total_paid, c.outstanding_balance]), 'customers.csv')}><Download size={17} aria-hidden="true" />Export</Button><Button onClick={() => open('new')}><Plus size={18} aria-hidden="true" />Add customer</Button></>} />
    <ErrorNotice message={actionError} />
    <div className="filter-bar"><SearchBox label="Search customers" value={search} onChange={setSearch} placeholder="Search a name or phone number…" /><div className="chips">{[['active', 'Active'], ['dues', 'With dues'], ['archived', 'Archived']].map(([id, label]) => <button type="button" key={id} className={'chip ' + (filter === id ? 'selected' : '')} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div></div>
    {!visible.length ? <EmptyState icon={<Users size={28} />} title={search ? 'No matching customers' : filter === 'dues' ? 'All caught up' : filter === 'archived' ? 'No archived customers' : 'Meet your first customer'} description={search ? 'Try another name or phone number.' : filter === 'dues' ? 'Your active customers have no outstanding balances.' : filter === 'archived' ? 'Archived customers and their statements remain available here.' : 'Add a customer to start taking orders and tracking payments.'} action={filter === 'active' && !search ? <Button onClick={() => open('new')}>Add your first customer</Button> : undefined} /> :
      <div className="customer-grid">{pages.items.map((c, index) => <div className={'card customer-card ' + (!c.active ? 'archived' : '')} key={c.id}>
        <div className="row"><div className={'item-icon ' + ['tonal', 'tonal-peach', 'tonal-lavender'][index % 3]}><Users size={21} aria-hidden="true" /></div><div className="grow"><h3>{c.name}</h3><a className="small muted" href={'tel:' + c.phone.replace(/[^\d+]/g, '')}>{c.phone}</a></div><Button variant="ghost" className="icon-button" aria-label={'Edit ' + c.name} onClick={() => open(c)}><Pencil size={17} /></Button></div>
        <div className="customer-balance"><div className="row between"><span>{Number(c.outstanding_balance) < 0 ? 'Customer credit' : 'Outstanding balance'}</span><Badge variant={Number(c.outstanding_balance) > 0 ? 'warning' : 'success'}>{Number(c.outstanding_balance) > 0 ? 'Payment due' : Number(c.outstanding_balance) < 0 ? 'In credit' : 'Settled'}</Badge></div><strong className="numeric">{money(Math.abs(Number(c.outstanding_balance || 0)))}</strong><span>{c.credit_terms_days === 0 ? 'Due on invoice date' : c.credit_terms_days + ' days to pay'}</span></div>
        <div className="row between wrap"><Button variant="secondary" size="sm" onClick={() => onSelectCustomer(c)}>Statement<ArrowUpRight size={15} aria-hidden="true" /></Button>{c.active ? <Button variant="ghost" className="icon-button" aria-label={'Archive ' + c.name} onClick={() => { setArchive(c); setActionError(null); }}><Archive size={17} /></Button> : <Button variant="ghost" size="sm" disabled={busy} onClick={() => changeActive(c, true)}><RotateCcw size={16} aria-hidden="true" />Restore</Button>}</div>
        {settings.modules.payments && Number(c.outstanding_balance) > 0 && <Button variant="outline" size="sm" onClick={() => onRecordPayment(c.id)}>Record payment</Button>}
      </div>)}</div>}
    <Pagination {...pages} />
    <p className="muted small">{visible.length} matching {visible.length === 1 ? 'account' : 'accounts'}</p>
    {editing && <CustomerModal customer={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSubmit={data => editing === 'new' ? onCreateCustomer(data) : onUpdateCustomer(editing.id, data)} />}
    <Modal isOpen={!!archive} title="Archive customer?" onClose={() => setArchive(null)} busy={busy}><div className="stack"><p><strong>{archive?.name}</strong> will be hidden from new orders. You can still view statements, receive payments, and restore the account.</p>{Number(archive?.outstanding_balance) > 0 && <p className="form-note">This account has {money(archive?.outstanding_balance)} outstanding.</p>}<ErrorNotice message={actionError} /><div className="form-actions"><Button variant="ghost" disabled={busy} onClick={() => setArchive(null)}>Keep customer</Button><Button variant="danger" busy={busy} onClick={() => archive && changeActive(archive, false)}>Archive customer</Button></div></div></Modal>
  </div>;
}
