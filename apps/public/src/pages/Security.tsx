/**
 * Security — sessions, password rotation and the audit trail of the account.
 *
 * Two ideas the rest of the product depends on are visible here:
 *   • being signed in is not the same as being allowed to move money — payment
 *     credentials are separate and short-lived;
 *   • every sensitive action leaves a row in the audit log, and the account holder
 *     can see their own slice of it.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Field,
  Loading,
  Panel,
  PanelBody,
  Stat,
  TextInput,
  formatDateTime,
  formatRelative,
  labelFa,
  statusTone,
} from '@parsbank/ui';
import { api, describeError } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { useSession } from '../lib/session.tsx';

interface SecurityPayload {
  currentSessionId: string;
  sessions: Array<{
    id: string;
    audience: string;
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string;
    revoked: boolean;
    current: boolean;
    device: string | null;
    location: string | null;
  }>;
  loginAttempts: Array<{ outcome: string; occurred_at: string; user_agent: string | null }>;
  mfaEnabled: boolean;
  passwordChangedAt: string | null;
}

export function Security() {
  const { session } = useSession();
  const state = useAsync<SecurityPayload>(() => api.get<SecurityPayload>('/me/security'), []);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'critical' | 'info'; text: string } | null>(null);

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api.post('/auth/password/change', { currentPassword, newPassword });
      setMessage({ tone: 'success', text: 'گذرواژه تغییر کرد. نشست‌های دیگر با گذرواژهٔ پیشین باطل می‌شوند.' });
      setCurrentPassword('');
      setNewPassword('');
      await state.reload();
    } catch (caught) {
      setMessage({ tone: 'critical', text: describeError(caught) });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (sessionId: string) => {
    setMessage(null);
    try {
      await api.post(`/me/security/sessions/${sessionId}/revoke`, {});
      setMessage({ tone: 'info', text: 'نشست باطل شد.' });
      await state.reload();
    } catch (caught) {
      setMessage({ tone: 'critical', text: describeError(caught) });
    }
  };

  const reactivate = async () => {
    setMessage(null);
    try {
      const result = await api.post<{ authorizationId: string; expiresAt: string }>('/auth/transaction-authorization', {
        walletRef: '',
        credential: { kind: 'PASSWORD', value: currentPassword },
        maxAmountMinor: 1,
      });
      setMessage({
        tone: 'success',
        text: `مجوز آزمایشی صادر شد (تا ${new Date(result.expiresAt).toLocaleTimeString('fa-IR')}). مجوز پرداخت جدا از نشست است و خودش منقضی می‌شود.`,
      });
    } catch (caught) {
      setMessage({ tone: 'critical', text: describeError(caught) });
    }
  };

  return (
    <div className="prs-container prs-container-base prs-stack-6" style={{ maxWidth: 'var(--prs-container-base)' }}>
      <div className="prs-row prs-between prs-wrap">
        <div>
          <h1>امنیت حساب</h1>
          <p className="prs-small prs-muted">
            نشست‌های فعال، گذرواژه و تاریخچهٔ تلاش‌های ورود. حرکت پول مجوز جداگانه دارد و به نشست بسنده
            نمی‌کند.
          </p>
        </div>
        <Link className="prs-btn prs-btn--sm prs-btn--outline" to="/dashboard">
          نمای حساب
        </Link>
      </div>

      {message ? <Alert tone={message.tone === 'success' ? 'success' : message.tone === 'critical' ? 'critical' : 'info'}>{message.text}</Alert> : null}

      {state.loading && !state.data ? (
        <Loading label="در حال خواندن وضعیت امنیتی…" />
      ) : state.data ? (
        <>
          <section className="prs-grid prs-grid-4">
            <Stat
              label="ورود دو مرحله‌ای"
              value={state.data.mfaEnabled ? 'فعال' : 'غیرفعال'}
              hint={state.data.mfaEnabled ? 'کد یک‌بارمصرف در پرداخت‌ها خواسته می‌شود' : 'برای پرداخت‌های بزرگ توصیه می‌شود'}
              tone={state.data.mfaEnabled ? 'positive' : 'warning'}
              icon="shield"
            />
            <Stat label="نشست‌های فعال" value={`${state.data.sessions.filter((row) => !row.revoked).length}`} hint="از جمله همین دستگاه" icon="list" />
            <Stat
              label="آخرین تغییر گذرواژه"
              value={state.data.passwordChangedAt ? formatRelative(state.data.passwordChangedAt) : '—'}
              hint={state.data.passwordChangedAt ? formatDateTime(state.data.passwordChangedAt) : 'ثبت نشده'}
              icon="key"
            />
            <Stat
              label="نقش نشست"
              value={session?.role ?? '—'}
              hint={session?.mfaSatisfied ? 'عامل دوم تأییدشده' : 'عامل دوم تأیید نشده'}
              icon="user"
            />
          </section>

          <Panel title="نشست‌های فعال" subtitle="هر نشست به یک مرورگر یا دستگاه گره خورده است" icon="list">
            <PanelBody tight>
              <DataTable
                rows={state.data.sessions}
                rowKey={(row) => row.id}
                compact
                empty={<div className="prs-empty">نشستی ثبت نشده است.</div>}
                columns={[
                  {
                    key: 'audience',
                    header: 'نوع',
                    render: (row) => (
                      <span>
                        {row.audience === 'ADMIN' ? 'مدیریتی' : 'کاربری'} {row.current ? <Badge tone="info">همین نشست</Badge> : null}
                      </span>
                    ),
                  },
                  { key: 'device', header: 'دستگاه', render: (row) => <span className="prs-small">{row.device ?? 'نامشخص'}</span> },
                  { key: 'created', header: 'شروع', render: (row) => <span className="prs-small prs-muted">{formatDateTime(row.createdAt)}</span> },
                  { key: 'seen', header: 'آخرین فعالیت', render: (row) => <span className="prs-small prs-muted">{formatRelative(row.lastSeenAt)}</span> },
                  { key: 'expires', header: 'انقضا', render: (row) => <span className="prs-small prs-muted">{formatDateTime(row.expiresAt)}</span> },
                  {
                    key: 'status',
                    header: 'وضعیت',
                    render: (row) => <Badge tone={row.revoked ? 'muted' : 'positive'}>{row.revoked ? 'باطل‌شده' : 'فعال'}</Badge>,
                  },
                  {
                    key: 'action',
                    header: '',
                    render: (row) =>
                      row.revoked ? null : (
                        <Button size="sm" variant="outline" onClick={() => void revoke(row.id)} disabled={row.current && false}>
                          باطل کردن
                        </Button>
                      ),
                  },
                ]}
              />
            </PanelBody>
          </Panel>

          <section className="prs-split">
            <Panel title="تغییر گذرواژه" subtitle="حداقل ۱۰ نویسه، شامل حرف و رقم" icon="key">
              <PanelBody>
                <form className="prs-stack-4" onSubmit={changePassword}>
                  <Field label="گذرواژهٔ فعلی">
                    <TextInput type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
                  </Field>
                  <Field label="گذرواژهٔ تازه" hint="گذرواژه هرگز به شکل متن ساده ذخیره نمی‌شود.">
                    <TextInput type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                  </Field>
                  <div className="prs-row prs-wrap">
                    <Button type="submit" variant="primary" loading={busy} disabled={currentPassword.length < 1 || newPassword.length < 10}>
                      ثبت گذرواژهٔ تازه
                    </Button>
                    <Button type="button" variant="outline" onClick={() => void reactivate()} disabled={currentPassword.length < 1}>
                      آزمایش صدور مجوز پرداخت
                    </Button>
                  </div>
                </form>
              </PanelBody>
            </Panel>

            <Panel title="تلاش‌های ورود" subtitle="۲۰ رویداد آخر همین حساب" icon="history">
              <PanelBody tight>
                <DataTable
                  rows={state.data.loginAttempts}
                  rowKey={(row, index) => `${row.occurred_at}-${index}`}
                  compact
                  empty={<div className="prs-empty">تلاشی ثبت نشده است.</div>}
                  columns={[
                    {
                      key: 'outcome',
                      header: 'نتیجه',
                      render: (row) => (
                        <Badge tone={row.outcome === 'SUCCESS' ? 'positive' : row.outcome === 'BAD_PASSWORD' ? 'critical' : 'warning'}>
                          {labelFa(row.outcome)}
                        </Badge>
                      ),
                    },
                    { key: 'when', header: 'زمان', render: (row) => <span className="prs-small prs-muted">{formatDateTime(row.occurred_at)}</span> },
                    { key: 'agent', header: 'دستگاه', render: (row) => <span className="prs-small">{row.user_agent?.slice(0, 48) ?? 'نامشخص'}</span> },
                  ]}
                />
              </PanelBody>
            </Panel>
          </section>

          <Alert tone="info" title="چرا رمز کارت اینجا نیست؟">
            رمز پرداخت کارت در صفحهٔ <Link to="/card">کارت</Link> و تنها با داشتن رمز فعلی تغییر می‌کند.
            گذرواژهٔ حساب و رمز کارت دو چیز جداگانه‌اند و هیچ‌کدام جای دیگری را نمی‌گیرند.
          </Alert>
        </>
      ) : (
        <Alert tone="critical" title="وضعیت امنیتی خوانده نشد">{state.error}</Alert>
      )}
    </div>
  );
}
