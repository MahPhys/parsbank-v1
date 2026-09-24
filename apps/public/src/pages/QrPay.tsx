/**
 * QR payment — the payer's confirmation screen.
 *
 * The destination card number is pre-filled from the QR session and shown as
 * verified. If it were ever altered, the server compares the presented number with
 * the number the session was opened for and aborts (`QR_DESTINATION_MISMATCH`), so
 * a tampered page cannot redirect the money. The amount, the payer's CVV and the
 * transaction credential are supplied here; the CVV alone is never enough.
 */
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
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
  formatCountdown,
  formatPrs,
  groupCardNumber,
  labelFa,
  statusTone,
  toPersianDigits,
} from '@parsbank/ui';
import type { QrPaymentSession, WalletSummary } from '@parsbank/types';
import { api, apiRequest, describeError, newIdempotencyKey } from '../lib/api.ts';
import { useAsync, usePolling } from '../lib/hooks.ts';
import { useSession } from '../lib/session.tsx';

const DENOMINATIONS = [1, 2, 5, 10, 50, 100, 200] as const;

export function QrPay() {
  const { sessionRef = '' } = useParams<{ sessionRef: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { session } = useSession();
  const prefill = (location.state as { destinationCardNumber?: string } | null)?.destinationCardNumber ?? '';

  const qrSession = useAsync<QrPaymentSession>(
    () => api.get<QrPaymentSession>(`/qr/session/${encodeURIComponent(sessionRef)}`, { anonymous: true }),
    [sessionRef],
  );
  const wallets = useAsync<{ items: WalletSummary[] }>(() => api.get<{ items: WalletSummary[] }>('/me/wallets'), []);
  const walletList = wallets.data?.items ?? [];
  const activeWallet = walletList.find((wallet) => wallet.isPrimary) ?? walletList[0] ?? null;

  const destination = prefill || qrSession.data?.destinationCardNumber || '';

  const [amount, setAmount] = useState('');
  const [cvv, setCvv] = useState('');
  const [memo, setMemo] = useState('');
  const [credentialKind, setCredentialKind] = useState<'PIN' | 'PASSWORD'>('PIN');
  const [credential, setCredential] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ reference: string; replayed: boolean } | null>(null);

  usePolling(() => void qrSession.reload(), 20_000, Boolean(qrSession.data && qrSession.data.status === 'OPEN'));

  const amountMinor = Number(amount || '0');
  const payable = qrSession.data?.status === 'OPEN' || qrSession.data?.status === 'AWAITING_AUTHORIZATION';
  const enough = activeWallet ? amountMinor <= activeWallet.balanceMinor : false;

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await apiRequest<{ transactionReference: string; replayed: boolean }>(
        `/qr/${encodeURIComponent(sessionRef)}/pay`,
        {
          method: 'POST',
          idempotencyKey: newIdempotencyKey('qrpay'),
          body: {
            amountMinor,
            destinationCardNumber: destination,
            cvv,
            walletRef: activeWallet?.publicRef,
            credential: {
              kind: credentialKind,
              value: credential,
              totpCode: totpCode.trim() ? totpCode.trim() : undefined,
            },
            memo: memo.trim() ? memo.trim() : null,
          },
        },
      );
      setDone({ reference: result.transactionReference, replayed: result.replayed });
      setCredential('');
      setCvv('');
      await Promise.all([qrSession.reload(), wallets.reload()]);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  if (qrSession.loading && !qrSession.data) return <Loading label="در حال باز کردن نشست پرداخت…" />;
  if (qrSession.error && !qrSession.data) {
    return (
      <div className="prs-container prs-container-narrow">
        <Alert tone="critical" title="این نشست پرداخت باز نشد">
          {qrSession.error}
          <div style={{ marginTop: 'var(--prs-space-3)' }}>
            <Link className="prs-btn prs-btn--sm prs-btn--outline" to="/scan">
              بازگشت به اسکن
            </Link>
          </div>
        </Alert>
      </div>
    );
  }
  if (!qrSession.data) return null;
  const data = qrSession.data;

  return (
    <div className="prs-container prs-container-narrow prs-stack-6">
      <div className="prs-row prs-between prs-wrap">
        <div>
          <h1>پرداخت با کد کارت</h1>
          <p className="prs-small prs-muted">
            مقصد از شناسهٔ کد پیش‌پر شده و تأییدشده است. مبلغ و مدرک پرداخت را شما وارد می‌کنید.
          </p>
        </div>
        <Badge tone={statusTone(data.status)} dot>
          {labelFa(data.status)}
        </Badge>
      </div>

      {done ? (
        <Panel title="پرداخت ثبت شد" icon="check">
          <PanelBody>
            <div className="prs-stack-4">
              <MoneyText minor={amountMinor} withUnit size="xl" />
              <dl className="prs-kv">
                <div style={{ display: 'contents' }}>
                  <dt>شناسهٔ تراکنش</dt>
                  <dd className="prs-num">{done.reference || '—'}</dd>
                </div>
                <div style={{ display: 'contents' }}>
                  <dt>مقصد</dt>
                  <dd className="prs-num" dir="ltr">
                    {groupCardNumber(data.destinationCardNumber, false)}
                  </dd>
                </div>
              </dl>
              {done.replayed ? (
                <Alert tone="info" title="این پرداخت پیش‌تر انجام شده بود">
                  همان رسید نخستین بار بازگردانده شد؛ پول دوباره منتقل نشد.
                </Alert>
              ) : null}
              <div className="prs-row prs-wrap">
                {done.reference ? (
                  <Button variant="primary" icon="receipt" onClick={() => navigate(`/transactions/${done.reference}`)}>
                    مشاهدهٔ رسید
                  </Button>
                ) : null}
                <Button variant="outline" onClick={() => navigate('/dashboard')}>
                  نمای حساب
                </Button>
              </div>
            </div>
          </PanelBody>
        </Panel>
      ) : (
        <section className="prs-split">
          <Panel title="پرداخت" icon="send">
            <PanelBody>
              <div className="prs-stack-4">
                <div className="prs-stat">
                  <span className="prs-stat__label">کارت مقصد (از کد خوانده‌شده)</span>
                  <span className="prs-num" style={{ fontSize: 'var(--prs-font-size-xl)', fontWeight: 600 }} dir="ltr">
                    {groupCardNumber(data.destinationCardNumber, false)}
                  </span>
                  <span className="prs-small">
                    {data.destinationCardholderNameFa} ·{' '}
                    <Link to={`/secure/card/${encodeURIComponent(sessionRef)}`}>صفحهٔ عمومی کارت</Link>
                  </span>
                </div>

                <Field label="مبلغ" hint={activeWallet ? `موجودی ${activeWallet.labelFa}: ${formatPrs(activeWallet.balanceMinor, true)}` : undefined}>
                  <AmountInput value={amount} onValueChange={setAmount} invalid={!enough} />
                </Field>
                <DenominationPicker
                  denominations={DENOMINATIONS}
                  selected={null}
                  onSelect={(denomination) => setAmount(String(Number(amount || '0') + denomination))}
                />

                <Field label="کد امنیتی کارت خودتان (CVV)" hint={`سه رقم پشت کارت ${toPersianDigits(3)} رقمی؛ فقط برای اثبات حضور کارت.`}>
                  <CodeInput label="کد امنیتی" secret length={3} value={cvv} onValueChange={setCvv} />
                </Field>

                <Segmented
                  label="مدرک پرداخت"
                  value={credentialKind}
                  onChange={(next) => setCredentialKind(next as 'PIN' | 'PASSWORD')}
                  options={[
                    { id: 'PIN', label: 'رمز ۴ رقمی کارت' },
                    { id: 'PASSWORD', label: 'گذرواژهٔ حساب' },
                  ]}
                />
                {credentialKind === 'PIN' ? (
                  <CodeInput label="رمز پرداخت" secret value={credential} onValueChange={setCredential} />
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

                <Field label="یادداشت (اختیاری)">
                  <TextInput value={memo} maxLength={200} onChange={(event) => setMemo(event.target.value)} placeholder={`پرداخت ${data.sessionRef}`} />
                </Field>

                {error ? (
                  <Alert tone="critical" title="پرداخت انجام نشد">
                    {error}
                  </Alert>
                ) : null}
                {!payable ? (
                  <Alert tone="warning" title="این نشست دیگر قابل پرداخت نیست">
                    وضعیت نشست: {labelFa(data.status)}. برای پرداخت تازه، کد کارت را دوباره اسکن کنید.
                  </Alert>
                ) : null}
                {!enough && amountMinor > 0 ? (
                  <Alert tone="critical" title="موجودی کافی نیست">
                    مبلغ از موجودی کیف پول انتخابی بیشتر است؛ سرور این پرداخت را رد می‌کند.
                  </Alert>
                ) : null}

                <Button
                  variant="primary"
                  size="lg"
                  block
                  icon="check"
                  loading={busy}
                  disabled={!payable || !enough || amountMinor <= 0 || cvv.length !== 3 || credential.length < 4 || !activeWallet}
                  onClick={() => void pay()}
                >
                  پرداخت {amountMinor > 0 ? formatPrs(amountMinor, true) : ''}
                </Button>
              </div>
            </PanelBody>
          </Panel>

          <div className="prs-stack-5">
            <Panel title="نشست پرداخت" icon="clock">
              <PanelBody>
                <dl className="prs-kv">
                  <div style={{ display: 'contents' }}>
                    <dt>شناسهٔ نشست</dt>
                    <dd className="prs-num">{data.sessionRef}</dd>
                  </div>
                  <div style={{ display: 'contents' }}>
                    <dt>مهلت</dt>
                    <dd className="prs-num">{formatCountdown(data.expiresAt)}</dd>
                  </div>
                  <div style={{ display: 'contents' }}>
                    <dt>کارت مقصد (پوشیده)</dt>
                    <dd className="prs-num" dir="ltr">
                      {data.destinationCardNumberMasked}
                    </dd>
                  </div>
                </dl>
                <p className="prs-small prs-muted" style={{ marginTop: 'var(--prs-space-3)' }}>
                  اگر شمارهٔ کارتی که درخواست پرداخت به آن ارسال می‌شود با شمارهٔ ثبت‌شده در نشست یکی نباشد،
                  سرور نشست را «نیمه‌کاره» می‌کند و پولی جابه‌جا نمی‌شود.
                </p>
              </PanelBody>
            </Panel>

            <Panel title="کیف پول پرداخت" icon="wallet">
              <PanelBody>
                {activeWallet ? (
                  <div className="prs-stack-3">
                    <div className="prs-row prs-between">
                      <span>{activeWallet.labelFa}</span>
                      <MoneyText minor={activeWallet.balanceMinor} withUnit size="lg" />
                    </div>
                    <div className="prs-num prs-small prs-muted">{activeWallet.publicRef}</div>
                  </div>
                ) : (
                  <Loading label="کیف پولی یافت نشد." />
                )}
              </PanelBody>
            </Panel>

            <Alert tone="info" title="کد امنیتی تنها عامل پرداخت نیست">
              CVV فقط حضور کارت را اثبات می‌کند. مجوز واقعی پرداخت، رمز یا گذرواژهٔ شماست که برای همین
              پرداخت و در همین مبلغ صادر می‌شود.
            </Alert>
          </div>
        </section>
      )}
    </div>
  );
}
