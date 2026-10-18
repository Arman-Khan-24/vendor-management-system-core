import { useEffect, useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, LoaderCircle, Search, X } from 'lucide-react';

export function Card({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return onClick
    ? <button type="button" onClick={onClick} className={'card card-button ' + className}>{children}</button>
    : <div className={'card ' + className}>{children}</div>;
}
export function Button({ children, variant = 'primary', size = 'md', className = '', busy, disabled, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'; busy?: boolean }) {
  return <button {...props} type={type} disabled={disabled || busy} aria-busy={busy || undefined} className={'btn btn-' + variant + ' btn-' + size + ' ' + className}>
    {busy && <LoaderCircle aria-hidden="true" size={18} className="spin" />}{children}
  </button>;
}
export function Badge({ children, variant = 'default', className = '' }: { children: ReactNode; variant?: 'default' | 'success' | 'warning' | 'info' | 'danger'; className?: string }) {
  return <span className={'badge badge-' + variant + ' ' + className}>{children}</span>;
}
export function Input({ label, error, hint, id, className = '', ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string; hint?: string }) {
  const generated = useId();
  const inputId = id || generated;
  return <div className="field">
    {label && <label htmlFor={inputId}>{label}</label>}
    <input {...props} id={inputId} aria-invalid={!!error || undefined} aria-describedby={error || hint ? inputId + '-hint' : undefined} className={'input ' + className} />
    {(error || hint) && <p id={inputId + '-hint'} className={error ? 'field-error' : 'field-hint'}>{error || hint}</p>}
  </div>;
}
export function Select({ label, hint, id, className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; hint?: string }) {
  const generated = useId();
  const inputId = id || generated;
  return <div className="field">
    {label && <label htmlFor={inputId}>{label}</label>}
    <select {...props} id={inputId} className={'input ' + className} aria-describedby={hint ? inputId + '-hint' : undefined}>{children}</select>
    {hint && <p id={inputId + '-hint'} className="field-hint">{hint}</p>}
  </div>;
}
export function Textarea({ label, id, className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  const generated = useId();
  return <div className="field"><label htmlFor={id || generated}>{label}</label><textarea {...props} id={id || generated} className={'input ' + className} /></div>;
}
export function SearchBox({ value, onChange, placeholder = 'Search…', label = 'Search' }: { value: string; onChange: (value: string) => void; placeholder?: string; label?: string }) {
  return <div className="search-box"><Search size={19} aria-hidden="true" /><input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)} /></div>;
}
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <div className="page-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</div>;
}
export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state">{icon && <div className="empty-icon">{icon}</div>}<h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function ErrorNotice({ message, retry }: { message: string | null; retry?: () => void }) {
  if (!message) return null;
  return <div className="error-notice" role="alert"><AlertCircle size={20} aria-hidden="true" /><p>{message}</p>{retry && <Button variant="outline" size="sm" onClick={retry}>Try again</Button>}</div>;
}
export function LoadingState({ label = 'Loading your workspace…' }: { label?: string }) {
  return <div className="loading-state" role="status"><LoaderCircle className="spin" size={28} aria-hidden="true" /><p>{label}</p></div>;
}
export function Modal({ isOpen, onClose, title, children, wide = false, busy = false, className = '' }: { isOpen: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; busy?: boolean; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!isOpen || !dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [isOpen]);
  return <dialog ref={ref} aria-labelledby={titleId} className={'modal ' + (wide ? 'modal-wide ' : '') + className} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-header"><h2 id={titleId}>{title}</h2><Button aria-label="Close dialog" variant="ghost" className="icon-button" disabled={busy} onClick={onClose}><X size={20} /></Button></div>
    {isOpen && <div className="modal-body">{children}</div>}
  </dialog>;
}
export function Switch({ checked, onChange, label, description, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  const id = useId();
  return <div className="switch-row"><div><label htmlFor={id}>{label}</label>{description && <p>{description}</p>}</div>
    <button type="button" id={id} role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={'switch ' + (checked ? 'on' : '')} onClick={() => onChange(!checked)}><span /></button>
  </div>;
}
export function SectionHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="section-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}
export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button className="text-link" type="button" onClick={onClick}>{children}<ChevronRight size={16} aria-hidden="true" /></button>;
}

export function usePagination<T>(items: readonly T[], filterKey: string, pageSize = 24) {
  const [selection, setSelection] = useState({ key: filterKey, page: 1 });
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = selection.key === filterKey ? Math.min(selection.page, pageCount) : 1;
  if (selection.key !== filterKey || selection.page !== page) setSelection({ key: filterKey, page });
  return {
    page, pageCount, total: items.length, pageSize,
    items: items.slice((page - 1) * pageSize, page * pageSize),
    onPageChange: (next: number) => setSelection({ key: filterKey, page: Math.max(1, Math.min(next, pageCount)) }),
  };
}

export function Pagination({ page, pageCount, total, pageSize, onPageChange }: { page: number; pageCount: number; total: number; pageSize: number; onPageChange: (page: number) => void }) {
  if (pageCount <= 1) return null;
  return <nav className="pagination" aria-label="Record pages">
    <p className="muted small" role="status">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</p>
    <div className="row"><Button variant="outline" size="sm" disabled={page === 1} onClick={() => onPageChange(page - 1)}><ChevronLeft size={16} aria-hidden="true" />Previous</Button><span className="small">{page} / {pageCount}</span><Button variant="outline" size="sm" disabled={page === pageCount} onClick={() => onPageChange(page + 1)}>Next<ChevronRight size={16} aria-hidden="true" /></Button></div>
  </nav>;
}
