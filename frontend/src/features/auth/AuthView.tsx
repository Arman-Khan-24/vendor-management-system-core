import { useState } from 'react';
import { BookOpen, Link2, LogIn } from 'lucide-react';
import { Button, ErrorNotice, Input, Modal, Select } from '../../components/ui';
import { ApiClient } from '../../api/client';
import type { Business, User } from '../../types';
import { errorMessage } from '../../utils/formatters';
import { ServerConnection } from '../settings/ConnectionSettings';

export function AuthView({ onSuccess }: { onSuccess: (user: User, business: Business) => void }) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connections, setConnections] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [template, setTemplate] = useState('custom');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const result = register
        ? await ApiClient.register({ businessName: businessName.trim(), businessSlug: slug, categoryTemplate: template, phone: phone || undefined, ownerName: ownerName.trim(), email: email.trim(), password })
        : await ApiClient.login({ email: email.trim(), password });
      ApiClient.setToken(result.token);
      onSuccess(result.user, result.business);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <div className="auth-layout">
    <aside className="auth-story"><div><div className="brand"><div className="brand-symbol"><BookOpen size={25} strokeWidth={1.8} aria-hidden="true" /></div><span>OrderLedger</span></div><h1>A little more order.<br />A little less busy.</h1><p>Orders, customers, and payments. A calm home for the business you’re building.</p><div className="auth-preview" aria-hidden="true"><p>ONE PLACE FOR YOUR DAY</p><strong>Everything, together.</strong><div className="auth-preview-row"><span className="tonal">Orders</span><span className="tonal-peach">People</span><span className="tonal-lavender">Payments</span></div></div></div><div className="auth-copyright">Made for everyday business.</div></aside>
    <main className="auth-content"><div className="auth-form"><p className="eyebrow">{register ? 'MAKE ROOM FOR YOUR BUSINESS' : 'YOUR WORKSPACE IS WAITING'}</p><h2>{register ? 'A fresh start.' : 'Welcome back.'}</h2><p>{register ? 'Create your business. Make it yours in Settings.' : 'Sign in to pick up where you left off.'}</p>
      {error && <div style={{ marginBottom: 20 }}><ErrorNotice message={error} /></div>}
      <form onSubmit={submit}>
        {register && <><Input label="Business name" value={businessName} required minLength={2} maxLength={100} autoComplete="organization" onChange={e => { setBusinessName(e.target.value); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)); }} /><Input label="Workspace ID" value={slug} required minLength={2} maxLength={50} pattern="[a-z0-9-]+" onChange={e => setSlug(e.target.value)} hint="A unique name with lowercase letters, numbers, and hyphens." /><Select label="Business preset" value={template} onChange={e => setTemplate(e.target.value)}><option value="custom">Custom — start with an empty catalog</option><option value="fruits_veg">Fresh produce — starter products included</option><option value="grocery">Grocery & staples — starter products included</option><option value="dairy">Dairy & eggs — starter products included</option></Select><Input label="Your name" value={ownerName} required minLength={2} autoComplete="name" onChange={e => setOwnerName(e.target.value)} /><Input label="Business phone" type="tel" value={phone} maxLength={20} minLength={5} autoComplete="tel" onChange={e => setPhone(e.target.value)} /></>}
        <Input label="Email address" type="email" value={email} required autoComplete="username" onChange={e => setEmail(e.target.value)} placeholder="you@yourbusiness.com" />
        <Input label="Password" type="password" value={password} required minLength={register ? 8 : 1} autoComplete={register ? 'new-password' : 'current-password'} onChange={e => setPassword(e.target.value)} hint={register ? 'At least 8 characters.' : undefined} />
        <Button type="submit" size="lg" busy={busy}><LogIn size={18} aria-hidden="true" />{register ? 'Create business' : 'Sign in'}</Button>
      </form>
      <div className="auth-mode"><span className="muted">{register ? 'Already have an account? ' : 'New here? '}</span><button type="button" onClick={() => { setRegister(!register); setError(null); }}>{register ? 'Sign in' : 'Create a business'}</button></div>
      <div className="auth-connection"><Button variant="ghost" size="sm" onClick={() => setConnections(true)}><Link2 size={16} aria-hidden="true" />Server connection</Button></div>
    </div></main>
    <Modal isOpen={connections} title="Server connection" onClose={() => setConnections(false)}><ServerConnection /></Modal>
  </div>;
}
