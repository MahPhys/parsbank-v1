/**
 * Send — the reference money-movement flow.
 *
 * The order is intentional and mirrors the server's contract:
 *   1. resolve the destination server-side and show the payer who they are paying;
 *   2. collect the amount;
 *   3. collect a *transaction credential* (PIN or account password, + one-time code
 *      when enabled) which the server exchanges for a short-lived authorisation;
 *   4. submit with an Idempotency-Key so a double click or a retry cannot move money
 *      twice — the second submission returns the original receipt.
 *
 * No balance is edited locally: after the transfer the page re-reads the wallet.
 */
import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  AmountInput,
  Badge,
  Button,
  CodeInput,
  DenominationPicker,
  Field,
  Loading,
  MoneyText,
  Panel,
  PanelBody,
  Segmented,
  TextInput,
  formatPrs,
  normalizeDigits,
  toPersianDigits,
} from '@parsbank/ui';
import type { TransactionDto, WalletSummary } from '@parsbank/types';
import { api, apiRequest, describeError, newIdempotencyKey } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { useSession } from '../lib/session.tsx';

interface PreviewResult {
  kind: string;
  destinationNameFa: string | null;
  cardNumberMasked: string | null;
  walletRef: string | null;
  payable: boolean;
  reasonFa?: string;
}

interface AuthorizationResult {
  authorizationId: string;
  expiresAt: string;
}

const DENOMINATIONS = [1, 2, 5, 10, 50, 100, 200] as const;

export function Send() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useSession();
  const prefilled = (location.state as { destinationCardNumber?: string } | null)?.destinationCardNumber ?? '';

  const wallets = useAsync<{ items: WalletSummary[] }>(() => api.get<{ items: WalletSummary[] }>('/me/wallets'), []);
  const walletList = wallets.data?.items ?? [];
  const [walletRef, setWalletRef] = useState<string>('');
  const activeWallet = walletList.find((wallet) => wallet.publicRef === walletRef) ?? walletList[0] ?? null;

  const [mode, setMode] = useState<'card' | 'wallet'>(prefilled ? 'card' : 'card');
  const [destination, setDestination] = useState(prefilled);
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const [stage, setStage] = useState<'form' | 'authorize' | 'done'>('form');
  const [credentialKind, setCredentialKind] = useState<'PIN' | 'PASSWORD'>('PIN');
  const [credential, setCredential] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ transaction: TransactionDto; replayed: boolean } | null>(null);

  const amountMinor = Number(amount || '0');
  const destinationReady = destination.trim().length >= 10;

  const previewDestination = async () => {
    setPreviewing(true);
    setPreviewError(null);
    try {
      const body =
        mode === 'card'
          ? { receiverCardNumber: normalizeDigits(destination).replace(/\D/g, '') }
          : { receiverWalletRef: destination.trim() };
      const value = await api.post<PreviewResult>('/transfers/preview', body);
      setPreview(value);
      if (!value.payable) setPreviewError(value.reasonFa ?? 'این مقصد در حال حاضر قابل دریافت نیست.');
    } catch (caught) {
      setPreview(null);
      setPreviewError(describeError(caught));
    } finally {
      setPreviewing(false);
    }
  };

  const canContinue = useMemo(
    () => Boolean(activeWallet) && preview?.payable === true && amountMinor > 0 && amountMinor <= (activeWallet?.balanceMinor ?? 0),
    [activeWallet, preview, amountMinor],
  );

  const authorizeAndSend = async () => {
    if (!activeWallet || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const authorization = await api.post<AuthorizationResult>('/auth/transaction-authorization', {
        walletRef: activeWallet.publicRef,
        credential: {
          kind: credentialKind,
          value: credential,
          totpCode: totpCode.trim() ? totpCode.trim() : undefined,
        },
        maxAmountMinor: amountMinor,
      });

      const transfer = await apiRequest<{ transaction: TransactionDto; replayed: boolean }>('/transfers', {
        method: 'POST',
        idempotencyKey: newIdempotencyKey('transfer'),
        body: {
          senderWalletRef: activeWallet.publicRef,
          ...(mode === 'card'
            ? { receiverCardNumber: normalizeDigits(destination).replace(/\D/g, '') }
            : { receiverWalletRef: destination.trim() }),
          amountMinor,
          memo: memo.trim() ? memo.trim() : null,
          transactionAuthorizationId: authorization.authorizationId,
        },
      });

      setResult(transfer);
      setStage('done');
      setCredential('');
      setTotpCode('');
      await wallets.reload();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  if (wallets.loading && walletList.length === 0) return <Loading label="در حال خواندن کیف پول‌ها…" />;
  if (walletList.length === 0) {
    return (
      <div className="prs-container prs-container-narrow">
        <Alert tone="warning" title="کیف پولی برای این حساب وجود ندارد">
          برای انتقال، نخست باید کیف پولی صادر شود. با کارگزار شبکه تماس بگیرید.
        </Alert>
      </div>
    );
  }

  return (
    <div className="prs-container prs-container-narrow prs-stack-6">
      <div className="prs-row prs-between prs-wrap">
        <div>
          <h1>انتقال پارسه</h1>
          <p className="prs-small prs-muted">
            مقصد با شمارهٔ کارت یا شناسهٔ کیف پول مشخص می‌شود. پیش از هر حرکت پول، مقصد در سرور بررسی و
            نام دارنده نمایش داده می‌شود.
          </p>
        </div>
        <Link className="prs-btn prs-btn--sm prs-btn--outline" to="/dashboard">
          بازگشت به نمای حساب
        </Link>
      </div>

      {stage === 'done' && result ? (
        <Panel title="انتقال انجام شد" icon="check">
          <PanelBody>
            <div className="prs-stack-4">
              <div className="prs-stat">
                <span className="prs-stat__label">مبلغ انتقال‌یافته</span>
                <span className="prs-hero__amount" style={{ color: 'var(--prs-color-neutral-900)' }}>
                  <span className="prs-num">{formatPrs(result.transaction.amountMinor)}</span>
                  <span className="prs-hero__unit">پارسه</span>
                </span>
                <span className="prs-small prs-muted">
                  {result.transaction.counterpartyNameFa ?? 'مقصد ثبت‌شده'} ·{' '}
                  {result.transaction.counterpartyCardMasked ?? ''}
                </span>
              </div>
              {result.replayed ? (
                <Alert tone="info" title="این درخواست پیش‌تر ثبت شده بود">
                  پاسخ سرور همان رسید نخستین بار است و پول دوباره منتقل نشد.
                </Alert>
              ) : null}
              <dl className="prs-kv">
                <div style={{ display: 'contents' }}>
                  <dt>شناسهٔ تراکنش</dt>
                  <dd className="prs-num">{result.transaction.reference}</dd>
                </div>
                <div style={{ display: 'contents' }}>
                  <dt>دفتر کل</dt>
                  <dd>دو ثبت متوازن بدهکار/بستانکار</dd>
                </div>
              </dl>
              <div className="prs-row prs-wrap">
                <Button variant="primary" icon="receipt" onClick={() => navigate(`/transactions/${result.transaction.reference}`)}>
                  مشاهدهٔ رسید
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setResult(null);
                    setStage('form');
                    setAmount('');
                    setMemo('');
                    setPreview(null);
                    setDestination('');
                  }}
                >
                  انتقال تازه
                </Button>
              </div>
            </div>
          </PanelBody>
        </Panel>
      ) : (
        <section className="prs-split">
          <div className="prs-stack-5">
            <Panel title="۱ · مقصد" subtitle="شمارهٔ کارت ۱۲ رقمی یا شناسهٔ کیف پول" icon="send">
              <PanelBody>
                <div className="prs-stack-4">
                  <Segmented
                    label="نوع مقصد"
                    value={mode}
                    onChange={(next) => {
                      setMode(next as 'card' | 'wallet');
                      setDestination('');
                      setPreview(null);
                      setPreviewError(null);
                    }}
                    options={[
                      { id: 'card', label: 'شمارهٔ کارت' },
                      { id: 'wallet', label: 'شناسهٔ کیف پول' },
                    ]}
                  />

                  <Field
                    label={mode === 'card' ? 'شمارهٔ کارت مقصد' : 'شناسهٔ کیف پول مقصد'}
                    hint={mode === 'card' ? `${toPersianDigits(normalizeDigits(destination).replace(/\D/g, '').length)}/۱۲ رقم` : 'مانند PRS-W-000123'}
                  >
                    <TextInput
                      numeric={mode === 'card'}
                      value={destination}
                      onChange={(event) => {
                        setDestination(event.target.value);
                        setPreview(null);
                      }}
                      onBlur={() => {
                        if (destinationReady) void previewDestination();
                      }}
                      placeholder={mode === 'card' ? '0000 0000 0000' : 'PRS-W-000123'}
                    />
                  </Field>

                  <div className="prs-row prs-wrap">
                    <Button variant="outline" icon="search" loading={previewing} disabled={!destinationReady} onClick={() => void previewDestination()}>
                      بررسی مقصد
                    </Button>
                    {previewError ? <span className="prs-error">{previewError}</span> : null}
                  </div>

                  {preview?.payable ? (
                    <Alert tone="success" title="مقصد تأیید شد">
                      <div className="prs-stack-2" style={{ marginTop: 'var(--prs-space-2)' }}>
                        <span>
                          دارندهٔ حساب: <strong>{preview.destinationNameFa ?? 'نامشخص'}</strong>
                        </span>
                        {preview.cardNumberMasked ? (
                          <span className="prs-num" dir="ltr">
                            {preview.cardNumberMasked}
                          </span>
                        ) : (
                          <span className="prs-num">{preview.walletRef}</span>
                        )}
                      </div>
                    </Alert>
                  ) : null}
                </div>
              </PanelBody>
            </Panel>

            <Panel title="۲ · مبلغ و یادداشت" subtitle="کوچک‌ترین واحد، یک پارسه است؛ کسری وجود ندارد." icon="chart">
              <PanelBody>
                <div className="prs-stack-4">
                  <Field label="مبلغ" hint={activeWallet ? `موجودی این کیف پول: ${formatPrs(activeWallet.balanceMinor, true)}` : undefined}>
                    <AmountInput value={amount} onValueChange={setAmount} invalid={amountMinor > (activeWallet?.balanceMinor ?? 0)} />
                  </Field>
                  <DenominationPicker
                    denominations={DENOMINATIONS}
                    selected={null}
                    onSelect={(denomination) => setAmount(String(Number(amount || '0') + denomination))}
                  />
                  <Field label="یادداشت (اختیاری)" hint="حداکثر ۲۰۰ نویسه؛ در رسید و دفتر کل ثبت می‌شود.">
                    <TextInput value={memo} maxLength={200} onChange={(event) => setMemo(event.target.value)} placeholder="بابت…" />
                  </Field>
                  {activeWallet && amountMinor > activeWallet.balanceMinor ? (
                    <Alert tone="critical" title="موجودی کافی نیست">
                      این انتقال در سرور رد می‌شود. موجودی در دسترس: {formatPrs(activeWallet.balanceMinor, true)}.
                    </Alert>
                  ) : null}
                </div>
              </PanelBody>
            </Panel>
          </div>

          <div className="prs-stack-5">
            <Panel title="۳ · تأیید نهایی" subtitle="قبل از ارسال بازخوانی کنید" icon="shield">
              <PanelBody>
                <dl className="prs-kv">
                  <div style={{ display: 'contents' }}>
                    <dt>از کیف پول</dt>
                    <dd className="prs-num">{activeWallet?.publicRef ?? '—'}</dd>
                  </div>
                  <div style={{ display: 'contents' }}>
                    <dt>به</dt>
                    <dd>{preview?.destinationNameFa ?? '— مقصد بررسی نشده —'}</dd>
                  </div>
                  <div style={{ display: 'contents' }}>
                    <dt>مبلغ</dt>
                    <dd>
                      <MoneyText minor={amountMinor} withUnit size="lg" />
                    </dd>
                  </div>
                  <div style={{ display: 'contents' }}>
                    <dt>کارمزد</dt>
                    <dd>۰ پارسه</dd>
                  </div>
                </dl>

                <div className="prs-receipt__divider" />

                {stage === 'form' ? (
                  <Button variant="primary" size="lg" block icon="send" disabled={!canContinue} onClick={() => setStage('authorize')}>
                    ادامه و دریافت مجوز پرداخت
                  </Button>
                ) : (
                  <div className="prs-stack-4">
                    <Segmented
                      label="نوع مدرک"
                      value={credentialKind}
                      onChange={(next) => setCredentialKind(next as 'PIN' | 'PASSWORD')}
                      options={[
                        { id: 'PIN', label: 'رمز ۴ رقمی کارت' },
                        { id: 'PASSWORD', label: 'گذرواژهٔ حساب' },
                      ]}
                    />
                    {credentialKind === 'PIN' ? (
                      <Field label="رمز پرداخت کارت" hint="رمز روی کارت چاپ نشده است و در سرور فقط به شکل درهم‌سازیشده نگه‌داری می‌شود.">
                        <CodeInput label="رمز پرداخت" secret value={credential} onValueChange={setCredential} />
                      </Field>
                    ) : (
                      <Field label="گذرواژهٔ حساب">
                        <TextInput type="password" autoComplete="current-password" value={credential} onChange={(event) => setCredential(event.target.value)} />
                      </Field>
                    )}
                    {session?.mfaSatisfied ? (
                      <Field label="کد یک‌بارمصرف (در صورت فعال بودن)">
                        <TextInput numeric value={totpCode} onChange={(event) => setTotpCode(event.target.value)} placeholder="000000" />
                      </Field>
                    ) : null}
                    {error ? <Alert tone="critical" title="انتقال انجام نشد">{error}</Alert> : null}
                    <div className="prs-row prs-wrap">
                      <Button variant="primary" icon="check" loading={busy} onClick={() => void authorizeAndSend()} disabled={credential.length < 4}>
                        تأیید و انتقال
                      </Button>
                      <Button variant="outline" onClick={() => setStage('form')} disabled={busy}>
                        بازگشت
                      </Button>
                    </div>
                  </div>
                )}
              </PanelBody>
            </Panel>

            <Alert tone="info" title="چه چیزی محافظت می‌شود؟">
              هر انتقال یک کلید یکتاسازی و یک مجوز کوتاه‌مدت دارد. ارسال دوبارهٔ همان درخواست، پول را دو
              بار جابه‌جا نمی‌کند و همان رسید را برمی‌گرداند.
            </Alert>

            <Panel title="کیف پول مبدأ" icon="wallet">
              <PanelBody>
                <div className="prs-stack-3">
                  {walletList.map((wallet) => (
                    <button
                      key={wallet.walletId}
                      type="button"
                      className={wallet.walletId === activeWallet?.walletId ? 'prs-choice prs-choice--active' : 'prs-choice'}
                      onClick={() => setWalletRef(wallet.publicRef)}
                    >
                      <span className="prs-grow">{wallet.labelFa}</span>
                      <span className="prs-num">{formatPrs(wallet.balanceMinor, true)}</span>
                      <Badge tone={statusToneLocal(wallet.status)}>{wallet.status === 'ACTIVE' ? 'فعال' : wallet.status}</Badge>
                    </button>
                  ))}
                </div>
              </PanelBody>
            </Panel>
          </div>
        </section>
      )}
    </div>
  );
}

function statusToneLocal(status: string): 'positive' | 'warning' | 'critical' | 'muted' {
  if (status === 'ACTIVE') return 'positive';
  if (status === 'FROZEN') return 'critical';
  if (status === 'CREATED') return 'warning';
  return 'muted';
}
