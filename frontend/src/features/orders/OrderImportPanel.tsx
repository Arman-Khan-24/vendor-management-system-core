import { useEffect, useState } from 'react';
import { FileImage, Sparkles } from 'lucide-react';
import { ApiClient } from '../../api/client';
import { Button, ErrorNotice, Input, Textarea } from '../../components/ui';
import type { OrderImportResult } from '../../types';
import { errorMessage } from '../../utils/formatters';
import { readOrderPhoto } from '../../utils/orderPhoto';

export function OrderImportPanel({ disabled, onExtracted, onBusyChange }: { disabled: boolean; onExtracted: (result: OrderImportResult) => void; onBusyChange: (busy: boolean) => void }) {
  const [text, setText] = useState('');
  const [image, setImage] = useState<Awaited<ReturnType<typeof readOrderPhoto>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { onBusyChange(busy || reading); return () => onBusyChange(false); }, [busy, reading, onBusyChange]);
  const photo = async (file?: File) => {
    setImage(null); setError(null);
    if (!file) return;
    setReading(true);
    try { setImage(await readOrderPhoto(file)); } catch (e) { setError(errorMessage(e)); } finally { setReading(false); }
  };
  const extract = async () => {
    if (disabled || busy || reading) return;
    setBusy(true); setError(null);
    try {
      if (!text.trim() && !image) throw new Error('Paste an order or upload a photo first.');
      onExtracted(await ApiClient.extractOrder({ text: text.trim(), ...(image ? { image: { data: image.data, mimeType: image.mimeType } } : {}) }));
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <section className="order-import stack" aria-label="Import order items">
    <div><h3>Start with a message or photo</h3><p className="small muted">Paste the customer’s list or upload an order photo. Uses your saved Gemini or Groq connection.</p></div>
    <Textarea label="Order text or photo caption" value={text} rows={3} maxLength={10000} disabled={disabled || busy || reading} placeholder="Tomato 2 kg, Onion 1 kg…" onChange={e => { setText(e.target.value); setError(null); }} />
    <Input label="Upload order photo" type="file" accept="image/jpeg,image/png" disabled={disabled || busy || reading} hint="JPEG or PNG, up to 3 MB. For photos, choose an image-capable model in Settings → Connections." onChange={e => { void photo(e.target.files?.[0]); e.target.value = ''; }} />
    {image && <div className="row between wrap small"><span><FileImage size={16} aria-hidden="true" /> {image.name}</span><Button variant="ghost" size="sm" disabled={busy} onClick={() => setImage(null)}>Remove photo</Button></div>}
    <ErrorNotice message={error} focus />
    {busy && <p className="form-note" role="status">Reading the order… This can take up to a minute. Your draft stays here.</p>}
    <div className="row wrap"><Button variant="secondary" busy={busy} disabled={disabled || reading} onClick={() => void extract()}><Sparkles size={17} aria-hidden="true" />Extract items</Button><span className="small muted">Replaces the current item list. Review before creating the order.</span></div>
  </section>;
}
