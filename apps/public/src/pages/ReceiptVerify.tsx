/**
 * Public receipt verification.
 *
 * Anyone holding a printed receipt can check it here without signing in: the
 * verification code is an HMAC over the transaction reference and only the bank can
 * mint it. The response deliberately returns a status and an amount, never a
 * counterparty.
 */
import { useState } from 'react';
import { Alert, Badge, Button, Field, Loading, Panel, PanelBody, TextInput, formatDateTime, formatPrs, labelFa, statusTone, transactionTypeFa } from '@parsbank/ui';
import { api, describeError } from '../lib/api.ts';

interface VerifyResult {
  valid: boolean;
  reference: string;
  status?: string | null;
  amountMinor?: number | null;
  completedAt?: string | null;
}

export function ReceiptVerify() {
  const [reference, setReference] = useState('');
  const [code, setCode] = useState('');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const value = await api.post<VerifyResult>('/receipts/verify', { reference: reference.trim().toUpperCase(), code: code.trim() }, { anonymous: true });
      setResult(value);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="prs-container prs-container-narrow prs-stack-6">
      <div>
        <h1>بررسی رسید</h1>
        <p className="prs-small prs-muted">
          کد رهگیری روی رسید با کلید سامانه امضا شده است. اگر کد با شناسهٔ تراکنش جور در نیاید، رسید جعلی
          یا دست‌کاری‌شده است.
        </p>
      </div>

      <Panel title="ورود اطلاعات رسید" icon="receipt">
        <PanelBody>
          <form className="prs-stack-4" onSubmit={verify}>
            <Field label="شناسهٔ تراکنش" hint="مانند PRS-TRX-C43VCBX9MX">
              <TextInput value={reference} onChange={(event) => setReference(event.target.value)} placeholder="PRS-TRX-…" />
            </Field>
            <Field label="کد رهگیری رسید">
              <TextInput value={code} onChange={(event) => setCode(event.target.value)} placeholder="PRS-…" />
            </Field>
            <Button type="submit" variant="primary" icon="check" loading={busy} disabled={reference.trim().length < 6 || code.trim().length < 6}>
              بررسی
            </Button>
          </form>
        </PanelBody>
      </Panel>

      {busy && !result ? <Loading label="در حال بررسی…" /> : null}
      {error ? <Alert tone="critical" title="بررسی انجام نشد">{error}</Alert> : null}

      {result ? (
        result.valid ? (
          <Panel title="رسید معتبر است" icon="seal">
            <PanelBody>
              <div className="prs-stack-4">
                <Alert tone="success" title="امضای رسید با رکورد سامانه مطابقت دارد">
                  این رسید در دفتر کل وجود دارد و پس از صدور تغییر نکرده است.
                </Alert>
                <dl className="prs-kv">
                  <div style={{ display: 'contents' }}>
                    <dt>شناسهٔ تراکنش</dt>
                    <dd className="prs-num">{result.reference}</dd>
                  </div>
                  <div style={{ display: 'contents' }}>
                    <dt>نوع</dt>
                    <dd>{transactionTypeFa((result as { type?: string }).type ?? 'TRANSFER')}</dd>
                  </div>
                  <div style={{ display: 'contents' }}>
                    <dt>مبلغ</dt>
                    <dd className="prs-num">{result.amountMinor !== null && result.amountMinor !== undefined ? `${formatPrs(result.amountMinor, true)}` : '—'}</dd>
                  </div>
                  <div style={{ display: 'contents' }}>
                    <dt>وضعیت</dt>
                    <dd>
                      <Badge tone={statusTone(result.status)}>{labelFa(result.status)}</Badge>
                    </dd>
                  </div>
                  <div style={{ display: 'contents' }}>
                    <dt>زمان تکمیل</dt>
                    <dd>{result.completedAt ? formatDateTime(result.completedAt) : '—'}</dd>
                  </div>
                </dl>
              </div>
            </PanelBody>
          </Panel>
        ) : (
          <Alert tone="critical" title="این رسید معتبر نیست">
            کد رهگیری با شناسهٔ {result.reference} نمی‌خواند. اگر مطمئن هستید رسید از بانک پارس صادر شده،
            اطلاعات را دوباره و بدون فاصلهٔ اضافه وارد کنید.
          </Alert>
        )
      ) : null}

      <Panel title="نکته‌های امنیتی" icon="shield">
        <PanelBody>
          <ul className="prs-stack-3" style={{ paddingInlineStart: 'var(--prs-space-5)', margin: 0 }}>
            <li>کد رهگیری هرگز شامل نام، شمارهٔ کارت کامل یا موجودی نیست.</li>
            <li>بررسی رسید به حساب کاربری نیاز ندارد؛ اطلاعات حساس هم بازنمی‌گرداند.</li>
            <li>هر تراکنش فقط یک رسید دارد و اصلاح مالی، رسید تازهٔ معکوس تولید می‌کند.</li>
          </ul>
        </PanelBody>
      </Panel>
    </div>
  );
}
