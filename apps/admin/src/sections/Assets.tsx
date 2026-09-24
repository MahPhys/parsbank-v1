/**
 * SECTION: assets — the visual library behind the brand.
 *
 * Assets are referenced by key, versioned on save, and never served as raw file bytes
 * from this console: an asset row points at a storage path plus metadata. The
 * banknote artwork keys used by the registry live here, which keeps the register and
 * the artwork in step without either knowing the other's internals.
 */
import { useState } from 'react';
import { Alert, Badge, Button, DataTable, Field, Modal, Select, Stat, TextArea, TextInput, toPersianDigits } from '@parsbank/ui';
import { adminApi, describeError } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { ConsolePage, ConsolePanel } from '../components/console.tsx';

interface AssetRow {
  id: string;
  asset_key: string;
  name_fa: string;
  kind: string;
  mime_type: string;
  storage_path: string;
  denomination_minor: number | null;
  side: string | null;
  current_version: number;
  status: string;
  tags: string[];
}

const KINDS = ['LOGO', 'LOGO_VARIANT', 'ICON', 'IMAGE', 'PATTERN', 'BANKNOTE_ART', 'CARD_ART', 'PORTRAIT', 'FONT', 'ILLUSTRATION', 'SOCIAL'];

export function Assets() {
  const [kind, setKind] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const list = useAsync<{ items: AssetRow[] }>(() => adminApi.get('/admin/design/assets', { query: { kind } }), [kind]);
  const rows = list.data?.items ?? [];

  return (
    <ConsolePage
      title="دارایی‌های بصری"
      description="نشان‌ها، نقش‌مایه‌ها، تصاویر اسکناس و کارت. هر دارایی یک کلید، یک نسخه و یک مسیر ذخیره‌سازی دارد."
      actions={
        <>
          <Button variant="outline" size="sm" icon="refresh" onClick={() => void list.reload()}>
            بازخوانی
          </Button>
          <Button variant="primary" size="sm" icon="plus" onClick={() => setCreateOpen(true)}>
            دارایی تازه
          </Button>
        </>
      }
    >
      <section className="prs-grid prs-grid-4">
        <Stat label="دارایی‌ها" value={toPersianDigits(rows.length)} hint={kind ? `صافی: ${kind}` : 'همهٔ انواع'} icon="eye" />
        <Stat label="نشان و نماد" value={toPersianDigits(rows.filter((row) => row.kind.startsWith('LOGO') || row.kind === 'ICON').length)} icon="grid" />
        <Stat label="تصویر اسکناس" value={toPersianDigits(rows.filter((row) => row.kind === 'BANKNOTE_ART').length)} hint="هفت رقم × دو رو" icon="notes" />
        <Stat label="نسخه‌های ثبت‌شده" value={toPersianDigits(rows.reduce((sum, row) => sum + row.current_version, 0))} hint="جمع نسخه‌های جاری" icon="copy" />
      </section>

      <Alert tone="info" title="دارایی، فایل خام نیست">
        این کنسول فایل باینری ذخیره نمی‌کند؛ هر ردیف یک ارجاع به مسیر ذخیره‌سازی با فرادادهٔ کامل است. این
        کار هم بازبینی نسخه‌ها را ساده می‌کند و هم جلوی آپلود ناخواسته از پنل مدیریت را می‌گیرد.
      </Alert>

      <ConsolePanel title="صافی نوع" icon="search">
        <Field label="نوع دارایی">
          <Select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">همه</option>
            {KINDS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
      </ConsolePanel>

      {list.error ? <Alert tone="critical" title="فهرست دارایی‌ها خوانده نشد">{list.error}</Alert> : null}

      <ConsolePanel
        title="کتابخانهٔ دارایی‌ها"
        icon="eye"
        loading={list.loading && rows.length === 0}
        rowCount={rows.length}
        empty="دارایی‌ای ثبت نشده است."
      >
        <DataTable
          compact
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            { key: 'key', header: 'کلید', render: (row) => <span className="prs-num prs-small" dir="ltr">{row.asset_key}</span> },
            { key: 'name', header: 'نام', render: (row) => <span>{row.name_fa}</span> },
            { key: 'kind', header: 'نوع', render: (row) => <Badge tone="info">{row.kind}</Badge> },
            { key: 'mime', header: 'قالب', render: (row) => <span className="prs-small" dir="ltr">{row.mime_type}</span> },
            {
              key: 'denomination',
              header: 'ارزش',
              render: (row) => <span className="prs-num">{row.denomination_minor ? toPersianDigits(row.denomination_minor) : '—'}</span>,
            },
            { key: 'side', header: 'رو', render: (row) => <span className="prs-small">{row.side === 'FRONT' ? 'رو' : row.side === 'REVERSE' ? 'پشت' : '—'}</span> },
            { key: 'version', header: 'نسخه', numeric: true, render: (row) => <span className="prs-num">{toPersianDigits(row.current_version)}</span> },
            { key: 'status', header: 'وضعیت', render: (row) => <span className="prs-small">{row.status}</span> },
            { key: 'path', header: 'مسیر', render: (row) => <span className="prs-small prs-muted" dir="ltr">{row.storage_path}</span> },
          ]}
        />
      </ConsolePanel>

      <CreateAssetDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          void list.reload();
        }}
      />
    </ConsolePage>
  );
}

function CreateAssetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [assetKey, setAssetKey] = useState('');
  const [nameFa, setNameFa] = useState('');
  const [kind, setKind] = useState('LOGO');
  const [mimeType, setMimeType] = useState('image/svg+xml');
  const [storagePath, setStoragePath] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.post('/admin/design/assets', {
        assetKey,
        nameFa,
        kind,
        mimeType,
        storagePath,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
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
      title="ثبت دارایی بصری"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            بستن
          </Button>
          <Button variant="primary" loading={busy} disabled={assetKey.length < 2 || nameFa.length < 2 || storagePath.length < 3} onClick={() => void submit()}>
            ثبت دارایی
          </Button>
        </>
      }
    >
      <div className="prs-stack-4">
        <Field label="کلید دارایی" hint="حروف کوچک لاتین، عدد، نقطه و خط تیره.">
          <TextInput dir="ltr" value={assetKey} onChange={(event) => setAssetKey(event.target.value)} placeholder="logo.primary" />
        </Field>
        <Field label="نام فارسی">
          <TextInput value={nameFa} onChange={(event) => setNameFa(event.target.value)} />
        </Field>
        <Field label="نوع">
          <Select value={kind} onChange={(event) => setKind(event.target.value)}>
            {KINDS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="قالب فایل">
          <TextInput dir="ltr" value={mimeType} onChange={(event) => setMimeType(event.target.value)} />
        </Field>
        <Field label="مسیر ذخیره‌سازی">
          <TextInput dir="ltr" value={storagePath} onChange={(event) => setStoragePath(event.target.value)} placeholder="assets/logo/primary.svg" />
        </Field>
        <Field label="برچسب‌ها" hint="با کاما جدا کنید.">
          <TextArea rows={2} value={tags} onChange={(event) => setTags(event.target.value)} />
        </Field>
        {error ? <Alert tone="critical" title="ثبت دارایی انجام نشد">{error}</Alert> : null}
        {done ? <Alert tone="success" title="دارایی ثبت شد" /> : null}
      </div>
    </Modal>
  );
}
