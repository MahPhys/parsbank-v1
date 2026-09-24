/**
 * Profile — who the account belongs to.
 *
 * Read-only for the fields that identify the account (name, role, public reference);
 * nothing here can change a balance, a role or a limit. Preferences are the only
 * writable things, and even those are re-read from the server after saving.
 */
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Loading,
  Panel,
  PanelBody,
  Stat,
  formatDate,
  formatDateTime,
  formatPrs,
  formatRelative,
  formatUsd,
  labelFa,
  roleFa,
  statusTone,
  toPersianDigits,
} from '@parsbank/ui';
import type { MonetarySnapshot, WalletSummary } from '@parsbank/types';
import { api } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { useSession } from '../lib/session.tsx';

interface MePayload {
  profile: {
    profileId: string;
    publicRef: string;
    fullNameFa: string;
    fullNameEn: string;
    role: string;
    status: string;
    email: string | null;
    phone: string | null;
    locale: string;
    themePreference: string;
    mfaEnabled: boolean;
    mustRotatePassword: boolean;
    lastLoginAt: string | null;
    createdAt: string;
  } | null;
  wallets: WalletSummary[];
  monetary: MonetarySnapshot;
}

export function Profile() {
  const { session } = useSession();
  const me = useAsync<MePayload>(() => api.get<MePayload>('/me'), []);

  if (me.loading && !me.data) return <Loading label="در حال خواندن پروفایل…" />;
  if (!me.data?.profile) return <Alert tone="critical" title="پروفایل خوانده نشد">{me.error ?? 'اطلاعاتی بازنگشت.'}</Alert>;

  const profile = me.data.profile;
  const balance = me.data.wallets.reduce((sum, wallet) => sum + wallet.balanceMinor, 0);
  const referenceUsd = me.data.wallets.reduce((sum, wallet) => sum + wallet.referenceUsdMinor, 0);

  return (
    <div className="prs-container prs-container-base prs-stack-6" style={{ maxWidth: 'var(--prs-container-base)' }}>
      <div className="prs-row prs-between prs-wrap">
        <div>
          <h1>پروفایل حساب</h1>
          <p className="prs-small prs-muted">هویت، نقش و ترجیحات. این بخش هیچ اثری بر منطق پولی ندارد.</p>
        </div>
        <div className="prs-row-2">
          <Link className="prs-btn prs-btn--sm prs-btn--outline" to="/security">
            امنیت و نشست‌ها
          </Link>
          <Link className="prs-btn prs-btn--sm prs-btn--quiet" to="/dashboard">
            نمای حساب
          </Link>
        </div>
      </div>

      <section className="prs-grid prs-grid-4">
        <Stat label="موجودی کل" value={`${formatPrs(balance, true)}`} hint={`ارزش مرجع ${formatUsd(referenceUsd)} دلار`} icon="wallet" />
        <Stat label="نقش" value={roleFa(profile.role)} hint="نقش‌ها یکدیگر را به ارث نمی‌برند" icon="shield" />
        <Stat label="وضعیت حساب" value={labelFa(profile.status)} hint={profile.mfaEnabled ? 'ورود دو مرحله‌ای فعال' : 'ورود دو مرحله‌ای غیرفعال'} icon="user" />
        <Stat label="شناسهٔ عمومی" value={<span className="prs-num">{profile.publicRef}</span>} hint="برای ارجاع داخلی؛ حاوی اطلاعات حساس نیست" icon="key" />
      </section>

      <Panel title="هویت" icon="user">
        <PanelBody>
          <dl className="prs-kv">
            <div style={{ display: 'contents' }}>
              <dt>نام (فارسی)</dt>
              <dd>{profile.fullNameFa}</dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>نام (لاتین)</dt>
              <dd>{profile.fullNameEn}</dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>ایمیل</dt>
              <dd>{profile.email ?? 'ثبت نشده'}</dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>تلفن</dt>
              <dd>{profile.phone ?? 'ثبت نشده'}</dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>زبان</dt>
              <dd>{profile.locale === 'fa-IR' ? 'فارسی' : profile.locale}</dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>عضویت از</dt>
              <dd>{formatDate(profile.createdAt)}</dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>آخرین ورود</dt>
              <dd>
                {formatDateTime(profile.lastLoginAt)} <span className="prs-small prs-muted">({formatRelative(profile.lastLoginAt)})</span>
              </dd>
            </div>
          </dl>
          <Alert tone="info" title="تغییر نام و شناسه‌ها دستی است">
            نام قانونی و شناسهٔ عمومی توسط کارگزار شبکه و با ثبت در گزارش حسابرسی تغییر می‌کند؛ رابط کاربری
            اجازهٔ تغییر مستقیم این فیلدها را ندارد.
          </Alert>
        </PanelBody>
      </Panel>

      <Panel title="کیف پول‌ها و کارت‌ها" subtitle="خلاصهٔ دارایی و ابزارهای پرداخت" icon="grid">
        <PanelBody>
          <div className="prs-stack-3">
            {me.data.wallets.map((wallet) => (
              <div key={wallet.walletId} className="prs-row prs-between prs-wrap">
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {wallet.labelFa} {wallet.isPrimary ? <Badge tone="info">اصلی</Badge> : null}
                  </div>
                  <div className="prs-num prs-small prs-muted">{wallet.publicRef}</div>
                </div>
                <div className="prs-row-2">
                  <Badge tone={statusTone(wallet.status)}>{labelFa(wallet.status)}</Badge>
                  <span className="prs-num">{formatPrs(wallet.balanceMinor, true)}</span>
                  <Link className="prs-btn prs-btn--sm prs-btn--quiet" to={`/wallet/${wallet.publicRef}`}>
                    صورت حساب
                  </Link>
                </div>
              </div>
            ))}
            {me.data.wallets.length === 0 ? <div className="prs-empty">کیف پولی برای این حساب صادر نشده است.</div> : null}
          </div>

          <div className="prs-receipt__divider" />

          <p className="prs-small prs-muted">
            نقش شما: <strong>{roleFa(session?.role ?? profile.role)}</strong> · نشست جاری از نوع{' '}
            <span className="prs-num">{session?.audience ?? 'USER'}</span> · تعداد کیف پول{' '}
            <span className="prs-num">{toPersianDigits(me.data.wallets.length)}</span>
          </p>
        </PanelBody>
      </Panel>

      <Alert tone="warning" title="پارسه ارز قانونی نیست">
        این حساب بخشی از یک شبکهٔ بستهٔ خصوصی است. هیچ سرویس خارجی، کارت‌شاپ یا شبکهٔ پرداخت واقعی به این
        سامانه متصل نیست و موجودی این حساب قابل تبدیل به ارز رسمی در بیرون از شبکه نیست.
      </Alert>
    </div>
  );
}
