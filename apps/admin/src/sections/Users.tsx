/**
 * SECTION: users — identities, roles and account state.
 *
 * Three rules shape this screen:
 *   • a role change never happens here — it files an ADMIN_ROLE_CHANGE request for a
 *     second administrator;
 *   • a suspension is immediate (it protects the institution) but always carries a
 *     written reason that lands in the audit log;
 *   • the balances shown are the same ledger figures the member sees, not a copy.
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Field,
  Modal,
  Panel,
  PanelBody,
  Select,
  TextArea,
  TextInput,
  formatDateTime,
  formatPrs,
  labelFa,
  roleFa,
  statusTone,
  toPersianDigits,
} from '@parsbank/ui';
import { useAsync, useDebounced } from '../lib/hooks.ts';
import { adminApi, describeError } from '../lib/api.ts';
import { ConsolePage, ConsolePanel, DateCell, Pager, StatusCell } from '../components/console.tsx';
import { RequestApprovalDialog } from '../components/approval.tsx';
import { useAdminSession } from '../lib/session.tsx';

interface ProfileRow {
  id: string;
  public_ref: string;
  full_name_fa: string;
  full_name_en: string;
  role: string;
  status: string;
  email: string | null;
  phone: string | null;
  mfa_enabled: boolean;
  last_login_at: string | null;
  created_at: string;
  total_balance_minor: string;
  card_count: string;
}

interface ProfileDetail {
  profile: ProfileRow;
  wallets: Array<{ id: string; public_ref: string; label_fa: string; status: string; balance_minor: string }>;
  cards: Array<{ id: string; card_number: string; status: string; expiry_month: number; expiry_year: number; cardholder_name_fa: string }>;
  recentTransactions: Array<{ reference: string; type: string; status: string; amount_minor: string; created_at: string }>;
  activity: Array<{ id: number; occurred_at: string; action: string; severity: string }>;
}

const STATUSES = ['', 'PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED'];
const ROLES = ['', 'USER', 'DESIGN_ADMIN', 'AUDITOR', 'TREASURY_OFFICER', 'SUPER_ADMIN'];

export function Users() {
  const { session } = useAdminSession();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [roleDialog, setRoleDialog] = useState<ProfileRow | null>(null);
  const [statusDialog, setStatusDialog] = useState<ProfileRow | null>(null);

  const list = useAsync<{ items: ProfileRow[]; total: number }>(
    () => adminApi.get('/admin/users', { query: { search: debounced, status, role, page, pageSize: 25 } }),
    [debounced, status, role, page],
  );

  const detail = useAsync<ProfileDetail | null>(
    () => (selectedId ? adminApi.get<ProfileDetail>(`/admin/users/${selectedId}`) : Promise.resolve(null)),
    [selectedId],
  );

  const rows = list.data?.items ?? [];

  return (
    <ConsolePage
      title="کاربران و نقش‌ها"
      description="هر کاربر یک پروفایل، یک یا چند کیف پول و نقش صریح دارد. نقش‌ها یکدیگر را به ارث نمی‌برند."
      actions={
        <>
          <Button variant="outline" size="sm" icon="refresh" onClick={() => void list.reload()}>
            به‌روزرسانی
          </Button>
          <Button variant="primary" size="sm" icon="plus" onClick={() => setRegisterOpen(true)}>
            ثبت کاربر تازه
          </Button>
        </>
      }
    >
      <ConsolePanel title="صافی‌ها" icon="search">
        <div className="prs-grid prs-grid-3">
          <Field label="جست‌وجو" hint="نام، شناسهٔ عمومی یا ایمیل">
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
          <Field label="نقش">
            <Select
              value={role}
              onChange={(event) => {
                setPage(1);
                setRole(event.target.value);
              }}
            >
              {ROLES.map((value) => (
                <option key={value || 'all'} value={value}>
                  {value ? roleFa(value) : 'همه'}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </ConsolePanel>

      {list.error ? <Alert tone="critical" title="فهرست کاربران خوانده نشد">{list.error}</Alert> : null}

      <ConsolePanel
        title="کاربران"
        subtitle={list.data ? `${toPersianDigits(list.data.total)} پروفایل` : undefined}
        icon="user"
        loading={list.loading && rows.length === 0}
        rowCount={rows.length}
        empty="با این صافی‌ها کاربری پیدا نشد."
      >
        <DataTable
          compact
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            { key: 'ref', header: 'شناسهٔ عمومی', render: (row) => <span className="prs-num prs-small">{row.public_ref}</span> },
            { key: 'name', header: 'نام', render: (row) => <span>{row.full_name_fa}</span> },
            { key: 'role', header: 'نقش', render: (row) => <Badge tone="info">{roleFa(row.role)}</Badge> },
            { key: 'status', header: 'وضعیت', render: (row) => <StatusCell value={row.status} /> },
            {
              key: 'balance',
              header: 'مجموع موجودی',
              numeric: true,
              render: (row) => <span className="prs-num">{formatPrs(row.total_balance_minor, true)}</span>,
            },
            { key: 'cards', header: 'کارت فعال', numeric: true, render: (row) => <span className="prs-num">{toPersianDigits(row.card_count)}</span> },
            { key: 'mfa', header: 'عامل دوم', render: (row) => (row.mfa_enabled ? <Badge tone="positive">فعال</Badge> : <Badge tone="muted">غیرفعال</Badge>) },
            { key: 'last', header: 'آخرین ورود', render: (row) => <DateCell value={row.last_login_at} relative /> },
            {
              key: 'actions',
              header: '',
              render: (row) => (
                <span className="prs-row-2">
                  <Button size="sm" variant="quiet" onClick={() => setSelectedId(row.id)}>
                    پرونده
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRoleDialog(row)}>
                    نقش
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setStatusDialog(row)}>
                    وضعیت
                  </Button>
                </span>
              ),
            },
          ]}
        />
        {list.data ? (
          <Pager page={page} pageSize={25} total={list.data.total} onPage={setPage} />
        ) : null}
      </ConsolePanel>

      <Modal
        open={Boolean(selectedId)}
        title="پروندهٔ کاربر"
        onClose={() => setSelectedId(null)}
        footer={
          <Button variant="outline" onClick={() => setSelectedId(null)}>
            بستن
          </Button>
        }
      >
        {detail.loading ? (
          <p className="prs-small prs-muted">در حال خواندن پرونده…</p>
        ) : detail.data ? (
          <div className="prs-stack-4">
            <dl className="prs-kv">
              <div style={{ display: 'contents' }}>
                <dt>نام</dt>
                <dd>{detail.data.profile.full_name_fa}</dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>شناسهٔ عمومی</dt>
                <dd className="prs-num">{detail.data.profile.public_ref}</dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>نقش</dt>
                <dd>{roleFa(detail.data.profile.role)}</dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>وضعیت</dt>
                <dd>
                  <Badge tone={statusTone(detail.data.profile.status)}>{labelFa(detail.data.profile.status)}</Badge>
                </dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>ایمیل</dt>
                <dd>{detail.data.profile.email ?? '—'}</dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>عضویت</dt>
                <dd>{formatDateTime(detail.data.profile.created_at)}</dd>
              </div>
            </dl>

            <div>
              <div className="prs-small prs-muted">کیف پول‌ها</div>
              {detail.data.wallets.length === 0 ? (
                <div className="prs-empty">کیف پولی صادر نشده است.</div>
              ) : (
                detail.data.wallets.map((wallet) => (
                  <div key={wallet.id} className="prs-row prs-between" style={{ paddingBlock: 6 }}>
                    <span>
                      {wallet.label_fa} <span className="prs-num prs-small prs-muted">{wallet.public_ref}</span>
                    </span>
                    <span className="prs-num">{formatPrs(wallet.balance_minor, true)}</span>
                  </div>
                ))
              )}
            </div>

            <div>
              <div className="prs-small prs-muted">کارت‌ها</div>
              {detail.data.cards.length === 0 ? (
                <div className="prs-empty">کارتی صادر نشده است.</div>
              ) : (
                detail.data.cards.map((card) => (
                  <div key={card.id} className="prs-row prs-between" style={{ paddingBlock: 6 }}>
                    <span className="prs-num" dir="ltr">
                      {card.card_number}
                    </span>
                    <Badge tone={statusTone(card.status)}>{labelFa(card.status)}</Badge>
                  </div>
                ))
              )}
            </div>

            <div>
              <div className="prs-small prs-muted">آخرین فعالیت‌ها</div>
              <DataTable
                compact
                rows={detail.data.activity.slice(0, 12)}
                rowKey={(row) => String(row.id)}
                empty={<div className="prs-empty">فعالیتی ثبت نشده است.</div>}
                columns={[
                  { key: 'action', header: 'عمل', render: (row) => <span className="prs-small">{row.action}</span> },
                  { key: 'severity', header: 'شدت', render: (row) => <StatusCell value={row.severity} /> },
                  { key: 'when', header: 'زمان', render: (row) => <DateCell value={row.occurred_at} relative /> },
                ]}
              />
            </div>
          </div>
        ) : (
          <Alert tone="critical" title="پرونده خوانده نشد">{detail.error}</Alert>
        )}
      </Modal>

      <RegisterDialog
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onDone={() => {
          setRegisterOpen(false);
          void list.reload();
        }}
        selfProfileId={session?.profileId ?? null}
      />

      <RoleChangeDialog profile={roleDialog} onClose={() => setRoleDialog(null)} />
      <StatusChangeDialog
        profile={statusDialog}
        onClose={() => setStatusDialog(null)}
        onDone={() => {
          setStatusDialog(null);
          void list.reload();
        }}
      />
    </ConsolePage>
  );
}

function RegisterDialog({
  open,
  onClose,
  onDone,
  selfProfileId,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  selfProfileId: string | null;
}) {
  const [form, setForm] = useState({ fullNameFa: '', fullNameEn: '', email: '', password: '', role: 'USER' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ publicRef?: string } | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await adminApi.post<{ publicRef?: string }>('/admin/users', {
        fullNameFa: form.fullNameFa,
        fullNameEn: form.fullNameEn,
        email: form.email || null,
        password: form.password,
        role: form.role,
      });
      setCreated(result);
      onDone();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="ثبت کاربر تازه"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            بستن
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={form.fullNameFa.length < 3 || form.fullNameEn.length < 3 || form.password.length < 10}
            onClick={() => void submit()}
          >
            ثبت کاربر
          </Button>
        </>
      }
    >
      <div className="prs-stack-4">
        <Alert tone="info" title="این عمل دو‌نفره نیست، ولی ثبت می‌شود">
          ساخت پروفایل یک عمل کارگزاری است. نقش اولیه کاربر عمداً ساده نگه داشته می‌شود؛ ارتقا به نقش‌های
          مدیریتی از مسیر درخواست تأیید انجام می‌گیرد.
        </Alert>
        <Field label="نام و نام خانوادگی (فارسی)">
          <TextInput value={form.fullNameFa} onChange={(event) => setForm({ ...form, fullNameFa: event.target.value })} />
        </Field>
        <Field label="نام (لاتین)">
          <TextInput dir="ltr" value={form.fullNameEn} onChange={(event) => setForm({ ...form, fullNameEn: event.target.value })} />
        </Field>
        <Field label="ایمیل (اختیاری)">
          <TextInput dir="ltr" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        </Field>
        <Field label="گذرواژهٔ نخستین" hint="حداقل ۱۰ نویسه، شامل حرف و رقم. به شکل درهم‌ساخته ذخیره می‌شود.">
          <TextInput type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
        </Field>
        <Field label="نقش" hint="نقش‌های مدیریتی باید بعداً با تأیید دوم اعطا شوند.">
          <Select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
            <option value="USER">عضو عادی</option>
          </Select>
        </Field>
        {error ? <Alert tone="critical" title="ثبت انجام نشد">{error}</Alert> : null}
        {created ? (
          <Alert tone="success" title="کاربر ثبت شد">
            شناسهٔ عمومی: <span className="prs-num">{created.publicRef ?? '—'}</span> — کیف پول اصلی نیز ساخته شد.
          </Alert>
        ) : null}
      </div>
    </Modal>
  );
}

function RoleChangeDialog({ profile, onClose }: { profile: ProfileRow | null; onClose: () => void }) {
  const [role, setRole] = useState('USER');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filedRef, setFiledRef] = useState<string | null>(null);

  const submit = async () => {
    if (!profile) return;
    setBusy(true);
    setError(null);
    try {
      const result = await adminApi.post<{ actionRef: string }>(`/admin/users/${profile.id}/role`, { role, reason });
      setFiledRef(result.actionRef ?? 'ثبت شد');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(profile)}
      title="درخواست تغییر نقش"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            بستن
          </Button>
          <Button variant="primary" loading={busy} disabled={reason.trim().length < 8} onClick={() => void submit()}>
            ثبت درخواست
          </Button>
        </>
      }
    >
      <div className="prs-stack-4">
        <Alert tone="warning" title="تغییر نقش یک عملیات حاکمیتی است">
          درخواست شما برای مدیر دوم ارسال می‌شود و تا تأیید او هیچ تغییری رخ نمی‌دهد. خودتان نمی‌توانید
          درخواست خودتان را تأیید کنید.
        </Alert>
        <dl className="prs-kv">
          <div style={{ display: 'contents' }}>
            <dt>کاربر</dt>
            <dd>
              {profile?.full_name_fa} <span className="prs-num prs-small prs-muted">{profile?.public_ref}</span>
            </dd>
          </div>
          <div style={{ display: 'contents' }}>
            <dt>نقش کنونی</dt>
            <dd>{roleFa(profile?.role)}</dd>
          </div>
        </dl>
        <Field label="نقش تازه">
          <Select value={role} onChange={(event) => setRole(event.target.value)}>
            {['USER', 'DESIGN_ADMIN', 'AUDITOR', 'TREASURY_OFFICER', 'SUPER_ADMIN'].map((value) => (
              <option key={value} value={value}>
                {roleFa(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="دلیل" hint="دست‌کم ۸ نویسه؛ در گزارش حسابرسی ثبت می‌شود.">
          <TextArea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        {error ? <Alert tone="critical" title="درخواست ثبت نشد">{error}</Alert> : null}
        {filedRef ? (
          <Alert tone="success" title="درخواست ثبت شد">
            شناسهٔ درخواست <span className="prs-num">{filedRef}</span>
          </Alert>
        ) : null}
      </div>
    </Modal>
  );
}

function StatusChangeDialog({ profile, onClose, onDone }: { profile: ProfileRow | null; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState('SUSPENDED');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!profile) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.post(`/admin/users/${profile.id}/status`, { status, reason });
      onDone();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(profile)}
      title="تغییر وضعیت حساب"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            بستن
          </Button>
          <Button variant="danger" loading={busy} disabled={reason.trim().length < 4} onClick={() => void submit()}>
            اعمال وضعیت
          </Button>
        </>
      }
    >
      <div className="prs-stack-4">
        <Alert tone="warning" title="این عمل بی‌درنگ اثر می‌گذارد">
          تعلیق، دسترسی کاربر به همهٔ سامانه را می‌بندد؛ دارایی در دفتر کل دست‌نخورده می‌ماند و هیچ ردیفی
          حذف نمی‌شود. دلیل شما در گزارش حسابرسی ثبت خواهد شد.
        </Alert>
        <Field label="وضعیت تازه">
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            {['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED'].map((value) => (
              <option key={value} value={value}>
                {labelFa(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="دلیل" hint="الزامی و ثبت‌شدنی.">
          <TextArea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        {error ? <Alert tone="critical" title="تغییر وضعیت انجام نشد">{error}</Alert> : null}
      </div>
    </Modal>
  );
}
