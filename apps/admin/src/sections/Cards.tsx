/**
 * SECTION: cards — issuance, credentials and lifecycle.
 *
 * A card is an access instrument for one wallet: it never holds money, and its QR
 * token is stored only as a digest. The console can issue a card, hand over its
 * one-time credentials and reset a forgotten PIN. Credentials exist in readable form
 * for exactly one screen — the hand-over sheet — and only at the moment they are
 * minted; after that the database holds digests only.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Field,
  Modal,
  RevealSecret,
  Select,
  Stat,
  TextInput,
  formatExpiry,
  groupCardNumber,
  labelFa,
  maskCardNumber,
  statusTone,
  toPersianDigits,
} from '@parsbank/ui';
import { adminApi, describeError } from '../lib/api.ts';
import { useAsync, useDebounced } from '../lib/hooks.ts';
import { ConsolePage, ConsolePanel, DateCell, Pager, StatusCell } from '../components/console.tsx';
import { RequestApprovalDialog } from '../components/approval.tsx';

interface CardRow {
  id: string;
  card_number: string;
  expiry_month: number;
  expiry_year: number;
  status: string;
  scheme: string;
  network_label: string;
  issued_at: string;
  cardholder_name_fa: string;
  profile_ref: string;
  holder_name: string;
  wallet_ref: string;
}

const STATUSES = ['', 'PENDING', 'ACTIVE', 'FROZEN', 'EXPIRED', 'CANCELLED'];

/** The one-time material the server returns when it mints card credentials. */
interface IssuedCardMaterial {
  kind: 'ISSUE' | 'RESET';
  cardId: string;
  cardNumber: string;
  cardholderNameFa: string;
  expiryMonth: number;
  expiryYear: number;
  cvv: string;
  pin: string;
  qrToken?: string;
  walletRef?: string;
}

export function Cards() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [issueOpen, setIssueOpen] = useState(false);
  const [freezeTarget, setFreezeTarget] = useState<CardRow | null>(null);
  const [pinTarget, setPinTarget] = useState<CardRow | null>(null);
  const [issuedMaterial, setIssuedMaterial] = useState<IssuedCardMaterial | null>(null);
  const debounced = useDebounced(search);

  const list = useAsync<{ items: CardRow[]; total: number }>(
    () => adminApi.get('/admin/cards', { query: { search: debounced, status, page, pageSize: 25 } }),
    [debounced, status, page],
  );

  const rows = list.data?.items ?? [];

  return (
    <ConsolePage
      title="کارت‌ها"
      description="کارت، ابزار دسترسی به یک کیف پول است. شمارهٔ کارت ۱۲ رقمی است و رمز و کد امنیتی هرگز به شکل خوانا ذخیره نمی‌شوند."
      actions={
        <>
          <Button variant="outline" size="sm" icon="refresh" onClick={() => void list.reload()}>
            به‌روزرسانی
          </Button>
          <Button variant="primary" size="sm" icon="plus" onClick={() => setIssueOpen(true)}>
            صدور کارت
          </Button>
        </>
      }
    >
      <section className="prs-grid prs-grid-4">
        <Stat label="کارت‌ها در این صفحه" value={toPersianDigits(rows.length)} hint={`از ${toPersianDigits(list.data?.total ?? 0)} کارت`} icon="card" />
        <Stat label="فعال" value={toPersianDigits(rows.filter((row) => row.status === 'ACTIVE').length)} icon="check" />
        <Stat label="منجمد" value={toPersianDigits(rows.filter((row) => row.status === 'FROZEN').length)} hint="پرداخت متوقف است" icon="lock" />
        <Stat
          label="منقضی یا لغوشده"
          value={toPersianDigits(rows.filter((row) => row.status === 'EXPIRED' || row.status === 'CANCELLED').length)}
          icon="ban"
        />
      </section>

      <ConsolePanel title="صافی‌ها" icon="search">
        <div className="prs-grid prs-grid-2">
          <Field label="جست‌وجو" hint="شمارهٔ کارت، نام دارنده یا شناسهٔ پروفایل">
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
        </div>
      </ConsolePanel>

      {list.error ? <Alert tone="critical" title="فهرست کارت‌ها خوانده نشد">{list.error}</Alert> : null}

      <ConsolePanel
        title="کارت‌ها"
        subtitle={list.data ? `${toPersianDigits(list.data.total)} کارت` : undefined}
        icon="card"
        loading={list.loading && rows.length === 0}
        rowCount={rows.length}
        empty="با این صافی‌ها کارتی پیدا نشد."
      >
        <DataTable
          compact
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            { key: 'number', header: 'شمارهٔ کارت', render: (row) => <span className="prs-num" dir="ltr">{groupCardNumber(row.card_number, false)}</span> },
            { key: 'holder', header: 'دارنده', render: (row) => <span>{row.cardholder_name_fa}</span> },
            { key: 'wallet', header: 'کیف پول', render: (row) => <span className="prs-num prs-small">{row.wallet_ref}</span> },
            { key: 'expiry', header: 'انقضا', render: (row) => <span className="prs-num">{formatExpiry(row.expiry_month, row.expiry_year)}</span> },
            { key: 'status', header: 'وضعیت', render: (row) => <StatusCell value={row.status} /> },
            { key: 'scheme', header: 'طرح', render: (row) => <Badge tone="info">{row.network_label || row.scheme}</Badge> },
            { key: 'issued', header: 'صدور', render: (row) => <DateCell value={row.issued_at} /> },
            {
              key: 'actions',
              header: '',
              render: (row) => (
                <span className="prs-row-2">
                  <Button
                    size="sm"
                    variant={row.status === 'FROZEN' ? 'outline' : 'danger'}
                    disabled={row.status === 'CANCELLED'}
                    onClick={() => setFreezeTarget(row)}
                  >
                    {row.status === 'FROZEN' ? 'رفع انجماد' : 'انجماد'}
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    disabled={row.status === 'CANCELLED'}
                    onClick={() => setPinTarget(row)}
                  >
                    بازنشانی رمز
                  </Button>
                </span>
              ),
            },
          ]}
        />
        {list.data ? <Pager page={page} pageSize={25} total={list.data.total} onPage={setPage} /> : null}
      </ConsolePanel>

      <Alert tone="info" title="رمز و کد امنیتی کجا دیده می‌شوند؟">
        CVV و رمز پرداخت فقط در دو لحظه خوانا هستند و هر دو یک‌بارمصرف‌اند: هنگام <b>صدور کارت</b> و هنگام
        <b> بازنشانی رمز</b> که خودتان آن را انجام می‌دهید. بلافاصله پس از نمایش، فقط درهم‌ساختهٔ آن‌ها ذخیره
        می‌شود؛ هیچ صفحه‌ای — از جمله همین صفحه — بعداً نمی‌تواند آن‌ها را بازتاباند. رمز را روی برگهٔ تحویل
        بنویسید و به دارنده بدهید.
      </Alert>

      <IssueCardDialog
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        onIssued={(material) => {
          setIssuedMaterial(material);
          void list.reload();
        }}
      />

      <PinResetDialog
        card={pinTarget}
        onClose={() => setPinTarget(null)}
        onIssued={(material) => void list.reload()} 
      />

      <CardMaterialSheet
        material={issuedMaterial}
        onClose={() => setIssuedMaterial(null)}
      />

      <RequestApprovalDialog
        open={Boolean(freezeTarget)}
        initialType="CARD_FREEZE"
        lockedPayload={freezeTarget ? { cardId: freezeTarget.id, freeze: freezeTarget.status !== 'FROZEN' } : undefined}
        onClose={() => {
          setFreezeTarget(null);
          void list.reload();
        }}
      />
    </ConsolePage>
  );
}

function IssueCardDialog({
  open,
  onClose,
  onIssued,
}: {
  open: boolean;
  onClose: () => void;
  onIssued: (material: IssuedCardMaterial) => void;
}) {
  const [walletRef, setWalletRef] = useState('');
  const [cardholderNameFa, setCardholderNameFa] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const value = await adminApi.post<{
        cardId: string;
        cardNumber: string;
        cardholderNameFa: string;
        expiryMonth: number;
        expiryYear: number;
        cvv: string;
        pin: string;
        qrToken?: string;
      }>('/admin/cards', { walletRef: walletRef.trim(), cardholderNameFa: cardholderNameFa.trim() });
      onIssued({ ...value, walletRef: walletRef.trim(), kind: 'ISSUE' });
      setWalletRef('');
      setCardholderNameFa('');
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
      title="صدور کارت برای کیف پول"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            بستن
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={walletRef.trim().length < 6 || cardholderNameFa.trim().length < 3}
            onClick={() => void submit()}
          >
            صدور کارت
          </Button>
        </>
      }
    >
      <div className="prs-stack-4">
        <Alert tone="info" title="صدور کارت، پول خلق نمی‌کند">
          کارت به یک کیف پول موجود گره می‌خورد و شمارهٔ کارت، CVV و رمز پرداخت تازه تولید می‌شوند. اگر کیف پول
          موجودی نداشته باشد، کارت هم چیزی برای خرج کردن ندارد.
        </Alert>
        <Field label="شناسهٔ کیف پول دارنده" hint="شناسهٔ عمومی کیف پول از بخش «کیف پول‌ها» — با PRS-W شروع می‌شود.">
          <TextInput dir="ltr" value={walletRef} onChange={(event) => setWalletRef(event.target.value)} placeholder="PRS-W-…" />
        </Field>
        <Field label="نام دارنده روی کارت (فارسی)" hint="همان‌طور که باید روی کارت چاپ شود.">
          <TextInput value={cardholderNameFa} onChange={(event) => setCardholderNameFa(event.target.value)} placeholder="مثلاً: مریم دانشور" />
        </Field>
        <Alert tone="warning" title="پس از صدور، برگهٔ تحویل را چاپ کنید">
          رمز پرداخت و CVV فقط یک بار نشان داده می‌شوند. اگر پنجرهٔ تحویل را ببندید، رمز قابل بازیابی نیست و
          باید بازنشانی شود.
        </Alert>
        {error ? <Alert tone="critical" title="صدور کارت انجام نشد">{error}</Alert> : null}
      </div>
    </Modal>
  );
}

/** One-time PIN reset performed by an operator for a holder who lost theirs. */
function PinResetDialog({
  card,
  onClose,
  onIssued,
}: {
  card: CardRow | null;
  onClose: () => void;
  onIssued: (material: IssuedCardMaterial) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ pin: string } | null>(null);

  useEffect(() => {
    if (card) {
      setResult(null);
      setError(null);
    }
  }, [card?.id]);

  const submit = async () => {
    if (!card) return;
    setBusy(true);
    setError(null);
    try {
      const value = await adminApi.post<{ cardId: string; pin: string }>(`/admin/cards/${card.id}/pin`, {});
      setResult({ pin: value.pin });
      onIssued({ cardId: card.id, cardNumber: card.card_number, cardholderNameFa: card.cardholder_name_fa, expiryMonth: card.expiry_month, expiryYear: card.expiry_year, cvv: '', pin: value.pin, kind: 'RESET' });
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(card)}
      title={card ? `بازنشانی رمز کارت ${maskCardNumber(card.card_number)}` : ''}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            بستن
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()} disabled={Boolean(result)}>
            تولید رمز تازه
          </Button>
        </>
      }
    >
      <div className="prs-stack-4">
        <Alert tone="warning" title="این کار رمز فعلی را باطل می‌کند">
          بازنشانی رمز، رمز پیشین دارنده را بی‌درنگ از کار می‌اندازد و در گزارش امنیتی با نام شما ثبت می‌شود.
          رمز تازه فقط یک بار نشان داده می‌شود.
        </Alert>
        <dl className="prs-kv">
          <div style={{ display: 'contents' }}>
            <dt>دارنده</dt>
            <dd>{card?.cardholder_name_fa}</dd>
          </div>
          <div style={{ display: 'contents' }}>
            <dt>شمارهٔ کارت</dt>
            <dd className="prs-num" dir="ltr">{groupCardNumber(card?.card_number ?? '', false)}</dd>
          </div>
        </dl>
        {result ? <RevealSecret value={result.pin} label="رمز پرداخت تازه" hint="همین حالا به دارنده تحویل دهید." /> : null}
        {error ? <Alert tone="critical" title="بازنشانی انجام نشد">{error}</Alert> : null}
      </div>
    </Modal>
  );
}

/**
 * The hand-over sheet. This is the only place in the institution where a card's
 * secrets are readable, and it exists for exactly one screen: the operator prints it,
 * walks it to the holder, and closes it. Nothing is persisted, nothing is re-readable.
 */
function CardMaterialSheet({ material, onClose }: { material: IssuedCardMaterial | null; onClose: () => void }) {
  if (!material) return null;
  return (
    <Modal
      open
      title={material.kind === 'ISSUE' ? 'برگهٔ تحویل کارت' : 'رمز تازهٔ کارت'}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" icon="print" onClick={() => window.print()}>
            چاپ برگه
          </Button>
          <Button variant="primary" onClick={onClose}>
            تحویل داده شد — بستن
          </Button>
        </>
      }
    >
      <div className="prs-stack-4">
        <Alert tone="critical" title="این مقادیر دیگر نمایش داده نمی‌شوند">
          پس از بستن این پنجره، رمز پرداخت و CVV از سامانه قابل بازیابی نیستند (فقط درهم‌ساختهٔ آن‌ها ذخیره
          شده است). همین حالا چاپ کنید.
        </Alert>
        <dl className="prs-kv">
          <div style={{ display: 'contents' }}>
            <dt>دارنده</dt>
            <dd>{material.cardholderNameFa}</dd>
          </div>
          <div style={{ display: 'contents' }}>
            <dt>شمارهٔ کارت</dt>
            <dd className="prs-num" dir="ltr">{groupCardNumber(material.cardNumber, false)}</dd>
          </div>
          <div style={{ display: 'contents' }}>
            <dt>انقضا</dt>
            <dd className="prs-num">{formatExpiry(material.expiryMonth, material.expiryYear)}</dd>
          </div>
        </dl>
        {material.cvv ? <RevealSecret value={material.cvv} label="CVV (کد امنیتی پشت کارت)" hint="فقط برای اثبات حضور کارت." /> : null}
        <RevealSecret value={material.pin} label="رمز پرداخت (PIN)" hint="برای تأیید تراکنش؛ هرگز با کسی جز دارنده به اشتراک گذاشته نشود." />
        {material.qrToken ? (
          <div className="prs-stack-3">
            <p className="prs-small prs-muted">
              نشانهٔ QR کارت باید توسط دارنده در بخش کارت خودش چرخانده شود تا رمز تازه و اختصاصی داشته باشد.
            </p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
