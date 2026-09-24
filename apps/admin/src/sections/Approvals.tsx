/**
 * SECTION: approvals — the institution's second signature.
 *
 * The queue is the heart of governance: fifteen action types, each requiring two
 * distinct administrators. This screen lists requests, shows the payload that will be
 * executed, and walks an approver through nonce → approve/reject → execute. The
 * server enforces no-self-approval, single-use nonces and a two-minute window; the
 * console only makes that protocol visible.
 */
import { useState } from 'react';
import { Alert, Button, DataTable, Panel, PanelBody, Segmented, Stat, formatCountdown, formatDateTime, labelFa, toPersianDigits } from '@parsbank/ui';
import type { AdminActionDto } from '@parsbank/types';
import { adminApi } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { ConsolePage, ConsolePanel, Pager } from '../components/console.tsx';
import { ApprovalDetail, RequestApprovalDialog } from '../components/approval.tsx';
import { useAdminSession } from '../lib/session.tsx';

interface ApprovalPayload {
  items: AdminActionDto[];
  total: number;
  page: number;
  pageSize: number;
}

const FILTERS: Array<{ id: string; label: string }> = [
  { id: 'PENDING', label: 'در انتظار' },
  { id: 'APPROVED', label: 'تأییدشده' },
  { id: 'EXECUTED', label: 'اجراشده' },
  { id: 'REJECTED', label: 'ردشده' },
  { id: '', label: 'همه' },
];

export function Approvals() {
  const { session } = useAdminSession();
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const queue = useAsync<ApprovalPayload>(
    () => adminApi.get('/admin/approvals', { query: { status: status || undefined, page, pageSize: 25 } }),
    [status, page],
  );

  const rows = queue.data?.items ?? [];
  const selectedAction = rows.find((row) => row.id === selected) ?? null;

  return (
    <ConsolePage
      title="درخواست‌های تأیید"
      description="هیچ عملیات حساسی با یک نفر انجام نمی‌شود. اینجا درخواست ثبت می‌شود، مدیر دوم تأیید می‌کند و اجرا پس از آن انجام می‌گیرد."
      actions={
        <>
          <Button variant="outline" size="sm" icon="refresh" onClick={() => void queue.reload()}>
            بازخوانی
          </Button>
          <Button variant="primary" size="sm" icon="seal" onClick={() => setDialogOpen(true)}>
            ثبت درخواست تازه
          </Button>
        </>
      }
    >
      <section className="prs-grid prs-grid-4">
        <Stat
          label="در انتظار تصمیم"
          value={toPersianDigits(rows.filter((row) => row.status === 'PENDING').length)}
          hint="در صفحهٔ جاری"
          tone={rows.some((row) => row.status === 'PENDING') ? 'warning' : 'positive'}
          icon="clock"
        />
        <Stat label="کل ردیف‌ها" value={toPersianDigits(queue.data?.total ?? 0)} hint="با صافی کنونی" icon="list" />
        <Stat
          label="بانتظار اجرا"
          value={toPersianDigits(rows.filter((row) => row.status === 'APPROVED').length)}
          hint="تأیید شده ولی اثر واقعی هنوز اجرا نشده است"
          icon="seal"
        />
        <Stat
          label="اجراشده"
          value={toPersianDigits(rows.filter((row) => row.status === 'EXECUTED').length)}
          hint="اثر واقعی روی دفتر کل"
          icon="check"
        />
      </section>

      <Alert tone="info" title="قواعدی که سامانه تحمیل می‌کند">
        تأییدکننده نمی‌تواند همان درخواست‌کننده باشد (قید در سطح پایگاه داده)، هر تصمیم به یک نشان یک‌بارمصرف
        دوقیقه‌ای نیاز دارد، و اجرا تنها پس از ثبت تصمیم دوم ممکن است. ردیف‌های منقضی هرگز اجرا نمی‌شوند.
      </Alert>

      <Segmented
        label="صافی وضعیت"
        value={status}
        onChange={(next) => {
          setStatus(next);
          setPage(1);
          setSelected(null);
        }}
        options={FILTERS}
      />

      {queue.error ? <Alert tone="critical" title="صف تأیید خوانده نشد">{queue.error}</Alert> : null}

      <ConsolePanel
        title="صف تأیید"
        subtitle={queue.data ? `${toPersianDigits(queue.data.total)} ردیف` : undefined}
        icon="seal"
        loading={queue.loading && rows.length === 0}
        rowCount={rows.length}
        empty="در این وضعیت درخواستی وجود ندارد."
      >
        <DataTable
          compact
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            { key: 'ref', header: 'شناسه', render: (row) => <span className="prs-num prs-small">{row.actionRef}</span> },
            { key: 'type', header: 'نوع', render: (row) => <span>{row.actionLabelFa || labelFa(row.actionType)}</span> },
            { key: 'by', header: 'درخواست‌کننده', render: (row) => <span className="prs-small">{row.requestedByNameFa}</span> },
            { key: 'when', header: 'زمان درخواست', render: (row) => <span className="prs-small prs-muted">{formatDateTime(row.requestedAt)}</span> },
            {
              key: 'window',
              header: 'مهلت',
              render: (row) => <span className="prs-num prs-small">{row.status === 'PENDING' ? formatCountdown(row.expiresAt) : '—'}</span>,
            },
            {
              key: 'second',
              header: 'امضای دوم',
              render: (row) => <span className="prs-small">{row.requiresSecondApprover ? 'لازم است' : 'لازم نیست'}</span>,
            },
            { key: 'status', header: 'وضعیت', render: (row) => <span className="prs-small">{labelFa(row.status)}</span> },
            {
              key: 'actions',
              header: '',
              render: (row) => (
                <Button size="sm" variant={row.status === 'PENDING' || row.status === 'APPROVED' ? 'primary' : 'quiet'} onClick={() => setSelected(row.id)}>
                  بررسی
                </Button>
              ),
            },
          ]}
        />
        {queue.data ? <Pager page={page} pageSize={25} total={queue.data.total} onPage={setPage} /> : null}
      </ConsolePanel>

      {selectedAction ? (
        <ApprovalDetail
          action={selectedAction}
          selfProfileId={session?.profileId ?? null}
          onDone={() => {
            setSelected(null);
            void queue.reload();
          }}
        />
      ) : (
        <Panel title="راهنمای تصمیم‌گیری" icon="list">
          <PanelBody>
            <ol className="prs-stack-3" style={{ paddingInlineStart: 'var(--prs-space-6)', margin: 0 }}>
              <li>ابتدا payload را بخوانید: همان چیزی است که پس از تأیید اجرا می‌شود.</li>
              <li>دلیل درخواست را بسنجید؛ دلیل خالی یا مبهم، دلیل کافی نیست.</li>
              <li>اگر عملیات مالی است، اثر آن روی عرضه، پوشش و نرخ مرجع را در بخش‌های خزانه و پشتوانه ببینید.</li>
              <li>تأیید یعنی پذیرش مسئولیت: نام شما در دفتر حسابرسی کنار این تصمیم می‌ماند.</li>
            </ol>
          </PanelBody>
        </Panel>
      )}

      <RequestApprovalDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          void queue.reload();
        }}
        onFiled={() => void queue.reload()}
      />
    </ConsolePage>
  );
}
