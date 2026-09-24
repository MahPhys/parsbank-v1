/**
 * Account dashboard.
 *
 * The one screen that must always answer "how much do I have, what is it worth, and
 * what can I do right now". Order is fixed: balance → reference value → actions →
 * recent activity. Every figure is server-derived; the page only formats.
 */
import { Link, useNavigate } from 'react-router-dom';
import { useCallback } from 'react';
import {
  Alert,
  Badge,
  BankCard,
  DataTable,
  Loading,
  MoneyText,
  MoneyHero,
  Panel,
  PanelBody,
  Stat,
  formatCountdown,
  formatPercent,
  formatRate,
  formatRelative,
  formatUsd,
  labelFa,
  statusTone,
  transactionTypeFa,
} from '@parsbank/ui';
import type { CardSummary, MonetarySnapshot, TransactionDto, WalletSummary } from '@parsbank/types';
import { api } from '../lib/api.ts';
import { useAsync, usePolling } from '../lib/hooks.ts';
import { useSession } from '../lib/session.tsx';

interface MePayload {
  profile: {
    profileId: string;
    publicRef: string;
    fullNameFa: string;
    role: string;
    status: string;
    mfaEnabled: boolean;
    mustRotatePassword: boolean;
    lastLoginAt: string | null;
    createdAt: string;
  } | null;
  wallets: WalletSummary[];
  cards: CardSummary[];
  monetary: MonetarySnapshot;
}

interface TransactionsPayload {
  items: TransactionDto[];
  total: number;
}

export function Dashboard() {
  const navigate = useNavigate();
  const { session } = useSession();

  const me = useAsync<MePayload>(() => api.get<MePayload>('/me'), []);
  const activity = useAsync<TransactionsPayload>(
    () => api.get<TransactionsPayload>('/me/transactions?pageSize=6'),
    [],
  );

  const reload = useCallback(async () => {
    await Promise.all([me.reload(), activity.reload()]);
  }, [me, activity]);

  // The dashboard re-reads the money every 30 s so a payment made from another
  // device shows up without a manual refresh. It still never computes anything.
  usePolling(() => void reload(), 30_000, true);

  if (me.loading && !me.data) return <Loading label="در حال خواندن حساب…" />;
  if (me.error && !me.data) return <Alert tone="critical" title="حساب خوانده نشد">{me.error}</Alert>;
  if (!me.data) return null;

  const { profile, wallets, cards, monetary } = me.data;
  const balanceMinor = wallets.reduce((sum, wallet) => sum + wallet.balanceMinor, 0);
  const referenceUsdMinor = wallets.reduce((sum, wallet) => sum + wallet.referenceUsdMinor, 0);
  const primaryWallet = wallets.find((wallet) => wallet.isPrimary) ?? wallets[0] ?? null;
  const primaryCard = cards[0] ?? null;
  const transactions = activity.data?.items ?? [];

  return (
    <div className="prs-container prs-container-wide prs-stack-6">
      {profile?.mustRotatePassword ? (
        <Alert tone="warning" title="گذرواژهٔ شما باید تغییر کند">
          گذرواژهٔ این حساب در زمان افتتاح توسط کارگزار تعیین شده است. تا پیش از تغییر، برخی عملیات محدود
          می‌ماند. <Link to="/security">تغییر گذرواژه</Link>
        </Alert>
      ) : null}

      <MoneyHero
        balanceMinor={balanceMinor}
        referenceUsdMinor={referenceUsdMinor}
        referenceRate={monetary.referenceRatePrsPerUsd}
        coverageRatio={monetary.reserveCoverageRatio}
        accountsCount={wallets.length}
        onAction={(action) => {
          if (action === 'transfer') navigate('/send');
          if (action === 'receive') navigate('/receive');
          if (action === 'scan') navigate('/scan');
          if (action === 'card') navigate('/card');
        }}
      />

      <section className="prs-grid prs-grid-4">
        <Stat
          label="کیف پول‌ها"
          value={`${wallets.length.toLocaleString('fa-IR')} حساب`}
          hint={primaryWallet ? `${primaryWallet.publicRef} · ${labelFa(primaryWallet.status)}` : 'بدون کیف پول'}
          icon="wallet"
        />
        <Stat
          label="اسکناس‌های نزد شما"
          value={`${cards.length > 0 ? cards.length.toLocaleString('fa-IR') : '۰'} کارت`}
          hint={primaryCard ? `${primaryCard.networkLabel} · ${labelFa(primaryCard.status)}` : 'کارتی صادر نشده'}
          icon="notes"
        />
        <Stat
          label="ارزش مرجع دارایی شما"
          value={`${formatUsd(referenceUsdMinor)} دلار`}
          hint={`نرخ ${formatRate(monetary.referenceRatePrsPerUsd)} دلار برای هر پارسه`}
          icon="exchange"
        />
        <Stat
          label="پوشش پشتوانهٔ شبکه"
          value={formatPercent(monetary.reserveCoverageRatio)}
          hint="محاسبهٔ سرور از پشتوانهٔ واجد شرایط"
          tone={monetary.reserveCoverageRatio >= 1 ? 'positive' : 'warning'}
          icon="scale"
        />
      </section>

      <section className="prs-split">
        <Panel
          title="آخرین گردش‌ها"
          subtitle={`${activity.data?.total?.toLocaleString('fa-IR') ?? '۰'} رویداد ثبت‌شده در دفتر کل`}
          icon="history"
          actions={
            <>
              <Link className="prs-btn prs-btn--sm prs-btn--outline" to="/history">
                همهٔ گردش‌ها
              </Link>
              <button type="button" className="prs-btn prs-btn--sm prs-btn--quiet" onClick={() => void reload()}>
                به‌روزرسانی
              </button>
            </>
          }
        >
          <PanelBody tight>
            {activity.loading && transactions.length === 0 ? (
              <Loading />
            ) : (
              <DataTable
                compact
                rows={transactions}
                rowKey={(row) => row.id}
                empty={<div className="prs-empty">هنوز گردشی ثبت نشده است. با «دریافت» اولین پارسه را بگیرید.</div>}
                columns={[
                  {
                    key: 'type',
                    header: 'نوع',
                    render: (row) => (
                      <div className="prs-stack-2" style={{ gap: 2 }}>
                        <span style={{ fontWeight: 600 }}>{transactionTypeFa(row.type)}</span>
                        <span className="prs-2xs prs-muted">
                          {row.direction === 'IN' ? 'ورودی' : row.direction === 'OUT' ? 'خروجی' : 'داخلی'}
                        </span>
                      </div>
                    ),
                  },
                  {
                    key: 'counterparty',
                    header: 'طرف مقابل',
                    render: (row) => (
                      <span className="prs-small">
                        {row.counterpartyNameFa ?? (row.direction === 'IN' ? 'دریافت از شبکه' : '—')}
                      </span>
                    ),
                  },
                  {
                    key: 'amount',
                    header: 'مبلغ',
                    numeric: true,
                    render: (row) => <MoneyText minor={row.amountMinor} withUnit tone={row.direction === 'IN' ? 'in' : 'out'} />,
                  },
                  {
                    key: 'status',
                    header: 'وضعیت',
                    render: (row) => <Badge tone={statusTone(row.status)}>{labelFa(row.status)}</Badge>,
                  },
                  {
                    key: 'when',
                    header: 'زمان',
                    render: (row) => <span className="prs-small prs-muted">{formatRelative(row.completedAt ?? row.createdAt)}</span>,
                  },
                  {
                    key: 'actions',
                    header: '',
                    render: (row) => (
                      <Link className="prs-btn prs-btn--sm prs-btn--quiet" to={`/transactions/${row.reference}`}>
                        رسید
                      </Link>
                    ),
                  },
                ]}
              />
            )}
          </PanelBody>
        </Panel>

        <div className="prs-stack-5">
          <Panel
            title="کارت من"
            icon="card"
            actions={
              <Link className="prs-btn prs-btn--sm prs-btn--outline" to="/card">
                مدیریت کارت
              </Link>
            }
          >
            <PanelBody>
              {primaryCard ? (
                <div className="prs-stack-4">
                  <BankCard card={primaryCard} />
                  <dl className="prs-kv">
                    <div style={{ display: 'contents' }}>
                      <dt>وضعیت</dt>
                      <dd>
                        <Badge tone={statusTone(primaryCard.status)}>{labelFa(primaryCard.status)}</Badge>
                      </dd>
                    </div>
                    <div style={{ display: 'contents' }}>
                      <dt>کد پرداخت</dt>
                      <dd className="prs-num">{primaryCard.qrTokenPrefix ?? 'ساخته نشده'}</dd>
                    </div>
                  </dl>
                </div>
              ) : (
                <div className="prs-empty">هنوز کارتی برای این حساب صادر نشده است.</div>
              )}
            </PanelBody>
          </Panel>

          <Panel title="کنترل‌های سریع" subtitle="سه کار پرکاربرد" icon="grid">
            <PanelBody>
              <div className="prs-stack-3">
                <Link className="prs-choice prs-choice--active" to="/receive">
                  دریافت پارسه — نمایش شمارهٔ کارت و کد پرداخت
                </Link>
                <Link className="prs-choice" to="/scan">
                  پرداخت با اسکن کد کارت طرف مقابل
                </Link>
                <Link className="prs-choice" to="/banknotes">
                  اسکناس‌های من — واریز، برداشت و بررسی اصالت
                </Link>
              </div>
            </PanelBody>
          </Panel>

          <Panel title="وضعیت امنیت حساب" icon="shield">
            <PanelBody>
              <dl className="prs-kv">
                <div style={{ display: 'contents' }}>
                  <dt>ورود دو مرحله‌ای</dt>
                  <dd>{profile?.mfaEnabled ? <Badge tone="positive">فعال</Badge> : <Badge tone="warning">غیرفعال</Badge>}</dd>
                </div>
                <div style={{ display: 'contents' }}>
                  <dt>آخرین ورود</dt>
                  <dd>{formatRelative(profile?.lastLoginAt)}</dd>
                </div>
                <div style={{ display: 'contents' }}>
                  <dt>شناسهٔ عمومی</dt>
                  <dd className="prs-num">{profile?.publicRef ?? '—'}</dd>
                </div>
                <div style={{ display: 'contents' }}>
                  <dt>نشست جاری</dt>
                  <dd>
                    {session?.role ? `نقش ${session.role}` : '—'} · پنجرهٔ باقی‌مانده {' '}
                    <span className="prs-num">{formatCountdown(new Date(Date.now() + 15 * 60_000).toISOString())}</span>
                  </dd>
                </div>
              </dl>
              <div style={{ marginTop: 'var(--prs-space-4)' }}>
                <Link className="prs-btn prs-btn--sm prs-btn--outline" to="/security">
                  مدیریت امنیت و نشست‌ها
                </Link>
              </div>
            </PanelBody>
          </Panel>
        </div>
      </section>
    </div>
  );
}
