// Topic 43/44: small reusable, configurable components. Everything is driven by props; inputs are fully controlled.
import { useEffect, useId, useRef } from 'react';
import { Loader2, X, Inbox, AlertTriangle, Info, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { clsx } from '../../utils/format.js';
import { useEscape } from '../../hooks/index.js';

export function Button({ variant = 'primary', size, block, loading, icon: Icon, children, className, ...rest }) {
  return (
    <button className={clsx('btn', variant !== 'primary' && `btn-${variant}`, size === 'sm' && 'btn-sm', block && 'btn-block', className)} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Loader2 size={16} className="spin" aria-hidden="true" /> : Icon ? <Icon size={16} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Panel({ title, subtitle, actions, flat, children, className }) {
  return (
    <section className={clsx('panel', flat && 'panel-flat', className)}>
      {(title || actions) && (
        <div className="panel-head" style={flat ? { padding: '18px 20px 0', marginBottom: 12 } : undefined}>
          <div>{title && <h2>{title}</h2>}{subtitle && <p>{subtitle}</p>}</div>
          {actions && <div className="row row-wrap">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="page-head">
      <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      {actions && <div className="row row-wrap no-print">{actions}</div>}
    </header>
  );
}

/** Label + control + error wiring in one place (accessible: label, aria-invalid, aria-describedby). */
export function Field({ label, error, hint, children, className }) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={clsx('field', className)}>
      {label && <label htmlFor={id}>{label}</label>}
      {children({ id, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': describedBy })}
      {error ? <span id={`${id}-err`} className="field-error" role="alert">{error}</span> : hint ? <span id={`${id}-hint`} className="field-hint">{hint}</span> : null}
    </div>
  );
}
export const TextField = ({ label, error, hint, className, ...input }) => <Field label={label} error={error} hint={hint} className={className}>{(p) => <input className="input" {...p} {...input} />}</Field>;
export const SelectField = ({ label, error, hint, className, options, placeholder, ...select }) => (
  <Field label={label} error={error} hint={hint} className={className}>
    {(p) => (
      <select className="select" {...p} {...select}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )}
  </Field>
);
export const TextArea = ({ label, error, hint, className, ...ta }) => <Field label={label} error={error} hint={hint} className={className}>{(p) => <textarea className="textarea" rows={3} {...p} {...ta} />}</Field>;

export function Skeleton({ h = 16, w = '100%', style }) { return <div className="skeleton" style={{ height: h, width: w, ...style }} aria-hidden="true" />; }
export function PanelSkeleton({ rows = 4, title = true }) {
  return <div className="panel" aria-busy="true" aria-label="Loading"><div className="stack-sm">{title && <Skeleton h={20} w="40%" />}{Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={16} w={`${95 - i * 9}%`} />)}</div></div>;
}

export function EmptyState({ icon: Icon = Inbox, title, children, action }) {
  return <div className="empty"><div className="empty-icon"><Icon size={22} aria-hidden="true" /></div><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}

export function Banner({ tone = 'info', icon, children, action }) {
  const Icon = icon ?? { warn: AlertTriangle, neg: AlertTriangle, pos: CheckCircle2, gold: Info, info: Info }[tone];
  return <div className={clsx('banner', tone !== 'info' && `banner-${tone}`)} role={tone === 'neg' ? 'alert' : 'note'}><Icon size={18} aria-hidden="true" /><div className="grow">{children}</div>{action}</div>;
}
export const ErrorState = ({ error, onRetry }) => (
  <Banner tone="neg" action={onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}>{error?.message || 'Something went wrong.'}</Banner>
);

export const Chip = ({ tone, children, ...rest }) => <span className={clsx('chip', tone && `chip-${tone}`)} {...rest}>{children}</span>;
export const ColorDot = ({ color }) => <span className="dot" style={{ background: color || 'var(--ink-3)' }} aria-hidden="true" />;

export function ProgressBar({ percent, status = 'ok', label }) {
  const p = Math.max(0, Math.min(100, percent));
  return <div className={clsx('progress', status)} role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100} aria-label={label}><span style={{ width: `${p}%` }} /></div>;
}

export function Stat({ label, value, sub, tone }) {
  return <div className="stat"><span className="stat-label">{label}</span><span className={clsx('stat-value', tone)}>{value}</span>{sub && <span className="stat-sub">{sub}</span>}</div>;
}

export function Tabs({ tabs, value, onChange, label = 'Sections' }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}>{t.label}</button>)}
    </div>
  );
}
export function Segmented({ options, value, onChange, label }) {
  return <div className="seg" role="group" aria-label={label}>{options.map((o) => <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>;
}

export function Modal({ title, onClose, children, footer, wide }) {
  const ref = useRef(null);
  useEscape(onClose);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('input, select, textarea, button:not(.icon-btn)')?.focus();
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; prev?.focus?.(); };
  }, []);
  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={clsx('modal', wide && 'modal-wide')} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Topic 46: confirmation before anything destructive. */
export function ConfirmDialog({ title, message, confirmLabel = 'Delete', onConfirm, onCancel, busy, children }) {
  return (
    <Modal title={title} onClose={onCancel} footer={<><Button variant="secondary" onClick={onCancel}>Cancel</Button><Button variant="danger" loading={busy} onClick={onConfirm}>{confirmLabel}</Button></>}>
      <p className="muted">{message}</p>{children}
    </Modal>
  );
}

export function Pager({ page, pages, onPage, label }) {
  return (
    <nav className="pager" aria-label="Pagination">
      <span className="muted small">{label}</span>
      <div className="row">
        <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</Button>
        <span className="small">Page {page} of {pages}</span>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next <ChevronRight size={16} aria-hidden="true" /></Button>
      </div>
    </nav>
  );
}

/** Month selector: previous / next arrows + native month input (controlled). */
export function PeriodSwitcher({ value, onChange, max }) {
  const shift = (n) => { const [y, m] = value.split('-').map(Number); const i = y * 12 + (m - 1) + n; onChange(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`); };
  return (
    <div className="row no-print" role="group" aria-label="Choose month">
      <button className="icon-btn" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft size={18} /></button>
      <input className="input" type="month" aria-label="Month" value={value} max={max} onChange={(e) => e.target.value && onChange(e.target.value)} style={{ width: 170 }} />
      <button className="icon-btn" aria-label="Next month" onClick={() => shift(1)} disabled={max && value >= max}><ChevronRight size={18} /></button>
    </div>
  );
}