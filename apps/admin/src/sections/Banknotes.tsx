/**
 * SECTION: banknotes — the physical register.
 *
 * The paper is not the money: the register is. Every leaf has a serial, a batch, a
 * status and a holder, and the section can compare what the register says is carrying
 * value with what the ledger says is outstanding. When those two disagree, the
 * reconciliation banner says so in plain language.
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Field,
  Modal,
  Select,
  Stat,
  TextArea,
  TextInput,
  formatPrs,
  formatRelative,
  labelFa,
  statusTone,
  toPersianDigits,
} from '@parsbank/ui';
import { DENOMINATIONS } from '@parsbank/config/constants';
import { adminApi, describeError } from '../lib/api.ts';
import { useAsync, useDebounced } from '../lib/hooks.ts';
import { ConsolePage, ConsolePanel, DateCell, Pager, StatusCell } from '../components/console.tsx';
import { RequestApprovalDialog } from '../components/approval.tsx';

interface BanknoteRow {
  id: string;
  serialNumber: string;
  denominationMinor: number;
  status: string;
  seriesLabel: string;
  holderNameFa: string | null;
  carriesOutstandingValue: boolean;
  issuedAt: string | null;
  lastEventAt: string | null;
  artworkKey: string | null;
}

interface BatchRow {
  id: string;
  batch_code: string;
  series_label: string;
  denomination_minor: string;
  quantity: number;
  design_version: string | null;
  printed_at: string | null;
  created_at: string;
  registered_notes: number;
  outstanding_value_minor: string;
}

interface SummaryPayload {
  byStatus: Array<{ status: string; count: number; faceValueMinor: number }>;
  byDenomination: Array<{ denominationMinor: number; count: number }>;
  registryOutstandingMinor: number;
  ledgerNotesOutstandingMinor: number;
  reconciled: boolean;
}

const STATUSES = ['', 'REGISTERED', 'ISSUED', 'ASSIGNED', 'DEPOSITED', 'WITHDRAWN', 'FROZEN', 'LOST', 'STOLEN', 'DESTROYED'];

export function Banknotes() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [denomination, setDenomination] = useState('');
  const [page, setPage] = useState(1);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState<BanknoteRow | null>(null);
  const debounced = useDebounced(search);

  const summary = useAsync<SummaryPayload>(() => adminApi.get('/admin/banknotes/summary'), []);
  const batches = useAsync<{ items: BatchRow[] }>(() => adminApi.get('/admin/banknotes/batches'), []);
  const list = useAsync<{ items: BanknoteRow[]; total: number }>(
    () => adminApi.get('/admin/banknotes', { query: { search: debounced, status, denomination, page, pageSize: 50 } }),
    [debounced, status, denomination, page],
  );

  const rows = list.data?.items ?? [];

  return (
    <ConsolePage
      title="اسکناس‌ها"
      description="هر برگ یک سریال یکتا دارد و در دفتر اسکناس ثبت می‌شود: سری، وضعیت، دارنده و تاریخچهٔ بررسی."
      actions={
        <>
          <Button variant="outline" size="sm" icon="refresh" onClick={() => void Promise.all([summary.reload(), batches.reload(), list.reload()])}>
            به‌روزرسانی
          </Button>
          <Button variant="outline" size="sm" icon="card" onClick={() => setAssignOpen(true)}>
            تخصیص برگ
          </Button>
          <Button variant="primary" size="sm" icon="plus" onClick={() => setRegisterOpen(true)}>
            ثبت سری چاپ
          </Button>
        </>
      }
    >
      {summary.data ? (
        <Alert
          tone={summary.data.reconciled ? 'success' : 'critical'}
          title={summary.data.reconciled ? 'دفتر اسکناس با دفتر کل می‌خواند' : 'ناسازگاری میان دفتر اسکناس و دفتر کل'}
        >
          ارزش ثبت‌شده در دفتر اسکناس: <strong>{formatPrs(summary.data.registryOutstandingMinor, true)}</strong> — ارزشی که دفتر کل
          برای اسکناس در گردش نگه می‌دارد: <strong>{formatPrs(summary.data.ledgerNotesOutstandingMinor, true)}</strong>.
          {summary.data.reconciled ? ' این دو یکی است.' : ' این اختلاف باید بررسی شود و از مسیر اصلاح دفتری رفع گردد.'}
        </Alert>
      ) : null}

      <section className="prs-grid prs-grid-4">
        <Stat
          label="اسکناس‌های دارای ارزش در گردش"
          value={toPersianDigits((summary.data?.byStatus ?? []).filter((row) => row.status !== 'DESTROYED').reduce((sum, row) => sum + row.count, 0))}
          hint="شمارش برگ‌هایی که هنوز ارزش دارند"
          icon="notes"
        />
        <Stat
          label="ارزش اسمی در گردش"
          value={formatPrs(summary.data?.registryOutstandingMinor ?? 0, true)}
          hint="جمع رقم چاپ‌شده روی برگ‌های فعال"
          icon="treasury"
        />
        <Stat label="سری‌های چاپ" value={toPersianDigits(batches.data?.items.length ?? 0)} hint="هر سری یک چاپ متمایز است" icon="grid" />
        <Stat
          label="انجماد و مفقودی"
          value={toPersianDigits(
            (summary.data?.byStatus ?? []).filter((row) => row.status === 'FROZEN' || row.status === 'LOST' || row.status === 'STOLEN').reduce((sum, row) => sum + row.count, 0),
          )}
          hint="برگ‌هایی که از گردش بیرون شده‌اند"
          icon="ban"
        />
      </section>

      {summary.data ? (
        <section className="prs-split">
          <ConsolePanel title="ترکیب بر اساس وضعیت" icon="list" rowCount={summary.data.byStatus.length} empty="داده‌ای نیست.">
            <div className="prs-stack-3">
              {summary.data.byStatus.map((row) => (
                <div key={row.status} className="prs-row prs-between">
                  <Badge tone={statusTone(row.status)} dot>
                    {labelFa(row.status)}
                  </Badge>
                  <span className="prs-small prs-muted">
                    {toPersianDigits(row.count)} برگ · {formatPrs(row.faceValueMinor, true)}
                  </span>
                </div>
              ))}
            </div>
          </ConsolePanel>

          <ConsolePanel title="ترکیب بر اساس ارزش" subtitle="هفت رقم استاندارد پارسه" icon="grid" rowCount={summary.data.byDenomination.length} empty="داده‌ای نیست.">
            <div className="prs-stack-3">
              {summary.data.byDenomination.map((row) => (
                <div key={row.denominationMinor} className="prs-row prs-between">
                  <span className="prs-num">{formatPrs(row.denominationMinor, true)}</span>
                  <span className="prs-small prs-muted">{toPersianDigits(row.count)} برگ</span>
                </div>
              ))}
            </div>
          </ConsolePanel>
        </section>
      ) : null}

      <ConsolePanel title="سری‌های چاپ" subtitle="چاپ، برگ‌ها را ثبت می‌کند ولی آن‌ها را در گردش نمی‌گذارد" icon="grid" loading={batches.loading && !batches.data}>
        <DataTable
          compact
          rows={batches.data?.items ?? []}
          rowKey={(row) => row.id}
          empty={<div className="prs-empty">سری‌ای ثبت نشده است.</div>}
          columns={[
            { key: 'code', header: 'کد سری', render: (row) => <span className="prs-num">{toPersianDigits(row.batch_code)}</span> },
            { key: 'label', header: 'عنوان سری', render: (row) => <span>{row.series_label}</span> },
            { key: 'denom', header: 'ارزش', numeric: true, render: (row) => <span className="prs-num">{formatPrs(row.denomination_minor, true)}</span> },
            { key: 'qty', header: 'تعداد', numeric: true, render: (row) => <span className="prs-num">{toPersianDigits(row.quantity)}</span> },
            { key: 'registered', header: 'ثبت‌شده', numeric: true, render: (row) => <span className="prs-num">{toPersianDigits(row.registered_notes)}</span> },
            {
              key: 'value',
              header: 'ارزش در گردش',
              numeric: true,
              render: (row) => <span className="prs-num">{formatPrs(row.outstanding_value_minor, true)}</span>,
            },
            { key: 'design', header: 'نسخهٔ طرح', render: (row) => <span className="prs-small">{row.design_version ?? '—'}</span> },
            { key: 'printed', header: 'چاپ', render: (row) => <DateCell value={row.printed_at} relative /> },
          ]}
        />
      </ConsolePanel>

      <ConsolePanel title="صافی‌ها" icon="search">
        <div className="prs-grid prs-grid-3">
          <Field label="جست‌وجو" hint="سریال برگ">
            <TextInput
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
              placeholder="PRS-100-0001-00001-H"
            />
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
          <Field label="ارزش">
            <Select
              value={denomination}
              onChange={(event) => {
                setPage(1);
                setDenomination(event.target.value);
              }}
            >
              <option value="">همه</option>
              {DENOMINATIONS.map((value) => (
                <option key={value} value={value}>
                  {formatPrs(value, true)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </ConsolePanel>

      {list.error ? <Alert tone="critical" title="فهرست اسکناس‌ها خوانده نشد">{list.error}</Alert> : null}

      <ConsolePanel
        title="دفتر اسکناس"
        subtitle={list.data ? `${toPersianDigits(list.data.total)} برگ` : undefined}
        icon="notes"
        loading={list.loading && rows.length === 0}
        rowCount={rows.length}
        empty="با این صافی‌ها برگی پیدا نشد."
      >
        <DataTable
          compact
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            { key: 'serial', header: 'سریال', render: (row) => <span className="prs-num prs-small" dir="ltr">{row.serialNumber}</span> },
            { key: 'denom', header: 'ارزش', numeric: true, render: (row) => <span className="prs-num">{formatPrs(row.denominationMinor, true)}</span> },
            { key: 'series', header: 'سری', render: (row) => <span className="prs-small">{row.seriesLabel}</span> },
            { key: 'status', header: 'وضعیت', render: (row) => <StatusCell value={row.status} /> },
            { key: 'holder', header: 'دارنده', render: (row) => <span className="prs-small">{row.holderNameFa ?? 'خزانه'}</span> },
            {
              key: 'value',
              header: 'ارزش‌دار',
              render: (row) => (row.carriesOutstandingValue ? <Badge tone="positive">بله</Badge> : <Badge tone="muted">خیر</Badge>),
            },
            { key: 'event', header: 'آخرین رویداد', render: (row) => <span className="prs-small prs-muted">{formatRelative(row.lastEventAt)}</span> },
            {
              key: 'actions',
              header: '',
              render: (row) => (
                <Button size="sm" variant="outline" onClick={() => setStatusTarget(row)}>
                  وضعیت
                </Button>
              ),
            },
          ]}
        />
        {list.data ? <Pager page={page} pageSize={50} total={list.data.total} onPage={setPage} /> : null}
      </ConsolePanel>

      <RegisterBatchDialog
        open={registerOpen}
        onClose={() => {
          setRegisterOpen(false);
          void Promise.all([batches.reload(), summary.reload(), list.reload()]);
        }}
      />
      <AssignDialog
        open={assignOpen}
        onClose={() => {
          setAssignOpen(false);
          void Promise.all([list.reload(), summary.reload()]);
        }}
      />
      <RequestApprovalDialog
        open={Boolean(statusTarget)}
        initialType="BANKNOTE_STATUS_CHANGE"
        lockedPayload={statusTarget ? { serialNumber: statusTarget.serialNumber } : undefined}
        onClose={() => {
          setStatusTarget(null);
          void Promise.all([list.reload(), summary.reload()]);
        }}
      />
    </ConsolePage>
  );
}

function RegisterBatchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [denomination, setDenomination] = useState('100');
  const [quantity, setQuantity] = useState('10');
  const [seriesLabel, setSeriesLabel] = useState('سری ۱');
  const [designVersion, setDesignVersion] = useState('series-1');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ batchCode?: string; registered?: number } | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const value = await adminApi.post<{ batchCode?: string; registered?: number }>('/admin/banknotes/batches', {
        denominationMinor: Number(denomination),
        quantity: Number(quantity),
        seriesLabel,
        designVersion: designVersion || null,
        notes: notes || null,
      });
      setResult(value);
      onClose();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="ثبت سری چاپ اسکناس"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            بستن
          </Button>
          <Button variant="primary" loading={busy} disabled={Number(quantity) < 1} onClick={() => void submit()}>
            ثبت سری
          </Button>
        </>
      }
    >
      <div className="prs-stack-4">
        <Alert tone="info" title="چاپ، انتشار نیست">
          ثبت سری فقط برگ‌ها را در دفتر اسکناس می‌سازد. برگ تا زمانی که در گردش گذاشته نشود، هیچ ارزشی خارج
          از خزانه ندارد.
        </Alert>
        <Field label="ارزش برگ">
          <Select value={denomination} onChange={(event) => setDenomination(event.target.value)}>
            {DENOMINATIONS.map((value) => (
              <option key={value} value={value}>
                {formatPrs(value, true)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="تعداد برگ">
          <TextInput numeric value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </Field>
        <Field label="عنوان سری">
          <TextInput value={seriesLabel} onChange={(event) => setSeriesLabel(event.target.value)} />
        </Field>
        <Field label="نسخهٔ طرح">
          <TextInput dir="ltr" value={designVersion} onChange={(event) => setDesignVersion(event.target.value)} />
        </Field>
        <Field label="یادداشت (اختیاری)">
          <TextArea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
        {error ? <Alert tone="critical" title="ثبت سری انجام نشد">{error}</Alert> : null}
        {result ? (
          <Alert tone="success" title="سری ثبت شد">
            کد سری <span className="prs-num">{result.batchCode}</span> — {toPersianDigits(result.registered ?? 0)} برگ در دفتر
            اسکناس ثبت شد.
          </Alert>
        ) : null}
      </div>
    </Modal>
  );
}

function AssignDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [serialNumber, setSerialNumber] = useState('');
  const [holderWalletRef, setHolderWalletRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.post('/admin/banknotes/assign', { serialNumber: serialNumber.trim(), holderWalletRef: holderWalletRef.trim() });
      setDone(true);
      onClose();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="تخصیص برگ به کیف پول"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            بستن
          </Button>
          <Button variant="primary" loading={busy} disabled={serialNumber.trim().length < 4 || holderWalletRef.trim().length < 6} onClick={() => void submit()}>
            تخصیص برگ
          </Button>
        </>
      }
    >
      <div className="prs-stack-4">
        <Alert tone="info" title="تخصیص، تحویل فیزیکی است">
          تخصیص یعنی این برگ به این دارنده سپرده شده است. تا وقتی برگ واریز نشود، ارزش آن در کیف پول نیست؛
          دارنده باید کاغذ را تحویل دهد تا ارزش به حسابش برود.
        </Alert>
        <Field label="سریال برگ">
          <TextInput dir="ltr" numeric value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} />
        </Field>
        <Field label="شناسهٔ کیف پول دارنده">
          <TextInput dir="ltr" value={holderWalletRef} onChange={(event) => setHolderWalletRef(event.target.value)} />
        </Field>
        {error ? <Alert tone="critical" title="تخصیص انجام نشد">{error}</Alert> : null}
        {done ? <Alert tone="success" title="برگ تخصیص یافت" /> : null}
      </div>
    </Modal>
  );
}
