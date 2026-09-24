/**
 * SECTION: feature flags and settings — the control surface.
 *
 * Two lists, two risk classes. Ordinary flags and settings can be changed directly
 * and are audited. Critical ones are refused inline with DUAL_APPROVAL_REQUIRED and
 * must travel through the approvals queue — the console shows that path rather than
 * hiding the refusal.
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
  Tabs,
  TextInput,
  formatDateTime,
  labelFa,
  toPersianDigits,
} from '@parsbank/ui';
import { adminApi, describeError } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { ConsolePage, ConsolePanel } from '../components/console.tsx';
import { RequestApprovalDialog } from '../components/approval.tsx';

interface SettingRow {
  key: string;
  value: unknown;
  value_type: string;
  category: string;
  label_fa: string;
  description_fa: string | null;
  is_critical: boolean;
  updated_at: string;
  updated_by_name: string | null;
}

interface FlagRow {
  key: string;
  enabled: boolean;
  scope: string;
  rollout_percent: number;
  description_fa: string | null;
  requires_dual_approval: boolean;
  updated_at: string;
}

export function FeatureFlags() {
  const [tab, setTab] = useState('flags');
  const [settingTarget, setSettingTarget] = useState<SettingRow | null>(null);
  const [criticalTarget, setCriticalTarget] = useState<{ kind: 'setting' | 'flag'; row: SettingRow | FlagRow } | null>(null);

  const state = useAsync<{ settings: SettingRow[]; flags: FlagRow[] }>(() => adminApi.get('/admin/settings'), []);
  const settings = state.data?.settings ?? [];
  const flags = state.data?.flags ?? [];

  const toggleFlag = async (row: FlagRow, enabled: boolean) => {
    try {
      await adminApi.post('/admin/feature-flags', { key: row.key, enabled });
      await state.reload();
    } catch (caught) {
      // A critical flag cannot be flipped from here: offer the governed route.
      if (row.requires_dual_approval) {
        setCriticalTarget({ kind: 'flag', row: { ...row, enabled } });
        return;
      }
      window.alert(describeError(caught));
    }
  };

  return (
    <ConsolePage
      title="پرچم‌ها و تنظیمات"
      description="تنظیمات غیرحیاتی مستقیم و حسابرسی‌شده تغییر می‌کنند؛ تنظیمات و پرچم‌های حیاتی فقط از مسیر تأیید دو‌نفره."
      actions={
        <Button variant="outline" size="sm" icon="refresh" onClick={() => void state.reload()}>
          بازخوانی
        </Button>
      }
    >
      <section className="prs-grid prs-grid-4">
        <Stat label="تنظیمات" value={toPersianDigits(settings.length)} hint={`${toPersianDigits(settings.filter((row) => row.is_critical).length)} حیاتی`} icon="settings" />
        <Stat label="پرچم‌ها" value={toPersianDigits(flags.length)} hint={`${toPersianDigits(flags.filter((row) => row.enabled).length)} روشن`} icon="flag" />
        <Stat
          label="پرچم‌های نیازمند تأیید دوم"
          value={toPersianDigits(flags.filter((row) => row.requires_dual_approval).length)}
          hint="تغییر این‌ها فقط با دو امضا"
          icon="seal"
        />
        <Stat
          label="تنظیمات پولی"
          value={toPersianDigits(settings.filter((row) => row.category === 'POLICY' || row.key.startsWith('policy.')).length)}
          hint="سقف عرضه، حد پوشش، ارزش اسمی، کنترل‌های مالی"
          icon="treasury"
        />
      </section>

      <Alert tone="info" title="چرا برخی تغییرها اینجا انجام نمی‌شوند؟">
        پرچم‌ها و تنظیمات حیاتی می‌توانند گردش پول را متوقف یا کنترل‌ها را خاموش کنند. به همین دلیل سرویس،
        درخواست مستقیم را با کد DUAL_APPROVAL_REQUIRED رد می‌کند و مسیر درست، ثبت درخواست و تأیید مدیر دوم
        است. تلاش‌های ردشده در گزارش حسابرسی می‌مانند.
      </Alert>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'flags', label: 'پرچم‌ها' },
          { id: 'settings', label: 'تنظیمات' },
        ]}
      />

      {state.error ? <Alert tone="critical" title="تنظیمات خوانده نشد">{state.error}</Alert> : null}

      {tab === 'flags' ? (
        <ConsolePanel title="پرچم‌های ویژگی" icon="flag" loading={state.loading && flags.length === 0} rowCount={flags.length} empty="پرچمی ثبت نشده است.">
          <DataTable
            compact
            rows={flags}
            rowKey={(row) => row.key}
            columns={[
              { key: 'key', header: 'کلید', render: (row) => <span className="prs-num prs-small" dir="ltr">{row.key}</span> },
              { key: 'desc', header: 'توضیح', render: (row) => <span className="prs-small">{row.description_fa ?? '—'}</span> },
              { key: 'scope', header: 'دامنه', render: (row) => <span className="prs-small">{row.scope}</span> },
              { key: 'rollout', header: 'درصد', numeric: true, render: (row) => <span className="prs-num">{toPersianDigits(row.rollout_percent)}٪</span> },
              {
                key: 'state',
                header: 'وضعیت',
                render: (row) => (row.enabled ? <Badge tone="positive">روشن</Badge> : <Badge tone="muted">خاموش</Badge>),
              },
              {
                key: 'critical',
                header: 'کنترل',
                render: (row) => (row.requires_dual_approval ? <Badge tone="warning">تأیید دو‌نفره</Badge> : <Badge tone="muted">مستقیم</Badge>),
              },
              { key: 'updated', header: 'آخرین تغییر', render: (row) => <span className="prs-small prs-muted">{formatDateTime(row.updated_at)}</span> },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <span className="prs-row-2">
                    <Button size="sm" variant={row.enabled ? 'outline' : 'primary'} onClick={() => void toggleFlag(row, !row.enabled)}>
                      {row.enabled ? 'خاموش' : 'روشن'}
                    </Button>
                    {row.requires_dual_approval ? (
                      <Button size="sm" variant="quiet" onClick={() => setCriticalTarget({ kind: 'flag', row })}>
                        مسیر تأیید
                      </Button>
                    ) : null}
                  </span>
                ),
              },
            ]}
          />
        </ConsolePanel>
      ) : (
        <ConsolePanel title="تنظیمات سامانه" icon="settings" loading={state.loading && settings.length === 0} rowCount={settings.length} empty="تنظیمی ثبت نشده است.">
          <DataTable
            compact
            rows={settings}
            rowKey={(row) => row.key}
            columns={[
              { key: 'key', header: 'کلید', render: (row) => <span className="prs-num prs-small" dir="ltr">{row.key}</span> },
              { key: 'label', header: 'عنوان', render: (row) => <span>{row.label_fa}</span> },
              {
                key: 'value',
                header: 'مقدار',
                render: (row) => <span className="prs-num prs-small" dir="ltr">{typeof row.value === 'object' ? JSON.stringify(row.value) : String(row.value)}</span>,
              },
              { key: 'category', header: 'دسته', render: (row) => <span className="prs-small">{labelFa(row.category)}</span> },
              {
                key: 'critical',
                header: 'کنترل',
                render: (row) => (row.is_critical ? <Badge tone="warning">حیاتی</Badge> : <Badge tone="muted">عادی</Badge>),
              },
              { key: 'updated', header: 'آخرین تغییر', render: (row) => <span className="prs-small prs-muted">{formatDateTime(row.updated_at)}</span> },
              { key: 'by', header: 'تغییردهنده', render: (row) => <span className="prs-small">{row.updated_by_name ?? 'سامانه'}</span> },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <Button size="sm" variant="outline" onClick={() => (row.is_critical ? setCriticalTarget({ kind: 'setting', row }) : setSettingTarget(row))}>
                    {row.is_critical ? 'مسیر تأیید' : 'ویرایش'}
                  </Button>
                ),
              },
            ]}
          />
        </ConsolePanel>
      )}

      <SettingEditor
        setting={settingTarget}
        onClose={() => setSettingTarget(null)}
        onSaved={() => {
          setSettingTarget(null);
          void state.reload();
        }}
      />

      <RequestApprovalDialog
        open={criticalTarget?.kind === 'setting'}
        initialType="SETTING_CHANGE_CRITICAL"
        lockedPayload={criticalTarget?.kind === 'setting' ? { key: criticalTarget.row.key } : undefined}
        onClose={() => {
          setCriticalTarget(null);
          void state.reload();
        }}
      />
      <RequestApprovalDialog
        open={criticalTarget?.kind === 'flag'}
        initialType="FEATURE_FLAG_CRITICAL"
        lockedPayload={
          criticalTarget?.kind === 'flag'
            ? { key: criticalTarget.row.key, enabled: (criticalTarget.row as FlagRow).enabled }
            : undefined
        }
        onClose={() => {
          setCriticalTarget(null);
          void state.reload();
        }}
      />
    </ConsolePage>
  );
}

function SettingEditor({ setting, onClose, onSaved }: { setting: SettingRow | null; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (setting && loadedFor !== setting.key) {
    setLoadedFor(setting.key);
    setValue(typeof setting.value === 'object' ? JSON.stringify(setting.value) : String(setting.value));
    setError(null);
  }

  const save = async () => {
    if (!setting) return;
    setBusy(true);
    setError(null);
    try {
      const parsed =
        setting.value_type === 'NUMBER' || setting.value_type === 'number'
          ? Number(value)
          : setting.value_type === 'BOOLEAN' || setting.value_type === 'boolean'
            ? value === 'true'
            : value;
      await adminApi.post('/admin/settings', { key: setting.key, value: parsed });
      onSaved();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(setting)}
      title={setting ? `ویرایش ${setting.label_fa}` : ''}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            بستن
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            ذخیره
          </Button>
        </>
      }
    >
      <div className="prs-stack-4">
        <dl className="prs-kv">
          <div style={{ display: 'contents' }}>
            <dt>کلید</dt>
            <dd className="prs-num" dir="ltr">
              {setting?.key}
            </dd>
          </div>
          <div style={{ display: 'contents' }}>
            <dt>نوع</dt>
            <dd>{setting?.value_type}</dd>
          </div>
          <div style={{ display: 'contents' }}>
            <dt>توضیح</dt>
            <dd>{setting?.description_fa ?? '—'}</dd>
          </div>
        </dl>
        {setting?.value_type === 'BOOLEAN' || setting?.value_type === 'boolean' ? (
          <Field label="مقدار">
            <Select value={value} onChange={(event) => setValue(event.target.value)}>
              <option value="true">روشن</option>
              <option value="false">خاموش</option>
            </Select>
          </Field>
        ) : (
          <Field label="مقدار">
            <TextInput dir="ltr" value={value} onChange={(event) => setValue(event.target.value)} />
          </Field>
        )}
        <Alert tone="info" title="هر تغییر تنظیم ثبت می‌شود">
          مقدار پیشین و تازه، همراه با نام شما، در گزارش حسابرسی می‌مانند.
        </Alert>
        {error ? <Alert tone="critical" title="ذخیره نشد">{error}</Alert> : null}
      </div>
    </Modal>
  );
}
