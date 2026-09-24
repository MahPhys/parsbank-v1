/**
 * SECTION: burning and redemption — money leaving circulation.
 *
 * Both operations destroy value without destroying history: the ledger receives new
 * postings, supply falls, and the row that records the event stays forever. The
 * console offers the two registers plus the request path; execution is always the
 * dual-approval route.
 */
import { useState } from 'react';
import { Alert, Button, DataTable, Stat, Tabs, formatDateTime, formatPrs, toPersianDigits } from '@parsbank/ui';
import { adminApi } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { ConsolePage, ConsolePanel } from '../components/console.tsx';
import { RequestApprovalDialog } from '../components/approval.tsx';
import { useAdminSession } from '../lib/session.tsx';

interface BurnRow {
  id: string;
  burn_ref: string;
  amount_minor: number;
  source_kind: string;
  reason: string;
  authorizer_name: string;
  approver_name: string;
  approved_at: string;
  resulting_circulating_supply_minor: number;
}

interface RedemptionRow {
  id: string;
  redemption_ref: string;
  amount_minor: number;
  fee_minor: number;
  wallet_ref: string;
  holder_name: string;
  reason: string;
  approved_at: string;
}

export function Burning() {
  const { session } = useAdminSession();
  const [tab, setTab] = useState('burn');
  const [dialog, setDialog] = useState<'BURN' | 'REDEMPTION' | null>(null);

  const burns = useAsync<{ items: BurnRow[] }>(() => adminApi.get('/admin/treasury/burns'), []);
  const redemptions = useAsync<{ items: RedemptionRow[] }>(() => adminApi.get('/admin/treasury/redemptions'), []);
  const burnRows = burns.data?.items ?? [];
  const redemptionRows = redemptions.data?.items ?? [];

  return (
    <ConsolePage
      title="امحا و بازخرید"
      description="خروج پول از گردش دو مسیر دارد: امحا (نابودی ثبت‌شده) و بازخرید (تحویل در برابر پشتوانه). هیچ‌کدام تاریخ را پاک نمی‌کنند."
      actions={
        <>
          <Button variant="outline" size="sm" icon="refresh" onClick={() => void Promise.all([burns.reload(), redemptions.reload()])}>
            به‌روزرسانی
          </Button>
          <Button variant="danger" size="sm" icon="ban" onClick={() => setDialog('BURN')}>
            درخواست امحا
          </Button>
          <Button variant="outline" size="sm" icon="exchange" onClick={() => setDialog('REDEMPTION')}>
            درخواست بازخرید
          </Button>
        </>
      }
    >
      <section className="prs-grid prs-grid-4">
        <Stat label="امحاها" value={toPersianDigits(burnRows.length)} hint="رویدادهای ثبت‌شده" icon="ban" />
        <Stat label="جمع امحاشده" value={formatPrs(burnRows.reduce((sum, row) => sum + Number(row.amount_minor ?? 0), 0), true)} icon="treasury" />
        <Stat label="بازخریدها" value={toPersianDigits(redemptionRows.length)} icon="exchange" />
        <Stat
          label="جمع بازخرید"
          value={formatPrs(redemptionRows.reduce((sum, row) => sum + Number(row.amount_minor ?? 0), 0), true)}
          hint={`کارمزد: ${formatPrs(redemptionRows.reduce((sum, row) => sum + Number(row.fee_minor ?? 0), 0), true)}`}
          icon="chart"
        />
      </section>

      <Alert tone="warning" title="امحا یعنی نابودی، نه پنهان‌سازی">
        در بانک پارس هیچ ردیفی حذف نمی‌شود. امحا یک ثبت تازه است که عرضه را کم می‌کند و سند آن برای همیشه
        می‌ماند؛ اگر بعداً معلوم شود امحایی اشتباه بوده، راه اصلاح آن یک ثبت معکوس تازه است، نه پاک کردن ردیف.
      </Alert>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'burn', label: 'امحا' },
          { id: 'redemption', label: 'بازخرید' },
        ]}
      />

      {tab === 'burn' ? (
        <ConsolePanel
          title="دفتر امحا"
          icon="ban"
          loading={burns.loading && burnRows.length === 0}
          rowCount={burnRows.length}
          empty="امحایی ثبت نشده است."
        >
          <DataTable
            compact
            rows={burnRows}
            rowKey={(row) => row.id}
            columns={[
              { key: 'ref', header: 'شناسه', render: (row) => <span className="prs-num prs-small">{row.burn_ref}</span> },
              { key: 'amount', header: 'مبلغ', numeric: true, render: (row) => <span className="prs-num">{formatPrs(row.amount_minor, true)}</span> },
              {
                key: 'source',
                header: 'منبع',
                render: (row) => <span className="prs-small">{row.source_kind === 'PHYSICAL_NOTES' ? 'اسکناس فیزیکی' : 'کیف پول'}</span>,
              },
              { key: 'authorizer', header: 'مجوزدهنده', render: (row) => <span className="prs-small">{row.authorizer_name}</span> },
              { key: 'approver', header: 'تأییدکنندهٔ دوم', render: (row) => <span className="prs-small">{row.approver_name}</span> },
              {
                key: 'supply',
                header: 'در گردش پس از رویداد',
                numeric: true,
                render: (row) => <span className="prs-num">{formatPrs(row.resulting_circulating_supply_minor, true)}</span>,
              },
              { key: 'when', header: 'زمان', render: (row) => <span className="prs-small prs-muted">{formatDateTime(row.approved_at)}</span> },
              { key: 'reason', header: 'دلیل', render: (row) => <span className="prs-small">{row.reason}</span> },
            ]}
          />
        </ConsolePanel>
      ) : (
        <ConsolePanel
          title="دفتر بازخرید"
          icon="exchange"
          loading={redemptions.loading && redemptionRows.length === 0}
          rowCount={redemptionRows.length}
          empty="بازخریدی ثبت نشده است."
        >
          <DataTable
            compact
            rows={redemptionRows}
            rowKey={(row) => row.id}
            columns={[
              { key: 'ref', header: 'شناسه', render: (row) => <span className="prs-num prs-small">{row.redemption_ref}</span> },
              { key: 'amount', header: 'مبلغ', numeric: true, render: (row) => <span className="prs-num">{formatPrs(row.amount_minor, true)}</span> },
              { key: 'fee', header: 'کارمزد', numeric: true, render: (row) => <span className="prs-num">{formatPrs(row.fee_minor, true)}</span> },
              { key: 'wallet', header: 'کیف پول', render: (row) => <span className="prs-num prs-small">{row.wallet_ref}</span> },
              { key: 'holder', header: 'دارنده', render: (row) => <span>{row.holder_name}</span> },
              { key: 'when', header: 'زمان', render: (row) => <span className="prs-small prs-muted">{formatDateTime(row.approved_at)}</span> },
              { key: 'reason', header: 'دلیل', render: (row) => <span className="prs-small">{row.reason}</span> },
            ]}
          />
        </ConsolePanel>
      )}

      <p className="prs-small prs-muted">
        نقش جاری: {session?.role ?? '—'} — ثبت درخواست امحا و بازخرید برای خزانه‌دار و مدیر ارشد باز است؛
        اجرا پس از تأیید مدیر دوم انجام می‌شود.
      </p>

      <RequestApprovalDialog
        open={dialog === 'BURN'}
        initialType="BURN"
        onClose={() => {
          setDialog(null);
          void burns.reload();
        }}
      />
      <RequestApprovalDialog
        open={dialog === 'REDEMPTION'}
        initialType="REDEMPTION"
        onClose={() => {
          setDialog(null);
          void redemptions.reload();
        }}
      />
    </ConsolePage>
  );
}
