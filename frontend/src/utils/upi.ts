/** Standard UPI payment intent; generating it does not confirm a bank transfer. */
export function upiPaymentLink({ upiId, payeeName, amount, reference }: { upiId: string; payeeName: string; amount: number; reference: string }): string {
  const address = upiId.trim();
  if (address.length > 255 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*@[a-zA-Z][a-zA-Z0-9.-]*$/.test(address)) throw new Error('Enter a valid merchant UPI ID in Billing settings.');
  if (!payeeName.trim()) throw new Error('Enter a UPI payee name in Billing settings.');
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) throw new Error('A UPI QR needs a positive amount with at most two decimal places.');
  const query = new URLSearchParams({ pa: address, pn: payeeName.trim().slice(0, 100), am: amount.toFixed(2), cu: 'INR', tn: reference.slice(0, 80) });
  return 'upi://pay?' + query.toString();
}
