/**
 * SECTION: system health — the checks that say whether the institution is sound.
 *
 * Seven checks run on the server: monetary invariants, ledger balance, banknote
 * reconciliation, session controls, database reachability and the reserve floor. The
 * screen shows them verbatim, including the Persian detail line, so nothing is
 * summarised away between the database and the operator.
 */
import { Alert,
  Badge,
  Button,
  DataTable,
  Panel,
  PanelBody,
  Stat,
  formatDateTime,
  formatPercent,
  formatPrs,
  statusTone,
  toPersianDigits,
} from '@parsbank/ui';
import { adminApi } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { ConsolePage, ConsolePanel } from '../components/console.tsx';

interface HealthPayload {
  status: 'OK' | 'DEGRADED' | 'CRITICAL';
  checks: Array<{ code: string; labelFa: string; status: 'OK' | 'WARNING' | 'CRITICAL'; detailFa: string; value?: string | number | null }>;
  monetary: {
    totalIssuedMinor: number;
    circulatingSupplyMinor: number;
    bankHeldMinor: number;
    maxSupplyMinor: number;
    reserveCoverageRatio: number;
    referenceRatePrsPerUsd: number;
    eligibleReserveNavUsdMinor: number;
    ledgerSequence: number;
    asOf: string;
  } | null;
  database: { driver: string; latencyMs: number; version: string };
  version: string;
  generatedAt: string;
}

export function SystemHealth() {
  const health = useAsync<HealthPayload>(() => adminApi.get<HealthPayload>('/admin/health'), []);
  const findings = useAsync<{ items: Array<Record<string, unknown>> }>(() => adminApi.get('/admin/health/findings'), []);

  const data = health.data;

  return (
    <ConsolePage
      title="سلامت سامانه"
      description="بررسی‌های سرور دربارهٔ یکپارچگی پولی، توازن دفتر، اسکناس و کنترل‌های امنیتی."
      actions={
        <Button variant="outline" size="sm" icon="refresh" onClick={() => void Promise.all([health.reload(), findings.reload()])}>
          بازخوانی
        </Button>
      }
    >
      {health.error ? <Alert tone="critical" title="وضعیت سامانه خوانده نشد">{health.error}</Alert> : null}

      {data ? (
        <>
          <Alert
            tone={data.status === 'OK' ? 'success' : data.status === 'DEGRADED' ? 'warning' : 'critical'}
            title={data.status === 'OK' ? 'همهٔ بررسی‌ها سالم است' : data.status === 'DEGRADED' ? 'سامانه سالم است، با هشدار' : 'بررسی‌ها وضعیت بحرانی گزارش می‌کنند'}
          >
            آخرین بازخوانی: {formatDateTime(data.generatedAt)} — نسخهٔ سامانه {data.version}
          </Alert>

          <section className="prs-grid prs-grid-4">
            <Stat label="درایور پایگاه داده" value={data.database.driver} hint={`تأخیر ${toPersianDigits(data.database.latencyMs)} میلی‌ثانیه`} icon="treasury" />
            <Stat label="نسخهٔ PostgreSQL" value={<span className="prs-num prs-small">{data.database.version}</span>} icon="list" />
            <Stat
              label="عرضهٔ منتشرشده"
              value={formatPrs(data.monetary?.totalIssuedMinor ?? 0, true)}
              hint={`از سقف ${formatPrs(data.monetary?.maxSupplyMinor ?? 0, true)}`}
              icon="notes"
            />
            <Stat
              label="نسبت پوشش"
              value={formatPercent(data.monetary?.reserveCoverageRatio ?? null)}
              hint={`در گردش ${formatPrs(data.monetary?.circulatingSupplyMinor ?? 0, true)}`}
              tone={data.monetary && data.monetary.reserveCoverageRatio >= 1 ? 'positive' : 'critical'}
              icon="shield"
            />
          </section>

          <ConsolePanel title="بررسی‌ها" subtitle="همان چیزی که سرور گزارش می‌کند" icon="pulse" rowCount={data.checks.length}>
            <DataTable
              compact
              rows={data.checks}
              rowKey={(row) => row.code}
              columns={[
                { key: 'code', header: 'کد', render: (row) => <span className="prs-num prs-small" dir="ltr">{row.code}</span> },
                { key: 'label', header: 'بررسی', render: (row) => <span>{row.labelFa}</span> },
                {
                  key: 'status',
                  header: 'وضعیت',
                  render: (row) => (
                    <Badge tone={row.status === 'OK' ? 'positive' : row.status === 'WARNING' ? 'warning' : 'critical'} dot>
                      {row.status === 'OK' ? 'سالم' : row.status === 'WARNING' ? 'هشدار' : 'بحرانی'}
                    </Badge>
                  ),
                },
                { key: 'detail', header: 'توضیح', render: (row) => <span className="prs-small">{row.detailFa}</span> },
                { key: 'value', header: 'مقدار', render: (row) => <span className="prs-num prs-small">{row.value === undefined || row.value === null ? '—' : String(row.value)}</span> },
              ]}
            />
          </ConsolePanel>

          {data.monetary ? (
            <Panel title="تصویر پولی لحظه" subtitle="برای مقایسه با گزارش حسابرسی" icon="chart">
              <PanelBody>
                <dl className="prs-kv">
                  <div style={{ display: 'contents' }}>
                    <dt>عرضهٔ منتشرشده</dt>
                    <dd>{formatPrs(data.monetary.totalIssuedMinor, true)}</dd>
                  </div>
                  <div style={{ display: 'contents' }}>
                    <dt>در گردش</dt>
                    <dd>{formatPrs(data.monetary.circulatingSupplyMinor, true)}</dd>
                  </div>
                  <div style={{ display: 'contents' }}>
                    <dt>نزد خزانه</dt>
                    <dd>{formatPrs(data.monetary.bankHeldMinor, true)}</dd>
                  </div>
                  <div style={{ display: 'contents' }}>
                    <dt>پشتوانهٔ واجد شرایط</dt>
                    <dd className="prs-num">{data.monetary.eligibleReserveNavUsdMinor.toLocaleString('fa-IR')} سنت</dd>
                  </div>
                  <div style={{ display: 'contents' }}>
                    <dt>نرخ مرجع</dt>
                    <dd className="prs-num">{toPersianDigits(data.monetary.referenceRatePrsPerUsd)} دلار</dd>
                  </div>
                  <div style={{ display: 'contents' }}>
                    <dt>نسخهٔ دفتر کل</dt>
                    <dd className="prs-num">{toPersianDigits(data.monetary.ledgerSequence)}</dd>
                  </div>
                </dl>
              </PanelBody>
            </Panel>
          ) : null}
        </>
      ) : (
        <p className="prs-small prs-muted">در حال خواندن وضعیت…</p>
      )}

      <ConsolePanel
        title="یافته‌های یکپارچگی"
        subtitle="فهرست خالی یعنی هیچ نقض ثابتی پیدا نشده است"
        icon="alert"
        rowCount={findings.data?.items.length ?? 0}
        empty="یافته‌ای وجود ندارد."
        loading={findings.loading && !findings.data}
      >
        <pre className="prs-code" dir="ltr">
          {JSON.stringify(findings.data?.items ?? [], null, 2)}
        </pre>
      </ConsolePanel>

      <Alert tone="info" title="چرا وضعیت به‌جای «سبز/قرمز» توضیح می‌دهد؟">
        یک اپراتور باید بداند *چه چیزی* هشدار داده است. به همین دلیل هر بررسی یک توضیح فارسی همراه دارد؛
        عدد پوشش، اختلاف دفتر اسکناس و تعداد نشست‌های مشکوک همه با جملهٔ خودشان می‌آیند.
      </Alert>
    </ConsolePage>
  );
}
