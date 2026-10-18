import { useEffect, useState } from 'react';
import { CheckCircle2, Link2, Save, Server } from 'lucide-react';
import { ApiClient, normalizeApiUrl } from '../../api/client';
import { Badge, Button, ErrorNotice, Input, LoadingState, SectionHeading, Select } from '../../components/ui';
import type { Connections, ProviderConnection } from '../../types';
import { errorMessage } from '../../utils/formatters';

export function ServerConnection({ signedIn = false, onDirtyChange }: { signedIn?: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const [endpoint, setEndpoint] = useState(ApiClient.getConnection());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<string | null>(null);
  useEffect(() => { onDirtyChange?.(endpoint !== ApiClient.getConnection()); return () => onDirtyChange?.(false); }, [endpoint, onDirtyChange]);
  const test = async () => {
    setBusy(true); setError(null); setTested(null);
    try { await ApiClient.testConnection(endpoint); setTested(endpoint); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const save = () => {
    try { normalizeApiUrl(endpoint); ApiClient.setConnection(endpoint); setTested(null); } catch (e) { setError(errorMessage(e)); }
  };
  return <div className="stack">
    <SectionHeading title="Your app server" description="This connection is saved on this device." />
    <Input label="Backend API address" type="url" value={endpoint} onChange={e => { setEndpoint(e.target.value); setTested(null); }} placeholder="https://api.yourbusiness.com" hint="Leave blank to use this website’s /api address. A final /api is optional." />
    <ErrorNotice message={error} />
    {tested === endpoint && <p className="success-note" role="status">Connection verified. The server and database are responding.</p>}
    <p className="form-note">{signedIn ? 'Changing servers signs you out. Sign in with an account on the new server.' : 'Your login details will be sent to this server. Test the address before signing in.'}</p>
    <div className="row wrap"><Button variant="outline" busy={busy} onClick={test}><Link2 size={17} aria-hidden="true" />Test connection</Button><Button onClick={save} disabled={busy || endpoint === ApiClient.getConnection()}><Server size={17} aria-hidden="true" />{signedIn ? 'Save & sign out' : 'Save connection'}</Button></div>
  </div>;
}

type ProviderDraft = ProviderConnection & { apiKey: string; clearKey: boolean };
const toDraft = (connections: Connections) => ({ primary: { ...connections.primary, apiKey: '', clearKey: false }, fallback: { ...connections.fallback, apiKey: '', clearKey: false } });
const providerDefaults = {
  openai: { endpoint: 'https://api.openai.com/v1', model: '' },
  gemini: { endpoint: 'https://generativelanguage.googleapis.com/v1beta', model: '' },
  groq: { endpoint: 'https://api.groq.com/openai/v1', model: '' },
  custom: { endpoint: '', model: '' },
};
export function ProviderConnections({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const [draft, setDraft] = useState<{ primary: ProviderDraft; fallback: ProviderDraft } | null>(null);
  const [stored, setStored] = useState<Connections | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = !!draft && !!stored && JSON.stringify(draft) !== JSON.stringify(toDraft(stored));
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const load = async () => {
    setError(null);
    try { const connections = await ApiClient.getConnections(); setStored(connections); setDraft(toDraft(connections)); } catch (e) { setError(errorMessage(e)); }
  };
  useEffect(() => { void load(); }, []);
  const change = (key: 'primary' | 'fallback', fields: Partial<ProviderDraft>) => { setDraft(d => d ? { ...d, [key]: { ...d[key], ...fields } } : d); setSaved(false); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!draft || !stored) return;
    setBusy(true); setError(null); setSaved(false);
    const payload = (value: ProviderDraft, original: ProviderConnection) => Object.fromEntries(Object.entries({ provider: value.provider, endpoint: value.endpoint.trim(), model: value.model.trim(), ...(value.clearKey ? { apiKey: '' } : value.apiKey.trim() ? { apiKey: value.apiKey.trim() } : {}) }).filter(([key, entry]) => key === 'apiKey' || entry !== original[key as keyof ProviderConnection]));
    const changes = Object.fromEntries((['primary', 'fallback'] as const).flatMap(slot => {
      const patch = payload(draft[slot], stored[slot]);
      return Object.keys(patch).length ? [[slot, patch]] : [];
    }));
    try { const connections = await ApiClient.updateConnections(changes); setStored(connections); setDraft(toDraft(connections)); setSaved(true); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <div className="stack">
    <SectionHeading title="AI provider connections" description="Prepare your provider settings for future automated ordering." action={<Badge>Not active yet</Badge>} />
    <ErrorNotice message={error} retry={!draft ? load : undefined} />
    {!draft ? !error && <LoadingState label="Loading connections…" /> : <form className="stack" onSubmit={save}>
      {(['primary', 'fallback'] as const).map(key => <div className="stack" key={key}>
        <div className="row between"><h3>{key === 'primary' ? 'Primary provider' : 'Fallback provider'}</h3><Badge variant={draft[key].hasApiKey ? 'success' : 'default'}>{draft[key].hasApiKey ? 'Key saved' : 'No saved key'}</Badge></div>
        <div className="form-grid"><Select label={key === 'primary' ? 'Primary provider' : 'Fallback provider'} value={draft[key].provider} onChange={e => { const provider = e.target.value as ProviderConnection['provider']; change(key, { provider, ...providerDefaults[provider] }); }}><option value="openai">OpenAI</option><option value="gemini">Google Gemini</option><option value="groq">Groq</option><option value="custom">Custom / compatible API</option></Select><Input label={key === 'primary' ? 'Primary model' : 'Fallback model'} value={draft[key].model} maxLength={150} placeholder="Model ID from your provider" onChange={e => change(key, { model: e.target.value })} /></div>
        <Input label={key === 'primary' ? 'Primary endpoint' : 'Fallback endpoint'} type="url" value={draft[key].endpoint} required onChange={e => change(key, { endpoint: e.target.value })} />
        <Input label={key === 'primary' ? 'Primary API key' : 'Fallback API key'} type="password" autoComplete="new-password" value={draft[key].apiKey} disabled={draft[key].clearKey} onChange={e => change(key, { apiKey: e.target.value })} placeholder={draft[key].hasApiKey ? 'Leave blank to keep saved key' : 'Enter an API key'} hint="Stored on the server. Saved keys are never shown or exported in a blueprint." />
        {draft[key].hasApiKey && <div className="check-options"><label><input type="checkbox" checked={draft[key].clearKey} onChange={e => change(key, { clearKey: e.target.checked, apiKey: '' })} />Remove saved {key} key</label></div>}
        {key === 'primary' && <div className="section-divider" />}
      </div>)}
      <p className="form-note">WhatsApp ordering is not connected. Saving these settings does not activate AI processing or send messages.</p>
      {saved && <p className="success-note" role="status"><CheckCircle2 size={16} className="inline" aria-hidden="true" /> Connections saved.</p>}
      {dirty && <p className="form-note">You have unsaved provider changes.</p>}
      <div className="form-actions"><Button variant="ghost" disabled={!dirty || busy} onClick={() => { if (stored) setDraft(toDraft(stored)); setError(null); setSaved(false); }}>Discard provider changes</Button><Button type="submit" disabled={!dirty} busy={busy}><Save size={17} aria-hidden="true" />Save provider connections</Button></div>
    </form>}
  </div>;
}
