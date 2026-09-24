/** Not found — a quiet dead end that still tells the visitor what this place is. */
import { Link } from 'react-router-dom';
import { Alert, Button, Panel, PanelBody } from '@parsbank/ui';

export function NotFound() {
  return (
    <div className="prs-container prs-container-narrow prs-stack-5">
      <Panel title="این صفحه پیدا نشد" icon="alert">
        <PanelBody>
          <Alert tone="warning" title="نشانی وارد‌شده در بانک پارس وجود ندارد">
            ممکن است نشانی را ناقص وارد کرده باشید یا صفحه جابه‌جا شده باشد. اگر از روی یک کد QR آمده‌اید،
            کد را دوباره اسکن کنید؛ هر بار ساخت کد تازه، کد پیشین باطل می‌شود.
          </Alert>
          <div className="prs-row prs-wrap" style={{ marginTop: 'var(--prs-space-4)' }}>
            <Link className="prs-btn prs-btn--primary prs-btn--sm" to="/">
              صفحهٔ اصلی
            </Link>
            <Link className="prs-btn prs-btn--outline prs-btn--sm" to="/dashboard">
              نمای حساب
            </Link>
            <Link className="prs-btn prs-btn--quiet prs-btn--sm" to="/receipts">
              بررسی رسید
            </Link>
          </div>
          <p className="prs-small prs-muted" style={{ marginTop: 'var(--prs-space-4)' }}>
            بانک پارس یک شبکهٔ بستهٔ پولی خصوصی است؛ پارسه ارز قانونی نیست و این سامانه به هیچ شبکهٔ پرداخت
            عمومی متصل نیست.
          </p>
        </PanelBody>
      </Panel>
      <Button variant="quiet" onClick={() => window.history.back()}>
        بازگشت به صفحهٔ پیشین
      </Button>
    </div>
  );
}
