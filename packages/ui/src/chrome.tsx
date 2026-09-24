/**
 * @parsbank/ui — application chrome.
 *
 * The two shells share one visual language and nothing else: the public shell is
 * a bank's customer surface, the administrative shell is an operations console
 * (denser, darker sidebar, always showing the pending-approval counter). Neither
 * shell decides authorization — that is the server's job — they only avoid
 * showing a section the caller's role cannot read.
 */
import { useMemo, type ReactNode } from 'react';
import { compileTheme } from '@parsbank/design-system';
import { formatPrs, formatPercent, formatRate, formatUsd, groupCardNumber, formatExpiry, maskCardNumber } from './format.ts';
import { BrandMark, Icon, type IconName } from './icons.tsx';
import { Badge, MoneyText, Progress } from './primitives.tsx';

/* ------------------------------------------------------------------- theme -- */

/**
 * Injects the published theme as one `<style>` element. Values are compiled by the
 * design system (unknown keys rejected), so a CMS typo cannot smuggle arbitrary
 * CSS into every page.
 */
export function ThemeStyle({ tokens }: { tokens: Record<string, string> | null | undefined }) {
  const css = useMemo(() => compileTheme(tokens ?? {}).css, [tokens]);
  return <style data-prs-theme dangerouslySetInnerHTML={{ __html: css }} />;
}

/* --------------------------------------------------------------- public nav -- */

export interface NavItem {
  labelFa: string;
  href: string;
  iconKey?: string | null;
}

const ICON_ALIASES: Record<string, IconName> = {
  home: 'grid',
  dashboard: 'grid',
  wallet: 'wallet',
  card: 'card',
  send: 'send',
  receive: 'receive',
  scan: 'scan',
  history: 'history',
  receipt: 'receipt',
  notes: 'notes',
  profile: 'user',
  security: 'shield',
  bell: 'bell',
  users: 'user',
  transactions: 'exchange',
  treasury: 'treasury',
  issuance: 'plus',
  burning: 'ban',
  banknotes: 'notes',
  rates: 'exchange',
  reserve: 'scale',
  audit: 'list',
  cms: 'list',
  design: 'palette',
  assets: 'grid',
  flags: 'flag',
  settings: 'settings',
  health: 'pulse',
  approvals: 'seal',
  overview: 'grid',
};

export function iconFor(key: string | null | undefined): IconName {
  if (!key) return 'grid';
  return ICON_ALIASES[key] ?? 'grid';
}

export function PublicShell({
  navItems,
  children,
  footer,
  session,
  onLogout,
  brandNameFa = 'بانک پارس',
  brandNameEn = 'BANK PARS',
}: {
  navItems: NavItem[];
  children: ReactNode;
  footer?: ReactNode;
  session?: { fullNameFa: string; roleFa: string } | null;
  onLogout?: () => void;
  brandNameFa?: string;
  brandNameEn?: string;
}) {
  return (
    <div className="prs-app">
      <header className="prs-header">
        <div className="prs-container prs-container-wide prs-header__bar">
          <a className="prs-brand" href="/">
            <BrandMark size={40} className="prs-brand__mark" />
            <span>
              <span className="prs-brand__name">{brandNameFa}</span>
              <span className="prs-brand__sub">{brandNameEn} · واحد پول: پارسه</span>
            </span>
          </a>
          <div className="prs-grow" />
          <nav className="prs-nav" aria-label="ناوبری اصلی">
            {navItems.slice(0, 7).map((item) => (
              <a
                key={item.href}
                className="prs-nav__link"
                href={item.href}
                aria-current={typeof window !== 'undefined' && window.location.pathname === item.href ? 'page' : undefined}
              >
                {item.labelFa}
              </a>
            ))}
          </nav>
          {session ? (
            <div className="prs-row-2">
              <a className="prs-nav__link" href="/profile">
                {session.fullNameFa}
              </a>
              {onLogout ? (
                <button type="button" className="prs-btn prs-btn--sm prs-btn--outline" onClick={onLogout}>
                  <Icon name="logout" size={15} />
                  خروج
                </button>
              ) : null}
            </div>
          ) : (
            <a className="prs-btn prs-btn--primary prs-btn--sm" href="/login">
              ورود به حساب
            </a>
          )}
        </div>
      </header>
      <main className="prs-main">{children}</main>
      <footer className="prs-footer">
        <div className="prs-container prs-container-wide prs-stack-2">
          {footer}
          <div className="prs-row prs-wrap prs-between">
            <span>
              {brandNameFa} · {brandNameEn} — شبکه بستهٔ پولی خصوصی. پارسه ارز قانونی نیست و هیچ اتصالی به
              سیستم‌های پرداخت واقعی وجود ندارد.
            </span>
            <span className="prs-num">PRS · v1</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* --------------------------------------------------------------- admin nav -- */

export interface AdminNavSection {
  id: string;
  labelFa: string;
  groupFa: string;
  href: string;
  iconKey?: string;
}

export function AdminShell({
  sections,
  children,
  title,
  subtitle,
  session,
  onLogout,
  pendingApprovals = 0,
  apiStatus,
  sidebarOpen,
  onToggleSidebar,
  headerExtra,
}: {
  sections: AdminNavSection[];
  children: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  session: { fullNameFa: string; roleFa: string } | null;
  onLogout: () => void;
  pendingApprovals?: number;
  apiStatus?: 'OK' | 'DEGRADED' | 'CRITICAL' | 'UNKNOWN';
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  headerExtra?: ReactNode;
}) {
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  const groups = useMemo(() => {
    const map = new Map<string, AdminNavSection[]>();
    for (const section of sections) {
      map.set(section.groupFa, [...(map.get(section.groupFa) ?? []), section]);
    }
    return [...map.entries()];
  }, [sections]);

  return (
    <div className="prs-admin">
      <aside className={sidebarOpen ? 'prs-sidebar prs-sidebar--open' : 'prs-sidebar'} aria-label="ناوبری بخش‌های مدیریتی">
        <a className="prs-sidebar__brand" href="/admin">
          <BrandMark size={36} />
          <span>
            <span className="prs-sidebar__name">بانک پارس</span>
            <span className="prs-sidebar__sub">کنسول عملیات</span>
          </span>
        </a>
        {groups.map(([group, items]) => (
          <div key={group}>
            <div className="prs-sidebar__group">{group}</div>
            <nav className="prs-stack-2" style={{ gap: 2, flexDirection: 'column' }}>
              {items.map((section) => (
                <a
                  key={section.id}
                  className="prs-sidebar__link"
                  href={section.href}
                  aria-current={path === section.href ? 'page' : undefined}
                  onClick={() => {
                    if (window.innerWidth <= 1024) onToggleSidebar();
                  }}
                >
                  <Icon name={iconFor(section.iconKey)} size={17} />
                  <span className="prs-grow">{section.labelFa}</span>
                  {section.id === 'approvals' && pendingApprovals > 0 ? (
                    <span className="prs-badge prs-badge--critical">{pendingApprovals}</span>
                  ) : null}
                </a>
              ))}
            </nav>
          </div>
        ))}
        <div className="prs-sidebar__group">شبکه بسته</div>
        <p className="prs-sidebar__sub" style={{ padding: '0 var(--prs-space-3)' }}>
          پارسه ارز قانونی نیست. هیچ مسیر کدی برای اتصال به سیستم‌های پرداخت واقعی وجود ندارد.
        </p>
      </aside>

      <div className="prs-admin__body">
        <header className="prs-admin__bar">
          <button type="button" className="prs-btn prs-btn--sm prs-btn--outline prs-sidebar-toggle" onClick={onToggleSidebar} aria-label="نمایش یا پنهان کردن ناوبری">
            <Icon name="menu" size={16} />
          </button>
          <div className="prs-grow">
            <div className="prs-panel__title">{title}</div>
            {subtitle ? <div className="prs-panel__sub">{subtitle}</div> : null}
          </div>
          {headerExtra}
          <Badge tone={apiStatus === 'OK' ? 'positive' : apiStatus === 'UNKNOWN' ? 'muted' : 'warning'} dot>
            {apiStatus === 'OK' ? 'سامانه سالم' : apiStatus === 'UNKNOWN' ? 'وضعیت نامعلوم' : 'نیازمند بررسی'}
          </Badge>
          {pendingApprovals > 0 ? (
            <a className="prs-btn prs-btn--sm prs-btn--outline" href="/admin/approvals">
              <Icon name="seal" size={15} />
              {pendingApprovals} درخواست در انتظار
            </a>
          ) : null}
          <div className="prs-row-2">
            <span className="prs-small prs-muted prs-nowrap">
              {session ? `${session.fullNameFa} · ${session.roleFa}` : '—'}
            </span>
            <button type="button" className="prs-btn prs-btn--sm prs-btn--outline" onClick={onLogout}>
              <Icon name="logout" size={15} />
              خروج
            </button>
          </div>
        </header>
        <div className="prs-admin__content">{children}</div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- bankcard -- */

export interface BankCardView {
  cardNumber: string;
  cardholderNameFa: string;
  expiryMonth: number;
  expiryYear: number;
  status: string;
  scheme: string;
  networkLabel: string;
  contactless: boolean;
}

export function BankCard({
  card,
  variant = 'front',
  qrDataUri,
  small,
}: {
  card: BankCardView;
  variant?: 'front' | 'back';
  qrDataUri?: string | null;
  small?: boolean;
}) {
  const frozen = card.status === 'FROZEN' || card.status === 'CANCELLED';
  return (
    <div className={`prs-bankcard${frozen ? ' prs-bankcard--frozen' : ''}${small ? ' prs-bankcard--small' : ''}`}>
      <div className="prs-bankcard__pattern" aria-hidden />
      <div className="prs-bankcard__inner">
        {variant === 'front' ? (
          <>
            <div className="prs-bankcard__top">
              <div>
                <div className="prs-bankcard__brand">BANK PARS · بانک پارس</div>
                <div className="prs-bankcard__label">واحد پول: پارسه (PRS)</div>
              </div>
              <div className="prs-bankcard__chip" aria-hidden />
            </div>
            <div className="prs-bankcard__number" dir="ltr">
              {groupCardNumber(card.cardNumber, false)
                .split(' ')
                .map((part, index) => (
                  <span key={index}>{part}</span>
                ))}
            </div>
            <div className="prs-bankcard__meta">
              <div>
                <div className="prs-bankcard__label">دارنده کارت</div>
                <div className="prs-bankcard__value">{card.cardholderNameFa}</div>
              </div>
              <div>
                <div className="prs-bankcard__label">انقضا</div>
                <div className="prs-bankcard__value prs-num">{formatExpiry(card.expiryMonth, card.expiryYear)}</div>
              </div>
              <div className="prs-bankcard__brand">{card.networkLabel}</div>
            </div>
          </>
        ) : (
          <>
            <div className="prs-bankcard__top">
              <div className="prs-bankcard__brand">BANK PARS</div>
              <div className="prs-bankcard__label">پشت کارت</div>
            </div>
            <div className="prs-row prs-between" style={{ alignItems: 'center' }}>
              <div className="prs-stack-2" style={{ gap: 6 }}>
                <div className="prs-bankcard__label">اسکن برای پرداخت</div>
                {qrDataUri ? (
                  <div className="prs-bankcard__qr">
                    <img src={qrDataUri} alt="کد پرداخت کارت" width={84} height={84} />
                  </div>
                ) : (
                  <div
                    className="prs-bankcard__qr"
                    aria-label="کد پرداخت هنوز ساخته نشده است"
                    style={{ color: 'var(--prs-color-neutral-500)', fontSize: 'var(--prs-font-size-2xs)', textAlign: 'center' }}
                  >
                    بدون کد
                  </div>
                )}
                <div className="prs-bankcard__label">کد امنیتی روی کارت چاپ نمی‌شود.</div>
              </div>
              <div className="prs-stack-2" style={{ gap: 6, textAlign: 'left' }}>
                <div className="prs-bankcard__label">شماره کارت</div>
                <div className="prs-bankcard__value prs-num" dir="ltr">
                  {maskCardNumber(card.cardNumber)}
                </div>
                <div className="prs-bankcard__label">شبکه</div>
                <div className="prs-bankcard__value">{card.scheme}</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- money hero -- */

/**
 * The dashboard headline. It always shows, in this order: the balance, the
 * server-derived reference value, and the primary actions. `onAction` receives the
 * action id so each application can route it; the kit does not know about routes.
 */
export function MoneyHero({
  balanceMinor,
  referenceUsdMinor,
  referenceRate,
  coverageRatio,
  accountsCount,
  onAction,
}: {
  balanceMinor: number;
  referenceUsdMinor: number | null;
  referenceRate: number | null;
  coverageRatio: number | null;
  accountsCount: number;
  onAction: (id: 'transfer' | 'receive' | 'scan' | 'card') => void;
}) {
  const actions: Array<{ id: 'transfer' | 'receive' | 'scan' | 'card'; label: string; icon: IconName }> = [
    { id: 'transfer', label: 'انتقال', icon: 'send' },
    { id: 'receive', label: 'دریافت', icon: 'receive' },
    { id: 'scan', label: 'اسکن', icon: 'scan' },
    { id: 'card', label: 'کارت', icon: 'card' },
  ];
  return (
    <section className="prs-hero" aria-label="موجودی و اقدام‌های اصلی">
      <div className="prs-hero__label">موجودی کل ({formatPrs(accountsCount, true)} حساب)</div>
      <div className="prs-hero__amount">
        <span className="prs-num">{formatPrs(balanceMinor)}</span>
        <span className="prs-hero__unit">پارسه</span>
      </div>
      <div className="prs-hero__usd">
        {referenceUsdMinor === null ? (
          <span>ارزش مرجع در دسترس نیست.</span>
        ) : (
          <span>
            ارزش مرجع: <span className="prs-num">{formatUsd(referenceUsdMinor)}</span> دلار
            {referenceRate ? <> · نرخ مرجع <span className="prs-num">{formatRate(referenceRate)}</span> دلار برای هر پارسه</> : null}
            {coverageRatio !== null ? <> · پوشش پشتوانه <span className="prs-num">{formatPercent(coverageRatio)}</span></> : null}
          </span>
        )}
      </div>
      <div className="prs-hero__actions">
        {actions.map((action) => (
          <button key={action.id} type="button" className="prs-btn prs-btn--quiet" onClick={() => onAction(action.id)}>
            <Icon name={action.icon} size={18} />
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- monetary bar -- */

export function MonetaryStrip({
  maxSupplyMinor,
  totalIssuedMinor,
  circulatingSupplyMinor,
  notesOutstandingMinor,
  eligibleNavUsdMinor,
  coverageRatio,
}: {
  maxSupplyMinor: number | null;
  totalIssuedMinor: number | null;
  circulatingSupplyMinor: number | null;
  notesOutstandingMinor?: number | null;
  eligibleNavUsdMinor: number | null;
  coverageRatio: number | null;
}) {
  const issued = totalIssuedMinor ?? 0;
  const max = maxSupplyMinor ?? 0;
  return (
    <div className="prs-panel">
      <div className="prs-panel__head">
        <Icon name="chart" size={18} className="prs-muted" />
        <div className="prs-grow">
          <div className="prs-panel__title">وضعیت پولی شبکه</div>
          <div className="prs-panel__sub">محاسبه‌شده در سرور از دفتر کل و پشتوانه؛ رابط کاربری این اعداد را تغییر نمی‌دهد.</div>
        </div>
        <Badge tone={coverageRatio !== null && coverageRatio >= 1 ? 'positive' : 'warning'}>
          پوشش {coverageRatio === null ? '—' : formatPercent(coverageRatio)}
        </Badge>
      </div>
      <div className="prs-panel__body prs-stack">
        <div className="prs-grid prs-grid-3">
          <div className="prs-stack-2">
            <span className="prs-small prs-muted">عرضه کل منتشرشده</span>
            <MoneyText minor={totalIssuedMinor} size="lg" />
            <span className="prs-small prs-muted">از سقف {formatPrs(maxSupplyMinor, true)}</span>
          </div>
          <div className="prs-stack-2">
            <span className="prs-small prs-muted">در گردش</span>
            <MoneyText minor={circulatingSupplyMinor} size="lg" />
            <span className="prs-small prs-muted">کیف پول‌ها + اسکناس در دست مردم</span>
          </div>
          <div className="prs-stack-2">
            <span className="prs-small prs-muted">پشتوانه واجد شرایط</span>
            <span className="prs-num" style={{ fontSize: 'var(--prs-font-size-lg)', fontWeight: 600 }}>
              {formatUsd(eligibleNavUsdMinor)} <span className="prs-small prs-muted">دلار</span>
            </span>
            {notesOutstandingMinor !== undefined && notesOutstandingMinor !== null ? (
              <span className="prs-small prs-muted">اسکناس فعال: {formatPrs(notesOutstandingMinor, true)}</span>
            ) : null}
          </div>
        </div>
        <Progress value={issued} max={max || 1} />
        <div className="prs-small prs-muted">
          {formatPrs(max - issued, true)} ظرفیت باقی‌مانده تا سقف ۱۰٬۰۰۰ پارسه. تغییر سقف فقط با درخواست دوگانه‌تأییدشده امکان‌پذیر است.
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- note strip -- */

export function NoteArt({
  svg,
  denomination,
  figureFa,
}: {
  svg: string;
  denomination: number;
  figureFa?: string;
}) {
  return (
    <figure className="prs-note-thumb" style={{ margin: 0 }}>
      <div className="prs-note" role="img" aria-label={`اسکناس ${denomination} پارسه`} dangerouslySetInnerHTML={{ __html: svg }} />
      <figcaption className="prs-note-thumb__denom">
        {formatPrs(denomination, true)}
        {figureFa ? ` · ${figureFa}` : ''}
      </figcaption>
    </figure>
  );
}
