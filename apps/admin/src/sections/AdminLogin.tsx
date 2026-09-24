/**
 * Console login.
 *
 * The operations console is a separate audience: an ordinary member session — even a
 * member who happens to hold a SUPER_ADMIN profile in the public app — cannot reach
 * these screens. Login answers with the same credentials as the public app because
 * there is one identity model, one password store and one second factor; the only
 * difference is which cookie and which idle timeout the session receives.
 */
import { useState } from 'react';
import { Alert, BrandMark, Button, Field, Panel, PanelBody, TextInput } from '@parsbank/ui';
import { describeError } from '../lib/api.ts';
import { useAdminSession } from '../lib/session.tsx';

export function AdminLogin() {
  const { login } = useAdminSession();
  const [cardNumber, setCardNumber] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ cardNumber, password, totpCode });
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="prs-container prs-container-narrow prs-stack-5" style={{ paddingBlock: 'var(--prs-space-9)' }}>
      <div className="prs-row" style={{ gap: 'var(--prs-space-4)', alignItems: 'center' }}>
        <BrandMark size={54} />
        <div>
          <h1 style={{ margin: 0 }}>کنسول عملیات بانک پارس</h1>
          <p className="prs-small prs-muted" style={{ margin: 0 }}>
            این ورودی برای کارگزاران شبکه است: خزانه‌دار، حسابرس، مدیر ارشد و دفتر طراحی.
          </p>
        </div>
      </div>

      <Panel title="ورود کارگزار" icon="shield">
        <PanelBody>
          <form className="prs-stack-4" onSubmit={submit}>
            <Field label="شمارهٔ کارت ۱۲ رقمی">
              <TextInput
                numeric
                inputMode="numeric"
                autoComplete="username"
                value={cardNumber}
                onChange={(event) => setCardNumber(event.target.value)}
              />
            </Field>
            <Field label="گذرواژهٔ حساب">
              <TextInput type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </Field>
            <Field label="کد یک‌بارمصرف (اگر فعال است)">
              <TextInput numeric inputMode="numeric" value={totpCode} onChange={(event) => setTotpCode(event.target.value)} />
            </Field>

            {error ? (
              <Alert tone="critical" title="ورود انجام نشد">
                {error}
              </Alert>
            ) : null}

            <Button type="submit" variant="primary" size="lg" block icon="lock" loading={busy} disabled={cardNumber.length < 12 || password.length < 8}>
              ورود به کنسول
            </Button>
          </form>
        </PanelBody>
      </Panel>

      <Alert tone="info" title="چرا کد امنیتی کارت اینجا خواسته نمی‌شود؟">
        CVV تنها برای اثبات حضور کارت در پرداخت‌ها به کار می‌رود و هرگز عامل ورود یا عامل تأیید عملیات پولی
        نیست. ورود کارگزار با گذرواژه و عامل دوم انجام می‌شود و هر تلاش ناکام در گزارش حسابرسی ثبت می‌گردد.
      </Alert>

      <p className="prs-small prs-muted">
        پارسه ارز قانونی نیست و این کنسول هیچ مسیری برای اتصال به شبکه‌های پرداخت واقعی ندارد.
      </p>
    </div>
  );
}
