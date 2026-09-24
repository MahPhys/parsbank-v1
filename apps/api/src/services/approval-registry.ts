/**
 * BANK PARS — approval executor registry.
 *
 * The workflow (request → approve → execute) lives in approvals.service. The
 * *effect* of an approved action lives with the domain that owns it (treasury,
 * wallets, cms …). They are joined here so that the workflow never contains
 * monetary logic and the monetary services never contain approval state.
 */
import type { ApprovalActionType } from '@parsbank/types';
import type { TransactionContext } from '../db/types.ts';
import type { ActorContext, RequestMeta } from './context.ts';

export interface ApprovalActionRecord {
  id: string;
  actionRef: string;
  actionType: ApprovalActionType;
  payload: Record<string, unknown>;
  reason: string;
  requestedBy: string;
  decidedBy: string | null;
  adminActionId: string;
}

export interface ApprovalExecutionResult {
  entityRef?: string | null;
  result?: Record<string, unknown>;
}

export type ApprovalExecutor = (
  tx: TransactionContext,
  input: { action: ApprovalActionRecord; actor: ActorContext; meta: RequestMeta },
) => Promise<ApprovalExecutionResult>;

const executors = new Map<ApprovalActionType, ApprovalExecutor>();

export function registerApprovalExecutor(actionType: ApprovalActionType, executor: ApprovalExecutor): void {
  if (executors.has(actionType)) {
    throw new Error(`approval executor for ${actionType} is already registered`);
  }
  executors.set(actionType, executor);
}

export function getApprovalExecutor(actionType: ApprovalActionType): ApprovalExecutor | undefined {
  return executors.get(actionType);
}

export function registeredApprovalTypes(): ApprovalActionType[] {
  return [...executors.keys()];
}
