const currencyFormatters = new Map<string, Intl.NumberFormat>();
export function formatCurrency(amount: number, currency = 'INR'): string {
  let formatter = currencyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    currencyFormatters.set(currency, formatter);
  }
  return formatter.format(Number.isFinite(amount) ? amount : 0);
}
export function localDate(date = new Date()): string {
  return String(date.getFullYear()) + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}
export function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr.length === 10 ? dateStr + 'T12:00:00' : dateStr);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
}
export function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return '—';
  if (dateStr.length === 10) return formatDate(dateStr);
  return new Date(dateStr).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return '';
  const diff = Math.max(0, Date.now() - new Date(dateStr).getTime());
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
  return Math.floor(diff / 86_400_000) + 'd ago';
}
export function invoiceNumber(invoice: { invoice_no: number; invoice_prefix?: string }, prefix = 'INV') {
  return (invoice.invoice_prefix || prefix) + '-' + String(invoice.invoice_no).padStart(4, '0');
}
export function downloadFile(content: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function downloadCsv(headers: string[], rows: unknown[][], filename: string) {
  const cell = (value: unknown) => {
    const raw = String(value ?? '');
    const safe = /^[=+@\-\t\r]/.test(raw) ? "'" + raw : raw;
    return '"' + safe.replace(/"/g, '""') + '"';
  };
  downloadFile('\uFEFF' + [headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n'), filename, 'text/csv;charset=utf-8');
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
