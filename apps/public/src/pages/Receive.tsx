/**
 * Receive — what the account holder shows to be paid.
 *
 * The QR encodes the *secure page URL* for the card's opaque token, so any camera
 * app opens `/secure/card/{token}` directly. The payload carries no password, no
 * PIN, no CVV, no balance and no database identifier — only the token, which is
 * stored hashed on the server and can be rotated instantly.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  BankCard,
  Button,
  CopyButton,
  Loading,
  Panel,
  PanelBody,
  formatExpiry,
  formatPrs,
  groupCardNumber,
  labelFa,
  statusTone,
  toPersianDigits,
} from '@parsbank/ui';
import type { CardSummary, WalletSummary } from '@parsbank/types';
import QRCode from 'qrcode';
import { api, describeError } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';

export function Receive() {
  const cards = useAsync<{ items: CardSummary[] }>(() => api.get<{ items: CardSummary[] }>('/me/cards'), []);
  const wallets = useAsync<{ items: WalletSummary[] }>(() => api.get<{ items: WalletSummary[] }>('/me/wallets'), []);
  const cardList = cards.data?.items ?? [];
  const [cardId, setCardId] = useState<string>('');
  const activeCard = cardList.find((card) => card.cardId === cardId) ?? cardList[0] ?? null;

  const [qrDataUri, setQrDataUri] = useState<string | null>(null);
  const [payload, setPayload] = useState<string | null>(null);
  const [securePath, setSecurePath] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQrDataUri(null);
    setPayload(null);
    setSecurePath(null);
  }, [cardId]);

  const rotate = async () => {
    if (!activeCard) return;
    setRotating(true);
    setError(null);
    try {
      const result = await api.post<{ qrPayload: string; securePath: string; tokenPrefix: string; warningFa: string }>(
        `/me/cards/${activeCard.cardId}/qr/rotate`,
      );
      const url = `${window.location.origin}${result.securePath}`;
      const dataUri = await QRCode.toDataURL(url, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 320,
        color: { dark: '#141A24', light: '#FFFFFF' },
      });
      setQrDataUri(dataUri);
      setPayload(url);
      setSecurePath(result.securePath);
      await cards.reload();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setRotating(false);
    }
  };

  if (cards.loading && cardList.length === 0) return <Loading label="در حال خواندن کارت‌ها…" />;

  if (cardList.length === 0) {
    return (
      <div className="prs-container prs-container-narrow">
        <Alert tone="warning" title="کارتی برای این حساب صادر نشده است">
          برای دریافت پارسه می‌توانید شناسهٔ کیف پول خود را در اختیار پرداخت‌کننده بگذارید.
          <div style={{ marginTop: 'var(--prs-space-3)' }} className="prs-stack-2">
            {(wallets.data?.items ?? []).map((wallet) => (
              <div key={wallet.walletId} className="prs-row prs-between">
                <span className="prs-num">{wallet.publicRef}</span>
                <CopyButton value={wallet.publicRef} />
              </div>
            ))}
          </div>
        </Alert>
      </div>
    );
  }

  return (
    <div className="prs-container prs-narrow prs-stack-6" style={{ maxWidth: 'var(--prs-container-base)' }}>
      <div className="prs-row prs-between prs-wrap">
        <div>
          <h1>دریافت پارسه</h1>
          <p className="prs-small prs-muted">
            شمارهٔ کارت خود را بگویید، یا کد پرداخت را نشان دهید. پرداخت‌کننده مبلغ را خودش وارد می‌کند.
          </p>
        </div>
        <Link className="prs-btn prs-btn--sm prs-btn--outline" to="/dashboard">
          نمای حساب
        </Link>
      </div>

      {error ? <Alert tone="critical" title="ساخت کد پرداخت ممکن نشد">{error}</Alert> : null}

      <section className="prs-split">
        <Panel title="کارت دریافت" subtitle="این کارت را برای پرداخت‌کننده نشان دهید" icon="card">
          <PanelBody>
            {activeCard ? (
              <div className="prs-stack-5">
                <BankCard card={activeCard} variant="front" />
                <div className="prs-stack-3">
                  <div>
                    <div className="prs-small prs-muted">شمارهٔ کارت</div>
                    <div className="prs-row-2">
                      <span className="prs-num" style={{ fontSize: 'var(--prs-font-size-xl)' }} dir="ltr">
                        {groupCardNumber(activeCard.cardNumber, false)}
                      </span>
                      <CopyButton value={activeCard.cardNumber} />
                    </div>
                  </div>
                  <dl className="prs-kv">
                    <div style={{ display: 'contents' }}>
                      <dt>دارنده</dt>
                      <dd>{activeCard.cardholderNameFa}</dd>
                    </div>
                    <div style={{ display: 'contents' }}>
                      <dt>انقضا</dt>
                      <dd className="prs-num">{formatExpiry(activeCard.expiryMonth, activeCard.expiryYear)}</dd>
                    </div>
                    <div style={{ display: 'contents' }}>
                      <dt>وضعیت</dt>
                      <dd>
                        <Badge tone={statusTone(activeCard.status)}>{labelFa(activeCard.status)}</Badge>
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            ) : (
              <Loading />
            )}
          </PanelBody>
        </Panel>

        <div className="prs-stack-5">
          <Panel title="کد پرداخت (QR)" subtitle="فقط برای همین کارت و تا زمان باطل شدن" icon="scan">
            <PanelBody>
              {qrDataUri ? (
                <div className="prs-stack-4" style={{ alignItems: 'center' }}>
                  <div style={{ background: '#fff', padding: 'var(--prs-space-3)', borderRadius: 'var(--prs-radius-md)', boxShadow: 'var(--prs-shadow-2)' }}>
                    <img src={qrDataUri} alt="کد پرداخت کارت" width={220} height={220} />
                  </div>
                  <Alert tone="info" title="این کد فقط یک بار نمایش داده می‌شود">
                    با ساخت کد تازه، کد پیشین باطل می‌شود و نشست‌های باز آن بسته می‌شوند.
                  </Alert>
                  {payload ? (
                    <div className="prs-stack-2" style={{ width: '100%' }}>
                      <div className="prs-small prs-muted">نشانی صفحهٔ امن (بدون هیچ رمزی)</div>
                      <div className="prs-row-2">
                        <code className="prs-input prs-small" style={{ display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
                          {payload}
                        </code>
                        <CopyButton value={payload} />
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="prs-stack-4">
                  <Alert tone="warning" title="کد پرداخت فعالی نمایش داده نشده است">
                    برای ساخت کد، دکمهٔ زیر را بزنید. کد پیشین (اگر وجود داشته باشد) باطل می‌شود.
                  </Alert>
                  <Button variant="primary" icon="refresh" loading={rotating} onClick={() => void rotate()}>
                    ساخت کد پرداخت
                  </Button>
                  {activeCard?.qrTokenPrefix ? (
                    <span className="prs-small prs-muted">
                      آخرین کد فعال: <span className="prs-num">{activeCard.qrTokenPrefix}</span> · ساخته‌شده{' '}
                      {activeCard.qrTokenIssuedAt ? new Date(activeCard.qrTokenIssuedAt).toLocaleString('fa-IR') : '—'}
                    </span>
                  ) : null}
                </div>
              )}
            </PanelBody>
          </Panel>

          <Panel title="کیف پول‌های من" subtitle="اگر پرداخت‌کننده شناسهٔ کیف پول را ترجیح می‌دهد" icon="wallet">
            <PanelBody>
              <div className="prs-stack-3">
                {(wallets.data?.items ?? []).map((wallet) => (
                  <div key={wallet.walletId} className="prs-row prs-between">
                    <div>
                      <div style={{ fontWeight: 600 }}>{wallet.labelFa}</div>
                      <div className="prs-num prs-small prs-muted">{wallet.publicRef}</div>
                    </div>
                    <div className="prs-row-2">
                      <span className="prs-num">{formatPrs(wallet.balanceMinor, true)}</span>
                      <CopyButton value={wallet.publicRef} />
                    </div>
                  </div>
                ))}
              </div>
            </PanelBody>
          </Panel>

          <Panel title="کارت‌های دیگر" icon="grid">
            <PanelBody>
              <div className="prs-stack-3">
                {cardList.map((card) => (
                  <button
                    key={card.cardId}
                    type="button"
                    className={card.cardId === activeCard?.cardId ? 'prs-choice prs-choice--active' : 'prs-choice'}
                    onClick={() => setCardId(card.cardId)}
                  >
                    <span className="prs-num prs-grow">{groupCardNumber(card.cardNumber, true)}</span>
                    <Badge tone={statusTone(card.status)}>{labelFa(card.status)}</Badge>
                  </button>
                ))}
              </div>
              <p className="prs-small prs-muted" style={{ marginTop: 'var(--prs-space-3)' }}>
                {toPersianDigits(cardList.length)} کارت در این حساب صادر شده است.
              </p>
            </PanelBody>
          </Panel>
        </div>
      </section>
    </div>
  );
}
