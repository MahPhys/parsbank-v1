/**
 * Sign-in.
 *
 * The credential is the 12-digit card number plus the account password, with the
 * one-time code when two-factor is enabled. The screen deliberately says what it
 * does *not* ask for: the card's CVV and PIN are not login factors — they belong to
 * payment authorisation, which happens separately for every money movement.
 */
import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, BrandMark, Button, Field, TextInput, ThemeStyle, toPersianDigits } from '@parsbank/ui';
import { describeError } from '../lib/api.ts';
import { useContent } from '../lib/content.tsx';
import { useSession } from '../lib/session.tsx';

export function Login() {
  const { theme } = useContent();
  const { login, status } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [cardNumber, setCardNumber] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const next = params.get('next') ?? '/dashboard';

  if (status === 'authenticated') return <Navigate to={next} replace />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({
        cardNumber,
        password,
        totpCode: totpCode.trim() ? totpCode.trim() : undefined,
      });
      navigate(next, { replace: true });
    } catch (caught) {
      const message = describeError(caught);
      setError(message);
      if (/عامل دوم|دو مرحله|TOTP|کد یک‌بار/i.test(message)) setNeedsTotp(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ThemeStyle tokens={theme?.tokens} />
      <div className="prs-auth">
        <aside className="prs-auth__aside">
          <div style={{ position: 'relative', zIndex: 1 }}>
            <BrandMark size={52} />
            <h1 style={{ marginTop: 'var(--prs-space-6)', fontSize: 'var(--prs-font-size-2xl)' }}>
              بانک پارس
            </h1>
            <p style={{ opacity: 0.85, maxWidth: '38ch', lineHeight: 2 }}>
              حساب کاربری شما یک دفتر کل است، نه یک کیف پول: هر پارسه سند دارد، هر اسکناس سریال دارد و هر
              تصمیم پولی امضای خودش را.
            </p>
          </div>
          <ul className="prs-stack-3" style={{ position: 'relative', zIndex: 1, listStyle: 'none', padding: 0, margin: 0, opacity: 0.9 }}>
            <li>• ورود با شمارهٔ ۱۲ رقمی کارت و گذرواژهٔ حساب</li>
            <li>• مجوز حرکت پول جدا از ورود صادر می‌شود</li>
            <li>• کد امنیتی کارت (CVV) تنها عامل تأیید پرداخت نیست</li>
            <li>• همهٔ رویدادهای حساس در گزارش حسابرسی ثبت می‌شوند</li>
          </ul>
          <div className="prs-small" style={{ position: 'relative', zIndex: 1, opacity: 0.7 }}>
            پارسه ارز قانونی نیست · شبکهٔ بستهٔ خصوصی
          </div>
        </aside>

        <section className="prs-auth__form">
          <div className="prs-stack-6" style={{ maxWidth: 420, margin: '0 auto', width: '100%' }}>
            <div>
              <h2>ورود به حساب</h2>
              <p className="prs-small prs-muted">شمارهٔ کارت روی روی کارت، و گذرواژهٔ حسابی که در زمان افتتاح تعیین کرده‌اید.</p>
            </div>

            {error ? <Alert tone="critical" title="ورود انجام نشد">{error}</Alert> : null}

            <form className="prs-stack" onSubmit={submit} noValidate>
              <Field
                label="شمارهٔ کارت"
                hint={`۱۲ رقم، بدون خط تیره — ${toPersianDigits(cardNumber.replace(/\D/g, '').length)}/۱۲`}
              >
                <TextInput
                  numeric
                  autoFocus
                  inputMode="numeric"
                  autoComplete="off"
                  value={cardNumber}
                  onChange={(event) => setCardNumber(event.target.value)}
                  placeholder="0000 0000 0000"
                />
              </Field>

              <Field label="گذرواژهٔ حساب">
                <TextInput
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••••"
                />
              </Field>

              {needsTotp ? (
                <Field label="کد عامل دوم" hint="۶ رقم از برنامهٔ تأییدکننده">
                  <TextInput
                    numeric
                    inputMode="numeric"
                    value={totpCode}
                    onChange={(event) => setTotpCode(event.target.value)}
                    placeholder="000000"
                  />
                </Field>
              ) : (
                <button
                  type="button"
                  className="prs-btn prs-btn--quiet prs-btn--sm"
                  onClick={() => setNeedsTotp(true)}
                  style={{ alignSelf: 'flex-start' }}
                >
                  ورود دو مرحله‌ای فعال است
                </button>
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                block
                loading={busy}
                disabled={cardNumber.replace(/\D/g, '').length !== 12 || password.length === 0}
              >
                ورود
              </Button>
            </form>

            <Alert tone="info">
              رمز کارت (PIN) و کد امنیتی (CVV) در این صفحه پرسیده نمی‌شوند. برای هر پرداخت، مجوز جداگانه
              و کوتاه‌مدت گرفته می‌شود.
            </Alert>

            <div className="prs-small prs-muted">
              <Link to="/">بازگشت به صفحهٔ اصلی</Link> · <Link to="/banknotes/verify">بررسی اصالت اسکناس</Link> ·{' '}
              <Link to="/receipts">رهگیری رسید</Link>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
