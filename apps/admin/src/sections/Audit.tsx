/**
 * SECTION: audit — the record that makes the rest verifiable.
 *
 * Two registers live here and they answer different questions:
 *   • the audit log answers "who did what, and was it allowed?";
 *   • the ledger audit answers "does the book still balance?" — total debits against
 *     total credits, the supply view, and any posting set that does not balance.
 *
 * The auditor role can read both. Nothing on this screen can alter either.
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Field,
  Panel,
  PanelBody,
  Select,
  Stat,
  TextInput,
  formatDateTime,
  formatPrs,
  labelFa,
  statusTone,
  toPersianDigits,
} from '@parsbank/ui';
import { adminApi } from '../lib/api.ts';
import { useAsync, useDebounced } from '../lib/hooks.ts';
import { ConsolePage, ConsolePanel, Pager } from '../components/console.tsx';

interface AuditRow {
  id: number;
  occurred_at: string;
  actor_label: string | null;
  actor_role: string | null;
  action: string;
  category: string;
  severity: string;
  outcome: string;
  entity_type: string | null;
  entity_ref: string | null;
  reason: string | null;
  request_id: string | null;
  has_ip: boolean;
}

interface LedgerAuditPayload {
  balanced: boolean;
  totalDebitsMinor: number;
  totalCreditsMinor: number;
  entriesCount: number;
  transactionsCount: number;
  unbalancedPostingSets: Array<Record<string, unknown>>;
  supply: { totalIssuedMinor: number; circulatingSupplyMinor: number; bankHeldMinor: number };
  findings: Array<{ code: string; labelFa: string; detailFa?: string; severity?: string }>;
}

const CATEGORIES = ['', 'AUTH', 'MONEY', 'TREASURY', 'CARD', 'BANKNOTE', 'ADMIN', 'CONTENT', 'SECURITY', 'GENERAL'];
const SEVERITIES = ['', 'INFO', 'NOTICE', 'WARNING', 'CRITICAL'];
const OUTCOMES = ['', 'SUCCESS', 'DENIED', 'FAILED'];

export function Audit() {
  const [action, setAction] = useState('');
  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState('');
  const [outcome, setOutcome] = useState('');
  const [page, setPage] = useState(1);
  const debouncedAction = useDebounced(action);

  const logs = useAsync<{ rows: AuditRow[]; total: number; page: number; pageSize: number }>(
    () =>
      adminApi.get('/admin/audit', {
        query: { action: debouncedAction, category, severity, outcome, page, pageSize: 50 },
      }),
    [debouncedAction, category, severity, outcome, page],
  );

  const ledger = useAsync<LedgerAuditPayload>(() => adminApi.get('/admin/ledger-audit'), []);
  const rows = logs.data?.rows ?? [];

  return (
    <ConsolePage
      title="گزارش حسابرسی"
      description="هر عمل مدیریتی، هر تصمیم دو‌نفره و هر رد صلاحیت در این دفتر ثبت می‌شود. حسابرس این دفتر را می‌خواند و نمی‌تواند تغییرش دهد."
      actions={
        <Button variant="outline" size="sm" icon="refresh" onClick={() => void Promise.all([logs.reload(), ledger.reload()])}>
          بازخوانی
        </Button>
      }
    >
      <section className="prs-grid prs-grid-4">
        <Stat
          label="توازن دفتر کل"
          value={ledger.data ? (ledger.data.balanced ? 'متوازن' : 'نامتوازن') : '—'}
          hint={ledger.data ? `بدهکار ${formatPrs(ledger.data.totalDebitsMinor)} = بستانکار ${formatPrs(ledger.data.totalCreditsMinor)}` : ''}
          tone={ledger.data?.balanced ? 'positive' : 'critical'}
          icon="scale"
        />
        <Stat
          label="ثبت‌های دفتر"
          value={toPersianDigits(ledger.data?.entriesCount ?? 0)}
          hint={`در ${toPersianDigits(ledger.data?.transactionsCount ?? 0)} تراکنش`}
          icon="list"
        />
        <Stat
          label="مجموعه‌های نامتوازن"
          value={toPersianDigits(ledger.data?.unbalancedPostingSets.length ?? 0)}
          hint="باید همیشه صفر باشد"
          tone={(ledger.data?.unbalancedPostingSets.length ?? 0) === 0 ? 'positive' : 'critical'}
          icon="alert"
        />
        <Stat
          label="یافته‌های یکپارچگی"
          value={toPersianDigits(ledger.data?.findings.length ?? 0)}
          hint="بررسی‌های سقف عرضه، پوشش و اسکناس"
          tone={(ledger.data?.findings.length ?? 0) === 0 ? 'positive' : 'warning'}
          icon="shield"
        />
      </section>

      {ledger.data && !ledger.data.balanced ? (
        <Alert tone="critical" title="دفتر کل نامتوازن است">
          این وضعیت نباید رخ دهد و نشانهٔ نقض یک یا چند ثابت پولی است. تا رفع آن، هیچ عملیات مالی تازه‌ای
          نباید تأیید شود.
        </Alert>
      ) : null}

      <Panel title="تصویر پولی دفتر" subtitle="عرضه از دید حساب‌های موجودی" icon="treasury">
        <PanelBody>
          {ledger.data ? (
            <dl className="prs-kv">
              <div style={{ display: 'contents' }}>
                <dt>کل منتشرشده</dt>
                <dd>{formatPrs(ledger.data.supply.totalIssuedMinor, true)}</dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>در گردش</dt>
                <dd>{formatPrs(ledger.data.supply.circulatingSupplyMinor, true)}</dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>نزد خزانه</dt>
                <dd>{formatPrs(ledger.data.supply.bankHeldMinor, true)}</dd>
              </div>
            </dl>
          ) : (
            <p className="prs-small prs-muted">در حال خواندن…</p>
          )}
        </PanelBody>
      </Panel>

      {ledger.data && ledger.data.findings.length > 0 ? (
        <ConsolePanel title="یافته‌های یکپارچگی" icon="alert" rowCount={ledger.data.findings.length}>
          <div className="prs-stack-3">
            {ledger.data.findings.map((finding) => (
              <div key={finding.code} className="prs-row prs-between">
                <span>{finding.labelFa}</span>
                <Badge tone={statusTone(finding.severity ?? 'WARNING')}>{finding.code}</Badge>
              </div>
            ))}
          </div>
        </ConsolePanel>
      ) : null}

      <ConsolePanel title="صافی‌ها" icon="search">
        <div className="prs-grid prs-grid-4">
          <Field label="عمل" hint="نام فنی عمل، مانند card.qr.rotate">
            <TextInput
              dir="ltr"
              value={action}
              onChange={(event) => {
                setPage(1);
                setAction(event.target.value);
              }}
            />
          </Field>
          <Field label="دسته">
            <Select
              value={category}
              onChange={(event) => {
                setPage(1);
                setCategory(event.target.value);
              }}
            >
              {CATEGORIES.map((value) => (
                <option key={value || 'all'} value={value}>
                  {value ? labelFa(value) : 'همه'}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="شدت">
            <Select
              value={severity}
              onChange={(event) => {
                setPage(1);
                setSeverity(event.target.value);
              }}
            >
              {SEVERITIES.map((value) => (
                <option key={value || 'all'} value={value}>
                  {value ? labelFa(value) : 'همه'}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="نتیجه">
            <Select
              value={outcome}
              onChange={(event) => {
                setPage(1);
                setOutcome(event.target.value);
              }}
            >
              {OUTCOMES.map((value) => (
                <option key={value || 'all'} value={value}>
                  {value ? labelFa(value) : 'همه'}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </ConsolePanel>

      {logs.error ? <Alert tone="critical" title="گزارش خوانده نشد">{logs.error}</Alert> : null}

      <ConsolePanel
        title="دفتر حسابرسی"
        subtitle={logs.data ? `${toPersianDigits(logs.data.total)} ردیف` : undefined}
        icon="list"
        loading={logs.loading && rows.length === 0}
        rowCount={rows.length}
        empty="با این صافی‌ها ردیفی پیدا نشد."
      >
        <DataTable
          compact
          rows={rows}
          rowKey={(row) => String(row.id)}
          columns={[
            { key: 'when', header: 'زمان', render: (row) => <span className="prs-small prs-muted">{formatDateTime(row.occurred_at)}</span> },
            { key: 'action', header: 'عمل', render: (row) => <span className="prs-small" dir="ltr">{row.action}</span> },
            { key: 'category', header: 'دسته', render: (row) => <span className="prs-small">{labelFa(row.category)}</span> },
            { key: 'actor', header: 'عامل', render: (row) => <span className="prs-small">{row.actor_label ?? 'سامانه'}</span> },
            { key: 'role', header: 'نقش', render: (row) => <span className="prs-small">{row.actor_role ?? '—'}</span> },
            {
              key: 'severity',
              header: 'شدت',
              render: (row) => <Badge tone={statusTone(row.severity)}>{labelFa(row.severity)}</Badge>,
            },
            {
              key: 'outcome',
              header: 'نتیجه',
              render: (row) => (
                <Badge tone={row.outcome === 'SUCCESS' ? 'positive' : row.outcome === 'DENIED' ? 'warning' : 'critical'}>
                  {labelFa(row.outcome)}
                </Badge>
              ),
            },
            { key: 'entity', header: 'موجودیت', render: (row) => <span className="prs-small prs-num">{row.entity_ref ?? row.entity_type ?? '—'}</span> },
            { key: 'reason', header: 'دلیل', render: (row) => <span className="prs-small">{row.reason ?? '—'}</span> },
            { key: 'request', header: 'شناسهٔ درخواست', render: (row) => <span className="prs-small prs-num">{row.request_id ?? '—'}</span> },
          ]}
        />
        {logs.data ? <Pager page={page} pageSize={50} total={logs.data.total} onPage={setPage} /> : null}
      </ConsolePanel>

      <Alert tone="info" title="چرا گاهی نتیجهٔ «رد‌شده» می‌بینیم؟">
        ثبت تلاش‌های ردشده مهم‌تر از ثبت موفقیت‌هاست: نشان می‌دهد کنترل‌ها کار کرده‌اند. هر تلاش برای
        عبور از اختیارات، در همین دفتر با نتیجهٔ DENIED می‌ماند.
      </Alert>
    </ConsolePage>
  );
}
