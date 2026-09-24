/**
 * The dual-approval console.
 *
 * Institutional rule: nobody executes a governed operation alone. This component is
 * the only place in the console that can move from PENDING to EXECUTED, and it does
 * so through the server's three-step protocol:
 *
 *   1. `POST /admin/approvals/:id/nonce`   — a single-use, two-minute grants token,
 *   2. `POST /admin/approvals/:id/approve` — the second signature (never the requester),
 *   3. `POST /admin/approvals/:id/execute` — runs the registered executor.
 *
 * The console cannot skip step 2 by construction: `execute` only succeeds after the
 * server has recorded a distinct approver.
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Field,
  Modal,
  Panel,
  PanelBody,
  Select,
  TextArea,
  TextInput,
  formatCountdown,
  formatDateTime,
  labelFa,
  statusTone,
} from '@parsbank/ui';
import type { AdminActionDto, ApprovalActionType } from '@parsbank/types';
import { adminApi, describeError } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { APPROVAL_ACTIONS, actionSpec, initialValues, type ApprovalActionSpec } from '../lib/actions.ts';

/** Catalogue is never empty; the compiler just cannot know that. */
const FALLBACK_SPEC = APPROVAL_ACTIONS[0]!;
const specFor = (type: ApprovalActionType): ApprovalActionSpec => actionSpec(type) ?? FALLBACK_SPEC;
import { StatusCell } from './console.tsx';

/* ------------------------------------------------------------- request form -- */

export function RequestApprovalDialog({
  open,
  onClose,
  onFiled,
  initialType,
  lockedPayload,
}: {
  open: boolean;
  onClose: () => void;
  onFiled?: (result: { actionRef: string; actionType: string }) => void;
  initialType?: ApprovalActionType;
  lockedPayload?: Record<string, unknown>;
}) {
  const [type, setType] = useState<ApprovalActionType>(initialType ?? 'ISSUANCE');
  const spec = specFor(type);
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(spec));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState<{ actionRef: string } | null>(null);

  const changeType = (next: ApprovalActionType) => {
    setType(next);
    setValues(initialValues(specFor(next)));
    setFiled(null);
    setError(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = lockedPayload ? { ...spec.buildPayload(values), ...lockedPayload } : spec.buildPayload(values);
      const result = await adminApi.post<{ actionRef: string; actionType: string }>('/admin/approvals', {
        actionType: spec.type,
        payload,
        reason,
      });
      setFiled({ actionRef: result.actionRef });
      onFiled?.(result);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`درخواست تأیید — ${spec.labelFa}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            بستن
          </Button>
          <Button variant="primary" icon="seal" loading={busy} disabled={reason.trim().length < 8} onClick={() => void submit()}>
            ثبت درخواست برای تأیید دوم
          </Button>
        </>
      }
    >
      <div className="prs-stack-4">
        <Alert tone="info" title="هیچ عملیاتی اینجا اجرا نمی‌شود">
          این فرم فقط درخواست را ثبت می‌کند. اجرای واقعی پس از تأیید مدیر دوم و از مسیر
          «اجرا» انجام می‌شود؛ درخواست‌کننده نمی‌تواند درخواست خودش را تأیید کند.
        </Alert>

        <Field label="نوع عملیات">
          <Select value={type} onChange={(event) => changeType(event.target.value as ApprovalActionType)}>
            {APPROVAL_ACTIONS.map((entry) => (
              <option key={entry.type} value={entry.type}>
                {entry.labelFa}
              </option>
            ))}
          </Select>
        </Field>

        <p className="prs-small prs-muted">{spec.summaryFa}</p>

        {spec.fields.map((field) => (
          <Field key={field.key} label={field.labelFa} hint={field.hintFa}>
            {field.kind === 'select' ? (
              <Select
                value={values[field.key] ?? ''}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
              >
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.labelFa}
                  </option>
                ))}
              </Select>
            ) : (
              <TextInput
                numeric={field.kind === 'number'}
                value={values[field.key] ?? ''}
                placeholder={field.placeholder}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
              />
            )}
          </Field>
        ))}

        <Field label="دلیل درخواست" hint="دست‌کم ۸ نویسه. این متن در گزارش حسابرسی ثبت می‌شود.">
          <TextArea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>

        {error ? <Alert tone="critical" title="درخواست ثبت نشد">{error}</Alert> : null}
        {filed ? (
          <Alert tone="success" title="درخواست ثبت شد">
            شناسهٔ درخواست <span className="prs-num">{filed.actionRef}</span> — اکنون در صف تأیید است.
          </Alert>
        ) : null}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ decision flow -- */

export function DecisionActions({
  action,
  onDone,
  selfProfileId,
}: {
  action: AdminActionDto;
  onDone: () => void;
  selfProfileId: string | null;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRequester = selfProfileId !== null && action.requestedBy === selfProfileId;

  const decide = async (purpose: 'APPROVE' | 'REJECT') => {
    setBusy(true);
    setError(null);
    try {
      const nonce = await adminApi.post<{ nonce: string; expiresAt: string }>(`/admin/approvals/${action.id}/nonce`, { purpose });
      await adminApi.post(`/admin/approvals/${action.id}/${purpose === 'APPROVE' ? 'approve' : 'reject'}`, {
        nonce: nonce.nonce,
        note: note.trim() ? note.trim() : null,
      });
      onDone();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.post(`/admin/approvals/${action.id}/execute`, {});
      onDone();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="prs-stack-3">
      {action.status === 'PENDING' ? (
        <>
          {isRequester ? (
            <Alert tone="warning" title="شما درخواست‌کننده هستید">
              تأیید درخواست خودتان — حتی با نقش مدیر ارشد — ممکن نیست؛ این قاعده در سطح پایگاه داده اعمال می‌شود.
            </Alert>
          ) : null}
          <Field label="یادداشت تصمیم (اختیاری)">
            <TextInput value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          <div className="prs-row prs-wrap">
            <Button variant="primary" size="sm" icon="check" loading={busy} disabled={isRequester} onClick={() => void decide('APPROVE')}>
              تأیید (امضای دوم)
            </Button>
            <Button variant="danger" size="sm" icon="ban" loading={busy} onClick={() => void decide('REJECT')}>
              رد درخواست
            </Button>
          </div>
        </>
      ) : null}

      {action.status === 'APPROVED' ? (
        <div className="prs-row prs-wrap">
          <Button variant="primary" size="sm" icon="seal" loading={busy} onClick={() => void execute()}>
            اجرای عملیات تأییدشده
          </Button>
          <span className="prs-small prs-muted">
            اجرا اثر واقعی دارد: مصرف پشتوانه، تغییر عرضه یا جابه‌جایی گردش.
          </span>
        </div>
      ) : null}

      {error ? <Alert tone="critical" title="این تصمیم ثبت نشد">{error}</Alert> : null}
    </div>
  );
}

/** Detail view of one request, including its payload and the decision trail. */
export function ApprovalDetail({ action, selfProfileId, onDone }: { action: AdminActionDto; selfProfileId: string | null; onDone: () => void }) {
  const spec = actionSpec(action.actionType);
  return (
    <Panel
      title={action.actionLabelFa || spec?.labelFa || action.actionType}
      subtitle={`${action.actionRef} · درخواست ${formatDateTime(action.requestedAt)}`}
      icon="seal"
      actions={<Badge tone={statusTone(action.status)} dot>{labelFa(action.status)}</Badge>}
    >
      <PanelBody>
        <div className="prs-stack-4">
          <dl className="prs-kv">
            <div style={{ display: 'contents' }}>
              <dt>درخواست‌کننده</dt>
              <dd>{action.requestedByNameFa}</dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>دلیل</dt>
              <dd>{action.reason || '—'}</dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>مهلت</dt>
              <dd className="prs-num">{action.expiresAt ? formatCountdown(action.expiresAt) : '—'}</dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>تصمیم‌گیرنده</dt>
              <dd>{action.decidedBy ?? '—'}</dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>زمان تصمیم</dt>
              <dd>{action.decidedAt ? formatDateTime(action.decidedAt) : '—'}</dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>زمان اجرا</dt>
              <dd>{action.executedAt ? formatDateTime(action.executedAt) : '—'}</dd>
            </div>
            <div style={{ display: 'contents' }}>
              <dt>نیازمند تأیید دوم</dt>
              <dd>{action.requiresSecondApprover ? 'بله' : 'خیر'}</dd>
            </div>
          </dl>

          <div>
            <div className="prs-small prs-muted">اثر درخواست (payload)</div>
            <pre className="prs-code" dir="ltr">
              {JSON.stringify(action.payloadPreview, null, 2)}
            </pre>
          </div>

          <DecisionActions action={action} selfProfileId={selfProfileId} onDone={onDone} />
        </div>
      </PanelBody>
    </Panel>
  );
}

/* ------------------------------------------------------------------ queue --- */

export interface ApprovalListPayload {
  items: AdminActionDto[];
  total: number;
}

export function useApprovalQueue(status = 'PENDING', page = 1) {
  return useAsync<ApprovalListPayload>(
    () => adminApi.get<ApprovalListPayload>('/admin/approvals', { query: { status: status || undefined, page, pageSize: 25 } }),
    [status, page],
  );
}

export function statusOf(action: AdminActionDto): string {
  return action.status;
}

export { StatusCell };
