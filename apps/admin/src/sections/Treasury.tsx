/**
 * SECTION: treasury — the monetary state of the institution.
 *
 * Everything here is read from `prs.monetary_state` and the reserve book; nothing is
 * computed in the browser. The two controls on this page (issue, change a monetary
 * rule) do not execute anything: they open the approval flow, because a single
 * operator may never move the money supply.
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Field,
  KeyValue,
  MoneyText,
  MonetaryStrip,
  Panel,
  PanelBody,
  Progress,
  Stat,
  TextInput,
  formatPercent,
  formatRate,
  formatUsd,
  toPersianDigits,
} from '@parsbank/ui';
import { useAsync } from '../lib/hooks.ts';
import { ConsolePage } from '../components/console.tsx';
import { RequestApprovalDialog } from '../components/approval.tsx';
import { adminApi, describeError } from '../lib/api.ts';

interface TreasuryState {
  maxSupplyMinor: number;
  totalIssuedMinor: number;
  circulatingSupplyMinor: number;
  bankHeldMinor: number;
  treasuryReserveUsdMinor: number;
  eligibleReserveNavUsdMinor: number;
  reserveCoverageRatio: number;
  referenceRatePrsPerUsd: number;
  parValueUsdMinor: number;
  isParityFallback: boolean;
  asOf: string | null;
  version: number;
}

interface ReserveRow {
  reserve_ref: string;
  asset_kind: string;
  book_value_usd_minor: string;
  haircut_bps: number;
  eligibility: string;
  eligible_nav_usd_minor: string;
}

interface TreasuryPayload {
  state: TreasuryState;
  reserves: ReserveRow[];
  issuanceHeadroomMinor: number;
  coverageFloor: { requiredNavUsdMinor: number; surplusUsdMinor: number } | null;
  counts: { issuances: number; issuedMinor: number; burns: number; burnedMinor: number; redemptions: number; redeemedMinor: number };
}

export function Treasury() {
  const treasury = useAsync<TreasuryPayload>(() => adminApi.get('/admin/treasury'), []);
  const [dialog, setDialog] = useState<'ISSUANCE' | 'MAX_SUPPLY_CHANGE' | 'RESERVE_RULE_CHANGE' | 'DISABLE_FINANCIAL_CONTROLS' | null>(null);

  const data = treasury.data;
  const state = data?.state;

  return (
    <ConsolePage
      title="خزانه"
      description="عرضه، پشتوانه و نرخ مرجع از یک منبع واحد خوانده می‌شوند: دفتر کل و پروندهٔ ارزیابی‌های سرور. این صفحه هیچ عددی را خودش نمی‌سازد."
      actions={
        <Button variant="outline" size="sm" icon="refresh" onClick={() => void treasury.reload()}>
          بازخوانی
        </Button>
      }
    >
      {treasury.error ? <Alert tone="critical" title="وضعیت خزانه خوانده نشد">{treasury.error}</Alert> : null}

      {state ? (
        <MonetaryStrip
          maxSupplyMinor={state.maxSupplyMinor}
          totalIssuedMinor={state.totalIssuedMinor}
          circulatingSupplyMinor={state.circulatingSupplyMinor}
          notesOutstandingMinor={state.bankHeldMinor}
          eligibleNavUsdMinor={state.eligibleReserveNavUsdMinor}
          coverageRatio={state.reserveCoverageRatio}
        />
      ) : null}

      <section className="prs-grid prs-grid-4">
        <Stat
          label="نرخ مرجع"
          value={state ? formatRate(state.referenceRatePrsPerUsd) : '—'}
          hint={state?.isParityFallback ? 'نرخ جایگزین اسمی (پشتوانه صفر)' : 'از تقسیم پشتوانه واجد شرایط بر عرضه در گردش'}
          icon="exchange"
        />
        <Stat label="پشتوانه واجد شرایط" value={state ? formatUsd(state.eligibleReserveNavUsdMinor, true) : '—'} hint={`ارزش دفتری: ${state ? formatUsd(state.treasuryReserveUsdMinor, true) : '—'}`} icon="scale" />
        <Stat label="سقف باقی‌ماندهٔ انتشار" value={data ? toPersianDigits(data.issuanceHeadroomMinor) : '—'} hint="پارسه قابل انتشار بدون تغییر سقف" icon="plus" />
        <Stat
          label="کف پوشش"
          value={data?.coverageFloor ? formatUsd(data.coverageFloor.surplusUsdMinor, true) : '—'}
          hint={data?.coverageFloor ? 'مازاد پشتوانه بالای کف ۱٫۰۰' : 'کف پوشش تعریف نشده است'}
          tone={data?.coverageFloor && data.coverageFloor.surplusUsdMinor < 0 ? 'critical' : 'positive'}
          icon="seal"
        />
      </section>

      <Panel
        title="کنترل‌های پولی"
        subtitle="هر عمل این بخش فقط یک درخواست ثبت می‌کند؛ اجرا با مدیر دوم است."
        icon="lock"
      >
        <PanelBody>
          <div className="prs-row prs-wrap" style={{ gap: 'var(--prs-space-3)' }}>
            <Button variant="primary" size="sm" icon="plus" onClick={() => setDialog('ISSUANCE')}>
              درخواست انتشار
            </Button>
            <Button variant="outline" size="sm" icon="scale" onClick={() => setDialog('MAX_SUPPLY_CHANGE')}>
              تغییر سقف عرضه
            </Button>
            <Button variant="outline" size="sm" icon="settings" onClick={() => setDialog('RESERVE_RULE_CHANGE')}>
              تغییر قاعدهٔ پشتوانه
            </Button>
            <Button variant="danger" size="sm" icon="ban" onClick={() => setDialog('DISABLE_FINANCIAL_CONTROLS')}>
              کنترل‌های اضطراری
            </Button>
          </div>
          <Alert tone="info" title="چرا دکمه‌ها مستقیم پول نمی‌سازند؟">
            انتشار، تغییر سقف و خاموش‌کردن کنترل‌ها هر سه «عمل حیاتی» هستند: درخواست ثبت می‌شود، مدیر دوم آن را
            می‌بیند و تأیید می‌کند و تنها پس از آن اجرا انجام می‌گیرد. سرویس هم جداگانه همین را تحمیل می‌کند؛
            بنابراین دور زدن این صفحه هیچ راهی برای تولید پول باز نمی‌کند.
          </Alert>
        </PanelBody>
      </Panel>

      <ConsolePanel
        title="وضعیت پولی"
        subtitle={state?.asOf ? `آخرین محاسبه: ${state.asOf}` : undefined}
        icon="treasury"
        loading={treasury.loading && !data}
        rowCount={state ? 1 : 0}
        empty="وضعیت پولی در دسترس نیست."
      >
        {state ? (
          <KeyValue
            items={[
              { label: 'حداکثر عرضه', value: <MoneyText minor={state.maxSupplyMinor} withUnit /> },
              { label: 'کل منتشرشده', value: <MoneyText minor={state.totalIssuedMinor} withUnit /> },
              { label: 'در گردش', value: <MoneyText minor={state.circulatingSupplyMinor} withUnit tone="out" /> },
              { label: 'در اختیار خزانه', value: <MoneyText minor={state.bankHeldMinor} withUnit /> },
              { label: 'نسبت پوشش', value: formatPercent(state.reserveCoverageRatio) },
              { label: 'ارزش اسمی', value: formatUsd(state.parValueUsdMinor, true) },
              { label: 'شمارهٔ نسخهٔ وضعیت', value: toPersianDigits(state.version) },
              {
                label: 'استفاده از سقف',
                value: <Progress value={state.totalIssuedMinor} max={state.maxSupplyMinor} />,
              },
            ]}
          />
        ) : null}
      </ConsolePanel>

      <ConsolePanel
        title="پشتوانهٔ ثبت‌شده"
        subtitle="ارزش دفتری، کسر قیمت و ارزش واجد شرایط هر دارایی"
        icon="scale"
        loading={treasury.loading && !data}
        rowCount={data?.reserves.length ?? 0}
        empty="دارایی پشتوانه‌ای ثبت نشده است."
      >
        <DataTable
          compact
          rows={data?.reserves ?? []}
          rowKey={(row) => row.reserve_ref}
          columns={[
            { key: 'ref', header: 'شناسه', render: (row) => <span className="prs-num" dir="ltr">{row.reserve_ref}</span> },
            { key: 'kind', header: 'نوع', render: (row) => <Badge tone="info">{row.asset_kind}</Badge> },
            { key: 'book', header: 'ارزش دفتری', numeric: true, render: (row) => formatUsd(row.book_value_usd_minor, true) },
            { key: 'haircut', header: 'کسر قیمت', numeric: true, render: (row) => `${toPersianDigits(row.haircut_bps / 100)}٪` },
            { key: 'elig', header: 'واجد شرایط', render: (row) => <Badge tone={row.eligibility === 'ELIGIBLE' ? 'positive' : 'warning'}>{row.eligibility === 'ELIGIBLE' ? 'بله' : 'خیر'}</Badge> },
            { key: 'nav', header: 'ارزش واجد شرایط', numeric: true, render: (row) => formatUsd(row.eligible_nav_usd_minor, true) },
          ]}
        />
      </ConsolePanel>

      <section className="prs-grid prs-grid-3">
        <Stat label="شمار انتشارها" value={data ? toPersianDigits(data.counts.issuances) : '—'} hint={data ? formatUsd(data.counts.issuedMinor) + ' پارسه' : undefined} icon="plus" />
        <Stat label="شمار امحاها" value={data ? toPersianDigits(data.counts.burns) : '—'} hint={data ? toPersianDigits(data.counts.burnedMinor) + ' پارسه' : undefined} icon="ban" />
        <Stat label="شمار بازخریدها" value={data ? toPersianDigits(data.counts.redemptions) : '—'} hint={data ? toPersianDigits(data.counts.redeemedMinor) + ' پارسه' : undefined} icon="exchange" />
      </section>

      <SimulationPanel />

      <RequestApprovalDialog
        open={dialog === 'ISSUANCE'}
        initialType="ISSUANCE"
        onClose={() => {
          setDialog(null);
          void treasury.reload();
        }}
      />
      <RequestApprovalDialog
        open={dialog === 'MAX_SUPPLY_CHANGE'}
        initialType="MAX_SUPPLY_CHANGE"
        lockedPayload={state ? { maxSupplyMinor: state.maxSupplyMinor } : undefined}
        onClose={() => {
          setDialog(null);
          void treasury.reload();
        }}
      />
      <RequestApprovalDialog
        open={dialog === 'RESERVE_RULE_CHANGE'}
        initialType="RESERVE_RULE_CHANGE"
        onClose={() => setDialog(null)}
      />
      <RequestApprovalDialog
        open={dialog === 'DISABLE_FINANCIAL_CONTROLS'}
        initialType="DISABLE_FINANCIAL_CONTROLS"
        onClose={() => {
          setDialog(null);
          void treasury.reload();
        }}
      />
    </ConsolePage>
  );
}

/**
 * Dry-run calculator. The server performs the projection with the same code path
 * that will execute the real issuance, so the numbers shown here are the numbers the
 * executor would produce — without creating a single unit.
 */
function SimulationPanel() {
  const [amount, setAmount] = useState('100');
  const [contribution, setContribution] = useState('10000');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const value = await adminApi.post<Record<string, unknown>>('/admin/treasury/issuance/simulate', {
        amountMinor: Number(amount),
        reserveContributionUsdMinor: Number(contribution),
      });
      setResult(value);
    } catch (caught) {
      setError(describeError(caught));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const projected = (result?.projected ?? null) as
    | { reserveCoverageRatio?: number; referenceRatePrsPerUsd?: number; eligibleReserveNavUsdMinor?: number }
    | null;

  return (
    <Panel
      title="محاسبهٔ آزمایشی انتشار"
      subtitle="بدون هیچ اثری روی عرضه یا دفتر کل"
      icon="chart"
    >
      <PanelBody>
        <div className="prs-grid prs-grid-2">
          <Field label="مقدار انتشار (پارسه)">
            <TextInput numeric value={amount} onChange={(event) => setAmount(event.target.value)} />
          </Field>
          <Field label="کمک پشتوانه (سنت دلار)" hint="حداقل برابر ارزش اسمی مقدار منتشرشده.">
            <TextInput numeric value={contribution} onChange={(event) => setContribution(event.target.value)} />
          </Field>
        </div>
        <Button variant="outline" size="sm" loading={busy} onClick={() => void run()}>
          محاسبه کن
        </Button>
        {error ? <Alert tone="warning" title="محاسبه انجام نشد">{error}</Alert> : null}
        {result ? (
          <Alert tone={result.allowed ? 'success' : 'critical'} title={result.allowed ? 'این انتشار مجاز است' : 'این انتشار مجاز نیست'}>
            {String(result.messageFa ?? '')}
            {projected ? (
              <span className="prs-block">
                پوشش پس از انتشار: {formatPercent(projected.reserveCoverageRatio ?? null)} — نرخ پس از انتشار:{' '}
                {formatRate(projected.referenceRatePrsPerUsd ?? null)}
              </span>
            ) : null}
          </Alert>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

/** Small wrapper so every section renders the same panel shell. */
function ConsolePanel({
  title,
  subtitle,
  icon,
  loading,
  empty,
  rowCount,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: Parameters<typeof Panel>[0]['icon'];
  loading?: boolean;
  empty: string;
  rowCount: number;
  children: React.ReactNode;
}) {
  return (
    <Panel title={title} subtitle={subtitle} icon={icon}>
      <PanelBody>
        {loading ? (
          <span className="prs-muted">در حال بارگیری…</span>
        ) : rowCount === 0 ? (
          <p className="prs-muted">{empty}</p>
        ) : (
          children
        )}
      </PanelBody>
    </Panel>
  );
}
