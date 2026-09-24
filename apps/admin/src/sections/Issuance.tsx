/**
 * SECTION: issuance — the register of every parsa ever created.
 *
 * An issuance row is the institution's birth certificate for money: it names the
 * amount, the reserve contribution that backed it, the authorizer, the second
 * approver, and the supply and coverage *after* the event. Rows are never edited —
 * the register is the history of the currency.
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  DataTable,
  MoneyText,
  Stat,
  formatDateTime,
  formatPercent,
  formatPrs,
  formatUsd,
  toPersianDigits,
} from '@parsbank/ui';
import { adminApi } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { ConsolePage, ConsolePanel } from '../components/console.tsx';
import { RequestApprovalDialog } from '../components/approval.tsx';
import { useAdminSession } from '../lib/session.tsx';

interface IssuanceRow {
  id: string;
  issuance_ref: string;
  amount_minor: number;
  destination_kind: string;
  reserve_contribution_usd_minor: number;
  reason: string;
  authorizer_profile_id: string;
  authorizer_name: string;
  second_approver_profile_id: string;
  approver_name: string;
  approved_at: string;
  ledger_transaction_id: string;
  ledger_sequence: number;
  resulting_supply_minor: number;
  resulting_circulating_supply_minor: number;
  resulting_coverage_ratio: string;
}

export function Issuance() {
  const { session } = useAdminSession();
  const [dialogOpen, setDialogOpen] = useState(false);
  const list = useAsync<{ items: IssuanceRow[] }>(() => adminApi.get('/admin/treasury/issuances'), []);
  const rows = list.data?.items ?? [];

  const canRequest = session ? ['SUPER_ADMIN', 'TREASURY_OFFICER'].includes(session.role) : false;
  const canFile = session ? session.role === 'SUPER_ADMIN' || session.role === 'TREASURY_OFFICER' : false;

  return (
    <ConsolePage
      title="انتشار پول"
      description="هر انتشار دو امضا دارد: خزانه‌دار درخواست می‌کند و مدیر دوم تأیید می‌کند. پول فقط پس از اجرا و در همان لحظه ثبت دفتری می‌شود."
      actions={
        <>
          <Button variant="outline" size="sm" icon="refresh" onClick={() => void list.reload()}>
            به‌روزرسانی
          </Button>
          <Button variant="primary" size="sm" icon="plus" disabled={!canRequest} onClick={() => setDialogOpen(true)}>
            درخواست انتشار تازه
          </Button>
        </>
      }
    >
      <section className="prs-grid prs-grid-4">
        <Stat label="تعداد انتشارها" value={toPersianDigits(rows.length)} hint="از آغاز شبکه" icon="plus" />
        <Stat
          label="جمع منتشرشده"
          value={formatPrs(
            rows.reduce((sum, row) => sum + Number(row.amount_minor ?? 0), 0),
            true,
          )}
          hint="مجموع این فهرست"
          icon="treasury"
        />
        <Stat
          label="جمع پشتوانهٔ همراه"
          value={`${formatUsd(rows.reduce((sum, row) => sum + Number(row.reserve_contribution_usd_minor ?? 0), 0))} $`}
          hint="دست‌کم برابر مبلغ × ارزش اسمی"
          icon="scale"
        />
        <Stat
          label="تأییدکنندگان متمایز"
          value={toPersianDigits(new Set(rows.map((row) => row.approver_name)).size)}
          hint="قاعدهٔ «تأییدکننده ≠ درخواست‌کننده» در سطح پایگاه داده اعمال می‌شود"
          icon="shield"
        />
      </section>

      {!canRequest ? (
        <Alert tone="warning" title="نقش شما اجازهٔ درخواست انتشار ندارد">
          نقش‌های دیگر می‌توانند این دفتر را ببینند، اما ثبت درخواست انتشار فقط با خزانه‌دار و مدیر ارشد است.
        </Alert>
      ) : null}

      {list.error ? <Alert tone="critical" title="دفتر انتشار خوانده نشد">{list.error}</Alert> : null}

      <ConsolePanel
        title="دفتر انتشار"
        subtitle="سند خلق هر پارسه"
        icon="plus"
        loading={list.loading && rows.length === 0}
        rowCount={rows.length}
        empty="تا کنون انتشاری ثبت نشده است."
      >
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          compact
          columns={[
            { key: 'ref', header: 'شناسه', render: (row) => <span className="prs-num prs-small">{row.issuance_ref}</span> },
            {
              key: 'amount',
              header: 'مبلغ',
              numeric: true,
              render: (row) => <MoneyText minor={row.amount_minor} withUnit />,
            },
            {
              key: 'reserve',
              header: 'سهم پشتوانه',
              numeric: true,
              render: (row) => <span className="prs-num">{formatUsd(row.reserve_contribution_usd_minor)} $</span>,
            },
            { key: 'destination', header: 'مقصد', render: (row) => <span className="prs-small">{row.destination_kind === 'PHYSICAL_NOTES' ? 'اسکناس فیزیکی' : 'کیف پول'}</span> },
            { key: 'authorizer', header: 'مجوزدهنده', render: (row) => <span className="prs-small">{row.authorizer_name}</span> },
            { key: 'approver', header: 'تأییدکنندهٔ دوم', render: (row) => <span className="prs-small">{row.approver_name}</span> },
            {
              key: 'supply',
              header: 'عرضهٔ پس از انتشار',
              numeric: true,
              render: (row) => <span className="prs-num">{formatPrs(row.resulting_supply_minor, true)}</span>,
            },
            {
              key: 'coverage',
              header: 'پوشش پس از انتشار',
              numeric: true,
              render: (row) => <span className="prs-num">{formatPercent(Number(row.resulting_coverage_ratio))}</span>,
            },
            { key: 'when', header: 'زمان تأیید', render: (row) => <span className="prs-small prs-muted">{formatDateTime(row.approved_at)}</span> },
            { key: 'reason', header: 'دلیل', render: (row) => <span className="prs-small">{row.reason}</span> },
          ]}
        />
      </ConsolePanel>

      <Alert tone="info" title="چرا عرضهٔ پس از انتشار ثبت می‌شود؟">
        چون سؤال درست حسابرسی این نیست که «چقدر منتشر شد»، بلکه این است که «پس از آن رویداد، عرضه و پوشش چه
        بود». این دو ستون همان لحظه را برای همیشه ثبت می‌کنند.
      </Alert>

      <RequestApprovalDialog
        open={dialogOpen}
        initialType="ISSUANCE"
        onClose={() => {
          setDialogOpen(false);
          void list.reload();
        }}
        onFiled={() => void list.reload()}
      />

      {canFile ? null : <p className="prs-small prs-muted">برای ثبت درخواست، نقش خزانه‌دار یا مدیر ارشد لازم است.</p>}
    </ConsolePage>
  );
}
