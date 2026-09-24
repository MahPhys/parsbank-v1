/** Unknown console route — points the operator back at the sections they may open. */
import { Link } from 'react-router-dom';
import { Alert, Panel, PanelBody } from '@parsbank/ui';
import { ConsolePage } from '../components/console.tsx';

export function NotFoundSection() {
  return (
    <ConsolePage title="بخش پیدا نشد">
      <Panel title="این نشانی در کنسول وجود ندارد" icon="alert">
        <PanelBody>
          <Alert tone="warning" title="نشانی نامعتبر">
            ممکن است نشانی ناقص وارد شده باشد یا این بخش در نسخهٔ کنونی سامانه وجود نداشته باشد. فهرست بخش‌های
            مجاز برای نقش شما در نوار کناری دیده می‌شود.
          </Alert>
          <div className="prs-row prs-wrap" style={{ marginTop: 'var(--prs-space-4)' }}>
            <Link className="prs-btn prs-btn--primary prs-btn--sm" to="/admin">
              نمای کل
            </Link>
            <Link className="prs-btn prs-btn--outline prs-btn--sm" to="/admin/approvals">
              صف تأیید
            </Link>
            <Link className="prs-btn prs-btn--quiet prs-btn--sm" to="/admin/system-health">
              سلامت سامانه
            </Link>
          </div>
        </PanelBody>
      </Panel>
    </ConsolePage>
  );
}
