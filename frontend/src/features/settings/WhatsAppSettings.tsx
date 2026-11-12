import { useEffect,useState } from 'react';
import { CheckCircle2,Link2,Save } from 'lucide-react';
import { ApiClient } from '../../api/client';
import { Badge,Button,ErrorNotice,Input,LoadingState,SectionHeading,Switch } from '../../components/ui';
import type { WhatsAppConnection,WhatsAppConnectionPatch } from '../../types';
import { errorMessage } from '../../utils/formatters';

type Draft = WhatsAppConnection & { accessToken: string; appSecret: string; verifyToken: string; clearAccessToken: boolean; clearAppSecret: boolean; clearVerifyToken: boolean };
const toDraft = (value: WhatsAppConnection): Draft => ({ ...value,accessToken:'',appSecret:'',verifyToken:'',clearAccessToken:false,clearAppSecret:false,clearVerifyToken:false });
export function WhatsAppSettings({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const [stored,setStored] = useState<WhatsAppConnection | null>(null);
  const [draft,setDraft] = useState<Draft | null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const [notice,setNotice] = useState<string | null>(null);
  const dirty = !!stored && !!draft && JSON.stringify(draft)!==JSON.stringify(toDraft(stored));
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); },[dirty,onDirtyChange]);
  const load = async () => {
    try { const value=await ApiClient.getWhatsAppConnection(); setStored(value); setDraft(toDraft(value)); setError(null); }
    catch(e) { setError(errorMessage(e)); }
  };
  useEffect(() => { void load(); },[]);
  const update = (fields: Partial<Draft>) => { setDraft(value => value ? { ...value,...fields } : null); setNotice(null); setError(null); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!draft || !stored) return;
    setBusy(true);setError(null);setNotice(null);
    const patch: WhatsAppConnectionPatch = {};
    for (const key of ['enabled','phoneNumberId','wabaId','graphVersion','defaultCountryCode'] as const) {
      if (draft[key]!==stored[key]) Object.assign(patch,{ [key]: draft[key] });
    }
    for (const [key,clear] of [['accessToken','clearAccessToken'],['appSecret','clearAppSecret'],['verifyToken','clearVerifyToken']] as const) {
      if (draft[clear]) patch[key]=''; else if (draft[key].trim()) patch[key]=draft[key].trim();
    }
    try { const value=await ApiClient.updateWhatsAppConnection(patch); setStored(value);setDraft(toDraft(value));setNotice('WhatsApp connection saved.'); }
    catch(e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true);setError(null);setNotice(null);
    try { const result=await ApiClient.testWhatsAppConnection();setNotice('Meta connection verified: '+result.displayPhoneNumber); }
    catch(e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  if(draft?.phoneNumberId==='local-demo')return <div className="stack"><SectionHeading title="Local order testing" description="This temporary business captures replies inside the app." action={<Badge variant="info">Local test</Badge>}/><p>Use the test form in the WhatsApp inbox. Meta credentials are not needed for this local session. Your AI provider keys are available above. To test real WhatsApp, stop this demo and use the standard server with a separate business and your Meta credentials.</p></div>;
  return <div className="stack">
    <SectionHeading title="WhatsApp ordering" description="Connect your Meta test number, then enable ordering when the webhook is ready." action={<Badge variant={stored?.enabled ? 'success':'default'}>{stored?.enabled ? 'Enabled':'Disabled'}</Badge>} />
    <ErrorNotice message={error} focus retry={!draft ? load : undefined} />
    {!draft ? !error && <LoadingState label="Loading WhatsApp connection…" /> : <form onSubmit={save}><fieldset className="stack settings-fields" disabled={busy}>
      <ol className="help-steps"><li>Create a Meta developer app with WhatsApp access.</li><li>Add your own phone as a verified test recipient.</li><li>Save the IDs, API version and credentials below.</li><li>Configure the webhook URL and subscribe to messages in Meta.</li><li>Save and test Gemini/Groq above, then enable ordering.</li></ol>
      <p><a className="text-link" href="https://whatsappbusiness.com/developers/developer-hub/" target="_blank" rel="noreferrer">Open Meta’s developer setup</a></p>
      <div className="form-grid">
        <Input label="Phone Number ID" value={draft.phoneNumberId} inputMode="numeric" maxLength={50} onChange={e=>update({phoneNumberId:e.target.value.trim()})} hint="Use the ID from API Setup, not the phone number." />
        <Input label="WhatsApp Business Account ID" value={draft.wabaId} inputMode="numeric" maxLength={50} onChange={e=>update({wabaId:e.target.value.trim()})} />
        <Input label="Graph API version" value={draft.graphVersion} maxLength={20} placeholder="Version shown in Meta API Setup" onChange={e=>update({graphVersion:e.target.value.trim()})} />
        <Input label="Default country code" value={draft.defaultCountryCode} inputMode="numeric" maxLength={4} onChange={e=>update({defaultCountryCode:e.target.value.trim()})} hint="91 for Indian customer numbers entered without a country code." />
      </div>
      {([['accessToken','hasAccessToken','clearAccessToken','Meta access token'],['appSecret','hasAppSecret','clearAppSecret','Meta app secret'],['verifyToken','hasVerifyToken','clearVerifyToken','Webhook verify token']] as const).map(([key,has,clear,label])=><div className="stack" key={key}>
        <Input label={label} type="password" autoComplete="new-password" value={draft[key]} disabled={draft[clear]} maxLength={4096} onChange={e=>update({[key]:e.target.value})} placeholder={draft[has]?'Leave blank to keep saved value':'Enter '+label.toLowerCase()} hint={draft[has]?'Encrypted value saved.':'Saved values remain private on your server.'} />
        {draft[has] && <label className="check-options"><input type="checkbox" checked={draft[clear]} onChange={e=>update({[clear]:e.target.checked,[key]:''})} />Remove saved {label.toLowerCase()}</label>}
      </div>)}
      <div className="form-note"><strong>Webhook URL</strong><p className="whatsapp-webhook-url">{ApiClient.getServerAddress() || window.location.origin}/webhooks/whatsapp/{draft.businessId}</p><p>Meta requires a public HTTPS URL. Use the same verify token in Meta and here.</p></div>
      <Switch label="Enable WhatsApp ordering" description="Verified customer messages can create orders after customer confirmation." checked={draft.enabled} onChange={enabled=>update({enabled})} />
      {notice && <p className="success-note" role="status"><CheckCircle2 size={16} className="inline" aria-hidden="true" /> {notice}</p>}
      <div className="form-actions"><Button variant="outline" onClick={test} disabled={dirty||busy}><Link2 size={17} aria-hidden="true" />Test saved Meta connection</Button><Button type="submit" disabled={!dirty} busy={busy}><Save size={17} aria-hidden="true" />Save WhatsApp connection</Button></div>
      {dirty && <p className="form-note">Save your changes before testing the connection.</p>}
    </fieldset></form>}
  </div>;
}
