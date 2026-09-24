/**
 * BANK PARS — executor installation.
 *
 * Approval executors register themselves as an import side effect, which is
 * convenient but easy to forget: a missing import is not a compile error, it is a
 * "no executor registered" failure at the worst possible moment. This module is
 * therefore the single place that pulls every executor-bearing service in, and
 * `assertExecutorCoverage()` proves at boot that the register is complete.
 *
 * Import order is irrelevant; the registry is keyed by action type.
 */
import './users.service.ts';
import './treasury.service.ts';
import './cards.service.ts';
import './banknotes.service.ts';
import './design.service.ts';

import { APPROVAL_POLICIES } from '@parsbank/domain';
import { registeredApprovalTypes } from './approval-registry.ts';
import type { ApprovalActionType } from '@parsbank/types';

export interface ExecutorCoverage {
  expected: ApprovalActionType[];
  registered: ApprovalActionType[];
  missing: ApprovalActionType[];
}

export function executorCoverage(): ExecutorCoverage {
  const expected = Object.keys(APPROVAL_POLICIES) as ApprovalActionType[];
  const registered = registeredApprovalTypes();
  const missing = expected.filter((actionType) => !registered.includes(actionType));
  return { expected, registered, missing };
}

/**
 * Refuses to continue when an action type has a policy but no implementation.
 * Failing at boot is the only acceptable moment: the alternative is discovering it
 * while an officer is trying to issue money.
 */
export function assertExecutorCoverage(): ExecutorCoverage {
  const coverage = executorCoverage();
  if (coverage.missing.length > 0) {
    throw new Error(
      `BANK PARS startup: no executor registered for ${coverage.missing.join(', ')}. ` +
        'Every action type in APPROVAL_POLICIES must have an implementation.',
    );
  }
  return coverage;
}

export { registeredApprovalTypes };
