/**
 * SECTION: wallets — every account in the ledger.
 *
 * A wallet's balance is never editable. The only two levers an operator has are:
 * freezing (a governed action that needs a second signature) and reading the
 * statement. That is intentional — money moves through transactions, not through
 * administration screens.
 */
import { useState } from 'react';
import { Alert, Badge, Button, DataTable, Field, Select, Stat, TextInput, formatPrs, labelFa, statusTone, toPersianDigits } from '@parsbank/ui';
import { adminApi } from '../lib/api.ts';
import { useAsync, useDebounced } from '../lib/hooks.ts';
import { ConsolePage, ConsolePanel, DateCell, Pager } from '../components/console.tsx';
import { RequestApprovalDialog } from '../components/approval.tsx';
import { useAdminSession } from '../lib/session.tsx';

interface WalletRow {
  id: string;
  public_ref: string;
  label_fa: string;
  status: string;
  is_primary: boolean;
  created_at: string;
  profile_ref: string;
  holder_name: string;
  profile_id: string;
  balance_minor: string;
}

const STATUSES = ['', 'ACTIVE', 'FROZEN', 'CLOSED'];

export function Wallets() {
  const { session } = useAdminSession();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [freezeTarget, setFreezeTarget] = useState<WalletRow | null>(null);
  const debounced = useDebounced(search);

  const list = useAsync<{ items: WalletRow[]; total: number }>(
    () => adminApi.get('/admin/wallets', { query: { search: debounced, status, page, pageSize: 25 } }),
    [debounced, status, page],
  );

  const rows = list.data?.items ?? [];
  const totalHeld = rows.reduce((sum, row) => sum + Number(row.balance_minor ?? 0), 0);

  return (
    <ConsolePage
      title="کیف پول‌ها"
      description="هر کیف پول یک حساب در دفتر کل است. موجودی از ثبت‌های دفتر بازخوانی می‌شود و ویرایش‌شدنی نیست."
      actions={
        <Button variant="outline" size="sm" icon="refresh" onClick={() => void list.reload()}>
          به‌روزرسانی
        </Button>
      }
    >
      <section className="prs-grid prs-grid-4">
        <Stat label="کیف پول‌های این صفحه" value={toPersianDigits(rows.length)} hint={`از ${toPersianDigits(list.data?.total ?? 0)} ردیف`} icon="wallet" />
        <Stat
          label="مجموع موجودی این صفحه"
          value={formatPrs(totalHeld, true)}
          hint="فقط همان ردیف‌هایی که در این صفحه دیده می‌شوند"
          icon="chart"
        />
        <Stat label="منجمد" value={toPersianDigits(rows.filter((row) => row.status === 'FROZEN').length)} hint="کیف پول منجمد می‌گیرد ولی نمی‌فرستد" icon="lock" />
        <Stat label="در انتظار بررسی" value={toPersianDigits(rows.filter((row) => row.status !== 'ACTIVE' && row.status !== 'FROZEN').length)} hint="وضعیت‌های میانی" icon="alert" />
      </section>

      <ConsolePanel title="صافی‌ها" icon="search">
        <div className="prs-grid prs-grid-2">
          <Field label="جست‌وجو" hint="شناسهٔ عمومی کیف پول، نام دارنده یا شناسهٔ پروفایل">
            <TextInput
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
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
        </div>
      </ConsolePanel>

      {list.error ? <Alert tone="critical" title="فهرست کیف پول‌ها خوانده نشد">{list.error}</Alert> : null}

      <ConsolePanel
        title="کیف پول‌ها"
        subtitle={list.data ? `${toPersianDigits(list.data.total)} حساب` : undefined}
        icon="wallet"
        loading={list.loading && rows.length === 0}
        rowCount={rows.length}
        empty="با این صافی‌ها کیف پولی پیدا نشد."
      >
        <DataTable
          compact
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            { key: 'ref', header: 'شناسهٔ کیف پول', render: (row) => <span className="prs-num prs-small">{row.public_ref}</span> },
            { key: 'label', header: 'برچسب', render: (row) => <span>{row.label_fa}</span> },
            { key: 'holder', header: 'دارنده', render: (row) => <span>{row.holder_name}</span> },
            {
              key: 'balance',
              header: 'موجودی',
              numeric: true,
              render: (row) => <span className="prs-num" style={{ fontWeight: 600 }}>{formatPrs(row.balance_minor, true)}</span>,
            },
            {
              key: 'status',
              header: 'وضعیت',
              render: (row) => (
                <Badge tone={statusTone(row.status)} dot>
                  {labelFa(row.status)}
                </Badge>
              ),
            },
            { key: 'primary', header: 'اصلی', render: (row) => (row.is_primary ? <Badge tone="info">اصلی</Badge> : <span className="prs-muted">—</span>) },
            { key: 'opened', header: 'افتتاح', render: (row) => <DateCell value={row.created_at} /> },
            {
              key: 'actions',
              header: '',
              render: (row) => (
                <Button size="sm" variant={row.status === 'FROZEN' ? 'outline' : 'danger'} onClick={() => setFreezeTarget(row)}>
                  {row.status === 'FROZEN' ? 'رفع انجماد' : 'انجماد'}
                </Button>
              ),
            },
          ]}
        />
        {list.data ? <Pager page={page} pageSize={25} total={list.data.total} onPage={setPage} /> : null}
      </ConsolePanel>

      <Alert tone="info" title="انجماد کیف پول یک عمل دو‌نفره است">
        انجماد از مسیر «درخواست تأیید» انجام می‌شود تا دو کارگزار پشت هر توقف گردش پول باشند. کیف پول منجمد
        همچنان می‌تواند پول دریافت کند و گزارش کامل آن در دفتر کل می‌ماند.
      </Alert>

      <RequestApprovalDialog
        open={Boolean(freezeTarget)}
        initialType="WALLET_FREEZE"
        lockedPayload={freezeTarget ? { walletId: freezeTarget.id, freeze: freezeTarget.status !== 'FROZEN' } : undefined}
        onClose={() => {
          setFreezeTarget(null);
          void list.reload();
        }}
        onFiled={() => {
          void list.reload();
        }}
      />

      <p className="prs-small prs-muted">
        نقش جاری: {session ? session.role : '—'} — اگر نقش شما اجازهٔ انجماد ندارد، دکمه‌ها در سرور رد می‌شوند و
        پیام آن در همین صفحه نشان داده می‌شود.
      </p>
    </ConsolePage>
  );
}
