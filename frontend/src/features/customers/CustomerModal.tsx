import { useState } from 'react';
import { Button, ErrorNotice, Input, Modal } from '../../components/ui';
import type { Customer, CustomerInput } from '../../types';
import { errorMessage } from '../../utils/formatters';
import { useBusiness } from '../settings/businessSettings';

export function CustomerModal({ customer, onClose, onSubmit }: { customer?: Customer; onClose: () => void; onSubmit: (data: CustomerInput) => Promise<unknown> }) {
  const { settings } = useBusiness();
  const [name, setName] = useState(customer?.name || '');
  const [phone, setPhone] = useState(customer?.phone || '');
  const [terms, setTerms] = useState(String(customer?.credit_terms_days ?? settings.billing.defaultCreditTermsDays));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(null);
    try {
      if (!name.trim()) throw new Error('Enter a customer name.');
      await onSubmit({ name: name.trim(), phone: phone.trim(), creditTermsDays: Number(terms) });
      onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <Modal isOpen title={customer ? 'Edit customer' : 'Add a customer'} onClose={onClose} busy={busy}>
    <form className="stack" onSubmit={save}>
      <ErrorNotice message={error} />
      <Input label="Customer name" autoFocus value={name} maxLength={255} required disabled={busy} onChange={e => setName(e.target.value)} placeholder="e.g. Green Leaf Café" />
      <Input label="Phone number" type="tel" value={phone} minLength={5} maxLength={25} required disabled={busy} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210" />
      <Input label="Payment terms (days)" type="number" min="0" max="365" step="1" value={terms} required disabled={busy} onChange={e => setTerms(e.target.value)} hint="Use 0 for payment due on the invoice date. New terms apply to new orders." />
      <div className="form-actions"><Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" busy={busy}>Save customer</Button></div>
    </form>
  </Modal>;
}
