/**
 * `/secure/card/:token` — the page behind the QR on the back of a physical card.
 *
 * What this page may show is a hard contract, enforced by the API response type:
 * branding, the card number, the expiry and (when the card is usable) a button to
 * continue. It never shows a balance, a name, a CVV, a PIN, a wallet reference or an
 * internal identifier — the token is opaque and carries no data of its own.
 */
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAsync } from '../lib/hooks.ts';
import { api, describeError } from '../lib/api.ts';
import { useContent } from '../lib/content.tsx';
import { Alert, Badge, Button, Loading, PanelBody, ThemeStyle, formatExpiry, groupCardNumber } from '@parsbank/ui';
import type { SecureCardPublicView } from '@parsbank/types';

export function SecureCard() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { theme, branding } = useContent();

  const state = useAsync<SecureCardPublicView>(
    () => api.get<SecureCardPublicView>(`/secure/card/${encodeURIComponent(token ?? '')}`, { anonymous: true }),
    [token],
  );

  const brandNameFa = state.data?.brandNameFa ?? 'بانک پارس';
  const brandNameEn = state.data?.brandNameEn ?? 'BANK PARS';

  return (
    <>
      <ThemeStyle tokens={theme?.tokens} />
      <div className="prs-secure">
        <div className="prs-secure__card">
          <header className="prs-secure__head">
            <div>
              <div className="prs-brand__name">{brandNameFa}</div>
              <div className="prs-brand__sub">{brandNameEn} · واحد پول: پارسه (PRS)</div>
            </div>
            <div className="prs-grow" />
            {state.data ? (
              <Badge tone={state.data.payable ? 'positive' : 'warning'} dot>
                {state.data.payable ? 'آمادهٔ پرداخت' : 'غیرقابل پرداخت'}
              </Badge>
            ) : null}
          </header>

          {state.loading ? (
            <Loading label="در حال خواندن شناسهٔ کارت…" />
          ) : state.error ? (
            <PanelBody>
              <Alert tone="critical" title="این شناسه معتبر نیست">
                {state.error}
                <p className="prs-small" style={{ marginTop: 'var(--prs-space-3)' }}>
                  کد روی کارت ممکن است باطل شده باشد (هر بار ساخت کد جدید، کد پیشین باطل می‌شود) یا کد
                  ناقص منتقل شده باشد.
                </p>
              </Alert>
            </PanelBody>
          ) : state.data ? (
            <>
              <PanelBody>
                <div className="prs-stack-4">
                  <div>
                    <div className="prs-small prs-muted prs-center">شمارهٔ کارت مقصد</div>
                    <div className="prs-secure__number" dir="ltr">
                      {groupCardNumber(state.data.cardNumber, false)}
                    </div>
                  </div>
                  <div className="prs-row prs-between">
                    <div>
                      <div className="prs-small prs-muted">انقضا</div>
                      <div className="prs-num">
                        {formatExpiry(state.data.expiryMonth, state.data.expiryYear)}
                      </div>
                    </div>
                    <div>
                      <div className="prs-small prs-muted">شبکه</div>
                      <div>{state.data.networkLabel}</div>
                    </div>
                    <div>
                      <div className="prs-small prs-muted">شناسهٔ عمومی</div>
                      <div className="prs-num">{state.data.tokenPrefix}</div>
                    </div>
                  </div>

                  {state.data.payable ? (
                    <Alert tone="success" title="این صفحه هیچ اطلاعات دیگری ندارد">
                      مبلغ، کد امنیتی کارت خودتان و گذرواژه یا رمز پرداخت را در مرحلهٔ بعد وارد می‌کنید.
                      شمارهٔ کارت مقصد از همین شناسه پیش‌پر و دوباره بررسی می‌شود.
                    </Alert>
                  ) : (
                    <Alert tone="warning" title="این کارت در حال حاضر پرداخت نمی‌پذیرد">
                      {state.data.payableReasonFa ?? 'وضعیت کارت مقصد اجازهٔ دریافت پرداخت نمی‌دهد.'}
                    </Alert>
                  )}

                  {state.data.payable ? (
                    <Button
                      variant="primary"
                      size="lg"
                      block
                      icon="send"
                      onClick={() =>
                        navigate(`/qr/${encodeURIComponent(state.data!.sessionRef)}`, {
                          state: { destinationCardNumber: state.data!.cardNumber },
                        })
                      }
                    >
                      پرداخت به این کارت
                    </Button>
                  ) : null}

                  <div className="prs-small prs-muted prs-center">
                    برای پرداخت باید در حساب خود وارد شده باشید. اگر وارد نشده‌اید، پس از زدن دکمهٔ پرداخت
                    به صفحهٔ ورود هدایت می‌شوید و سپس به همین پرداخت بازمی‌گردید.
                  </div>
                </div>
              </PanelBody>
              <footer className="prs-panel__foot">
                <span className="prs-small prs-muted">
                  اعتبار این شناسه تا {new Date(state.data.sessionExpiresAt).toLocaleTimeString('fa-IR')} است.
                </span>
                <div className="prs-grow" />
                <Link to="/" className="prs-btn prs-btn--quiet prs-btn--sm">
                  بانک پارس
                </Link>
              </footer>
            </>
          ) : null}
        </div>

        <p className="prs-small prs-muted" style={{ maxWidth: 520, textAlign: 'center', marginTop: 'var(--prs-space-5)' }}>
          {branding?.currency.nameFa ?? 'پارسه'} ارز قانونی نیست. این سامانه یک شبکهٔ بستهٔ خصوصی است و به
          هیچ شبکهٔ پرداخت عمومی متصل نیست.
        </p>
      </div>
    </>
  );
}
