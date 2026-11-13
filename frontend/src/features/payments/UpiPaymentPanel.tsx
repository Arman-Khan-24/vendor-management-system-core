import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Badge, ErrorNotice } from '../../components/ui';
import { useBusiness } from '../settings/businessSettings';
import { upiPaymentLink } from '../../utils/upi';

export function UpiPaymentPanel({ amount, reference, customerName, upiId, payeeName }: { amount: number; reference: string; customerName?: string; upiId?: string; payeeName?: string }) {
  const { settings, business, money } = useBusiness();
  const address = (upiId ?? settings.billing.upiId).trim();
  const demo = !address;
  const name = (payeeName ?? settings.billing.upiPayeeName).trim() || business?.name || 'OrderLedger';
  let uri = '', invalid: string | null = null;
  if (amount > 0 && (!business || business.currency === 'INR')) {
    try { uri = upiPaymentLink({ upiId: address || 'demo@orderledger', payeeName: demo ? 'OrderLedger Demo' : name, amount, reference: reference + (customerName ? ' · ' + customerName : '') }); }
    catch (error) { invalid = error instanceof Error ? error.message : 'Cannot create this QR.'; }
  }
  const [generated, setGenerated] = useState<{ uri: string; image: string; error: string | null }>({ uri: '', image: '', error: null });
  useEffect(() => {
    let active = true;
    if (uri) void QRCode.toDataURL(uri, { width: 256, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
      .then(image => { if (active) setGenerated({ uri, image, error: null }); })
      .catch(() => { if (active) setGenerated({ uri, image: '', error: 'QR generation failed. Reopen this invoice to try again.' }); });
    return () => { active = false; };
  }, [uri]);
  if (amount <= 0 || (business && business.currency !== 'INR')) return null;
  const image = generated.uri === uri ? generated.image : '';
  return <section className={'upi-payment ' + (demo ? 'upi-demo' : '')} aria-label="UPI payment QR">
    <div className="upi-payment-copy stack">
      <div className="row wrap"><h3>{demo ? 'Demo payment QR' : 'Scan to pay with UPI'}</h3>{demo && <Badge>Preview only</Badge>}</div>
      <strong className="numeric upi-amount">{money(amount)}</strong>
      <p className="small">{reference}{customerName ? ' · ' + customerName : ''}</p>
      <p className="small">{demo ? 'Demo UPI ID — cannot receive payments. Add your real UPI ID in Settings → Billing & payments before collecting money.' : name + ' · ' + address}</p>
      <p className="small muted">{demo ? 'This preview shows how an amount-specific QR will look.' : 'Scan with GPay, PhonePe or another UPI app. Pay the amount shown to this UPI account.'}</p>
      <p className="small muted no-print">The amount is prefilled; your UPI app may allow edits. Confirm receipt in your bank or UPI app, then record the payment here.</p>
      {image && <div className="row wrap no-print"><a className="btn btn-outline btn-sm" href={image} download={(demo ? 'demo-' : '') + 'upi-' + reference.replace(/[^a-z0-9-]/gi, '-') + '-' + amount.toFixed(2) + '.png'}>{demo ? 'Download demo QR' : 'Download payment QR'}</a>{!demo && <a className="btn btn-secondary btn-sm" href={uri}>Open UPI app</a>}</div>}
      <ErrorNotice message={invalid || (generated.uri === uri ? generated.error : null)} />
    </div>
    {image ? <img className="upi-qr" src={image} width="256" height="256" alt={(demo ? 'Demo ' : '') + 'UPI QR for ' + money(amount) + ', ' + reference} /> : !invalid && <div className="upi-qr-loading" role="status">Creating QR…</div>}
  </section>;
}
