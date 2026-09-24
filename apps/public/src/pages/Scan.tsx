/**
 * Scan — the entry point of the QR payment flow.
 *
 * The hosted environment's Permissions-Policy disables the camera for this origin
 * (`camera=()` in the security headers), so the scanner is the device's own: the
 * payer opens the link the QR contains, or pastes the scanned payload here. This
 * page therefore accepts three interchangeable inputs and normalises them to the
 * same thing — a token, which the server resolves.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Button, Field, Panel, PanelBody, TextInput, normalizeDigits, toPersianDigits } from '@parsbank/ui';
import { extractTokenFromScan } from '@parsbank/domain';
import { api, describeError } from '../lib/api.ts';

export function Scan() {
  const navigate = useNavigate();
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openSecureView = async () => {
    setError(null);
    const token = extractTokenFromScan(raw);
    if (!token) {
      setError('این متن یک کد پرداخت پارس نیست. خروجی اسکنر یا نشانی صفحهٔ امن را کامل وارد کنید.');
      return;
    }
    setBusy(true);
    try {
      const view = await api.get<{ sessionRef: string; cardNumber: string }>(
        `/secure/card/${encodeURIComponent(token)}`,
        { anonymous: true },
      );
      navigate(`/qr/${encodeURIComponent(view.sessionRef)}`, {
        state: { destinationCardNumber: view.cardNumber },
      });
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const digits = normalizeDigits(raw).replace(/\D/g, '');
  const looksLikeCard = digits.length === 12;

  return (
    <div className="prs-container prs-container-narrow prs-stack-6">
      <div>
        <h1>اسکن و پرداخت</h1>
        <p className="prs-small prs-muted">
          کد QR روی پشت کارت فقط یک شناسهٔ عمومی است؛ نه رمز، نه کد امنیتی و نه موجودی. مبلغ را شما وارد
          می‌کنید و مقصد را سرور دوباره بررسی می‌کند.
        </p>
      </div>

      <Alert tone="info" title="دوربین در این محیط غیرفعال است">
        سیاست امنیتی سامانه دسترسی دوربین را برای این دامنه می‌بندد. از دوربین دستگاه خودتان استفاده کنید و
        نشانی بازشده را در همین حساب بپذیرید، یا خروجی اسکنر را در کادر زیر بچسبانید.
      </Alert>

      <Panel title="ورود کد یا نشانی" subtitle="هر سه شکل زیر پذیرفته می‌شود" icon="scan">
        <PanelBody>
          <div className="prs-stack-4">
            <Field
              label="خروجی اسکنر، نشانی صفحهٔ امن، یا شمارهٔ کارت"
              hint="نمونه: https://…/secure/card/prs1_AB12… یا prs1_AB12…"
            >
              <TextInput
                value={raw}
                onChange={(event) => setRaw(event.target.value)}
                placeholder="prs1_ …"
                autoFocus
              />
            </Field>
            {error ? <Alert tone="critical" title="این کد باز نشد">{error}</Alert> : null}
            <div className="prs-row prs-wrap">
              <Button variant="primary" icon="scan" loading={busy} disabled={raw.trim().length < 8} onClick={() => void openSecureView()}>
                باز کردن صفحهٔ پرداخت
              </Button>
              {looksLikeCard ? (
                <Button
                  variant="outline"
                  icon="send"
                  onClick={() =>
                    navigate('/send', { state: { destinationCardNumber: digits } })
                  }
                >
                  رفتن به انتقال با شمارهٔ کارت {toPersianDigits(digits.slice(-4))}
                </Button>
              ) : null}
            </div>
          </div>
        </PanelBody>
      </Panel>

      <Panel title="مراحل پرداخت" icon="list">
        <PanelBody>
          <ol className="prs-stack-3" style={{ paddingInlineStart: 'var(--prs-space-5)', margin: 0 }}>
            <li>شناسهٔ کارت مقصد از کد خوانده و در سرور باز می‌شود.</li>
            <li>شمارهٔ کارت مقصد پیش‌پر می‌شود و به‌صورت تأییدشده نمایش داده می‌شود.</li>
            <li>مبلغ، کد امنیتی کارت خودتان و گذرواژه یا رمز پرداخت را وارد می‌کنید.</li>
            <li>پرداخت با یک کلید یکتاسازی ثبت می‌شود؛ تکرار درخواست، پول را دو بار جابه‌جا نمی‌کند.</li>
          </ol>
          <div style={{ marginTop: 'var(--prs-space-4)' }}>
            <Link className="prs-btn prs-btn--sm prs-btn--outline" to="/dashboard">
              بازگشت به نمای حساب
            </Link>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
