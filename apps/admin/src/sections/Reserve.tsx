/**
 * SECTION: reserve — what stands behind the currency.
 *
 * A valuation is not a text field: it enters through a dual-approved action, it lands
 * in an append-only table, and it moves both the coverage ratio and the reference
 * rate. The screen therefore shows the eligibility rules and the haircut treatment
 * next to the numbers, because those rules are what make the NAV meaningful.
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Panel,
  PanelBody,
  Stat,
  formatPercent,
  formatRate,
  formatUsd,
  labelFa,
  toPersianDigits,
} from '@parsbank/ui';
import { adminApi } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { ConsolePage, ConsolePanel } from '../components/console.tsx';
import { RequestApprovalDialog } from '../components/approval.tsx';

interface ReserveRow {
  id: string;
  reserve_ref: string;
  asset_kind: string;
  description_fa: string;
  book_value_usd_minor: string;
  haircut_bps: number;
  eligibility: string;
  status: string;
  last_valued_at: string;
  custodian: string;
  evidence_ref: string | null;
  eligible_nav_usd_minor: string;
}

interface ReservePayload {
  reserves: ReserveRow[];
  latestValuation: {
    eligible_reserve_nav_usd_minor: string;
    reserve_coverage_ratio: string;
    reference_rate_prs_per_usd: string;
    as_of: string;
  } | null;
}

export function Reserve() {
  const state = useAsync<ReservePayload>(() => adminApi.get<ReservePayload>('/admin/reserve'), []);
  const [valuationOpen, setValuationOpen] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);

  const reserves = state.data?.reserves ?? [];
  const bookTotal = reserves.reduce((sum, row) => sum + Number(row.book_value_usd_minor ?? 0), 0);
  const eligibleTotal = reserves.reduce((sum, row) => sum + Number(row.eligible_nav_usd_minor ?? 0), 0);

  return (
    <ConsolePage
      title="پشتوانه"
      description="هر دارایی پشتوانه یک ارزش دفتری، یک کسر ارزش (haircut) و یک وضعیت واجد شرایط بودن دارد. NAV واجد شرایط، مبنای پوشش و نرخ مرجع است."
      actions={
        <>
          <Button variant="outline" size="sm" icon="refresh" onClick={() => void state.reload()}>
            به‌روزرسانی
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRuleOpen(true)}>
            درخواست تغییر قاعدهٔ پشتوانه
          </Button>
          <Button variant="primary" size="sm" icon="plus" onClick={() => setValuationOpen(true)}>
            درخواست ارزش‌گذاری تازه
          </Button>
        </>
      }
    >
      <section className="prs-grid prs-grid-4">
        <Stat label="ارزش دفتری دارایی‌ها" value={`${formatUsd(bookTotal)} $`} hint={`${toPersianDigits(reserves.length)} دارایی فعال`} icon="scale" />
        <Stat
          label="ارزش واجد شرایط پس از کسر"
          value={`${formatUsd(eligibleTotal)} $`}
          hint="همین عدد در محاسبهٔ پوشش به کار می‌رود"
          icon="shield"
        />
        <Stat
          label="نسبت پوشش"
          value={state.data?.latestValuation ? formatPercent(Number(state.data.latestValuation.reserve_coverage_ratio)) : '—'}
          hint="پشتوانهٔ واجد شرایط ÷ (عرضهٔ در گردش × ارزش اسمی)"
          tone={
            state.data?.latestValuation && Number(state.data.latestValuation.reserve_coverage_ratio) >= 1 ? 'positive' : 'warning'
          }
          icon="chart"
        />
        <Stat
          label="نرخ مرجع"
          value={state.data?.latestValuation ? `${formatRate(Number(state.data.latestValuation.reference_rate_prs_per_usd))} دلار` : '—'}
          hint="محاسبه‌شده در سرور، ذخیره‌شده به‌صورت تصویر زمانی"
          icon="exchange"
        />
      </section>

      <Alert tone="info" title="قواعد محاسبهٔ پشتوانه">
        NAV واجد شرایط = مجموع «ارزش دفتری × (۱ − کسر ارزش)» برای دارایی‌هایی که هم وضعیت فعال دارند و هم
        واجد شرایط شناخته شده‌اند. دارایی «در انتظار بررسی» در NAV نمی‌آید و «غیرواجد شرایط» هرگز وارد محاسبه
        نمی‌شود.
      </Alert>

      {state.error ? <Alert tone="critical" title="اطلاعات پشتوانه خوانده نشد">{state.error}</Alert> : null}

      <ConsolePanel
        title="دارایی‌های پشتوانه"
        subtitle="فقط وضعیت فعال و واجد شرایط در NAV وارد می‌شود"
        icon="scale"
        loading={state.loading && !state.data}
        rowCount={reserves.length}
        empty="پشتوانه‌ای ثبت نشده است."
      >
        <DataTable
          rows={reserves}
          rowKey={(row) => row.id}
          columns={[
            { key: 'ref', header: 'شناسه', render: (row) => <span className="prs-num prs-small">{row.reserve_ref}</span> },
            { key: 'desc', header: 'شرح', render: (row) => <span>{row.description_fa}</span> },
            { key: 'kind', header: 'نوع', render: (row) => <span className="prs-small">{row.asset_kind}</span> },
            { key: 'book', header: 'ارزش دفتری', numeric: true, render: (row) => <span className="prs-num">{formatUsd(row.book_value_usd_minor)} $</span> },
            { key: 'haircut', header: 'کسر', numeric: true, render: (row) => <span className="prs-num">{toPersianDigits(row.haircut_bps / 100)}٪</span> },
            {
              key: 'nav',
              header: 'NAV واجد شرایط',
              numeric: true,
              render: (row) => <span className="prs-num" style={{ fontWeight: 600 }}>{formatUsd(row.eligible_nav_usd_minor)} $</span>,
            },
            {
              key: 'eligibility',
              header: 'واجد شرایط',
              render: (row) =>
                row.eligibility === 'ELIGIBLE' ? (
                  <Badge tone="positive">واجد شرایط</Badge>
                ) : row.eligibility === 'PENDING_REVIEW' ? (
                  <Badge tone="warning">در انتظار بررسی</Badge>
                ) : (
                  <Badge tone="muted">غیرواجد شرایط</Badge>
                ),
            },
            { key: 'status', header: 'وضعیت', render: (row) => <Badge tone={row.status === 'ACTIVE' ? 'positive' : 'muted'}>{labelFa(row.status)}</Badge> },
            { key: 'custodian', header: 'امانت‌دار', render: (row) => <span className="prs-small">{row.custodian}</span> },
            { key: 'evidence', header: 'سند پشتیبان', render: (row) => <span className="prs-small prs-num">{row.evidence_ref ?? '—'}</span> },
            { key: 'valued', header: 'آخرین ارزش‌گذاری', render: (row) => <span className="prs-small prs-muted">{row.last_valued_at}</span> },
          ]}
        />
      </ConsolePanel>

      <Panel title="آخرین تصویر ارزش‌گذاری" icon="clock">
        <PanelBody>
          {state.data?.latestValuation ? (
            <dl className="prs-kv">
              <div style={{ display: 'contents' }}>
                <dt>زمان</dt>
                <dd>{state.data.latestValuation.as_of}</dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>NAV واجد شرایط</dt>
                <dd className="prs-num">{formatUsd(state.data.latestValuation.eligible_reserve_nav_usd_minor)} $</dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>نسبت پوشش</dt>
                <dd className="prs-num">{formatPercent(Number(state.data.latestValuation.reserve_coverage_ratio))}</dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>نرخ مرجع</dt>
                <dd className="prs-num">{formatRate(Number(state.data.latestValuation.reference_rate_prs_per_usd))} دلار</dd>
              </div>
            </dl>
          ) : (
            <p className="prs-small prs-muted">ارزش‌گذاری‌ای ثبت نشده است.</p>
          )}
        </PanelBody>
      </Panel>

      <RequestApprovalDialog
        open={valuationOpen}
        initialType="RESERVE_VALUATION"
        onClose={() => {
          setValuationOpen(false);
          void state.reload();
        }}
      />
      <RequestApprovalDialog
        open={ruleOpen}
        initialType="RESERVE_RULE_CHANGE"
        onClose={() => {
          setRuleOpen(false);
          void state.reload();
        }}
      />
    </ConsolePage>
  );
}
