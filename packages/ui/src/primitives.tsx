/**
 * @parsbank/ui — component primitives.
 *
 * These components are presentational only. None of them knows what money is:
 * they receive already-formatted strings or a plain integer, and they never fetch.
 * Keeping the kit ignorant of the domain is what lets the public and the
 * administrative applications share it while enforcing different rules.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { formatPrs, normalizeDigits, toPersianDigits } from './format.ts';
import { Icon, type IconName } from './icons.tsx';

/* ------------------------------------------------------------------ button -- */

export type ButtonVariant = 'primary' | 'outline' | 'quiet' | 'danger' | 'neutral';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  icon?: IconName;
  iconAfter?: IconName;
  loading?: boolean;
}

export function Button({
  variant = 'neutral',
  size = 'md',
  block,
  icon,
  iconAfter,
  loading,
  children,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'prs-btn',
    variant !== 'neutral' ? `prs-btn--${variant}` : '',
    size !== 'md' ? `prs-btn--${size}` : '',
    block ? 'prs-btn--block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type={type}
      className={classes}
      disabled={disabled ?? loading}
      aria-busy={loading ? true : undefined}
      {...rest}
    >
      {loading ? <span className="prs-spinner" aria-hidden /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 18} /> : null}
      {children}
      {iconAfter && !loading ? <Icon name={iconAfter} size={size === 'sm' ? 15 : 18} /> : null}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  name: IconName;
  label: string;
  variant?: ButtonVariant;
}

export function IconButton({ name, label, variant = 'quiet', className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={['prs-btn', `prs-btn--${variant}`, 'prs-btn--sm', className ?? ''].join(' ')}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={name} size={16} />
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = 'quiet',
  icon,
  external,
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  icon?: IconName;
  external?: boolean;
}) {
  return (
    <a
      className={['prs-btn', variant !== 'neutral' ? `prs-btn--${variant}` : ''].filter(Boolean).join(' ')}
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer noopener' : undefined}
    >
      {icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </a>
  );
}

/* ------------------------------------------------------------------- panel -- */

export function Panel({
  title,
  subtitle,
  actions,
  children,
  footer,
  flush,
  icon,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  flush?: boolean;
  icon?: IconName;
}) {
  return (
    <section className={flush ? 'prs-panel prs-panel--flush' : 'prs-panel'}>
      {title || actions ? (
        <header className="prs-panel__head">
          {icon ? <Icon name={icon} size={18} className="prs-muted" /> : null}
          <div className="prs-grow">
            <div className="prs-panel__title">{title}</div>
            {subtitle ? <div className="prs-panel__sub">{subtitle}</div> : null}
          </div>
          {actions ? <div className="prs-row-2">{actions}</div> : null}
        </header>
      ) : null}
      {children}
      {footer ? <footer className="prs-panel__foot">{footer}</footer> : null}
    </section>
  );
}

export function PanelBody({ children, tight }: { children: ReactNode; tight?: boolean }) {
  return <div className={tight ? 'prs-panel__body prs-panel__body--tight' : 'prs-panel__body'}>{children}</div>;
}

/* -------------------------------------------------------------------- stat -- */

export function Stat({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'positive' | 'critical' | 'warning';
  icon?: IconName;
}) {
  const color =
    tone === 'positive'
      ? 'var(--prs-color-positive)'
      : tone === 'critical'
        ? 'var(--prs-color-critical)'
        : tone === 'warning'
          ? 'var(--prs-color-warning)'
          : undefined;
  return (
    <div className="prs-stat">
      <div className="prs-stat__label">
        {icon ? <Icon name={icon} size={15} /> : null}
        {label}
      </div>
      <div className="prs-stat__value" style={color ? { color } : undefined}>
        {value}
      </div>
      {hint ? <div className="prs-stat__hint">{hint}</div> : null}
    </div>
  );
}

export function KeyValue({ items }: { items: Array<{ label: ReactNode; value: ReactNode }> }) {
  return (
    <dl className="prs-kv">
      {items.map((item, index) => (
        <div key={index} style={{ display: 'contents' }}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------- badge -- */

export function Badge({
  children,
  tone = 'muted',
  dot,
}: {
  children: ReactNode;
  tone?: 'positive' | 'warning' | 'critical' | 'info' | 'muted' | 'outline';
  dot?: boolean;
}) {
  return (
    <span className={`prs-badge prs-badge--${tone}`}>
      {dot ? <span className="prs-dot" aria-hidden /> : null}
      {children}
    </span>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
  icon,
}: {
  tone?: 'info' | 'warning' | 'critical' | 'success';
  title?: ReactNode;
  children?: ReactNode;
  icon?: IconName;
}) {
  const fallback: IconName = tone === 'critical' ? 'alert' : tone === 'warning' ? 'alert' : tone === 'success' ? 'check' : 'shield';
  return (
    <div className={`prs-alert prs-alert--${tone}`} role={tone === 'critical' ? 'alert' : 'status'}>
      <Icon name={icon ?? fallback} size={18} />
      <div className="prs-grow">
        {title ? <div className="prs-alert__title">{title}</div> : null}
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ fields -- */

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  action?: ReactNode;
}

export function Field({ label, hint, error, children, htmlFor, action }: FieldProps) {
  return (
    <div className="prs-field">
      <div className="prs-row-2 prs-between">
        <label className="prs-label" htmlFor={htmlFor}>
          {label}
        </label>
        {action}
      </div>
      {children}
      {error ? <div className="prs-error">{error}</div> : hint ? <div className="prs-hint">{hint}</div> : null}
    </div>
  );
}

export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & { numeric?: boolean };

export function TextInput({ numeric, className, ...rest }: TextInputProps) {
  return <input className={['prs-input', numeric ? 'prs-input--numeric' : '', className ?? ''].filter(Boolean).join(' ')} dir={numeric ? 'ltr' : undefined} {...rest} />;
}

export function AmountInput({
  value,
  onValueChange,
  unit = 'پارسه',
  autoFocus,
  id,
  invalid,
}: {
  value: string;
  onValueChange: (next: string) => void;
  unit?: string;
  autoFocus?: boolean;
  id?: string;
  invalid?: boolean;
}) {
  return (
    <div className="prs-amount-input">
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
        value={value}
        autoFocus={autoFocus}
        aria-invalid={invalid ? 'true' : undefined}
        placeholder="0"
        onChange={(event) => onValueChange(normalizeDigits(event.target.value).replace(/[^\d]/g, '').slice(0, 9))}
      />
      <span className="prs-amount-input__unit">{unit}</span>
    </div>
  );
}

export function DenominationPicker({
  denominations,
  selected,
  onSelect,
}: {
  denominations: readonly number[];
  selected: number | null;
  onSelect: (denomination: number) => void;
}) {
  return (
    <div className="prs-denoms" role="group" aria-label="اسکناس‌های موجود">
      {denominations.map((denomination) => (
        <button
          key={denomination}
          type="button"
          aria-pressed={selected === denomination}
          onClick={() => onSelect(denomination)}
          className="prs-num"
        >
          {toPersianDigits(denomination)}
        </button>
      ))}
    </div>
  );
}

export function Select({
  children,
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select className={['prs-select', className ?? ''].filter(Boolean).join(' ')} {...rest}>
      {children}
    </select>
  );
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={['prs-textarea', className ?? ''].filter(Boolean).join(' ')} {...rest} />;
}

/** Six-box one-time / PIN entry. The value is never echoed into a log or a URL. */
export function CodeInput({
  length = 4,
  value,
  onValueChange,
  label,
  secret,
}: {
  length?: number;
  value: string;
  onValueChange: (next: string) => void;
  label: string;
  secret?: boolean;
}) {
  const digits = normalizeDigits(value).replace(/\D/g, '').slice(0, length).split('');
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  const setDigit = (index: number, digit: string) => {
    const next = [...digits];
    next[index] = digit;
    onValueChange(next.join('').slice(0, length));
    if (digit && index + 1 < length) refs.current[index + 1]?.focus();
  };

  return (
    <div className="prs-code-input" role="group" aria-label={label}>
      {Array.from({ length }).map((_, index) => (
        <input
          key={index}
          ref={(node) => {
            refs.current[index] = node;
          }}
          type={secret ? 'password' : 'text'}
          inputMode="numeric"
          autoComplete="off"
          aria-label={`${label} — رقم ${toPersianDigits(index + 1)}`}
          value={digits[index] ?? ''}
          maxLength={1}
          onChange={(event) => setDigit(index, normalizeDigits(event.target.value).replace(/\D/g, '').slice(-1))}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !digits[index] && index > 0) refs.current[index - 1]?.focus();
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ tables -- */

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  numeric?: boolean;
  width?: string;
}

export function DataTable<T>({
  columns,
  rows,
  empty,
  caption,
  compact,
  rowKey,
  onRowClick,
}: {
  columns: Array<Column<T>>;
  rows: T[];
  empty?: ReactNode;
  caption?: ReactNode;
  compact?: boolean;
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
}) {
  if (rows.length === 0) return <>{empty ?? <EmptyState title="موردی ثبت نشده است" />}</>;
  return (
    <div className="prs-table-wrap">
      <table className={compact ? 'prs-table prs-table--compact' : 'prs-table'}>
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" style={column.width ? { width: column.width } : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKey(row, index)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={onRowClick ? { cursor: 'pointer' } : undefined}
            >
              {columns.map((column) => (
                <td key={column.key} className={column.numeric ? 'prs-table__num' : undefined}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------- modal -- */

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="prs-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={wide ? 'prs-modal prs-modal--wide' : 'prs-modal'} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <header className="prs-modal__head">
          <div className="prs-grow prs-panel__title">{title}</div>
          <IconButton name="close" label="بستن" onClick={onClose} />
        </header>
        <div className="prs-modal__body">{children}</div>
        {footer ? <footer className="prs-modal__foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ states -- */

export function EmptyState({ title, description, icon, action }: { title: ReactNode; description?: ReactNode; icon?: IconName; action?: ReactNode }) {
  return (
    <div className="prs-empty">
      {icon ? (
        <div className="prs-empty__icon">
          <Icon name={icon} size={26} />
        </div>
      ) : null}
      <div style={{ fontWeight: 600, color: 'var(--prs-color-neutral-800)' }}>{title}</div>
      {description ? <div className="prs-small">{description}</div> : null}
      {action}
    </div>
  );
}

export function Skeleton({ height = 14, width = '100%', radius }: { height?: number; width?: number | string; radius?: number }) {
  return <div className="prs-skeleton" style={{ height, width, borderRadius: radius }} aria-hidden />;
}

export function Loading({ label = 'در حال دریافت داده‌ها…' }: { label?: string }) {
  return (
    <div className="prs-row" style={{ padding: 'var(--prs-space-6)', justifyContent: 'center', color: 'var(--prs-color-text-muted)' }}>
      <span className="prs-spinner" aria-hidden />
      <span className="prs-small">{label}</span>
    </div>
  );
}

export function Progress({ value, max, reserve }: { value: number; max: number; reserve?: boolean }) {
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={reserve ? 'prs-progress prs-progress--reserve' : 'prs-progress'} role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
      <div className="prs-progress__bar" style={{ width: `${percent}%` }} />
    </div>
  );
}

export function Timeline({ items }: { items: Array<{ title: ReactNode; meta?: ReactNode; body?: ReactNode }> }) {
  return (
    <ul className="prs-timeline">
      {items.map((item, index) => (
        <li key={index}>
          <span className="prs-timeline__marker" aria-hidden />
          <div>
            <div className="prs-timeline__title">{item.title}</div>
            {item.meta ? <div className="prs-timeline__meta">{item.meta}</div> : null}
            {item.body ? <div className="prs-small" style={{ marginTop: 4 }}>{item.body}</div> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------- tabs -- */

export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ id: string; label: ReactNode }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="prs-tabs" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.id} role="tab" type="button" aria-selected={value === tab.id} onClick={() => onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  return (
    <div className="prs-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.id} type="button" aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ toasts -- */

export interface Toast {
  id: number;
  tone: 'info' | 'success' | 'error';
  message: ReactNode;
}

interface ToastContextValue {
  push: (tone: Toast['tone'], message: ReactNode) => void;
}

const ToastContext = createContext<ToastContextValue>({ push: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const push = useCallback((tone: Toast['tone'], message: ReactNode) => {
    counter.current += 1;
    const id = counter.current;
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 6000);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="prs-toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`prs-toast${toast.tone === 'error' ? ' prs-toast--error' : toast.tone === 'success' ? ' prs-toast--success' : ''}`}
          >
            <Icon name={toast.tone === 'error' ? 'alert' : toast.tone === 'success' ? 'check' : 'shield'} size={16} />
            <span className="prs-grow">{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

/* -------------------------------------------------------------------- misc -- */

export function CopyButton({ value, label = 'رونوشت' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const { push } = useToast();
  return (
    <Button
      size="sm"
      variant="outline"
      icon="copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          push('success', 'رونوشت شد.');
          window.setTimeout(() => setCopied(false), 2500);
        } catch {
          push('error', 'رونوشت‌برداری در این مرورگر ممکن نشد.');
        }
      }}
    >
      {copied ? 'رونوشت شد' : label}
    </Button>
  );
}

export function MoneyText({
  minor,
  withUnit,
  size,
  tone,
}: {
  minor: number | string | null | undefined;
  withUnit?: boolean;
  size?: 'inline' | 'lg' | 'xl';
  tone?: 'in' | 'out';
}) {
  const style: CSSProperties | undefined =
    size === 'xl'
      ? { fontSize: 'var(--prs-font-size-2xl)', fontWeight: 600 }
      : size === 'lg'
        ? { fontSize: 'var(--prs-font-size-lg)', fontWeight: 600 }
        : undefined;
  const color = tone === 'in' ? 'var(--prs-color-positive)' : tone === 'out' ? 'var(--prs-color-neutral-800)' : undefined;
  return (
    <span className="prs-num" style={{ ...style, color }}>
      {formatPrs(minor, withUnit)}
    </span>
  );
}

export function SectionHeading({
  title,
  description,
  actions,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="prs-row prs-between prs-wrap">
      <div className="prs-row-2">
        {icon ? (
          <span className="prs-empty__icon" style={{ width: 38, height: 38 }}>
            <Icon name={icon} size={20} />
          </span>
        ) : null}
        <div>
          <h1 style={{ fontSize: 'var(--prs-font-size-xl)' }}>{title}</h1>
          {description ? <div className="prs-small prs-muted">{description}</div> : null}
        </div>
      </div>
      {actions ? <div className="prs-row-2 prs-wrap">{actions}</div> : null}
    </div>
  );
}

/** A labelled secret the operator may reveal once — never auto-revealed. */
export function RevealSecret({ value, label, hint }: { value: string; label: string; hint?: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  const id = useId();
  return (
    <div className="prs-field">
      <div className="prs-label">{label}</div>
      <div className="prs-row-2">
        <code id={id} className="prs-input prs-num" style={{ display: 'flex', alignItems: 'center', letterSpacing: revealed ? '0.06em' : '0.2em' }}>
          {revealed ? value : '••••••••••••'}
        </code>
        <IconButton name={revealed ? 'ban' : 'eye'} label={revealed ? 'پنهان کردن' : 'نمایش'} onClick={() => setRevealed((current) => !current)} />
        <CopyButton value={value} />
      </div>
      {hint ? <div className="prs-hint">{hint}</div> : null}
    </div>
  );
}

/** Deterministic progress-free countdown text for a live session window. */
export function useTicker(intervalMs = 1000): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return tick;
}
