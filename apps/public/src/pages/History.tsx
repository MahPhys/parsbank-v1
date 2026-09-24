/**
 * History — the account's own ledger feed.
 *
 * Filtering happens on the server (`transactionQuerySchema`); this page only chooses
 * the filter values. Pagination is explicit, and the export button produces a CSV
 * from the rows that are already on screen — no hidden totals are computed here.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Field,
  Loading,
  MoneyText,
  Panel,
  PanelBody,
  Segmented,
  Select,
  TextInput,
  formatDateTime,
  formatPrs,
  formatRelative,
  labelFa,
  statusTone,
  toPersianDigits,
  transactionTypeFa,
} from '@parsbank/ui';
import type { TransactionDto } from '@parsbank/types';
import { api } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';

interface Page {
  items: TransactionDto[];
  page: number;
  pageSize: number;
  total: number;
}

const TYPES = ['', 'TRANSFER', 'QR_PAYMENT', 'DEPOSIT', 'WITHDRAWAL', 'ISSUANCE', 'BURN', 'REDEMPTION', 'REVERSAL'] as const;
const STATUSES = ['', 'PENDING', 'COMPLETED', 'FAILED', 'REVERSED', 'EXPIRED'] as const;

export function History() {
  const [params] = useSearchParams();
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState(params.get('wallet') ?? '');
  const [range, setRange] = useState<'all' | '30' | '7'>('all');

  const query = useMemo(() => {
    const parts = new URLSearchParams({ page: String(page), pageSize: '25' });
    if (type) parts.set('type', type);
    if (status) parts.set('status', status);
    if (search.trim()) parts.set('search', search.trim());
    if (range !== 'all') {
      const days = range === '30' ? 30 : 7;
      parts.set('from', new Date(Date.now() - days * 86_400_000).toISOString());
    }
    return parts.toString();
  }, [page, type, status, search, range]);

  const result = useAsync<Page>(() => api.get<Page>(`/me/transactions?${query}`), [query]);
  const rows = result.data?.items ?? [];
  const totalPages = result.data ? Math.max(1, Math.ceil(result.data.total / result.data.pageSize)) : 1;

  const exportCsv = () => {
    const header = ['reference', 'type', 'status', 'direction', 'amountMinor', 'counterparty', 'createdAt'];
    const lines = rows.map((row) =>
      [
        row.reference,
        row.type,
        row.status,
        row.direction,
        String(row.amountMinor),
        row.counterpartyNameFa ?? '',
        row.createdAt,
      ]
        .map((value) => `"${value.replace(/"/g, '""')}"`)
        .join(','),
    );
    const blob = new Blob([`\uFEFF${[header.join(','), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `pars-history-page-${page}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="prs-container prs-container-wide prs-stack-6">
      <div className="prs-row prs-between prs-wrap">
        <div>
          <h1>تاریخچهٔ گردش‌ها</h1>
          <p className="prs-small prs-muted">
            هر ردیف یک ثبت دفتر کل است؛ حذف یا ویرایش وجود ندارد و اصلاح‌ها با ثبت معکوس انجام می‌شوند.
          </p>
        </div>
        <div className="prs-row-2">
          <Button variant="outline" icon="download" onClick={exportCsv} disabled={rows.length === 0}>
            خروجی CSV این صفحه
          </Button>
          <Link className="prs-btn prs-btn--sm prs-btn--primary" to="/send">
            انتقال تازه
          </Link>
        </div>
      </div>

      <Panel title="صافی‌ها" icon="search">
        <PanelBody>
          <div className="prs-grid prs-grid-4">
            <Field label="جست‌وجو" hint="شناسهٔ تراکنش، نام طرف مقابل یا یادداشت">
              <TextInput
                value={search}
                onChange={(event) => {
                  setPage(1);
                  setSearch(event.target.value);
                }}
                placeholder="PRS-TRX-…"
              />
            </Field>
            <Field label="نوع">
              <Select
                value={type}
                onChange={(event) => {
                  setPage(1);
                  setType(event.target.value);
                }}
              >
                {TYPES.map((value) => (
                  <option key={value} value={value}>
                    {value ? transactionTypeFa(value) : 'همه'}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="وضعیت">
              <Select
                value={status}
                onChange={(event) => {
                  setPage(1);
                  setStatus(event.target.value);
                }}
              >
                {STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value ? labelFa(value) : 'همه'}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="بازهٔ زمانی">
              <Segmented
                label="بازه"
                value={range}
                onChange={(next) => {
                  setPage(1);
                  setRange(next as 'all' | '30' | '7');
                }}
                options={[
                  { id: 'all', label: 'همه' },
                  { id: '30', label: '۳۰ روز' },
                  { id: '7', label: '۷ روز' },
                ]}
              />
            </Field>
          </div>
        </PanelBody>
      </Panel>

      {result.error ? <Alert tone="critical" title="تاریخچه خوانده نشد">{result.error}</Alert> : null}

      <Panel
        title="گردش‌ها"
        subtitle={
          result.data
            ? `${toPersianDigits(result.data.total)} رویداد · صفحهٔ ${toPersianDigits(result.data.page)} از ${toPersianDigits(totalPages)}`
            : 'در حال خواندن…'
        }
        icon="history"
      >
        <PanelBody tight>
          {result.loading && rows.length === 0 ? (
            <Loading />
          ) : (
            <DataTable
              rows={rows}
              rowKey={(row) => row.id}
              empty={<div className="prs-empty">با این صافی‌ها گردشی پیدا نشد.</div>}
              columns={[
                { key: 'reference', header: 'شناسه', numeric: true, render: (row) => <span className="prs-small">{row.reference}</span> },
                { key: 'type', header: 'نوع', render: (row) => <span>{transactionTypeFa(row.type)}</span> },
                {
                  key: 'amount',
                  header: 'مبلغ',
                  numeric: true,
                  render: (row) => <MoneyText minor={row.amountMinor} withUnit tone={row.direction === 'IN' ? 'in' : 'out'} />,
                },
                {
                  key: 'counterparty',
                  header: 'طرف مقابل',
                  render: (row) => (
                    <span className="prs-small">
                      {row.counterpartyNameFa ?? '—'}
                      {row.counterpartyCardMasked ? <span className="prs-num prs-2xs"> · {row.counterpartyCardMasked}</span> : null}
                    </span>
                  ),
                },
                { key: 'status', header: 'وضعیت', render: (row) => <Badge tone={statusTone(row.status)}>{labelFa(row.status)}</Badge> },
                { key: 'when', header: 'زمان', render: (row) => <span className="prs-small prs-muted">{formatDateTime(row.createdAt)}</span> },
                {
                  key: 'actions',
                  header: '',
                  render: (row) => (
                    <Link className="prs-btn prs-btn--sm prs-btn--quiet" to={`/transactions/${row.reference}`}>
                      جزئیات
                    </Link>
                  ),
                },
              ]}
            />
          )}
        </PanelBody>
        <footer className="prs-panel__foot">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
            صفحهٔ پیشین
          </Button>
          <span className="prs-small prs-muted">
            صفحهٔ {toPersianDigits(page)} از {toPersianDigits(totalPages)}
          </span>
          <div className="prs-grow" />
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            صفحهٔ بعد
          </Button>
          <Button variant="quiet" size="sm" icon="refresh" onClick={() => void result.reload()}>
            به‌روزرسانی
          </Button>
        </footer>
      </Panel>

      <Alert tone="info" title="جمع‌ها را سرور می‌گوید">
        هر عدد در این صفحه از پاسخ سرور می‌آید. هیچ جمع یا تبدیل ارزی در مرورگر انجام نمی‌شود، چون مرورگر
        مرجع پولی نیست.
        <div style={{ marginTop: 'var(--prs-space-2)' }} className="prs-small">
          نمونه: بزرگ‌ترین گردش این صفحه{' '}
          <span className="prs-num">{rows.length > 0 ? formatPrs(Math.max(...rows.map((row) => row.amountMinor))) : '—'}</span> پارسه.
        </div>
      </Alert>

      <div className="prs-small prs-muted">
        آخرین به‌روزرسانی: {result.data ? formatRelative(new Date().toISOString()) : '—'}
      </div>
    </div>
  );
}
