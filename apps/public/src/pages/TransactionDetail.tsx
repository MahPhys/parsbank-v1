/**
 * Transaction detail + receipt.
 *
 * The receipt is a server artefact: `GET /transactions/:reference/receipt` returns the
 * verification code, which is an HMAC over the reference. Printing reproduces the
 * same code, so a paper copy can be checked later at `/receipts`.
 */
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  CopyButton,
  Loading,
  MoneyText,
  Panel,
  PanelBody,
  Stat,
  formatDateTime,
  formatRate,
  formatUsd,
  labelFa,
  statusTone,
  toPersianDigits,
  transactionTypeFa,
} from '@parsbank/ui';
import type { ReceiptDto, TransactionDto } from '@parsbank/types';
import { api } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { BrandMark } from '@parsbank/ui';

export function TransactionDetail() {
  const { reference = '' } = useParams<{ reference: string }>();
  const transaction = useAsync<TransactionDto>(() => api.get<TransactionDto>(`/transactions/${encodeURIComponent(reference)}`), [reference]);
  const receipt = useAsync<ReceiptDto>(() => api.get<ReceiptDto>(`/transactions/${encodeURIComponent(reference)}/receipt`), [reference]);

  if (transaction.loading && !transaction.data) return <Loading label="در حال خواندن تراکنش…" />;
  if (transaction.error && !transaction.data) {
    return (
      <div className="prs-container prs-container-narrow">
        <Alert tone="critical" title="این تراکنش در دسترس نیست">
          {transaction.error}
          <div style={{ marginTop: 'var(--prs-space-3)' }}>
            <Link className="prs-btn prs-btn--sm prs-btn--outline" to="/history">
              بازگشت به تاریخچه
            </Link>
          </div>
        </Alert>
      </div>
    );
  }
  if (!transaction.data) return null;
  const tx = transaction.data;

  return (
    <div className="prs-container prs-container-base prs-stack-6" style={{ maxWidth: 'var(--prs-container-base)' }}>
      <div className="prs-row prs-between prs-wrap prs-no-print">
        <div>
          <h1>جزئیات تراکنش</h1>
          <p className="prs-small prs-muted">
            {transactionTypeFa(tx.type)} · {formatDateTime(tx.createdAt)}
          </p>
        </div>
        <div className="prs-row-2">
          <Link className="prs-btn prs-btn--sm prs-btn--outline" to="/history">
            تاریخچه
          </Link>
          <Button variant="primary" size="sm" icon="print" onClick={() => window.print()}>
            چاپ رسید
          </Button>
        </div>
      </div>

      <section className="prs-grid prs-grid-4 prs-no-print">
        <Stat label="مبلغ" value={<MoneyText minor={tx.amountMinor} withUnit size="lg" />} hint={tx.direction === 'IN' ? 'ورودی' : tx.direction === 'OUT' ? 'خروجی' : 'داخلی'} />
        <Stat label="کارمزد" value={<MoneyText minor={tx.feeMinor} withUnit />} hint="در نسخهٔ ۱ کارمزد انتقال صفر است" />
        <Stat label="وضعیت" value={labelFa(tx.status)} hint={`شناسهٔ دفتر ${tx.reference}`} tone={tx.status === 'COMPLETED' ? 'positive' : undefined} />
        <Stat
          label="ارزش مرجع"
          value={receipt.data ? `${formatUsd(receipt.data.referenceUsdMinor)} دلار` : '—'}
          hint={receipt.data?.referenceRate ? `نرخ ${formatRate(receipt.data.referenceRate)}` : 'در دسترس نیست'}
        />
      </section>

      <article className="prs-receipt">
        <div className="prs-receipt__seal" aria-hidden>
          <BrandMark size={92} />
        </div>
        <header className="prs-stack-2">
          <div className="prs-brand__name">بانک پارس</div>
          <div className="prs-small prs-muted">رسید رسمی تراکنش داخلی · واحد پول: پارسه (PRS)</div>
        </header>

        <div className="prs-receipt__divider" />

        <div className="prs-grid prs-grid-2">
          <dl className="prs-kv">
            <div style={{ display: 'contents' }}>
              <dt>شناسهٔ تراکنش</dt>
              <dd className="prs-num">{tx.reference}</dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>نوع</dt>
              <dd>{transactionTypeFa(tx.type)}</dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>وضعیت</dt>
              <dd>{labelFa(tx.status)}</dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>مبلغ</dt>
              <dd>
                <MoneyText minor={tx.amountMinor} withUnit size="lg" />
              </dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>کارمزد</dt>
              <dd className="prs-num">{toPersianDigits(tx.feeMinor)} پارسه</dd>
            </div>
          </dl>

          <dl className="prs-kv">
            <div style={{ display: 'contents' }}>
              <dt>فرستنده</dt>
              <dd>{receipt.data?.senderNameFa ?? '—'}</dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>شمارهٔ کارت فرستنده</dt>
              <dd className="prs-num" dir="ltr">
                {receipt.data?.senderCardMasked ?? '—'}
              </dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>گیرنده</dt>
              <dd>{receipt.data?.receiverNameFa ?? '—'}</dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>شمارهٔ کارت گیرنده</dt>
              <dd className="prs-num" dir="ltr">
                {receipt.data?.receiverCardMasked ?? '—'}
              </dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>یادداشت</dt>
              <dd>{tx.memo ?? '—'}</dd>
            </div>
          </dl>
        </div>

        <div className="prs-receipt__divider" />

        <div className="prs-row prs-between prs-wrap">
          <div>
            <div className="prs-small prs-muted">کد رهگیری رسید</div>
            <div className="prs-receipt__code">{receipt.data?.verificationCode ?? '—'}</div>
          </div>
          <div className="prs-stack-2" style={{ textAlign: 'left' }}>
            <div className="prs-small prs-muted">تاریخ صدور</div>
            <div>{formatDateTime(receipt.data?.issuedAt ?? tx.createdAt)}</div>
            <div className="prs-small prs-muted">نسخهٔ دفتر کل</div>
            <div className="prs-num">{toPersianDigits(receipt.data?.ledgerSequence ?? '—')}</div>
          </div>
        </div>

        {receipt.data ? (
          <div className="prs-row prs-wrap prs-no-print" style={{ marginTop: 'var(--prs-space-5)' }}>
            <CopyButton value={receipt.data.verificationCode} label="رونوشت کد رهگیری" />
            <Link className="prs-btn prs-btn--sm prs-btn--outline" to="/receipts">
              بررسی رسید در صفحهٔ عمومی
            </Link>
          </div>
        ) : null}
      </article>

      <Panel title="سند دفتر کل" subtitle="انعکاس تراکنش در دفتر" icon="list" flush>
        <PanelBody>
          <dl className="prs-kv">
            <div style={{ display: 'contents' }}>
              <dt>وضعیت ثبت</dt>
              <dd>
                <Badge tone={statusTone(tx.status)}>{labelFa(tx.status)}</Badge>
              </dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>زمان تکمیل</dt>
              <dd>{tx.completedAt ? formatDateTime(tx.completedAt) : '—'}</dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>کیف پول فرستنده</dt>
              <dd className="prs-num">{tx.senderWalletRef ?? '—'}</dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>کیف پول گیرنده</dt>
              <dd className="prs-num">{tx.receiverWalletRef ?? '—'}</dd>
            </div>
          </dl>
          <p className="prs-small prs-muted" style={{ marginTop: 'var(--prs-space-4)' }}>
            این تراکنش در دفتر کل دو ثبت متوازن دارد: بدهکار از یک حساب و بستانکار به حساب دیگر. اصلاح
            احتمالی، ثبت معکوس تازه‌ای است و این ردیف هرگز پاک یا ویرایش نمی‌شود.
          </p>
        </PanelBody>
      </Panel>

      <div className="prs-small prs-muted prs-no-print">
        برای بررسی اصالت رسید کاغذی، کد رهگیری را در <Link to="/receipts">صفحهٔ بررسی رسید</Link> وارد کنید.
      </div>
    </div>
  );
}
