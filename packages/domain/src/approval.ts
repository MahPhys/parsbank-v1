/**
 * BANK PARS — two-person approval rules (pure).
 *
 * Critical admin actions require a request by one eligible officer and a decision
 * by a DIFFERENT eligible officer. Self-approval is refused in the domain layer,
 * refused again in the service layer, and refused a third time by a database CHECK
 * constraint (`admin_actions_second_approver_differs`).
 */
import type { ApprovalActionType, AdminRole } from '@parsbank/types';
import { DomainError } from './errors.ts';
import { can, type Permission } from './rbac.ts';

export interface ApprovalPolicy {
  actionType: ApprovalActionType;
  labelFa: string;
  requiredRole: AdminRole;
  approverRole: AdminRole;
  requiresSecondApprover: boolean;
  expiresMinutes: number;
  descriptionFa: string;
}

/**
 * Mirrors prs.approval_policies (seeded in migration 0010). Kept here as the
 * domain-level contract so the UI can render the same matrix the database holds.
 */
export const APPROVAL_POLICIES: Record<ApprovalActionType, ApprovalPolicy> = {
  ISSUANCE: policy('ISSUANCE', 'انتشار پول', 'TREASURY_OFFICER', 'SUPER_ADMIN', 240, 'ایجاد پارسه جدید با پشتوانه و صورت‌جلسه'),
  BURN: policy('BURN', 'امحای پول', 'TREASURY_OFFICER', 'SUPER_ADMIN', 240, 'خروج پارسه از گردش به‌صورت دفتری یا فیزیکی'),
  REDEMPTION: policy('REDEMPTION', 'بازخرید پارسه', 'TREASURY_OFFICER', 'SUPER_ADMIN', 240, 'تسویه پارسه در برابر پشتوانه'),
  MAX_SUPPLY_CHANGE: policy('MAX_SUPPLY_CHANGE', 'تغییر سقف عرضه', 'SUPER_ADMIN', 'SUPER_ADMIN', 1440, 'تغییر حداکثر عرضه کل'),
  RESERVE_RULE_CHANGE: policy('RESERVE_RULE_CHANGE', 'تغییر قواعد پشتوانه', 'TREASURY_OFFICER', 'SUPER_ADMIN', 1440, 'تغییر سیاست پشتوانه و نسبت پوشش'),
  REDEMPTION_RULE_CHANGE: policy('REDEMPTION_RULE_CHANGE', 'تغییر قواعد بازخرید', 'TREASURY_OFFICER', 'SUPER_ADMIN', 1440, 'تغییر شرایط بازخرید'),
  ADMIN_ROLE_CHANGE: policy('ADMIN_ROLE_CHANGE', 'تغییر نقش مدیران', 'SUPER_ADMIN', 'SUPER_ADMIN', 1440, 'اعطا یا سلب نقش مدیریتی'),
  DISABLE_FINANCIAL_CONTROLS: policy('DISABLE_FINANCIAL_CONTROLS', 'غیرفعال‌سازی کنترل‌ها', 'SUPER_ADMIN', 'SUPER_ADMIN', 60, 'خاموش‌کردن کنترل‌های مالی اضطراری'),
  RESERVE_VALUATION: policy('RESERVE_VALUATION', 'ثبت/تجدید ارزش پشتوانه', 'TREASURY_OFFICER', 'SUPER_ADMIN', 1440, 'افزودن یا ارزیابی مجدد دارایی پشتوانه'),
  WALLET_FREEZE: policy('WALLET_FREEZE', 'انجماد کیف پول', 'SUPER_ADMIN', 'TREASURY_OFFICER', 240, 'توقف عملیات یک کیف پول'),
  CARD_FREEZE: policy('CARD_FREEZE', 'انجماد کارت', 'SUPER_ADMIN', 'TREASURY_OFFICER', 240, 'توقف یک کارت بانکی داخلی'),
  BANKNOTE_STATUS_CHANGE: policy('BANKNOTE_STATUS_CHANGE', 'تغییر وضعیت اسکناس', 'TREASURY_OFFICER', 'SUPER_ADMIN', 1440, 'گم‌شده/سرقت‌شده/امحا کردن اسکناس ثبت‌شده'),
  SETTING_CHANGE_CRITICAL: policy('SETTING_CHANGE_CRITICAL', 'تغییر تنظیم حساس', 'SUPER_ADMIN', 'TREASURY_OFFICER', 1440, 'تغییر تنظیمات مالی حساس سیستم'),
  FEATURE_FLAG_CRITICAL: policy('FEATURE_FLAG_CRITICAL', 'تغییر پرچم حساس', 'SUPER_ADMIN', 'TREASURY_OFFICER', 1440, 'تغییر پرچم‌های نیازمند تأیید دوم'),
  // The design office proposes a theme; the institution's head authorises making it
  // public, because publishing reaches every visitor. One approval is enough (this is
  // not a monetary act), but it may never be the proposer's own — an invariant the
  // database enforces for every action type without exception.
  THEME_PUBLISH: policy(
    'THEME_PUBLISH',
    'انتشار پوسته',
    'DESIGN_ADMIN',
    'SUPER_ADMIN',
    1440,
    'انتشار نسخه طراحی در سطح سازمان — پیشنهاد مدیر طراحی، تأیید رئیس هیئت',
  ),
};

function policy(
  actionType: ApprovalActionType,
  labelFa: string,
  requiredRole: AdminRole,
  approverRole: AdminRole,
  expiresMinutes: number,
  descriptionFa: string,
): ApprovalPolicy {
  return {
    actionType,
    labelFa,
    requiredRole,
    approverRole,
    requiresSecondApprover: actionType !== 'THEME_PUBLISH',
    expiresMinutes,
    descriptionFa,
  };
}

const REQUEST_PERMISSION: Record<ApprovalActionType, Permission> = {
  ISSUANCE: 'treasury.issue.request',
  BURN: 'treasury.burn.request',
  REDEMPTION: 'treasury.redemption.request',
  MAX_SUPPLY_CHANGE: 'treasury.policy.request',
  RESERVE_RULE_CHANGE: 'treasury.policy.request',
  REDEMPTION_RULE_CHANGE: 'treasury.policy.request',
  ADMIN_ROLE_CHANGE: 'admin.roles.request',
  DISABLE_FINANCIAL_CONTROLS: 'admin.controls.toggle.request',
  RESERVE_VALUATION: 'treasury.reserve.request',
  WALLET_FREEZE: 'admin.wallets.freeze',
  CARD_FREEZE: 'admin.cards.freeze',
  BANKNOTE_STATUS_CHANGE: 'admin.banknote.status.request',
  SETTING_CHANGE_CRITICAL: 'treasury.policy.request',
  FEATURE_FLAG_CRITICAL: 'admin.controls.toggle.request',
  THEME_PUBLISH: 'cms.theme.publish',
};

const APPROVE_PERMISSION: Record<ApprovalActionType, Permission> = {
  ISSUANCE: 'treasury.issue.approve',
  BURN: 'treasury.burn.approve',
  REDEMPTION: 'treasury.redemption.approve',
  MAX_SUPPLY_CHANGE: 'treasury.policy.approve',
  RESERVE_RULE_CHANGE: 'treasury.policy.approve',
  REDEMPTION_RULE_CHANGE: 'treasury.policy.approve',
  ADMIN_ROLE_CHANGE: 'admin.roles.approve',
  DISABLE_FINANCIAL_CONTROLS: 'admin.controls.toggle.approve',
  RESERVE_VALUATION: 'treasury.reserve.approve',
  WALLET_FREEZE: 'admin.wallets.freeze',
  CARD_FREEZE: 'admin.cards.freeze',
  BANKNOTE_STATUS_CHANGE: 'admin.banknote.status.approve',
  SETTING_CHANGE_CRITICAL: 'treasury.policy.approve',
  FEATURE_FLAG_CRITICAL: 'admin.controls.toggle.approve',
  THEME_PUBLISH: 'cms.theme.publish',
};

export function policyFor(actionType: ApprovalActionType): ApprovalPolicy {
  const found = APPROVAL_POLICIES[actionType];
  if (!found) {
    throw new DomainError('INTERNAL_ERROR', { messageEn: `no approval policy for ${actionType}` });
  }
  return found;
}

export function assertCanRequest(actionType: ApprovalActionType, role: AdminRole): void {
  const required = REQUEST_PERMISSION[actionType];
  if (!can(role, required)) {
    throw new DomainError('INSUFFICIENT_ROLE', {
      messageEn: `role ${role} may not request ${actionType}`,
      context: { actionType, role },
    });
  }
}

export function assertCanApprove(actionType: ApprovalActionType, role: AdminRole): void {
  const required = APPROVE_PERMISSION[actionType];
  if (!can(role, required)) {
    throw new DomainError('INSUFFICIENT_ROLE', {
      messageEn: `role ${role} may not approve ${actionType}`,
      context: { actionType, role },
    });
  }
}

/**
 * The whole two-person rule in one predicate, used by the service and mirrored by
 * the database constraint.
 */
export function assertApprovalDecision(input: {
  actionType: ApprovalActionType;
  requestedBy: string;
  decidedBy: string;
  decidedByRole: AdminRole;
  status: string;
  expiresAt: Date;
  now?: Date;
}): void {
  const now = input.now ?? new Date();
  const policy = policyFor(input.actionType);

  if (input.status !== 'PENDING') {
    throw new DomainError('APPROVAL_ALREADY_DECIDED', { context: { status: input.status } });
  }
  if (input.expiresAt.getTime() <= now.getTime()) {
    throw new DomainError('APPROVAL_EXPIRED');
  }
  if (policy.requiresSecondApprover && input.requestedBy === input.decidedBy) {
    throw new DomainError('SELF_APPROVAL_FORBIDDEN');
  }
  assertCanApprove(input.actionType, input.decidedByRole);
}

/** Which actions the UI must show as dual-approved. */
export function requiresDualApproval(actionType: ApprovalActionType): boolean {
  return policyFor(actionType).requiresSecondApprover;
}
