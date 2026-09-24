/**
 * SECTION: exchange rates — the reference price, derived not quoted.
 *
 * BANK PARS has no external market feed. The reference rate is arithmetic over the
 * eligible reserve NAV and the circulating supply, and both the live snapshot and
 * every historical valuation are shown with the supply they were computed against —
 * which is what makes an old rate auditable.
 */
import { Alert, Badge, DataTable, Panel, PanelBody, Stat, formatPercent, formatRate, formatUsd, toPersianDigits, MoneyText } from '@parsbank/ui';
import { adminApi } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { ConsolePage, ConsolePanel } from '../components/console.tsx';

interface RateRow {
  id: number;
  base_currency: string;
  quote_currency: string;
  rate_prs_per_usd: string;
  inverse_rate_usd_per_prs: string;
  source: string;
  is_parity_fallback: boolean;
  effective_at: string;
  note: string | null;
}

interface ValuationRow {
  id: number;
  as_of: string;
  ledger_sequence: number;
  total_issued_minor: string;
  circulating_supply_minor: string;
  bank_held_minor: string;
  treasury_reserve_usd_minor: string;
  eligible_reserve_nav_usd_minor: string;
  reserve_coverage_ratio: string;
  reference_rate_prs_per_usd: string;
  eligible_reserve_count: number;
  reasons: string[];
}

export function ExchangeRates() {
  const state = useAsync<{ rates: RateRow[]; valuations: ValuationRow[] }>(() => adminApi.get('/admin/rates'), []);
  const rates = state.data?.rates ?? [];
  const valuations = state.data?.valuations ?? [];
  const latest = rates[0];
  const latestValuation = valuations[0];

  return (
    <ConsolePage
      title="نرخ مرجع و ارزش‌گذاری‌ها"
      description="نرخ مرجع پارسه/دلار از داده‌های واقعی دفتر محاسبه می‌شود: پشتوانهٔ واجد شرایط تقسیم بر عرضهٔ در گردش. هیچ نرخی دستی وارد نمی‌شود."
    >
      <section className="prs-grid prs-grid-4">
        <Stat
          label="نرخ مرجع کنونی"
          value={formatRate(latest ? Number(latest.rate_prs_per_usd) : null) + ' دلار'}
          hint={latest ? `هر دلار ${formatRate(Number(latest.inverse_rate_usd_per_prs))} پارسه` : '—'}
          icon="exchange"
        />
        <Stat
          label="منبع محاسبه"
          value={latest?.is_parity_fallback ? 'تساوی مرجع' : 'پشتوانهٔ واجد شرایط'}
          hint={latest?.is_parity_fallback ? 'پشتوانهٔ واجد شرایط صفر است؛ نرخ روی ارزش اسمی ثابت شده' : 'نرخ بازار بیرونی وجود ندارد'}
          icon="scale"
        />
        <Stat
          label="آخرین نسبت پوشش"
          value={latestValuation ? formatPercent(Number(latestValuation.reserve_coverage_ratio)) : '—'}
          hint={latestValuation ? `پشتوانهٔ واجد شرایط ${formatUsd(latestValuation.eligible_reserve_nav_usd_minor)} $` : '—'}
          tone={latestValuation && Number(latestValuation.reserve_coverage_ratio) >= 1 ? 'positive' : 'warning'}
          icon="shield"
        />
        <Stat
          label="تعداد ارزش‌گذاری‌ها"
          value={toPersianDigits(valuations.length)}
          hint="هر ردیف یک تصویر تاریخی بی‌تغییر است"
          icon="history"
        />
      </section>

      <Alert tone="info" title="چرا «نرخ» اینجا یک دادهٔ بازار نیست؟">
        بانک پارس یک شبکهٔ بستهٔ خصوصی است. هیچ فید نرخ بیرونی، هیچ کارگزار ارز و هیچ اتصالی به بازار واقعی
        وجود ندارد؛ نرخ فقط بازتاب ریاضی پشتوانه و عرضه است و برای حسابرسی داخلی معنا دارد.
      </Alert>

      <Panel title="تصویر جاری پولی" subtitle="همان محاسبه‌ای که در سراسر سامانه استفاده می‌شود" icon="chart">
        <PanelBody>
          {latestValuation ? (
            <dl className="prs-kv">
              <div style={{ display: 'contents' }}>
                <dt>زمان محاسبه</dt>
                <dd>{latestValuation.as_of}</dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>نسخهٔ دفتر</dt>
                <dd className="prs-num">{toPersianDigits(latestValuation.ledger_sequence)}</dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>عرضهٔ منتشرشده</dt>
                <dd>
                  <MoneyText minor={latestValuation.total_issued_minor} withUnit />
                </dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>در گردش</dt>
                <dd>
                  <MoneyText minor={latestValuation.circulating_supply_minor} withUnit />
                </dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>نزد خزانه</dt>
                <dd>
                  <MoneyText minor={latestValuation.bank_held_minor} withUnit />
                </dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>پشتوانهٔ واجد شرایط</dt>
                <dd className="prs-num">{formatUsd(latestValuation.eligible_reserve_nav_usd_minor)} $</dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>پشتوانه‌های واجد شرایط</dt>
                <dd>{toPersianDigits(latestValuation.eligible_reserve_count)} دارایی</dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>دلیل محاسبه</dt>
                <dd className="prs-small">{(latestValuation.reasons ?? []).join(' · ') || '—'}</dd>
              </div>
            </dl>
          ) : (
            <p className="prs-small prs-muted">ارزش‌گذاری‌ای ثبت نشده است.</p>
          )}
        </PanelBody>
      </Panel>

      <ConsolePanel
        title="تاریخچهٔ نرخ"
        subtitle="هر تغییر نرخ با منبع و زمان ثبت می‌شود"
        icon="exchange"
        loading={state.loading && !state.data}
        rowCount={rates.length}
        empty="نرخی ثبت نشده است."
      >
        <DataTable
          compact
          rows={rates}
          rowKey={(row) => String(row.id)}
          columns={[
            { key: 'pair', header: 'جفت ارز', render: (row) => <span className="prs-small">{[row.base_currency, row.quote_currency].join(' / ')}</span> },
            { key: 'rate', header: 'نرخ', numeric: true, render: (row) => <span className="prs-num">{formatRate(Number(row.rate_prs_per_usd))}</span> },
            {
              key: 'inverse',
              header: 'معکوس',
              numeric: true,
              render: (row) => <span className="prs-num">{formatRate(Number(row.inverse_rate_usd_per_prs))}</span>,
            },
            { key: 'source', header: 'منبع', render: (row) => <span className="prs-small">{row.source}</span> },
            {
              key: 'fallback',
              header: 'حالت',
              render: (row) => (row.is_parity_fallback ? <Badge tone="warning">تساوی مرجع</Badge> : <Badge tone="positive">محاسبه از پشتوانه</Badge>),
            },
            { key: 'when', header: 'زمان', render: (row) => <span className="prs-small prs-muted">{row.effective_at}</span> },
            { key: 'note', header: 'یادداشت', render: (row) => <span className="prs-small">{row.note ?? '—'}</span> },
          ]}
        />
      </ConsolePanel>

      <ConsolePanel
        title="ارزش‌گذاری‌های تاریخی"
        subtitle="تصویر بی‌تغییر پولی در هر لحظه"
        icon="history"
        loading={state.loading && !state.data}
        rowCount={valuations.length}
        empty="ارزش‌گذاری‌ای ثبت نشده است."
      >
        <DataTable
          compact
          rows={valuations}
          rowKey={(row) => String(row.id)}
          columns={[
            { key: 'when', header: 'زمان', render: (row) => <span className="prs-small prs-muted">{row.as_of}</span> },
            { key: 'seq', header: 'نسخهٔ دفتر', numeric: true, render: (row) => <span className="prs-num">{toPersianDigits(row.ledger_sequence)}</span> },
            {
              key: 'issued',
              header: 'منتشرشده',
              numeric: true,
              render: (row) => <span className="prs-num">{Number(row.total_issued_minor).toLocaleString('fa-IR')}</span>,
            },
            {
              key: 'circulating',
              header: 'در گردش',
              numeric: true,
              render: (row) => <span className="prs-num">{Number(row.circulating_supply_minor).toLocaleString('fa-IR')}</span>,
            },
            {
              key: 'nav',
              header: 'پشتوانهٔ واجد شرایط',
              numeric: true,
              render: (row) => <span className="prs-num">{formatUsd(row.eligible_reserve_nav_usd_minor)} $</span>,
            },
            {
              key: 'coverage',
              header: 'پوشش',
              numeric: true,
              render: (row) => <span className="prs-num">{formatPercent(Number(row.reserve_coverage_ratio))}</span>,
            },
            {
              key: 'rate',
              header: 'نرخ',
              numeric: true,
              render: (row) => <span className="prs-num">{formatRate(Number(row.reference_rate_prs_per_usd))}</span>,
            },
            { key: 'reserves', header: 'تعداد پشتوانه', numeric: true, render: (row) => <span className="prs-num">{toPersianDigits(row.eligible_reserve_count)}</span> },
          ]}
        />
      </ConsolePanel>
    </ConsolePage>
  );
}
