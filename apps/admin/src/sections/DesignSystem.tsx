/**
 * SECTION: design system — tokens, themes and publication.
 *
 * The design plane owns appearance and nothing else. Two rules are visible here:
 *   • locked tokens cannot be edited (they carry meaning: money colours, semantic
 *     states), and the server refuses unknown token keys outright;
 *   • publishing reaches every member, so it is a dual-approved action while drafting
 *     and previewing are free.
 */
import { useMemo, useState } from 'react';
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
  formatDateTime,
  toPersianDigits,
} from '@parsbank/ui';
import { TOKEN_CATEGORIES, compileTheme } from '@parsbank/design-system';
import { adminApi, describeError } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { ConsolePage, ConsolePanel } from '../components/console.tsx';
import { RequestApprovalDialog } from '../components/approval.tsx';
import { useAdminSession } from '../lib/session.tsx';

interface TokenRow {
  key: string;
  category: string;
  value: string;
  value_type: string;
  description_fa: string | null;
  is_locked: boolean;
  group_key: string | null;
  sort_order: number;
}

interface ThemeRow {
  id: string;
  version_number: number;
  name: string;
  status: string;
  token_count: number;
  created_at: string;
  published_at: string | null;
  note_fa: string | null;
  created_by_name: string | null;
}

export function DesignSystemSection() {
  const { session } = useAdminSession();
  const [category, setCategory] = useState('');
  const [tokenDialog, setTokenDialog] = useState<TokenRow | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [publishTarget, setPublishTarget] = useState<ThemeRow | null>(null);
  const [previewTheme, setPreviewTheme] = useState<{ id: string; name: string } | null>(null);

  const tokens = useAsync<{ items: TokenRow[] }>(() => adminApi.get('/admin/design/tokens', { query: { category } }), [category]);
  const themes = useAsync<{ items: ThemeRow[] }>(() => adminApi.get('/admin/design/themes'), []);

  const rows = tokens.data?.items ?? [];
  const tokenMap = useMemo(() => Object.fromEntries(rows.map((row) => [row.key, row.value])), [rows]);
  const compilation = useMemo(() => {
    const compiled = compileTheme(tokenMap);
    return {
      unknownKeys: compiled.unknownKeys,
      error: compiled.unknownKeys.length > 0 ? `کلیدهای ناشناخته: ${compiled.unknownKeys.join('، ')}` : null,
    };
  }, [tokenMap]);

  const themeRows = themes.data?.items ?? [];
  const canDraft = session ? ['DESIGN_ADMIN', 'SUPER_ADMIN'].includes(session.role) : false;

  return (
    <ConsolePage
      title="سیستم طراحی"
      description="رنگ‌ها، فونت‌ها، فاصله‌ها و نشان‌ها به شکل توکن نگه‌داری می‌شوند. طراحی و منطق پولی در این سامانه از هم جدا هستند."
      actions={
        <>
          <Button variant="outline" size="sm" icon="refresh" onClick={() => void Promise.all([tokens.reload(), themes.reload()])}>
            بازخوانی
          </Button>
          <Button variant="primary" size="sm" icon="plus" disabled={!canDraft} onClick={() => setDraftOpen(true)}>
            پیش‌نویس نسخهٔ تازه
          </Button>
        </>
      }
    >
      <section className="prs-grid prs-grid-4">
        <Stat label="توکن‌های ثبت‌شده" value={toPersianDigits(rows.length)} hint={category ? `صافی: ${category}` : 'همهٔ دسته‌ها'} icon="palette" />
        <Stat label="توکن‌های قفل‌شده" value={toPersianDigits(rows.filter((row) => row.is_locked).length)} hint="قفل‌شده‌ها تغییرپذیر نیستند" icon="lock" />
        <Stat label="نسخه‌های ظاهر" value={toPersianDigits(themeRows.length)} hint={`${toPersianDigits(themeRows.filter((row) => row.status === 'PUBLISHED').length)} منتشرشده`} icon="copy" />
        <Stat
          label="وضعیت کامپایل"
          value={compilation.error ? 'ناسازگار' : 'سازگار'}
          hint={compilation.error ?? 'همهٔ کلیدها در فهرست رسمی توکن‌ها هستند'}
          tone={compilation.error ? 'critical' : 'positive'}
          icon="check"
        />
      </section>

      <Alert tone="info" title="تفکیک نقش‌ها در همین صفحه دیده می‌شود">
        دفتر طراحی می‌تواند توکن بسازد، نسخهٔ تازه پیش‌نویس کند و پیش‌نمایش بگیرد. انتشار روی همهٔ کاربران اثر
        می‌گذارد و به همین دلیل یک عمل تأیید دو‌نفره است: مدیر طراحی درخواست می‌دهد و مدیر ارشد تأیید می‌کند.
      </Alert>

      {compilation.error ? <Alert tone="critical" title="کلید ناشناخته در توکن‌ها">{compilation.error}</Alert> : null}

      <ConsolePanel title="صافی دسته" icon="search">
        <Field label="دستهٔ توکن">
          <Select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">همه</option>
            {TOKEN_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
      </ConsolePanel>

      <ConsolePanel
        title="توکن‌های طراحی"
        subtitle="مقدار هر توکن، همان چیزی است که ظاهر سامانه را می‌سازد"
        icon="palette"
        loading={tokens.loading && rows.length === 0}
        rowCount={rows.length}
        empty="توکنی ثبت نشده است."
      >
        <DataTable
          rows={rows}
          rowKey={(row) => row.key}
          compact
          columns={[
            { key: 'key', header: 'کلید', render: (row) => <span className="prs-num prs-small" dir="ltr">{row.key}</span> },
            { key: 'category', header: 'دسته', render: (row) => <span className="prs-small">{row.category}</span> },
            {
              key: 'value',
              header: 'مقدار',
              render: (row) => (
                <span className="prs-row-2">
                  {row.category.includes('color') ? (
                    <span
                      aria-hidden
                      style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 4, border: '1px solid var(--prs-color-border)', background: row.value }}
                    />
                  ) : null}
                  <span className="prs-num prs-small" dir="ltr">
                    {row.value}
                  </span>
                </span>
              ),
            },
            { key: 'type', header: 'نوع', render: (row) => <span className="prs-small">{row.value_type}</span> },
            { key: 'desc', header: 'توضیح', render: (row) => <span className="prs-small prs-muted">{row.description_fa ?? '—'}</span> },
            { key: 'locked', header: 'قفل', render: (row) => (row.is_locked ? <Badge tone="warning">قفل‌شده</Badge> : <Badge tone="muted">آزاد</Badge>) },
            {
              key: 'actions',
              header: '',
              render: (row) => (
                <Button size="sm" variant="outline" disabled={row.is_locked} onClick={() => setTokenDialog(row)}>
                  ویرایش
                </Button>
              ),
            },
          ]}
        />
      </ConsolePanel>

      <ConsolePanel
        title="نسخه‌های ظاهر"
        subtitle="پیش‌نویس ← پیش‌نمایش ← انتشار ← بازگردانی"
        icon="copy"
        loading={themes.loading && themeRows.length === 0}
        rowCount={themeRows.length}
        empty="نسخه‌ای ثبت نشده است."
      >
        <DataTable
          compact
          rows={themeRows}
          rowKey={(row) => row.id}
          columns={[
            { key: 'version', header: 'نسخه', render: (row) => <span className="prs-num">{toPersianDigits(row.version_number)}</span> },
            { key: 'name', header: 'نام', render: (row) => <span>{row.name}</span> },
            {
              key: 'status',
              header: 'وضعیت',
              render: (row) => (
                <Badge tone={row.status === 'PUBLISHED' ? 'positive' : row.status === 'DRAFT' ? 'warning' : 'muted'}>
                  {row.status === 'PUBLISHED' ? 'منتشرشده' : row.status === 'DRAFT' ? 'پیش‌نویس' : row.status}
                </Badge>
              ),
            },
            { key: 'tokens', header: 'تعداد توکن', numeric: true, render: (row) => <span className="prs-num">{toPersianDigits(row.token_count)}</span> },
            { key: 'by', header: 'سازنده', render: (row) => <span className="prs-small">{row.created_by_name ?? '—'}</span> },
            { key: 'created', header: 'زمان ساخت', render: (row) => <span className="prs-small prs-muted">{formatDateTime(row.created_at)}</span> },
            { key: 'published', header: 'انتشار', render: (row) => <span className="prs-small prs-muted">{row.published_at ? formatDateTime(row.published_at) : '—'}</span> },
            {
              key: 'actions',
              header: '',
              render: (row) => (
                <span className="prs-row-2">
                  <Button size="sm" variant="quiet" onClick={() => setPreviewTheme({ id: row.id, name: row.name })}>
                    پیش‌نمایش
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPublishTarget(row)}>
                    انتشار
                  </Button>
                </span>
              ),
            },
          ]}
        />
      </ConsolePanel>

      <TokenEditor
        token={tokenDialog}
        onClose={() => setTokenDialog(null)}
        onSaved={() => {
          setTokenDialog(null);
          void tokens.reload();
        }}
      />

      <DraftThemeDialog
        open={draftOpen}
        onClose={() => {
          setDraftOpen(false);
          void themes.reload();
        }}
      />

      <ThemePreviewModal
        target={previewTheme}
        onClose={() => setPreviewTheme(null)}
      />

      <RequestApprovalDialog
        open={Boolean(publishTarget)}
        initialType="THEME_PUBLISH"
        lockedPayload={publishTarget ? { themeId: publishTarget.id } : undefined}
        onClose={() => {
          setPublishTarget(null);
          void themes.reload();
        }}
      />
    </ConsolePage>
  );
}

function TokenEditor({ token, onClose, onSaved }: { token: TokenRow | null; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (token && loadedFor !== token.key) {
    setLoadedFor(token.key);
    setValue(token.value);
    setError(null);
    setMessage(null);
  }

  const save = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.post('/admin/design/tokens', { updates: [{ key: token.key, value }] });
      setMessage('توکن ذخیره شد. برای دیدن اثر آن روی همهٔ کاربران، یک نسخهٔ ظاهر بسازید و منتشر کنید.');
      onSaved();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(token)}
      title={token ? `ویرایش توکن ${token.key}` : ''}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            بستن
          </Button>
          <Button variant="primary" loading={busy} disabled={value.length === 0} onClick={() => void save()}>
            ذخیرهٔ مقدار
          </Button>
        </>
      }
    >
      <div className="prs-stack-4">
        <dl className="prs-kv">
          <div style={{ display: 'contents' }}>
            <dt>کلید</dt>
            <dd className="prs-num" dir="ltr">
              {token?.key}
            </dd>
          </div>
          <div style={{ display: 'contents' }}>
            <dt>دسته</dt>
            <dd>{token?.category}</dd>
          </div>
          <div style={{ display: 'contents' }}>
            <dt>نوع مقدار</dt>
            <dd>{token?.value_type}</dd>
          </div>
        </dl>
        <Field label="مقدار تازه" hint={token?.description_fa ?? undefined}>
          <TextInput dir="ltr" value={value} onChange={(event) => setValue(event.target.value)} />
        </Field>
        <Alert tone="info" title="تغییر توکن، پول را جابه‌جا نمی‌کند">
          این مقدار فقط ظاهر سامانه را عوض می‌کند. هیچ توکنی به موجودی، عرضه، پشتوانه یا نرخ مرجع وصل نیست و
          نقش طراحی به آن‌ها دسترسی ندارد.
        </Alert>
        {error ? <Alert tone="critical" title="ذخیره نشد">{error}</Alert> : null}
        {message ? <Alert tone="success">{message}</Alert> : null}
      </div>
    </Modal>
  );
}

function DraftThemeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('نسخهٔ تازهٔ ظاهر');
  const [noteFa, setNoteFa] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ThemeRow | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const value = await adminApi.post<ThemeRow>('/admin/design/themes', { name, noteFa: noteFa || null });
      setCreated(value);
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
      title="پیش‌نویس نسخهٔ ظاهر"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            بستن
          </Button>
          <Button variant="primary" loading={busy} disabled={name.length < 2} onClick={() => void submit()}>
            ساخت پیش‌نویس
          </Button>
        </>
      }
    >
      <div className="prs-stack-4">
        <Field label="نام نسخه">
          <TextInput value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="یادداشت">
          <TextArea rows={3} value={noteFa} onChange={(event) => setNoteFa(event.target.value)} />
        </Field>
        <Alert tone="info" title="پیش‌نویس هیچ اثری روی کاربران ندارد">
          تا زمانی که انتشار تأیید نشود، کاربران همان نسخهٔ پیشین را می‌بینند.
        </Alert>
        {error ? <Alert tone="critical" title="ساخت پیش‌نویس انجام نشد">{error}</Alert> : null}
        {created ? (
          <Alert tone="success" title="پیش‌نویس ساخته شد">
            نسخهٔ {toPersianDigits(created.version_number)} با {toPersianDigits(created.token_count)} توکن.
          </Alert>
        ) : null}
      </div>
    </Modal>
  );
}

function ThemePreviewModal({ target, onClose }: { target: { id: string; name: string } | null; onClose: () => void }) {
  const preview = useAsync<{ name?: string; versionNumber?: number; tokens?: Record<string, string> } | null>(
    () => (target ? adminApi.get(`/admin/design/themes/${target.id}/preview`) : Promise.resolve(null)),
    [target?.id],
  );

  const tokens = preview.data?.tokens ?? {};
  const entries = Object.entries(tokens).slice(0, 60);

  return (
    <Modal
      open={Boolean(target)}
      title={target ? `پیش‌نمایش ${target.name}` : ''}
      onClose={onClose}
      footer={
        <Button variant="outline" onClick={onClose}>
          بستن
        </Button>
      }
    >
      {preview.error ? (
        <Alert tone="warning" title="پیش‌نمایش در دسترس نیست">
          {preview.error} — پیش‌نمایش نیاز به اختیار `cms.theme.preview` دارد که در نقش‌های تأییدکننده دیده نمی‌شود.
        </Alert>
      ) : (
        <div className="prs-stack-4">
          <p className="prs-small prs-muted">
            نمونهٔ زندهٔ رنگ‌ها و اندازه‌های نسخهٔ پیش‌نویس. کاربران تا زمان انتشار، این مقادیر را نمی‌بینند.
          </p>
          <div className="prs-stack-3">
            {entries
              .filter(([key]) => key.includes('color'))
              .slice(0, 12)
              .map(([key, value]) => (
                <div key={key} className="prs-row prs-between">
                  <span className="prs-num prs-small" dir="ltr">
                    {key}
                  </span>
                  <span className="prs-row-2">
                    <span style={{ display: 'inline-block', width: 18, height: 18, borderRadius: 4, background: value, border: '1px solid var(--prs-color-border)' }} />
                    <span className="prs-num prs-small" dir="ltr">
                      {value}
                    </span>
                  </span>
                </div>
              ))}
          </div>
          <p className="prs-small prs-muted">
            {toPersianDigits(Object.keys(tokens).length)} توکن در این نسخه هست.
          </p>
        </div>
      )}
    </Modal>
  );
}
