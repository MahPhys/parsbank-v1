/**
 * SECTION: overview — one screen for the state of the institution.
 *
 * Reading order is deliberate: money first (supply, coverage, rate), then the size of
 * the network, then what is waiting for a second signature, then what actually
 * happened. Every figure is a server-computed value from the ledger.
 */
import { Link } from 'react-router-dom';
import {
  Alert,
  DataTable,
  MoneyText,
  MonetaryStrip,
  Panel,
  PanelBody,
  Progress,
  Stat,
  formatDateTime,
  formatPercent,
  formatPrs,
  formatRate,
  formatRelative,
  labelFa,
  roleFa,
  toPersianDigits,
} from '@parsbank/ui';
import { adminApi } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { ConsolePage, ConsolePanel, DateCell, MoneyCell, StatusCell } from '../components/console.tsx';

interface OverviewPayload {
  monetary: {
    maxSupplyMinor: number;
    totalIssuedMinor: number;
    circulatingSupplyMinor: number;
    bankHeldMinor: number;
    eligibleReserveNavUsdMinor: number;
    reserveCoverageRatio: number;
    referenceRatePrsPerUsd: number;
    parValueUsdMinor: number;
    isParityFallback: boolean;
    asOf: string;
    ledgerSequence: number;
  };
  counts: {
    profiles: number;
    activeProfiles: number;
    wallets: number;
    frozenWallets: number;
    activeCards: number;
    transactions: number;
    transactionsToday: number;
    banknotes: number;
    outstandingNotes: number;
    pendingApprovals: number;
    criticalEvents: number;
  };
  volume: {
    transferredTodayMinor: number;
    transferredTotalMinor: number;
    issuedTotalMinor: number;
    burnedTotalMinor: number;
    feeRevenueMinor: number;
  };
  approvals: Array<Record<string, unknown>>;
  recentTransactions: Array<Record<string, unknown>>;
  recentAudit: Array<Record<string, unknown>>;
  sections: string[];
}

export function Overview() {
  const state = useAsync<OverviewPayload>(() => adminApi.get<OverviewPayload>('/admin/overview'), []);
  const roles = useAsync<{ counts: Record<string, number> }>(() => adminApi.get('/admin/roles/summary'), []);

  if (state.error) {
    return (
      <ConsolePage title="نمای کل">
        <Alert tone="critical" title="نمای کل خوانده نشد">{state.error}</Alert>
      </ConsolePage>
    );
  }

  const data = state.data;
  const monetary = data?.monetary;
  const counts = data?.counts;
  const volume = data?.volume;

  return (
    <ConsolePage
      title="نمای کل"
      description="مهم‌ترین اعداد مؤسسه در یک نگاه: عرضه، پوشش، نرخ مرجع و آنچه در انتظار امضای دوم است."
      actions={
        <>
          <Link className="prs-btn prs-btn--sm prs-btn--outline" to="/admin/approvals">
            صف تأیید ({toPersianDigits(counts?.pendingApprovals ?? 0)})
          </Link>
          <Link className="prs-btn prs-btn--sm prs-btn--outline" to="/admin/system-health">
            سلامت سامانه
          </Link>
          <Link className="prs-btn prs-btn--sm prs-btn--primary" to="/admin/treasury">
            خزانه
          </Link>
        </>
      }
    >
      {monetary ? (
        <>
          <MonetaryStrip
            maxSupplyMinor={monetary.maxSupplyMinor}
            totalIssuedMinor={monetary.totalIssuedMinor}
            circulatingSupplyMinor={monetary.circulatingSupplyMinor}
            notesOutstandingMinor={null}
            eligibleNavUsdMinor={monetary.eligibleReserveNavUsdMinor}
            coverageRatio={monetary.reserveCoverageRatio}
          />

          <section className="prs-grid prs-grid-4">
            <Stat
              label="عرضه در گردش"
              value={`${formatPrs(monetary.circulatingSupplyMinor, true)}`}
              hint={`شامل اسکناس در دست مردم و موجودی کیف پول‌ها · نسخهٔ دفتر ${toPersianDigits(monetary.ledgerSequence)}`}
              icon="notes"
            />
            <Stat
              label="نسبت پوشش"
              value={formatPercent(monetary.reserveCoverageRatio)}
              hint={
                monetary.isParityFallback
                  ? 'حالت تساوی مرجع: پشتوانهٔ واجد شرایط صفر است و نرخ روی ارزش اسمی ثابت شده.'
                  : `پشتوانهٔ واجد شرایط به ارزش دفتری، تقسیم بر عرضهٔ در گردش × ارزش اسمی`
              }
              tone={monetary.reserveCoverageRatio >= 1 ? 'positive' : 'critical'}
              icon="shield"
            />
            <Stat
              label="نرخ مرجع"
              value={`${formatRate(monetary.referenceRatePrsPerUsd)}`}
              hint="دلار برای هر پارسه — محاسبهٔ سرور از پشتوانه تقسیم بر عرضهٔ در گردش"
              icon="exchange"
            />
            <Stat
              label="سقف عرضه"
              value={`${formatPrs(monetary.maxSupplyMinor, true)}`}
              hint={`منتشرشده: ${formatPrs(monetary.totalIssuedMinor, true)} · نزده: ${formatPrs(monetary.maxSupplyMinor - monetary.totalIssuedMinor, true)}`}
              icon="treasury"
            />
          </section>

          <Panel title="فاصله تا سقف عرضه" subtitle="انتشار نمی‌تواند از این خط بگذرد" icon="chart">
            <PanelBody>
              <Progress value={monetary.totalIssuedMinor} max={monetary.maxSupplyMinor} />
              <p className="prs-small prs-muted" style={{ marginTop: 'var(--prs-space-3)' }}>
                مقدار منتشرشده {formatPrs(monetary.totalIssuedMinor, true)} از سقف{' '}
                {formatPrs(monetary.maxSupplyMinor, true)} — این قید در سطح پایگاه داده و در سرویس خزانه هر دو
                اعمال می‌شود.
              </p>
            </PanelBody>
          </Panel>
        </>
      ) : null}

      <section className="prs-grid prs-grid-4">
        <Stat label="کاربران" value={toPersianDigits(counts?.profiles ?? 0)} hint={`${toPersianDigits(counts?.activeProfiles ?? 0)} فعال`} icon="user" />
        <Stat
          label="کیف پول‌ها"
          value={toPersianDigits(counts?.wallets ?? 0)}
          hint={`${toPersianDigits(counts?.frozenWallets ?? 0)} منجمد`}
          icon="wallet"
        />
        <Stat label="کارت‌های فعال" value={toPersianDigits(counts?.activeCards ?? 0)} hint="کارت‌های منقضی و لغوشده شمرده نشده‌اند" icon="card" />
        <Stat
          label="تراکنش‌ها"
          value={toPersianDigits(counts?.transactions ?? 0)}
          hint={`${toPersianDigits(counts?.transactionsToday ?? 0)} در ۲۴ ساعت گذشته`}
          icon="history"
        />
      </section>

      <section className="prs-split">
        <ConsolePanel
          title="حجم عملیات"
          subtitle="جمع‌های دفتری، بدون احتساب گردش‌های ناکام"
          icon="treasury"
          loading={state.loading && !data}
        >
          <dl className="prs-kv">
            <div style={{ display: 'contents' }}>
              <dt>انتقال امروز</dt>
              <dd>
                <MoneyCell minor={volume?.transferredTodayMinor} />
              </dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>انتقال کل</dt>
              <dd>
                <MoneyCell minor={volume?.transferredTotalMinor} />
              </dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>کل انتشار</dt>
              <dd>
                <MoneyCell minor={volume?.issuedTotalMinor} />
              </dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>کل امحا</dt>
              <dd>
                <MoneyCell minor={volume?.burnedTotalMinor} />
              </dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>درآمد کارمزد (حساب ۲۵۰۰)</dt>
              <dd>
                <MoneyCell minor={volume?.feeRevenueMinor} />
              </dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>اسکناس‌های دارای ارزش در گردش</dt>
              <dd>
                {toPersianDigits(counts?.outstandingNotes ?? 0)} از {toPersianDigits(counts?.banknotes ?? 0)} برگ
              </dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>رویدادهای هشدار هفت روز گذشته</dt>
              <dd>{toPersianDigits(counts?.criticalEvents ?? 0)}</dd>
            </div>
          </dl>
        </ConsolePanel>

        <ConsolePanel
          title="ترکیب نقش‌ها"
          subtitle="نقش‌ها یکدیگر را به ارث نمی‌برند"
          icon="shield"
          loading={roles.loading && !roles.data}
        >
          <div className="prs-stack-3">
            {Object.entries(roles.data?.counts ?? {}).map(([role, count]) => (
              <div key={role} className="prs-row prs-between">
                <span>{roleFa(role)}</span>
                <span className="prs-num">{toPersianDigits(count)}</span>
              </div>
            ))}
          </div>
          <p className="prs-small prs-muted" style={{ marginTop: 'var(--prs-space-4)' }}>
            نقش DESIGN_ADMIN هیچ اختیار پولی ندارد و نقش AUDITOR فقط می‌خواند. تغییر نقش، خودش یک عملیات
            دو‌نفره است.
          </p>
        </ConsolePanel>
      </section>

      <ConsolePanel
        title="در انتظار امضای دوم"
        subtitle="تا تأیید نشود، هیچ اثری رخ نمی‌دهد"
        icon="seal"
        rowCount={data?.approvals?.length ?? 0}
        empty="صف تأیید خالی است."
        loading={state.loading && !data}
      >
        <DataTable
          compact
          rows={data?.approvals ?? []}
          rowKey={(row) => String(row.id)}
          columns={[
            { key: 'ref', header: 'شناسه', render: (row) => <span className="prs-num prs-small">{String(row.action_ref ?? '')}</span> },
            { key: 'type', header: 'نوع', render: (row) => <span>{labelFa(String(row.action_type ?? ''))}</span> },
            { key: 'label', header: 'شرح', render: (row) => <span>{String(row.label_fa ?? '')}</span> },
            { key: 'by', header: 'درخواست‌کننده', render: (row) => <span>{String(row.requested_by_name ?? '—')}</span> },
            { key: 'when', header: 'زمان', render: (row) => <DateCell value={row.requested_at as string} relative /> },
            {
              key: 'link',
              header: '',
              render: () => (
                <Link className="prs-btn prs-btn--sm prs-btn--quiet" to="/admin/approvals">
                  بررسی
                </Link>
              ),
            },
          ]}
        />
      </ConsolePanel>

      <section className="prs-split">
        <ConsolePanel
          title="آخرین تراکنش‌ها"
          subtitle="گردش واقعی دفتر کل"
          icon="history"
          rowCount={data?.recentTransactions?.length ?? 0}
          empty="تراکنشی ثبت نشده است."
          loading={state.loading && !data}
        >
          <DataTable
            compact
            rows={data?.recentTransactions ?? []}
            rowKey={(row) => String(row.reference)}
            columns={[
              { key: 'ref', header: 'شناسه', render: (row) => <span className="prs-num prs-small">{String(row.reference ?? '')}</span> },
              {
                key: 'amount',
                header: 'مبلغ',
                numeric: true,
                render: (row) => <MoneyText minor={Number(row.amount_minor ?? 0)} withUnit />,
              },
              { key: 'from', header: 'از', render: (row) => <span className="prs-small">{String(row.sender_name ?? 'خزانه')}</span> },
              { key: 'to', header: 'به', render: (row) => <span className="prs-small">{String(row.receiver_name ?? '—')}</span> },
              { key: 'status', header: 'وضعیت', render: (row) => <StatusCell value={row.status as string} /> },
              { key: 'when', header: 'زمان', render: (row) => <DateCell value={row.created_at as string} relative /> },
            ]}
          />
        </ConsolePanel>

        <ConsolePanel
          title="آخرین رخدادهای حسابرسی"
          subtitle="هر عمل مدیریتی اینجا ثبت می‌شود"
          icon="list"
          rowCount={data?.recentAudit?.length ?? 0}
          empty="رخدادی ثبت نشده است."
          loading={state.loading && !data}
        >
          <DataTable
            compact
            rows={data?.recentAudit ?? []}
            rowKey={(row) => String(row.id)}
            columns={[
              { key: 'action', header: 'عمل', render: (row) => <span className="prs-small">{String(row.action ?? '')}</span> },
              { key: 'actor', header: 'عامل', render: (row) => <span className="prs-small">{String(row.actor_label ?? 'سامانه')}</span> },
              { key: 'severity', header: 'شدت', render: (row) => <StatusCell value={row.severity as string} /> },
              { key: 'when', header: 'زمان', render: (row) => <DateCell value={row.occurred_at as string} relative /> },
            ]}
          />
        </ConsolePanel>
      </section>

      <Alert tone="info" title="چرا هیچ‌کدام از این اعداد قابل ویرایش نیست؟">
        هیچ صفحه‌ای در این کنسول مقدار عرضه، پشتوانه، نرخ یا موجودی را مستقیماً تغییر نمی‌دهد. این‌ها
        بازخوانی‌هایی از دفتر کل هستند؛ تغییر واقعی فقط با یک تراکنش تازه و از مسیر تأیید دو‌نفره ممکن است.
      </Alert>

      <p className="prs-small prs-muted">
        آخرین به‌روزرسانی اعداد: {monetary ? formatDateTime(monetary.asOf) : '—'} (
        {monetary ? formatRelative(monetary.asOf) : '—'})
      </p>
    </ConsolePage>
  );
}
