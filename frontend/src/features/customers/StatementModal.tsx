import { useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { ApiClient } from '../../api/client';
import { Badge, Button, ErrorNotice, Input, LoadingState, Modal } from '../../components/ui';
import { downloadCsv, errorMessage, formatDate } from '../../utils/formatters';
import { useBusiness } from '../settings/businessSettings';

export function StatementModal({ statementData, loading, loadError, onClose, onFilterChange }: { statementData: any; loading?: boolean; loadError?: string | null; onClose: () => void; onFilterChange: (startDate?: string, endDate?: string) => Promise<void> }) {
  const { money, business } = useBusiness();
  const [start, setStart] = useState(statementData?.period?.startDate || '');
  const [end, setEnd] = useState(statementData?.period?.endDate || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const apply = async (from = start, to = end) => {
    setError(null);
    if (from && to && from > to) { setError('The start date must be on or before the end date.'); return; }
    setBusy(true);
    try { await onFilterChange(from || undefined, to || undefined); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const download = async () => {
    setDownloading(true); setError(null);
    try { await ApiClient.downloadCustomerStatementPdf(statementData.customer.id, statementData.period, statementData.customer.name); }
    catch (e) { setError(errorMessage(e)); } finally { setDownloading(false); }
  };
  const entries = statementData?.entries || [];
  return <Modal isOpen title="Customer statement" wide onClose={onClose} busy={busy || downloading}>
    {loading ? <LoadingState label="Loading statement…" /> : <div className="stack"><ErrorNotice message={loadError || error} />
      {statementData && <>
        <div className="row between wrap"><div><h3>{statementData.customer.name}</h3><p className="small muted">{statementData.customer.phone} · {business?.name}</p></div><Badge>{statementData.customer.credit_terms_days} day payment terms</Badge></div>
        <form className="date-filter no-print" onSubmit={event => { event.preventDefault(); void apply(); }}><Input label="Statement from" type="date" value={start} max={end || undefined} onChange={e => setStart(e.target.value)} /><Input label="Statement to" type="date" value={end} min={start || undefined} onChange={e => setEnd(e.target.value)} /><Button type="submit" variant="secondary" busy={busy}>Apply</Button><Button variant="ghost" disabled={busy} onClick={() => { setStart(''); setEnd(''); void apply('', ''); }}>Clear</Button></form>
        <div className="report-totals"><div className="report-total tonal-lavender"><span>Billed in period</span><strong>{money(statementData.totalBilled)}</strong></div><div className="report-total tonal"><span>Paid in period</span><strong>{money(statementData.totalPaid)}</strong></div><div className="report-total tonal-peach"><span>Closing balance</span><strong>{money(statementData.closingBalance ?? statementData.currentOutstanding)}</strong></div></div>
        <div className="table-scroll"><table><thead><tr><th>Date / reference</th><th className="right">Billed</th><th className="right">Received</th><th className="right">Balance</th></tr></thead><tbody>
          <tr><td>Opening balance<small>Before this period</small></td><td /><td /><td className="right numeric">{money(statementData.openingBalance || 0)}</td></tr>
          {entries.map((entry: any, index: number) => <tr key={entry.reference_id || index}><td><strong>{entry.reference_no}</strong><small>{formatDate(entry.date)}</small></td><td className="right numeric">{entry.debit > 0 ? money(entry.debit) : '—'}</td><td className="right numeric">{entry.credit > 0 ? money(entry.credit) : '—'}</td><td className="right numeric">{money(entry.running_balance)}</td></tr>)}
          {!entries.length && <tr><td colSpan={4} className="muted">No transactions in this period.</td></tr>}
        </tbody></table></div>
        <p className="muted small">A negative closing balance means customer credit. Current outstanding: {money(statementData.currentOutstanding)}.</p>
        <div className="form-actions no-print"><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="outline" onClick={() => downloadCsv(['Date', 'Reference', 'Billed', 'Received', 'Balance'], entries.map((e: any) => [e.date, e.reference_no, e.debit, e.credit, e.running_balance]), 'customer-statement.csv')}><Download size={16} aria-hidden="true" />CSV</Button><Button busy={downloading} onClick={download}><Printer size={17} aria-hidden="true" />Download PDF</Button></div>
      </>}
    </div>}
  </Modal>;
}
