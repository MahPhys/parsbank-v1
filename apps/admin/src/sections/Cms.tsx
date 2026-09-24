/**
 * SECTION: CMS — the words and pages the members read.
 *
 * Content has a lifecycle: a draft is written here, published when it is ready, and
 * every save bumps a version so an earlier wording can be restored. Editing content
 * never touches money; the design office can work here without any treasury access.
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
  Stat,
  Tabs,
  TextArea,
  TextInput,
  formatDateTime,
  toPersianDigits,
} from '@parsbank/ui';
import { adminApi, describeError } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { ConsolePage, ConsolePanel } from '../components/console.tsx';

interface BlockRow {
  id: string;
  block_key: string;
  kind: string;
  title_fa: string | null;
  body_fa: string;
  status: string;
  current_version: number;
  published_at: string | null;
  updated_at: string;
}

interface PageRow {
  id: string;
  slug: string;
  title_fa: string;
  status: string;
  current_version: number;
  is_system: boolean;
  updated_at: string;
  published_at: string | null;
}

interface NavRow {
  id: string;
  location: string;
  label_fa: string;
  label_en: string | null;
  href: string;
  icon_key: string | null;
  sort_order: number;
  visible: boolean;
}

const BLOCK_KINDS = ['TEXT', 'HERO', 'ANNOUNCEMENT', 'BANNER', 'FAQ', 'LEGAL', 'CTA', 'STAT', 'FOOTER_NOTE'];
const LOCATIONS = ['PUBLIC_HEADER', 'PUBLIC_FOOTER', 'PUBLIC_APP_NAV', 'ADMIN_SIDEBAR', 'ADMIN_HEADER'];

export function Cms() {
  const [tab, setTab] = useState('blocks');
  const [blockDialog, setBlockDialog] = useState<BlockRow | 'new' | null>(null);
  const [pageDialog, setPageDialog] = useState<PageRow | 'new' | null>(null);
  const [navDialog, setNavDialog] = useState<NavRow | 'new' | null>(null);

  const blocks = useAsync<{ items: BlockRow[] }>(() => adminApi.get('/admin/content/blocks'), []);
  const pages = useAsync<{ items: PageRow[] }>(() => adminApi.get('/admin/content/pages'), []);
  const navigation = useAsync<{ items: NavRow[] }>(() => adminApi.get('/admin/content/navigation'), []);

  const blockRows = blocks.data?.items ?? [];
  const pageRows = pages.data?.items ?? [];
  const navRows = navigation.data?.items ?? [];

  return (
    <ConsolePage
      title="محتوای عمومی"
      description="متن‌ها، صفحه‌ها و ناوبری سایت عمومی. هر ذخیره یک نسخهٔ تازه می‌سازد و انتشار، وضعیت را از پیش‌نویس به منتشرشده می‌برد."
      actions={
        <Button variant="outline" size="sm" icon="refresh" onClick={() => void Promise.all([blocks.reload(), pages.reload(), navigation.reload()])}>
          بازخوانی
        </Button>
      }
    >
      <section className="prs-grid prs-grid-4">
        <Stat label="بلوک‌های محتوا" value={toPersianDigits(blockRows.length)} hint={`${toPersianDigits(blockRows.filter((row) => row.status === 'PUBLISHED').length)} منتشرشده`} icon="copy" />
        <Stat label="صفحه‌ها" value={toPersianDigits(pageRows.length)} hint={`${toPersianDigits(pageRows.filter((row) => row.status === 'PUBLISHED').length)} منتشرشده`} icon="list" />
        <Stat label="آیتم‌های ناوبری" value={toPersianDigits(navRows.length)} hint="هدر، فوتر و ناوبری اپلیکیشن" icon="grid" />
        <Stat
          label="پیش‌نویس‌ها"
          value={toPersianDigits(blockRows.filter((row) => row.status !== 'PUBLISHED').length + pageRows.filter((row) => row.status !== 'PUBLISHED').length)}
          hint="در انتظار انتشار"
          icon="eye"
        />
      </section>

      <Alert tone="info" title="محتوای عمومی هرگز پول را جابه‌جا نمی‌کند">
        این بخش فقط متن و ساختار صفحه‌ها را می‌سازد. هیچ فیلدی در اینجا به دفتر کل، عرضه، پشتوانه یا نرخ مرجع
        وصل نیست؛ نقش طراحی نمی‌تواند به منطق پولی نزدیک شود.
      </Alert>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'blocks', label: 'بلوک‌های محتوا' },
          { id: 'pages', label: 'صفحه‌ها' },
          { id: 'navigation', label: 'ناوبری' },
        ]}
      />

      {tab === 'blocks' ? (
        <ConsolePanel
          title="بلوک‌های محتوا"
          subtitle="هر بلوک یک قطعهٔ متنی با کلید یکتا و نسخهٔ خودش"
          icon="copy"
          loading={blocks.loading && blockRows.length === 0}
          rowCount={blockRows.length}
          empty="بلوکی ثبت نشده است."
          actions={
            <Button size="sm" variant="primary" icon="plus" onClick={() => setBlockDialog('new')}>
              بلوک تازه
            </Button>
          }
        >
          <DataTable
            compact
            rows={blockRows}
            rowKey={(row) => row.id}
            columns={[
              { key: 'key', header: 'کلید', render: (row) => <span className="prs-num prs-small" dir="ltr">{row.block_key}</span> },
              { key: 'kind', header: 'نوع', render: (row) => <span className="prs-small">{row.kind}</span> },
              { key: 'title', header: 'عنوان', render: (row) => <span>{row.title_fa ?? '—'}</span> },
              { key: 'body', header: 'متن', render: (row) => <span className="prs-small prs-muted">{row.body_fa.slice(0, 70)}{row.body_fa.length > 70 ? '…' : ''}</span> },
              {
                key: 'status',
                header: 'وضعیت',
                render: (row) => <Badge tone={row.status === 'PUBLISHED' ? 'positive' : 'warning'}>{row.status === 'PUBLISHED' ? 'منتشرشده' : 'پیش‌نویس'}</Badge>,
              },
              { key: 'version', header: 'نسخه', numeric: true, render: (row) => <span className="prs-num">{toPersianDigits(row.current_version)}</span> },
              { key: 'updated', header: 'آخرین تغییر', render: (row) => <span className="prs-small prs-muted">{formatDateTime(row.updated_at)}</span> },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <Button size="sm" variant="outline" onClick={() => setBlockDialog(row)}>
                    ویرایش
                  </Button>
                ),
              },
            ]}
          />
        </ConsolePanel>
      ) : null}

      {tab === 'pages' ? (
        <ConsolePanel
          title="صفحه‌ها"
          subtitle="صفحه‌های عمومی سایت"
          icon="list"
          loading={pages.loading && pageRows.length === 0}
          rowCount={pageRows.length}
          empty="صفحه‌ای ثبت نشده است."
          actions={
            <Button size="sm" variant="primary" icon="plus" onClick={() => setPageDialog('new')}>
              صفحهٔ تازه
            </Button>
          }
        >
          <DataTable
            compact
            rows={pageRows}
            rowKey={(row) => row.id}
            columns={[
              { key: 'slug', header: 'نشانی', render: (row) => <span className="prs-num prs-small" dir="ltr">/{row.slug}</span> },
              { key: 'title', header: 'عنوان', render: (row) => <span>{row.title_fa}</span> },
              {
                key: 'status',
                header: 'وضعیت',
                render: (row) => <Badge tone={row.status === 'PUBLISHED' ? 'positive' : 'warning'}>{row.status === 'PUBLISHED' ? 'منتشرشده' : 'پیش‌نویس'}</Badge>,
              },
              { key: 'system', header: 'سیستمی', render: (row) => (row.is_system ? <Badge tone="info">سیستمی</Badge> : <span className="prs-muted">—</span>) },
              { key: 'version', header: 'نسخه', numeric: true, render: (row) => <span className="prs-num">{toPersianDigits(row.current_version)}</span> },
              { key: 'updated', header: 'آخرین تغییر', render: (row) => <span className="prs-small prs-muted">{formatDateTime(row.updated_at)}</span> },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <Button size="sm" variant="outline" onClick={() => setPageDialog(row)}>
                    ویرایش
                  </Button>
                ),
              },
            ]}
          />
        </ConsolePanel>
      ) : null}

      {tab === 'navigation' ? (
        <ConsolePanel
          title="ناوبری"
          subtitle="ترتیب و برچسب لینک‌های عمومی و مدیریتی"
          icon="grid"
          loading={navigation.loading && navRows.length === 0}
          rowCount={navRows.length}
          empty="آیتمی ثبت نشده است."
          actions={
            <Button size="sm" variant="primary" icon="plus" onClick={() => setNavDialog('new')}>
              آیتم تازه
            </Button>
          }
        >
          <DataTable
            compact
            rows={navRows}
            rowKey={(row) => row.id}
            columns={[
              { key: 'location', header: 'محل', render: (row) => <span className="prs-small" dir="ltr">{row.location}</span> },
              { key: 'label', header: 'برچسب', render: (row) => <span>{row.label_fa}</span> },
              { key: 'href', header: 'نشانی', render: (row) => <span className="prs-num prs-small" dir="ltr">{row.href}</span> },
              { key: 'icon', header: 'نشان', render: (row) => <span className="prs-small">{row.icon_key ?? '—'}</span> },
              { key: 'order', header: 'ترتیب', numeric: true, render: (row) => <span className="prs-num">{toPersianDigits(row.sort_order)}</span> },
              { key: 'visible', header: 'نمایش', render: (row) => (row.visible ? <Badge tone="positive">فعال</Badge> : <Badge tone="muted">پنهان</Badge>) },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <Button size="sm" variant="outline" onClick={() => setNavDialog(row)}>
                    ویرایش
                  </Button>
                ),
              },
            ]}
          />
        </ConsolePanel>
      ) : null}

      <BlockEditor target={blockDialog} onClose={() => setBlockDialog(null)} onSaved={() => void blocks.reload()} />
      <PageEditor target={pageDialog} onClose={() => setPageDialog(null)} onSaved={() => void pages.reload()} />
      <NavEditor target={navDialog} onClose={() => setNavDialog(null)} onSaved={() => void navigation.reload()} />

      <Panel title="چرخهٔ انتشار" icon="history">
        <PanelBody>
          <ol className="prs-stack-3" style={{ paddingInlineStart: 'var(--prs-space-6)', margin: 0 }}>
            <li>پیش‌نویس: متن نوشته می‌شود و ذخیره می‌گردد، ولی کاربران آن را نمی‌بینند.</li>
            <li>پیش‌نمایش: نسخهٔ منتشرنشده با همان قالب زنده بررسی می‌شود.</li>
            <li>انتشار: نسخهٔ تازه جای نسخهٔ پیشین را می‌گیرد و نسخهٔ قبلی در تاریخ می‌ماند.</li>
            <li>بازگردانی: در صورت نیاز، نسخهٔ پیشین منتشر می‌شود — همیشه یک نسخهٔ تازه، نه پاک کردن تاریخ.</li>
          </ol>
        </PanelBody>
      </Panel>
    </ConsolePage>
  );
}

function BlockEditor({ target, onClose, onSaved }: { target: BlockRow | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const isNew = target === 'new';
  const row = target && target !== 'new' ? target : null;
  const [blockKey, setBlockKey] = useState('');
  const [kind, setKind] = useState('TEXT');
  const [titleFa, setTitleFa] = useState('');
  const [bodyFa, setBodyFa] = useState('');
  const [publish, setPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const key = row?.id ?? 'new';
  if (target && loadedFor !== key) {
    setLoadedFor(key);
    setBlockKey(row?.block_key ?? '');
    setKind(row?.kind ?? 'TEXT');
    setTitleFa(row?.title_fa ?? '');
    setBodyFa(row?.body_fa ?? '');
    setPublish(row?.status === 'PUBLISHED');
    setError(null);
  }

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.post('/admin/content/blocks', {
        blockKey,
        kind,
        titleFa: titleFa || null,
        bodyFa,
        publish,
      });
      onSaved();
      onClose();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(target)}
      title={isNew ? 'بلوک محتوای تازه' : `ویرایش بلوک ${row?.block_key ?? ''}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            بستن
          </Button>
          <Button variant="primary" loading={busy} disabled={blockKey.length < 2 || bodyFa.length < 3} onClick={() => void save()}>
            {publish ? 'ذخیره و انتشار' : 'ذخیرهٔ پیش‌نویس'}
          </Button>
        </>
      }
    >
      <div className="prs-stack-4">
        <Field label="کلید بلوک" hint="کلید یکتا، با حروف لاتین و نقطه.">
          <TextInput dir="ltr" value={blockKey} onChange={(event) => setBlockKey(event.target.value)} disabled={!isNew} />
        </Field>
        <Field label="نوع">
          <Select value={kind} onChange={(event) => setKind(event.target.value)}>
            {BLOCK_KINDS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="عنوان">
          <TextInput value={titleFa} onChange={(event) => setTitleFa(event.target.value)} />
        </Field>
        <Field label="متن">
          <TextArea rows={6} value={bodyFa} onChange={(event) => setBodyFa(event.target.value)} />
        </Field>
        <Field label="وضعیت">
          <Select value={publish ? 'PUBLISHED' : 'DRAFT'} onChange={(event) => setPublish(event.target.value === 'PUBLISHED')}>
            <option value="DRAFT">پیش‌نویس</option>
            <option value="PUBLISHED">منتشرشده</option>
          </Select>
        </Field>
        {row ? (
          <p className="prs-small prs-muted">
            نسخهٔ کنونی {toPersianDigits(row.current_version)} — با ذخیره، نسخهٔ {toPersianDigits(row.current_version + 1)} ساخته می‌شود و نسخهٔ
            پیشین در تاریخ می‌ماند.
          </p>
        ) : null}
        {error ? <Alert tone="critical" title="ذخیره نشد">{error}</Alert> : null}
      </div>
    </Modal>
  );
}

function PageEditor({ target, onClose, onSaved }: { target: PageRow | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const isNew = target === 'new';
  const row = target && target !== 'new' ? target : null;
  const [slug, setSlug] = useState('');
  const [titleFa, setTitleFa] = useState('');
  const [descriptionFa, setDescriptionFa] = useState('');
  const [publish, setPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const key = row?.id ?? 'new';
  if (target && loadedFor !== key) {
    setLoadedFor(key);
    setSlug(row?.slug ?? '');
    setTitleFa(row?.title_fa ?? '');
    setDescriptionFa('');
    setPublish(row?.status === 'PUBLISHED');
    setError(null);
  }

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.post('/admin/content/pages', {
        slug,
        titleFa,
        descriptionFa: descriptionFa || null,
        layout: row ? [] : [],
        publish,
      });
      onSaved();
      onClose();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(target)}
      title={isNew ? 'صفحهٔ تازه' : `ویرایش صفحه ${row?.slug ?? ''}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            بستن
          </Button>
          <Button variant="primary" loading={busy} disabled={slug.length < 1 || titleFa.length < 2} onClick={() => void save()}>
            {publish ? 'ذخیره و انتشار' : 'ذخیرهٔ پیش‌نویس'}
          </Button>
        </>
      }
    >
      <div className="prs-stack-4">
        <Field label="نشانی صفحه" hint="حروف کوچک لاتین، بدون فاصله.">
          <TextInput dir="ltr" value={slug} onChange={(event) => setSlug(event.target.value)} disabled={!isNew} />
        </Field>
        <Field label="عنوان">
          <TextInput value={titleFa} onChange={(event) => setTitleFa(event.target.value)} />
        </Field>
        <Field label="توضیح">
          <TextArea rows={3} value={descriptionFa} onChange={(event) => setDescriptionFa(event.target.value)} />
        </Field>
        <Field label="وضعیت">
          <Select value={publish ? 'PUBLISHED' : 'DRAFT'} onChange={(event) => setPublish(event.target.value === 'PUBLISHED')}>
            <option value="DRAFT">پیش‌نویس</option>
            <option value="PUBLISHED">منتشرشده</option>
          </Select>
        </Field>
        {error ? <Alert tone="critical" title="ذخیره نشد">{error}</Alert> : null}
      </div>
    </Modal>
  );
}

function NavEditor({ target, onClose, onSaved }: { target: NavRow | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const isNew = target === 'new';
  const row = target && target !== 'new' ? target : null;
  const [location, setLocation] = useState('PUBLIC_HEADER');
  const [labelFa, setLabelFa] = useState('');
  const [href, setHref] = useState('');
  const [iconKey, setIconKey] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const key = row?.id ?? 'new';
  if (target && loadedFor !== key) {
    setLoadedFor(key);
    setLocation(row?.location ?? 'PUBLIC_HEADER');
    setLabelFa(row?.label_fa ?? '');
    setHref(row?.href ?? '');
    setIconKey(row?.icon_key ?? '');
    setSortOrder(String(row?.sort_order ?? 0));
    setVisible(row?.visible ?? true);
    setError(null);
  }

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.post('/admin/content/navigation', {
        id: row?.id ?? null,
        location,
        labelFa,
        href,
        iconKey: iconKey || null,
        sortOrder: Number(sortOrder),
        visible,
      });
      onSaved();
      onClose();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(target)}
      title={isNew ? 'آیتم ناوبری تازه' : 'ویرایش آیتم ناوبری'}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            بستن
          </Button>
          <Button variant="primary" loading={busy} disabled={labelFa.length < 1 || href.length < 1} onClick={() => void save()}>
            ذخیره
          </Button>
        </>
      }
    >
      <div className="prs-stack-4">
        <Field label="محل نمایش">
          <Select value={location} onChange={(event) => setLocation(event.target.value)}>
            {LOCATIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="برچسب">
          <TextInput value={labelFa} onChange={(event) => setLabelFa(event.target.value)} />
        </Field>
        <Field label="نشانی">
          <TextInput dir="ltr" value={href} onChange={(event) => setHref(event.target.value)} />
        </Field>
        <Field label="نشان" hint="کلید نشان از کتابخانهٔ آیکون.">
          <TextInput dir="ltr" value={iconKey} onChange={(event) => setIconKey(event.target.value)} />
        </Field>
        <Field label="ترتیب">
          <TextInput numeric value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
        </Field>
        <Field label="نمایش">
          <Select value={visible ? 'true' : 'false'} onChange={(event) => setVisible(event.target.value === 'true')}>
            <option value="true">نمایش داده شود</option>
            <option value="false">پنهان باشد</option>
          </Select>
        </Field>
        {error ? <Alert tone="critical" title="ذخیره نشد">{error}</Alert> : null}
      </div>
    </Modal>
  );
}
