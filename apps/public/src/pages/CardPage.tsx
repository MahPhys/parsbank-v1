/**
 * Card — the account holder's own card, front and back.
 *
 * The back renders the QR that is printed on the physical card. The CVV is *never*
 * drawn: the artwork and this page both leave it out, and the value can only be
 * verified inside the payment flow. Rotating the QR invalidates the previous one.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  BankCard,
  Button,
  CodeInput,
  Field,
  Loading,
  Panel,
  PanelBody,
  Modal,
  formatDateTime,
  formatExpiry,
  formatPrs,
  groupCardNumber,
  labelFa,
  statusTone,
} from '@parsbank/ui';
import type { CardSummary, WalletSummary } from '@parsbank/types';
import QRCode from 'qrcode';
import { api, describeError } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';

export function CardPage() {
  const cards = useAsync<{ items: CardSummary[] }>(() => api.get<{ items: CardSummary[] }>('/me/cards'), []);
  const wallets = useAsync<{ items: WalletSummary[] }>(() => api.get<{ items: WalletSummary[] }>('/me/wallets'), []);
  const list = cards.data?.items ?? [];
  const [cardId, setCardId] = useState('');
  const active = list.find((card) => card.cardId === cardId) ?? list[0] ?? null;

  const [qr, setQr] = useState<{ dataUri: string; url: string; prefix: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinMessage, setPinMessage] = useState<string | null>(null);

  useEffect(() => {
    setQr(null);
    setError(null);
  }, [cardId]);

  const rotate = async () => {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ qrPayload: string; securePath: string; tokenPrefix: string }>(
        `/me/cards/${active.cardId}/qr/rotate`,
      );
      const url = `${window.location.origin}${result.securePath}`;
      const dataUri = await QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: '#141A24', light: '#FFFFFF' } });
      setQr({ dataUri, url, prefix: result.tokenPrefix });
      await cards.reload();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const savePin = async () => {
    if (!active) return;
    setBusy(true);
    setPinMessage(null);
    try {
      await api.post(`/me/cards/${active.cardId}/pin`, {
        currentPin: currentPin || undefined,
        newPin,
      });
      setPinMessage('رمز پرداخت کارت تغییر کرد. رمز پیشین دیگر کار نمی‌کند.');
      setCurrentPin('');
      setNewPin('');
      setPinOpen(false);
    } catch (caught) {
      setPinMessage(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  if (cards.loading && list.length === 0) return <Loading label="در حال خواندن کارت‌ها…" />;

  return (
    <div className="prs-container prs-container-wide prs-stack-6">
      <div className="prs-row prs-between prs-wrap">
        <div>
          <h1>کارت پارسه</h1>
          <p className="prs-small prs-muted">
            کارت، ابزار پرداخت حساب است: شمارهٔ ۱۲ رقمی، تاریخ انقضا، کد امنیتی و رمز پرداخت. رمز و کد
            امنیتی هرگز روی کارت چاپ نمی‌شوند و در سامانه فقط به شکل محافظت‌شده نگه‌داری می‌شوند.
          </p>
        </div>
        <div className="prs-row-2">
          <Link className="prs-btn prs-btn--sm prs-btn--outline" to="/receive">
            نمایش کد دریافت
          </Link>
          <Link className="prs-btn prs-btn--sm prs-btn--quiet" to="/security">
            امنیت حساب
          </Link>
        </div>
      </div>

      {error ? <Alert tone="critical" title="ساخت کد پرداخت ممکن نشد">{error}</Alert> : null}
      {pinMessage ? <Alert tone={pinMessage.includes('تغییر کرد') ? 'success' : 'critical'}>{pinMessage}</Alert> : null}

      {list.length === 0 ? (
        <Alert tone="warning" title="کارتی صادر نشده است">
          کارگزاری شبکه می‌تواند برای این حساب کارت صادر کند. تا آن زمان، دریافت پارسه با شناسهٔ کیف پول
          امکان‌پذیر است.
        </Alert>
      ) : (
        <section className="prs-split">
          <Panel title="کارت فعال" subtitle="نمای روی و پشت کارت؛ کد امنیتی هرگز نمایش داده نمی‌شود" icon="card">
            <PanelBody>
              {active ? (
                <div className="prs-stack-5">
                  <div className="prs-row prs-wrap" style={{ gap: 'var(--prs-space-5)' }}>
                    <BankCard card={active} variant="front" small />
                    <BankCard card={active} variant="back" small qrDataUri={qr?.dataUri ?? null} />
                  </div>

                  <dl className="prs-kv">
                    <div style={{ display: 'contents' }}>
                      <dt>شمارهٔ کارت</dt>
                      <dd className="prs-num" dir="ltr">
                        {groupCardNumber(active.cardNumber, false)}
                      </dd>
                    </div>
                    <div style={{ display: 'contents' }}>
                      <dt>دارنده</dt>
                      <dd>{active.cardholderNameFa}</dd>
                    </div>
                    <div style={{ display: 'contents' }}>
                      <dt>انقضا</dt>
                      <dd className="prs-num">{formatExpiry(active.expiryMonth, active.expiryYear)}</dd>
                    </div>
                    <div style={{ display: 'contents' }}>
                      <dt>شبکه</dt>
                      <dd>
                        {active.networkLabel} · {active.scheme}
                      </dd>
                    </div>
                    <div style={{ display: 'contents' }}>
                      <dt>وضعیت</dt>
                      <dd>
                        <Badge tone={statusTone(active.status)} dot>
                          {labelFa(active.status)}
                        </Badge>
                      </dd>
                    </div>
                    <div style={{ display: 'contents' }}>
                      <dt>تاریخ صدور</dt>
                      <dd>{formatDateTime(active.issuedAt)}</dd>
                    </div>
                    <div style={{ display: 'contents' }}>
                      <dt>کد پرداخت فعال</dt>
                      <dd className="prs-num">{active.qrTokenPrefix ?? 'ساخته نشده'}</dd>
                    </div>
                  </dl>

                  <div className="prs-row prs-wrap">
                    <Button variant="primary" icon="refresh" loading={busy} onClick={() => void rotate()}>
                      {qr ? 'چرخش کد پرداخت' : 'ساخت کد پرداخت'}
                    </Button>
                    <Button variant="outline" icon="key" onClick={() => setPinOpen(true)}>
                      تغییر رمز پرداخت
                    </Button>
                    <Link className="prs-btn prs-btn--quiet" to="/security">
                      مسدودسازی و وضعیت کارت
                    </Link>
                  </div>

                  <Alert tone="info" title="کد امنیتی (CVV) اینجا نمایش داده نمی‌شود">
                    CVV سه رقمی است و تنها در زمان پرداخت بررسی می‌شود. هیچ صفحه‌ای آن را بازنمی‌تاباند و
                    هیچ‌گاه تنها عامل تأیید پرداخت نیست.
                  </Alert>
                </div>
              ) : null}
            </PanelBody>
          </Panel>

          <div className="prs-stack-5">
            <Panel title="کیف پول پشت این کارت" icon="wallet">
              <PanelBody>
                <div className="prs-stack-3">
                  {(wallets.data?.items ?? []).map((wallet) => (
                    <div key={wallet.walletId} className="prs-row prs-between">
                      <div>
                        <div style={{ fontWeight: 600 }}>{wallet.labelFa}</div>
                        <div className="prs-num prs-small prs-muted">{wallet.publicRef}</div>
                      </div>
                      <span className="prs-num">{formatPrs(wallet.balanceMinor, true)}</span>
                    </div>
                  ))}
                </div>
              </PanelBody>
            </Panel>

            <Panel title="کارت‌های این حساب" icon="grid">
              <PanelBody>
                <div className="prs-stack-3">
                  {list.map((card) => (
                    <button
                      key={card.cardId}
                      type="button"
                      className={card.cardId === active?.cardId ? 'prs-choice prs-choice--active' : 'prs-choice'}
                      onClick={() => setCardId(card.cardId)}
                    >
                      <span className="prs-num prs-grow" dir="ltr">
                        {groupCardNumber(card.cardNumber, false)}
                      </span>
                      <Badge tone={statusTone(card.status)}>{labelFa(card.status)}</Badge>
                    </button>
                  ))}
                </div>
              </PanelBody>
            </Panel>
          </div>
        </section>
      )}

      <Modal
        open={pinOpen}
        title="تغییر رمز پرداخت کارت"
        onClose={() => setPinOpen(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setPinOpen(false)} disabled={busy}>
              انصراف
            </Button>
            <Button variant="primary" loading={busy} disabled={newPin.length !== 4} onClick={() => void savePin()}>
              ثبت رمز تازه
            </Button>
          </>
        }
      >
        <div className="prs-stack-4">
          <Alert tone="warning" title="رمز پرداخت با گذرواژهٔ حساب یکی نیست">
            رمز ۴ رقمی برای تأیید پرداخت‌هاست. اگر رمز فعلی را می‌دانید وارد کنید؛ در غیر این صورت کارگزار
            شبکه باید بازنشانی کند.
          </Alert>
          <Field label="رمز فعلی (در صورت وجود)">
            <CodeInput label="رمز فعلی" secret value={currentPin} onValueChange={setCurrentPin} />
          </Field>
          <Field label="رمز تازه" hint="چهار رقم؛ پیامدهای حدس تکراری ثبت و پس از چند تلاش قفل می‌شود.">
            <CodeInput label="رمز تازه" secret value={newPin} onValueChange={setNewPin} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
