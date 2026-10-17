import { useEffect, useRef, useState } from 'react';
import { BookOpen, Boxes, Check, CreditCard, Download, Layers3, Leaf, Link2, Milk, Paintbrush, Save, Settings2, ShoppingBasket, Store, Upload } from 'lucide-react';
import { Badge, Button, Card, ErrorNotice, Input, Modal, PageHeader, SectionHeading, Select, Switch, Textarea } from '../../components/ui';
import type { Accent, Business, BusinessSettings, BusinessUpdate, PaymentMode, Theme, User } from '../../types';
import { downloadFile, errorMessage } from '../../utils/formatters';
import { getSettings, presets } from './businessSettings';
import { ProviderConnections, ServerConnection } from './ConnectionSettings';

const paymentLabels: Record<PaymentMode, string> = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank transfer', cheque: 'Cheque' };
const sections = [
  { id: 'business', title: 'Business profile', icon: Store },
  { id: 'appearance', title: 'Appearance', icon: Paintbrush },
  { id: 'catalog', title: 'Catalog & labels', icon: Boxes },
  { id: 'billing', title: 'Billing & payments', icon: CreditCard },
  { id: 'modules', title: 'Features', icon: Layers3 },
  { id: 'connections', title: 'Connections', icon: Link2 },
  { id: 'blueprint', title: 'Blueprints', icon: Settings2 },
];
function businessDraft(b: Business): BusinessUpdate {
  return { name: b.name, phone: b.phone || '', currency: b.currency, logoUrl: b.logo_url || '', invoiceTrigger: b.invoice_trigger, categoryTemplate: b.category_template || 'custom', settings: structuredClone(getSettings(b)) };
}
function CommaList({ label, values, onChange, hint }: { label: string; values: string[]; onChange: (v: string[]) => void; hint: string }) {
  const [text, setText] = useState(values.join(', '));
  const lastValues = useRef(values.join(','));
  useEffect(() => {
    if (values.join(',') !== lastValues.current) { setText(values.join(', ')); lastValues.current = values.join(','); }
  }, [values]);
  return <Input label={label} value={text} hint={hint} onChange={e => {
    const next = e.target.value;
    setText(next);
    const parsed = [...new Set(next.split(',').map(s => s.trim()).filter(Boolean))];
    lastValues.current = parsed.join(',');
    onChange(parsed);
  }} />;
}
type Blueprint = { format: 'orderledger-blueprint'; version: 1; currency: string; invoiceTrigger: 'Packed' | 'Delivered'; categoryTemplate: string; settings: Omit<BusinessSettings, 'profile'> };
function exportBlueprint(business: Business): Blueprint {
  const { branding, catalog, billing, modules } = getSettings(business);
  return { format: 'orderledger-blueprint', version: 1, currency: business.currency, invoiceTrigger: business.invoice_trigger, categoryTemplate: business.category_template || 'custom', settings: { branding, catalog, billing, modules } };
}
function readBlueprint(value: unknown): Blueprint {
  const object = (v: unknown): Record<string, any> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('This file is not a valid OrderLedger blueprint.'); return v as Record<string, any>; };
  const b = object(value);
  if (b.format !== 'orderledger-blueprint' || b.version !== 1) throw new Error('Choose an OrderLedger blueprint exported by this version of the app.');
  const s = object(b.settings), branding = object(s.branding), catalog = object(s.catalog), billing = object(s.billing), modules = object(s.modules);
  const str = (v: unknown) => { if (typeof v !== 'string') throw new Error('Blueprint contains an invalid text field.'); return v; };
  const strings = (v: unknown) => { if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) throw new Error('Blueprint contains an invalid list.'); return v as string[]; };
  if (!['sage', 'lavender', 'peach', 'sky'].includes(branding.accent) || !['light', 'dark', 'system'].includes(branding.theme)) throw new Error('Blueprint has an unsupported theme.');
  if (!['Packed', 'Delivered'].includes(b.invoiceTrigger) || !presets.some(p => p.id === b.categoryTemplate) || !/^[A-Z]{3}$/.test(str(b.currency))) throw new Error('Blueprint has invalid business defaults.');
  if (typeof modules.reports !== 'boolean' || typeof modules.payments !== 'boolean' || typeof billing.defaultCreditTermsDays !== 'number' || typeof billing.taxRate !== 'number') throw new Error('Blueprint has invalid feature or billing values.');
  const methods = strings(billing.paymentMethods);
  if (!methods.length || methods.some(m => !(m in paymentLabels))) throw new Error('Blueprint has an unsupported payment method.');
  const units = strings(catalog.units);
  if (!units.length || !units.includes(catalog.defaultUnit)) throw new Error('Blueprint default unit must be included in its units list.');
  return { format: 'orderledger-blueprint', version: 1, currency: b.currency, invoiceTrigger: b.invoiceTrigger, categoryTemplate: b.categoryTemplate,
    settings: {
      branding: { appName: str(branding.appName), tagline: str(branding.tagline), accent: branding.accent, theme: branding.theme },
      catalog: { productLabel: str(catalog.productLabel), customerLabel: str(catalog.customerLabel), defaultUnit: str(catalog.defaultUnit), units, categories: strings(catalog.categories) },
      billing: { invoicePrefix: str(billing.invoicePrefix), defaultCreditTermsDays: billing.defaultCreditTermsDays, paymentMethods: methods as PaymentMode[], taxRate: billing.taxRate, footer: str(billing.footer) },
      modules: { reports: modules.reports, payments: modules.payments },
    },
  };
}
export function SettingsView({ business, user, onSave, onDirtyChange, initialSection = 'business' }: { business: Business; user: User; onSave: (data: BusinessUpdate) => Promise<void>; onDirtyChange: (dirty: boolean) => void; initialSection?: string }) {
  const [section, setSection] = useState(initialSection);
  const [draft, setDraft] = useState(() => businessDraft(business));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<typeof presets[number] | null>(null);
  const [imported, setImported] = useState<Blueprint | null>(null);
  const [saved, setSaved] = useState(false);
  const isOwner = user.role === 'OWNER';
  const dirty = JSON.stringify(draft) !== JSON.stringify(businessDraft(business));
  useEffect(() => { setDraft(businessDraft(business)); }, [business]);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => { setSection(initialSection); }, [initialSection]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const update = (patch: Partial<BusinessUpdate>) => { setDraft(d => ({ ...d, ...patch })); setSaved(false); };
  const setting = <K extends keyof BusinessSettings>(key: K, patch: Partial<BusinessSettings[K]>) => { setDraft(d => ({ ...d, settings: { ...d.settings, [key]: { ...d.settings[key], ...patch } } })); setSaved(false); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError(null); setSaved(false); setBusy(true);
    try {
      if (!draft.name.trim()) throw new Error('Enter your business name.');
      if (!draft.settings.catalog.units.includes(draft.settings.catalog.defaultUnit)) throw new Error('Add the default unit to your units list in Catalog & labels.');
      if (!draft.settings.billing.paymentMethods.length) throw new Error('Choose at least one payment method.');
      await onSave({ ...draft, name: draft.name.trim() }); setSaved(true);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    setError(null);
    try {
      if (file.size > 100_000) throw new Error('Blueprint files must be smaller than 100 KB.');
      setImported(readBlueprint(JSON.parse(await file.text())));
    } catch (e) { setError(e instanceof SyntaxError ? 'The file is not valid JSON.' : errorMessage(e)); }
  };
  const applyPreset = () => {
    if (!preset) return;
    setDraft(d => ({ ...d, categoryTemplate: preset.id, settings: { ...d.settings, catalog: { ...d.settings.catalog, defaultUnit: preset.unit, units: preset.units, categories: preset.categories }, billing: { ...d.settings.billing, defaultCreditTermsDays: preset.credit } } }));
    setPreset(null); setSaved(false);
  };
  const s = draft.settings;
  return <div className="page-stack">
    <PageHeader eyebrow="A workspace that feels like you" title="Make it yours." description="Your business, your way. Set it up once and make every day simpler." />
    {!isOwner && <Card><Badge>Business owner access</Badge><p className="muted" style={{ marginTop: 12 }}>You are signed in as {user.email}. Business settings and saved provider connections can be changed by the owner.</p><div className="section-divider" /><ServerConnection signedIn /></Card>}
    {isOwner && <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections">{sections.map(({ id, title, icon: Icon }) => <button type="button" key={id} aria-current={section === id ? 'page' : undefined} onClick={() => { setSection(id); setError(null); }} className={'nav-item ' + (section === id ? 'selected' : '')}><Icon size={18} aria-hidden="true" /><span>{title}</span></button>)}</nav>
      <div className="settings-panel">
        <ErrorNotice message={error} />
        {section === 'connections' ? <div className="stack"><Card className="settings-section"><ServerConnection signedIn /></Card><Card className="settings-section"><ProviderConnections /></Card></div> :
          <form onSubmit={save}>
            <div className="card settings-section">
              {section === 'business' && <div className="stack">
                <SectionHeading title="The business behind the name" description="These details appear on your invoices and statements." />
                <div className="form-grid"><Input label="Business name" value={draft.name} required minLength={2} maxLength={100} onChange={e => update({ name: e.target.value })} /><Input label="Phone number" type="tel" value={draft.phone} maxLength={25} onChange={e => update({ phone: e.target.value })} />
                  <Input label="Business email" type="email" value={s.profile.email} onChange={e => setting('profile', { email: e.target.value })} /><Select label="Currency" value={draft.currency} onChange={e => update({ currency: e.target.value })}>{['INR', 'USD', 'EUR', 'GBP', 'AED', 'CAD', 'AUD', 'SGD', 'BDT', 'NPR', 'PKR'].map(c => <option key={c}>{c}</option>)}</Select>
                  <div className="form-span"><Textarea label="Business address" rows={3} value={s.profile.address} maxLength={500} onChange={e => setting('profile', { address: e.target.value })} /></div>
                  <Input label="Tax registration number" value={s.profile.taxId} maxLength={100} placeholder="Optional GSTIN / tax ID" onChange={e => setting('profile', { taxId: e.target.value })} /><Input label="Logo URL" type="url" value={draft.logoUrl} placeholder="https://…" onChange={e => update({ logoUrl: e.target.value })} /></div>
                <p className="form-note">Currency is fixed once financial activity is recorded. Create a separate business for another currency.</p>
                <div className="section-divider" /><div className="row between wrap"><div><strong className="small">Owner account</strong><p className="muted small">{user.name} · {user.email}</p></div><Badge>Owner</Badge></div>
              </div>}
              {section === 'appearance' && <div className="stack">
                <SectionHeading title="A familiar place to work" description="Choose your brand name, theme, and a little color." />
                <Input label="App name" value={s.branding.appName} maxLength={60} required onChange={e => setting('branding', { appName: e.target.value })} />
                <Input label="Tagline" value={s.branding.tagline} maxLength={140} onChange={e => setting('branding', { tagline: e.target.value })} />
                <div><p className="small" style={{ fontWeight: 750, marginBottom: 12 }}>Accent palette</p><div className="palette-grid">{([{ id: 'sage', name: 'Sage', color: '#c9dda5' }, { id: 'lavender', name: 'Lavender', color: '#d8c5e9' }, { id: 'peach', name: 'Peach', color: '#edc6ad' }, { id: 'sky', name: 'Sky', color: '#b9d5ed' }] as const).map(p => <button type="button" key={p.id} aria-pressed={s.branding.accent === p.id} className={'palette-option ' + (s.branding.accent === p.id ? 'selected' : '')} onClick={() => setting('branding', { accent: p.id as Accent })}><span className="palette-dot" style={{ background: p.color }} />{p.name}</button>)}</div></div>
                <Select label="Default theme" value={s.branding.theme} onChange={e => setting('branding', { theme: e.target.value as Theme })}><option value="light">Light</option><option value="dark">Dark</option><option value="system">Match device</option></Select>
                <div className="preview-card" data-accent={s.branding.accent}><BookOpen size={25} aria-hidden="true" /><p>YOUR WORKSPACE PREVIEW</p><strong>{s.branding.appName || 'Your app'}</strong><p>{s.branding.tagline}</p><div className="chips" style={{ marginTop: 18 }}><span className="badge badge-default">Orders</span><span className="badge badge-default">{s.catalog.productLabel}</span><span className="badge badge-default">{s.catalog.customerLabel}</span></div></div>
              </div>}
              {section === 'catalog' && <div className="stack">
                <SectionHeading title="The right words for your business" description="Set the names, categories, and units your team uses." />
                <div className="form-grid"><Input label="Products page label" value={s.catalog.productLabel} required maxLength={40} onChange={e => setting('catalog', { productLabel: e.target.value })} /><Input label="Customers page label" value={s.catalog.customerLabel} required maxLength={40} onChange={e => setting('catalog', { customerLabel: e.target.value })} /></div>
                <CommaList label="Available units" values={s.catalog.units} hint="Separate units with commas. Example: kg, gram, piece, carton." onChange={units => setting('catalog', { units })} />
                <Select label="Default unit for new products" value={s.catalog.defaultUnit} onChange={e => setting('catalog', { defaultUnit: e.target.value })}>{[...new Set([...s.catalog.units, s.catalog.defaultUnit])].map(u => <option key={u}>{u}</option>)}</Select>
                <CommaList label="Catalog categories" values={s.catalog.categories} hint="Separate categories with commas. Existing product categories stay as they are." onChange={categories => setting('catalog', { categories })} />
                <p className="form-note">These are defaults for new entries. Update individual products in your catalog.</p>
              </div>}
              {section === 'billing' && <div className="stack">
                <SectionHeading title="Billing that follows your routine" description="Choose when to invoice and how customers can pay." />
                <div className="form-grid"><Input label="Invoice prefix" value={s.billing.invoicePrefix} required maxLength={16} onChange={e => setting('billing', { invoicePrefix: e.target.value.toUpperCase() })} hint={'Example: ' + (s.billing.invoicePrefix || 'INV') + '-0001'} /><Select label="Create invoice when" value={draft.invoiceTrigger} onChange={e => update({ invoiceTrigger: e.target.value as 'Packed' | 'Delivered' })}><option value="Packed">Order is packed</option><option value="Delivered">Order is delivered</option></Select>
                  <Input label="Default payment terms (days)" type="number" min="0" max="365" step="1" value={s.billing.defaultCreditTermsDays} required onChange={e => setting('billing', { defaultCreditTermsDays: Number(e.target.value) })} hint="Used when adding new customers." /><Input label="Tax rate (%)" type="number" min="0" max="100" step="0.01" value={s.billing.taxRate} required onChange={e => setting('billing', { taxRate: Number(e.target.value) })} hint="One tax rate applied to new orders." /></div>
                <div><p className="small" style={{ fontWeight: 750, marginBottom: 12 }}>Accepted payment methods</p><div className="check-options">{(Object.keys(paymentLabels) as PaymentMode[]).map(mode => <label key={mode}><input type="checkbox" checked={s.billing.paymentMethods.includes(mode)} onChange={e => setting('billing', { paymentMethods: e.target.checked ? [...s.billing.paymentMethods, mode] : s.billing.paymentMethods.filter(m => m !== mode) })} />{paymentLabels[mode]}</label>)}</div></div>
                <Textarea label="Invoice footer" value={s.billing.footer} maxLength={500} onChange={e => setting('billing', { footer: e.target.value })} />
                <p className="form-note">New tax rates, prefixes, and payment terms apply to future orders. Issued invoices retain their saved amounts and numbers.</p>
              </div>}
              {section === 'modules' && <div>
                <SectionHeading title="Keep what your team needs" description="Choose the tools visible in this workspace." />
                <Switch label="Payment collection" description="Show payment records and collection actions." checked={s.modules.payments} onChange={payments => setting('modules', { payments })} />
                <Switch label="Business reports" description="Show sales, collections, rankings, and overdue balances." checked={s.modules.reports} onChange={reports => setting('modules', { reports })} />
                <div className="switch-row"><div><strong>WhatsApp ordering</strong><p>Planned for a later integration. Manual orders are available now.</p></div><Badge>Coming later</Badge></div>
                <p className="form-note" style={{ marginTop: 24 }}>Orders, catalog, customers, and invoices are the core workflow. Hiding a tool keeps its existing records.</p>
              </div>}
              {section === 'blueprint' && <div className="stack">
                <SectionHeading title="One good setup. Many businesses." description="Start with a preset or reuse a configuration you have already built." />
                <div className="preset-grid">{presets.map((p, index) => { const Icon = [Leaf, ShoppingBasket, Milk, Store][index]; return <button key={p.id} type="button" className="preset-option" onClick={() => setPreset(p)}><Icon size={24} aria-hidden="true" /><strong>{p.name}</strong><p>{p.description}</p></button>; })}</div>
                <div className="section-divider" />
                <div className="row between wrap"><div><h3>Export saved blueprint</h3><p className="muted small" style={{ marginTop: 5 }}>Branding, catalog defaults, billing, and feature choices.</p></div><Button variant="secondary" disabled={dirty} onClick={() => downloadFile(JSON.stringify(exportBlueprint(business), null, 2), 'orderledger-blueprint.json', 'application/json')}><Download size={17} aria-hidden="true" />Export blueprint</Button></div>
                {dirty && <p className="small muted">Save your changes before exporting.</p>}
                <div className="blueprint-file"><label htmlFor="blueprint-file">Import a blueprint</label><p className="muted small">Preview the settings before applying them to this business.</p><input id="blueprint-file" type="file" accept=".json,application/json" onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }} /></div>
                <p className="form-note">Blueprints exclude customer records, orders, payments, business contact details, API keys, and the device’s server address. Presets never delete your existing catalog.</p>
              </div>}
            </div>
            <div className="settings-save"><p>{saved && !dirty ? 'All changes saved.' : dirty ? 'You have unsaved changes.' : 'Your settings are up to date.'}</p><div className="row"><Button variant="ghost" disabled={!dirty || busy} onClick={() => { setDraft(businessDraft(business)); setError(null); setSaved(false); }}>Discard</Button><Button type="submit" disabled={!dirty} busy={busy}><Save size={17} aria-hidden="true" />Save changes</Button></div></div>
          </form>}
        {section === 'connections' && dirty && <p className="form-note" style={{ marginTop: 16 }}>Your business settings have unsaved changes. Return to a settings section to save them.</p>}
      </div>
    </div>}
    <Modal isOpen={!!preset} title={'Use ' + (preset?.name || 'preset') + '?'} onClose={() => setPreset(null)}>
      <div className="stack"><p>This fills in units, categories, and default credit terms. Your existing products and financial records stay unchanged.</p><div className="form-note"><strong>Units:</strong> {preset?.units.join(', ')}<br /><strong>Payment terms:</strong> {preset?.credit} days</div><p className="muted small">Review the changes, then save your settings.</p><div className="form-actions"><Button variant="ghost" onClick={() => setPreset(null)}>Cancel</Button><Button onClick={applyPreset}><Check size={17} aria-hidden="true" />Apply to settings</Button></div></div>
    </Modal>
    <Modal isOpen={!!imported} title="Preview blueprint" onClose={() => setImported(null)}>
      {imported && <div className="stack"><div className="preview-card" data-accent={imported.settings.branding.accent}><Upload size={23} aria-hidden="true" /><strong>{imported.settings.branding.appName}</strong><p>{imported.settings.branding.tagline}</p></div><div className="form-note"><p><strong>Currency:</strong> {imported.currency}</p><p><strong>Units:</strong> {imported.settings.catalog.units.join(', ')}</p><p><strong>Invoices:</strong> {imported.settings.billing.invoicePrefix}, on {imported.invoiceTrigger.toLowerCase()}</p><p><strong>Tax:</strong> {imported.settings.billing.taxRate}%</p></div><p className="muted small">This replaces configuration fields in the form. Business contact details and existing records stay unchanged. Review and save to apply.</p><div className="form-actions"><Button variant="ghost" onClick={() => setImported(null)}>Cancel</Button><Button onClick={() => { setDraft(d => ({ ...d, currency: imported.currency, invoiceTrigger: imported.invoiceTrigger, categoryTemplate: imported.categoryTemplate, settings: { ...imported.settings, profile: d.settings.profile } })); setImported(null); setSaved(false); }}>Apply to settings</Button></div></div>}
    </Modal>
  </div>;
}
