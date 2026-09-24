/**
 * Console building blocks.
 *
 * These are thin: layout, loading and error states, and the small presentation
 * helpers that keep money, dates and statuses consistent across the eighteen
 * sections. No section is allowed to invent its own number formatting — money is
 * always rendered through `@parsbank/ui` so a figure can never be quietly re-based
 * by a screen.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Loading,
  Panel,
  PanelBody,
  Stat,
  formatDateTime,
  formatPrs,
  formatRelative,
  formatUsd,
  labelFa,
  statusTone,
  toPersianDigits,
  type Column,
} from '@parsbank/ui';

export function ConsolePage({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="prs-stack-6">
      <div className="prs-row prs-between prs-wrap">
        <div>
          <h1>{title}</h1>
          {description ? <p className="prs-small prs-muted">{description}</p> : null}
        </div>
        {actions ? <div className="prs-row-2 prs-wrap">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function ConsolePanel({
  title,
  subtitle,
  icon,
  actions,
  loading,
  error,
  empty,
  rowCount,
  children,
  tight,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: Parameters<typeof Panel>[0]['icon'];
  actions?: ReactNode;
  loading?: boolean;
  error?: string | null;
  empty?: ReactNode;
  rowCount?: number;
  children: ReactNode;
  tight?: boolean;
}) {
  return (
    <Panel title={title} subtitle={subtitle} icon={icon} actions={actions}>
      <PanelBody tight={tight}>
        {error ? <Alert tone="critical" title="خواندن این بخش ممکن نشد">{error}</Alert> : null}
        {loading ? <Loading /> : null}
        {!loading && !error && rowCount === 0 && empty ? <div className="prs-empty">{empty}</div> : null}
        {!loading && !error && (rowCount === undefined || rowCount > 0) ? children : null}
      </PanelBody>
    </Panel>
  );
}

export function MoneyCell({ minor, tone }: { minor: number | string | null | undefined; tone?: 'in' | 'out' }) {
  return (
    <span className="prs-num" style={{ whiteSpace: 'nowrap' }}>
      {formatPrs(minor, true)}
    </span>
  );
}

export function UsdCell({ minor }: { minor: number | string | null | undefined }) {
  return <span className="prs-num">{formatUsd(minor)} &#36;</span>;
}

export function DateCell({ value, relative = false }: { value: string | null | undefined; relative?: boolean }) {
  if (!value) return <span className="prs-muted">—</span>;
  return <span className="prs-small prs-muted">{relative ? formatRelative(value) : formatDateTime(value)}</span>;
}

export function StatusCell({ value }: { value: string | null | undefined }) {
  return <Badge tone={statusTone(value)}>{labelFa(value)}</Badge>;
}

export function CountCell({ value }: { value: number | string }) {
  return <span className="prs-num">{toPersianDigits(value)}</span>;
}

/** A stat row that never lets a raw minor unit leak into the label. */
export function StatRow({ children }: { children: ReactNode }) {
  return <section className="prs-grid prs-grid-4">{children}</section>;
}

export { Stat };

/** The standard "this is what the ledger says" hint under monetary figures. */
export function LedgerNote({ children }: { children: ReactNode }) {
  return (
    <Alert tone="info" title="این عدد از دفتر کل می‌آید">
      {children}
    </Alert>
  );
}

export function LinkButton({ to, children, variant = 'outline' }: { to: string; children: ReactNode; variant?: string }) {
  return (
    <Link className={`prs-btn prs-btn--sm prs-btn--${variant}`} to={to}>
      {children}
    </Link>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  return (
    <div className="prs-row prs-between prs-wrap" style={{ marginTop: 'var(--prs-space-4)' }}>
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        صفحهٔ پیشین
      </Button>
      <span className="prs-small prs-muted">
        صفحهٔ {toPersianDigits(page)} از {toPersianDigits(pages)} · {toPersianDigits(total)} ردیف
      </span>
      <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        صفحهٔ بعد
      </Button>
    </div>
  );
}

export function tableColumns<T>(columns: Array<Column<T>>): Array<Column<T>> {
  return columns;
}
