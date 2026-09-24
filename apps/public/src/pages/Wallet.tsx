/**
 * Wallet — one account's statement.
 *
 * The balance shown here is read from the ledger-derived view (`/me/wallets`), never
 * from a cached number in the browser, and the "reference value" column is the
 * server's own conversion using the published reference rate.
 */
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  DataTable,
  Loading,
  MoneyText,
  Panel,
  PanelBody,
  Stat,
  formatPrs,
  formatRate,
  formatRelative,
  formatUsd,
  labelFa,
  statusTone,
  toPersianDigits,
  transactionTypeFa,
} from '@parsbank/ui';
import type { MonetarySnapshot, TransactionDto, WalletSummary } from '@parsbank/types';
import { api } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';

interface WalletDetail {
  wallet: {
    walletId: string;
    publicRef: string;
    labelFa: string;
    status: string;
    isPrimary: boolean;
    balanceMinor: number;
    openedAt: string;
  };
  referenceRate: number | null;
  monetary: MonetarySnapshot;
  recentTransactions: TransactionDto[];
}

export function WalletPage() {
  const { walletRef } = useParams<{ walletRef: string }>();

  const wallets = useAsync<{ items: WalletSummary[] }>(() => api.get<{ items: WalletSummary[] }>('/me/wallets'), []);
  const detail = useAsync<WalletDetail | null>(
    () => (walletRef ? api.get<WalletDetail>(`/me/wallets/${encodeURIComponent(walletRef)}`) : Promise.resolve(null)),
    [walletRef],
  );

  const list = wallets.data?.items ?? [];

  if (wallets.loading && list.length === 0) return <Loading label="در حال خواندن کیف پول‌ها…" />;

  return (
    <div className="prs-container prs-container-wide prs-stack-6">
      <div className="prs-row prs-between prs-wrap">
        <div>
          <h1>کیف پول‌ها</h1>
          <p className="prs-small prs-muted">
            هر کیف پول یک حساب در دفتر کل است. موجودی از روی ثبت‌های دفتر بازخوانی می‌شود.
          </p>
        </div>
        <div className="prs-row-2">
          <Link className="prs-btn prs-btn--sm prs-btn--primary" to="/send">
            انتقال
          </Link>
          <Link className="prs-btn prs-btn--sm prs-btn--outline" to="/receive">
            دریافت
          </Link>
        </div>
      </div>

      {list.length > 0 ? (
        <section className="prs-grid prs-grid-3">
          {list.map((wallet) => (
            <Panel
              key={wallet.walletId}
              title={wallet.labelFa}
              subtitle={wallet.publicRef}
              icon="wallet"
              actions={<Badge tone={statusTone(wallet.status)}>{labelFa(wallet.status)}</Badge>}
            >
              <PanelBody>
                <div className="prs-stack-3">
                  <Stat
                    label="موجودی"
                    value={<MoneyText minor={wallet.balanceMinor} withUnit size="lg" />}
                    hint={`ارزش مرجع ${formatUsd(wallet.referenceUsdMinor)} دلار`}
                  />
                  <div className="prs-row prs-wrap">
                    <Link className="prs-btn prs-btn--sm prs-btn--outline" to={`/wallet/${wallet.publicRef}`}>
                      صورت حساب
                    </Link>
                    <Link className="prs-btn prs-btn--sm prs-btn--quiet" to="/receive">
                      گرفتن پارسه
                    </Link>
                  </div>
                </div>
              </PanelBody>
            </Panel>
          ))}
        </section>
      ) : (
        <Alert tone="warning" title="کیف پولی صادر نشده است">
          برای این حساب هنوز کیف پولی ساخته نشده. کارگزاران شبکه می‌توانند آن را صادر کنند.
        </Alert>
      )}

      {walletRef ? (
        detail.data ? (
          <Panel
            title={`صورت حساب ${detail.data.wallet.labelFa}`}
            subtitle={`${detail.data.wallet.publicRef} · بازشده ${formatRelative(detail.data.wallet.openedAt)}`}
            icon="history"
            actions={
              <Link className="prs-btn prs-btn--sm prs-btn--outline" to={`/history?wallet=${detail.data.wallet.publicRef}`}>
                همهٔ گردش‌ها
              </Link>
            }
          >
            <PanelBody>
              <div className="prs-grid prs-grid-4">
                <Stat label="موجودی" value={<MoneyText minor={detail.data.wallet.balanceMinor} withUnit size="lg" />} />
                <Stat
                  label="نرخ مرجع"
                  value={`${formatRate(detail.data.referenceRate)}`}
                  hint="دلار برای هر پارسه — محاسبهٔ سرور"
                />
                <Stat
                  label="عرضه در گردش شبکه"
                  value={`${formatPrs(detail.data.monetary.circulatingSupplyMinor, true)}`}
                  hint="کیف پول‌ها + اسکناس در دست مردم"
                />
                <Stat
                  label="آخرین به‌روزرسانی"
                  value={toPersianDigits(new Date(detail.data.monetary.asOf).toLocaleTimeString('fa-IR'))}
                  hint={`نسخهٔ دفتر ${toPersianDigits(detail.data.monetary.ledgerSequence)}`}
                />
              </div>
            </PanelBody>
            <PanelBody tight>
              <DataTable
                rows={detail.data.recentTransactions}
                rowKey={(row) => row.id}
                compact
                empty={<div className="prs-empty">برای این کیف پول گردشی ثبت نشده است.</div>}
                columns={[
                  {
                    key: 'type',
                    header: 'نوع',
                    render: (row) => <span>{transactionTypeFa(row.type)}</span>,
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
                    key: 'counterparty',
                    header: 'طرف مقابل',
                    render: (row) => <span className="prs-small">{row.counterpartyNameFa ?? '—'}</span>,
                  },
                  { key: 'when', header: 'زمان', render: (row) => <span className="prs-small prs-muted">{formatRelative(row.createdAt)}</span> },
                  {
                    key: 'link',
                    header: '',
                    render: (row) => (
                      <Link className="prs-btn prs-btn--sm prs-btn--quiet" to={`/transactions/${row.reference}`}>
                        رسید
                      </Link>
                    ),
                  },
                ]}
              />
            </PanelBody>
          </Panel>
        ) : detail.loading ? (
          <Loading label="در حال خواندن صورت حساب…" />
        ) : detail.error ? (
          <Alert tone="critical" title="صورت حساب خوانده نشد">{detail.error}</Alert>
        ) : null
      ) : (
        <Alert tone="info" title="یک کیف پول را برگزینید">
          برای دیدن صورت حساب کامل، روی «صورت حساب» در کارت یکی از کیف پول‌های بالا بزنید.
        </Alert>
      )}
    </div>
  );
}
