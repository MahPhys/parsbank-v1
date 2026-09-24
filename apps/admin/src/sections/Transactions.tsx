/**
 * SECTION: transactions — the ledger as seen from the operations desk.
 *
 * A row here is a settled fact, not a form. The section can read a reference, open
 * its receipt, and follow the two wallets involved; it cannot edit, delete or
 * "correct" anything. Corrections in BANK PARS are new postings, produced by the
 * reversal path, never by an UPDATE.
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  DataTable,
  Field,
  Modal,
  MoneyText,
  Select,
  Stat,
  TextInput,
  formatDateTime,
  formatPrs,
  formatRate,
  formatUsd,
  labelFa,
  toPersianDigits,
  transactionTypeFa,
} from '@parsbank/ui';
import { adminApi } from '../lib/api.ts';
import { useAsync, useDebounced } from '../lib/hooks.ts';
import { ConsolePage, ConsolePanel, DateCell, Pager, StatusCell } from '../components/console.tsx';

interface TransactionRow {
  id: string;
  reference: string;
  type: string;
  status: string;
  amount_minor: string;
  fee_minor: string;
  created_at: string;
  completed_at: string | null;
  memo: string | null;
  failure_code: string | null;
  sender_name: string | null;
  receiver_name: string | null;
  sender_wallet_ref: string | null;
  receiver_wallet_ref: string | null;
  ledger_sequence: number;
}

interface ReceiptPayload {
  reference: string;
  verificationCode: string;
  amountMinor: number;
  feeMinor: number;
  senderNameFa: string | null;
  receiverNameFa: string | null;
  senderCardMasked: string | null;
  receiverCardMasked: string | null;
  ledgerSequence: number;
  issuedAt: string;
  referenceRate?: number | null;
  referenceUsdMinor?: number | null;
}

const TYPES = ['', 'TRANSFER', 'QR_PAYMENT', 'DEPOSIT', 'WITHDRAWAL', 'ISSUANCE', 'BURN', 'REDEMPTION', 'FEE', 'REVERSAL', 'ADJUSTMENT'];
const STATUSES = ['', 'PENDING', 'COMPLETED', 'FAILED', 'REVERSED', 'EXPIRED'];

export function Transactions() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [receiptRef, setReceiptRef] = useState<string | null>(null);
  const debounced = useDebounced(search);

  const list = useAsync<{ items: TransactionRow[]; total: number; page: number; pageSize: number }>(
    () => adminApi.get('/admin/transactions', { query: { search: debounced, type, status, page, pageSize: 25 } }),
    [debounced, type, status, page],
  );

  const receipt = useAsync<ReceiptPayload | null>(
    () => (receiptRef ? adminApi.get<ReceiptPayload>(`/admin/transactions/${receiptRef}/receipt`) : Promise.resolve(null)),
    [receiptRef],
  );

  const rows = list.data?.items ?? [];
  const completedVolume = rows.filter((row) => row.status === 'COMPLETED').reduce((sum, row) => sum + Number(row.amount_minor ?? 0), 0);

  return (
    <ConsolePage
      title="تراکنش‌ها"
      description="دفتر کل فقط افزودنی است: هیچ تراکنشی حذف یا ویرایش نمی‌شود و اصلاح مالی، ثبت تازهٔ معکوس است."
      actions={
        <Button variant="outline" size="sm" icon="refresh" onClick={() => void list.reload()}>
          به‌روزرسانی
        </Button>
      }
    >
      <section className="prs-grid prs-grid-4">
        <Stat label="ردیف‌های این صفحه" value={toPersianDigits(rows.length)} hint={`از ${toPersianDigits(list.data?.total ?? 0)} تراکنش`} icon="history" />
        <Stat label="حجم موفق این صفحه" value={formatPrs(completedVolume, true)} hint="جمع مبلغ تراکنش‌های COMPLETED" icon="chart" />
        <Stat label="ناموفق" value={toPersianDigits(rows.filter((row) => row.status === 'FAILED').length)} hint="هیچ اثر دفتری ندارند" icon="alert" />
        <Stat label="معکوس‌شده" value={toPersianDigits(rows.filter((row) => row.status === 'REVERSED').length)} hint="اصلاح با ثبت تازه انجام شده است" icon="refresh" />
      </section>

      <ConsolePanel title="صافی‌ها" icon="search">
        <div className="prs-grid prs-grid-3">
          <Field label="جست‌وجو" hint="شناسهٔ تراکنش، یادداشت یا نام طرفین">
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
                <option key={value || 'all'} value={value}>
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
                <option key={value || 'all'} value={value}>
                  {value ? labelFa(value) : 'همه'}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </ConsolePanel>

      {list.error ? <Alert tone="critical" title="فهرست تراکنش‌ها خوانده نشد">{list.error}</Alert> : null}

      <ConsolePanel
        title="تراکنش‌ها"
        subtitle={list.data ? `${toPersianDigits(list.data.total)} ردیف دفتر کل` : undefined}
        icon="history"
        loading={list.loading && rows.length === 0}
        rowCount={rows.length}
        empty="با این صافی‌ها تراکنشی پیدا نشد."
      >
        <DataTable
          compact
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            { key: 'ref', header: 'شناسه', render: (row) => <span className="prs-num prs-small">{row.reference}</span> },
            { key: 'type', header: 'نوع', render: (row) => <span>{transactionTypeFa(row.type)}</span> },
            {
              key: 'amount',
              header: 'مبلغ',
              numeric: true,
              render: (row) => <MoneyText minor={row.amount_minor} withUnit />,
            },
            { key: 'from', header: 'از', render: (row) => <span className="prs-small">{row.sender_name ?? 'خزانه / سامانه'}</span> },
            { key: 'to', header: 'به', render: (row) => <span className="prs-small">{row.receiver_name ?? '—'}</span> },
            { key: 'status', header: 'وضعیت', render: (row) => <StatusCell value={row.status} /> },
            { key: 'seq', header: 'نسخهٔ دفتر', numeric: true, render: (row) => <span className="prs-num">{toPersianDigits(row.ledger_sequence)}</span> },
            { key: 'when', header: 'زمان', render: (row) => <DateCell value={row.created_at} /> },
            {
              key: 'actions',
              header: '',
              render: (row) => (
                <Button size="sm" variant="quiet" onClick={() => setReceiptRef(row.reference)}>
                  رسید
                </Button>
              ),
            },
          ]}
        />
        {list.data ? <Pager page={page} pageSize={25} total={list.data.total} onPage={setPage} /> : null}
      </ConsolePanel>

      <Modal
        open={Boolean(receiptRef)}
        title="رسید رسمی تراکنش"
        onClose={() => setReceiptRef(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setReceiptRef(null)}>
              بستن
            </Button>
            <Button variant="primary" icon="print" onClick={() => window.print()} disabled={!receipt.data}>
              چاپ رسید
            </Button>
          </>
        }
      >
        {receipt.loading ? (
          <p className="prs-small prs-muted">در حال خواندن رسید…</p>
        ) : receipt.data ? (
          <div className="prs-stack-4">
            <dl className="prs-kv">
              <div style={{ display: 'contents' }}>
                <dt>شناسهٔ تراکنش</dt>
                <dd className="prs-num">{receipt.data.reference}</dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>مبلغ</dt>
                <dd>
                  <MoneyText minor={receipt.data.amountMinor} withUnit size="lg" />
                </dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>کارمزد</dt>
                <dd>
                  <MoneyText minor={receipt.data.feeMinor} withUnit />
                </dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>فرستنده</dt>
                <dd>{receipt.data.senderNameFa ?? '—'}</dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>گیرنده</dt>
                <dd>{receipt.data.receiverNameFa ?? '—'}</dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>نسخهٔ دفتر کل</dt>
                <dd className="prs-num">{toPersianDigits(receipt.data.ledgerSequence)}</dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>ارزش مرجع</dt>
                <dd>
                  {receipt.data.referenceUsdMinor !== null && receipt.data.referenceUsdMinor !== undefined ? (
                    <span className="prs-num">{formatUsd(receipt.data.referenceUsdMinor)} &#36;</span>
                  ) : (
                    '—'
                  )}{' '}
                  {receipt.data.referenceRate ? (
                    <span className="prs-small prs-muted">(نرخ {formatRate(receipt.data.referenceRate)})</span>
                  ) : null}
                </dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>زمان صدور</dt>
                <dd>{formatDateTime(receipt.data.issuedAt)}</dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>کد رهگیری رسید</dt>
                <dd className="prs-num">{receipt.data.verificationCode}</dd>
              </div>
            </dl>
            <Alert tone="info" title="کد رهگیری با کلید سامانه امضا شده است">
              همین کد در صفحهٔ عمومی «بررسی رسید» قابل راستی‌آزمایی است؛ کاربر می‌تواند بدون ورود به سامانه
              اصالت رسید کاغذی را بسنجد.
            </Alert>
          </div>
        ) : (
          <Alert tone="critical" title="رسید خوانده نشد">{receipt.error}</Alert>
        )}
      </Modal>
    </ConsolePage>
  );
}
