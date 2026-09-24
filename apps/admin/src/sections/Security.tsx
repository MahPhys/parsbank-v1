/**
 * SECTION: security — sessions, sign-in attempts and locked accounts.
 *
 * This screen is read-only by design, with one deliberate exception: an operator may
 * suspend every account that has been locked by failed sign-in attempts. Revoking an
 * individual session or changing a credential is either the account holder's own act
 * or a governed operation, never a silent click from a console.
 */
import { useState } from 'react';
import { Alert, Badge, Button, DataTable, Stat, formatDateTime, formatRelative, toPersianDigits } from '@parsbank/ui';
import { adminApi, describeError } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { ConsolePage, ConsolePanel, DateCell } from '../components/console.tsx';
import { useAdminSession } from '../lib/session.tsx';

interface SecurityPayload {
  sessions: Array<{
    id: string;
    audience: string;
    public_ref: string;
    full_name_fa: string;
    issued_at: string;
    last_seen_at: string;
    absolute_expires_at: string;
    revoked_at: string | null;
    revoked_reason: string | null;
    ip_hash: string;
    user_agent: string | null;
  }>;
  loginAttempts: Array<{ id: number; outcome: string; occurred_at: string; ip_hash: string; user_agent: string | null; public_ref: string | null }>;
  lockedProfiles: Array<{ id: string; public_ref: string; full_name_fa: string; role: string; failed_logins: number; locked_until: string }>;
}

export function Security() {
  const { session } = useAdminSession();
  const state = useAsync<SecurityPayload>(() => adminApi.get<SecurityPayload>('/admin/security'), []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const suspendLocked = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await adminApi.post<{ suspended: number }>('/admin/security/suspend-locked', {});
      setMessage(`${toPersianDigits(result.suspended)} حساب قفل‌شده به وضعیت تعلیق منتقل شد.`);
      await state.reload();
    } catch (caught) {
      setMessage(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const sessions = state.data?.sessions ?? [];
  const attempts = state.data?.loginAttempts ?? [];
  const locked = state.data?.lockedProfiles ?? [];

  return (
    <ConsolePage
      title="امنیت و نشست‌ها"
      description="نشست‌های فعال، تلاش‌های ورود و حساب‌های قفل‌شده. ورود مدیریتی نشستی جدا با عمر کوتاه‌تر است."
      actions={
        <>
          <Button variant="outline" size="sm" icon="refresh" onClick={() => void state.reload()}>
            بازخوانی
          </Button>
          <Button variant="danger" size="sm" icon="lock" loading={busy} disabled={locked.length === 0} onClick={() => void suspendLocked()}>
            تعلیق حساب‌های قفل‌شده ({toPersianDigits(locked.length)})
          </Button>
        </>
      }
    >
      {message ? <Alert tone={message.includes('منتقل شد') ? 'success' : 'critical'}>{message}</Alert> : null}
      {state.error ? <Alert tone="critical" title="اطلاعات امنیتی خوانده نشد">{state.error}</Alert> : null}

      <section className="prs-grid prs-grid-4">
        <Stat
          label="نشست‌های فعال"
          value={toPersianDigits(sessions.filter((row) => !row.revoked_at).length)}
          hint={`از ${toPersianDigits(sessions.length)} نشست ثبت‌شدهٔ اخیر`}
          icon="list"
        />
        <Stat
          label="نشست‌های مدیریتی"
          value={toPersianDigits(sessions.filter((row) => row.audience === 'ADMIN' && !row.revoked_at).length)}
          hint="کنسول عملیات فقط با این نشست‌ها باز است"
          icon="shield"
        />
        <Stat
          label="ورودهای ناموفق"
          value={toPersianDigits(attempts.filter((row) => row.outcome !== 'SUCCESS').length)}
          hint={`از ${toPersianDigits(attempts.length)} تلاش اخیر`}
          tone={attempts.some((row) => row.outcome !== 'SUCCESS') ? 'warning' : 'positive'}
          icon="alert"
        />
        <Stat
          label="حساب‌های قفل‌شده"
          value={toPersianDigits(locked.length)}
          hint="محافظت خودکار پس از تلاش‌های پی‌درپی ناموفق"
          tone={locked.length > 0 ? 'warning' : 'positive'}
          icon="lock"
        />
      </section>

      <Alert tone="info" title="چرا شناسهٔ شبکه به شکل درهم دیده می‌شود؟">
        نشانی IP هرگز به شکل خام ذخیره نمی‌شود؛ فقط درهم‌ساختهٔ آن نگه داشته می‌شود تا بتوان الگوی حمله را
        دید بدون آنکه داده‌ای برای ردیابی افراد باقی بماند.
      </Alert>

      <ConsolePanel
        title="نشست‌های اخیر"
        subtitle="صد نشست آخر در هر دو سطح کاربری و مدیریتی"
        icon="list"
        loading={state.loading && sessions.length === 0}
        rowCount={sessions.length}
        empty="نشستی ثبت نشده است."
      >
        <DataTable
          compact
          rows={sessions}
          rowKey={(row) => row.id}
          columns={[
            {
              key: 'audience',
              header: 'نوع',
              render: (row) => (row.audience === 'ADMIN' ? <Badge tone="info">مدیریتی</Badge> : <Badge tone="muted">کاربری</Badge>),
            },
            { key: 'user', header: 'کاربر', render: (row) => <span>{row.full_name_fa} <span className="prs-num prs-small prs-muted">{row.public_ref}</span></span> },
            { key: 'issued', header: 'شروع', render: (row) => <DateCell value={row.issued_at} /> },
            { key: 'seen', header: 'آخرین فعالیت', render: (row) => <span className="prs-small prs-muted">{formatRelative(row.last_seen_at)}</span> },
            { key: 'expires', header: 'انقضا', render: (row) => <DateCell value={row.absolute_expires_at} /> },
            {
              key: 'status',
              header: 'وضعیت',
              render: (row) => (row.revoked_at ? <Badge tone="muted">باطل‌شده</Badge> : <Badge tone="positive">فعال</Badge>),
            },
            { key: 'agent', header: 'دستگاه', render: (row) => <span className="prs-small">{row.user_agent?.slice(0, 44) ?? 'نامشخص'}</span> },
            { key: 'ip', header: 'اثر شبکه', render: (row) => <span className="prs-num prs-small">{row.ip_hash?.slice(0, 10)}…</span> },
          ]}
        />
      </ConsolePanel>

      <ConsolePanel
        title="تلاش‌های ورود"
        subtitle="صد تلاش آخر"
        icon="shield"
        loading={state.loading && attempts.length === 0}
        rowCount={attempts.length}
        empty="تلاشی ثبت نشده است."
      >
        <DataTable
          compact
          rows={attempts}
          rowKey={(row) => String(row.id)}
          columns={[
            {
              key: 'outcome',
              header: 'نتیجه',
              render: (row) => (
                <Badge tone={row.outcome === 'SUCCESS' ? 'positive' : row.outcome === 'BAD_PASSWORD' ? 'critical' : 'warning'}>
                  {row.outcome}
                </Badge>
              ),
            },
            { key: 'user', header: 'کاربر', render: (row) => <span className="prs-num prs-small">{row.public_ref ?? 'ناشناس'}</span> },
            { key: 'when', header: 'زمان', render: (row) => <span className="prs-small prs-muted">{formatDateTime(row.occurred_at)}</span> },
            { key: 'agent', header: 'دستگاه', render: (row) => <span className="prs-small">{row.user_agent?.slice(0, 44) ?? 'نامشخص'}</span> },
          ]}
        />
      </ConsolePanel>

      <ConsolePanel
        title="حساب‌های قفل‌شده"
        subtitle="قفل خودکار موقت پس از تلاش‌های پی‌درپی ناموفق"
        icon="lock"
        loading={state.loading && locked.length === 0}
        rowCount={locked.length}
        empty="حساب قفل‌شدهٔ فعالی وجود ندارد."
      >
        <DataTable
          compact
          rows={locked}
          rowKey={(row) => row.id}
          columns={[
            { key: 'ref', header: 'شناسهٔ عمومی', render: (row) => <span className="prs-num prs-small">{row.public_ref}</span> },
            { key: 'name', header: 'نام', render: (row) => <span>{row.full_name_fa}</span> },
            { key: 'role', header: 'نقش', render: (row) => <span className="prs-small">{row.role}</span> },
            { key: 'failed', header: 'تلاش ناموفق', numeric: true, render: (row) => <span className="prs-num">{toPersianDigits(row.failed_logins)}</span> },
            { key: 'until', header: 'قفل تا', render: (row) => <DateCell value={row.locked_until} /> },
          ]}
        />
      </ConsolePanel>

      <p className="prs-small prs-muted">
        نشست جاری شما: {session ? `${session.fullNameFa} (${session.role})` : '—'} — تعلیق حساب‌های قفل‌شده یک
        عمل کارگزاری است و در گزارش حسابرسی ثبت می‌شود؛ تغییر نقش یا بازنشانی گذرواژه همچنان از مسیر تأیید
        دو‌نفره می‌گذرد.
      </p>
    </ConsolePage>
  );
}
