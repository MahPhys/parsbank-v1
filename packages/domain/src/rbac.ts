/**
 * BANK PARS — role model and permission matrix (pure).
 *
 * Roles are job functions, not a hierarchy:
 *   SUPER_ADMIN       system-level administration
 *   TREASURY_OFFICER  treasury operations
 *   AUDITOR           read-only financial/audit visibility
 *   DESIGN_ADMIN      UI, content, assets, design system
 *   USER              ordinary member — no administrative surface at all
 *
 * A role NEVER inherits another role's permissions implicitly: the matrix below is
 * explicit and exhaustive, and anything absent is denied. `DESIGN_ADMIN` and
 * `TREASURY_OFFICER` share exactly zero monetary permissions, by construction.
 */
import type { AdminRole, ProfileRole } from '@parsbank/types';
import { DomainError } from './errors.ts';

export const ROLES: readonly ProfileRole[] = ['USER', 'DESIGN_ADMIN', 'AUDITOR', 'TREASURY_OFFICER', 'SUPER_ADMIN'];
export const ADMIN_ROLES: readonly AdminRole[] = ['DESIGN_ADMIN', 'AUDITOR', 'TREASURY_OFFICER', 'SUPER_ADMIN'];

export type Permission =
  // user-side
  | 'wallet.read.own'
  | 'wallet.transfer.own'
  | 'wallet.receive.own'
  | 'card.read.own'
  | 'card.manage.own'
  | 'card.qr.pay'
  | 'transaction.read.own'
  | 'receipt.read.own'
  | 'banknote.read.own'
  | 'banknote.verify'
  // admin — observation
  | 'admin.overview.read'
  | 'admin.users.read'
  | 'admin.users.write'
  | 'admin.wallets.read'
  | 'admin.wallets.freeze'
  | 'admin.cards.read'
  | 'admin.cards.freeze'
  | 'admin.transactions.read'
  | 'admin.banknotes.read'
  | 'admin.banknotes.write'
  | 'admin.rates.read'
  | 'admin.reserve.read'
  | 'admin.treasury.read'
  | 'admin.audit.read'
  | 'admin.security.read'
  | 'admin.health.read'
  // admin — treasury & money
  | 'treasury.issue.request'
  | 'treasury.issue.approve'
  | 'treasury.burn.request'
  | 'treasury.burn.approve'
  | 'treasury.redemption.request'
  | 'treasury.redemption.approve'
  | 'treasury.reserve.request'
  | 'treasury.reserve.approve'
  | 'treasury.policy.request'
  | 'treasury.policy.approve'
  | 'admin.issuance.read'
  | 'admin.burning.read'
  | 'admin.approvals.request'
  | 'admin.approvals.decide'
  | 'admin.roles.request'
  | 'admin.roles.approve'
  | 'admin.controls.toggle.request'
  | 'admin.controls.toggle.approve'
  | 'admin.banknote.status.request'
  | 'admin.banknote.status.approve'
  // admin — content plane
  | 'cms.read'
  | 'cms.tokens.write'
  | 'cms.theme.draft'
  | 'cms.theme.preview'
  | 'cms.theme.publish'
  | 'cms.theme.rollback'
  | 'cms.assets.write'
  | 'cms.content.write'
  | 'cms.navigation.write'
  | 'cms.pages.write';

const USER_PERMISSIONS: Permission[] = [
  'wallet.read.own',
  'wallet.transfer.own',
  'wallet.receive.own',
  'card.read.own',
  'card.manage.own',
  'card.qr.pay',
  'transaction.read.own',
  'receipt.read.own',
  'banknote.read.own',
  'banknote.verify',
];

const AUDITOR_PERMISSIONS: Permission[] = [
  'admin.overview.read',
  'admin.users.read',
  'admin.wallets.read',
  'admin.cards.read',
  'admin.transactions.read',
  'admin.banknotes.read',
  'admin.rates.read',
  'admin.reserve.read',
  'admin.treasury.read',
  'admin.issuance.read',
  'admin.burning.read',
  'admin.audit.read',
  'admin.security.read',
  'admin.health.read',
  'cms.read',
];

const TREASURY_PERMISSIONS: Permission[] = [
  'admin.overview.read',
  'admin.users.read',
  'admin.wallets.read',
  'admin.wallets.freeze',
  'admin.cards.read',
  'admin.transactions.read',
  'admin.banknotes.read',
  'admin.banknotes.write',
  'admin.rates.read',
  'admin.reserve.read',
  'admin.treasury.read',
  'admin.issuance.read',
  'admin.burning.read',
  'admin.audit.read',
  'admin.health.read',
  'treasury.issue.request',
  'treasury.issue.approve',
  'treasury.burn.request',
  'treasury.burn.approve',
  'treasury.reserve.request',
  'treasury.reserve.approve',
  'treasury.policy.request',
  'admin.banknote.status.request',
  'admin.banknote.status.approve',
  'admin.approvals.request',
  'admin.approvals.decide',
  'cms.read',
];

const SUPER_ADMIN_PERMISSIONS: Permission[] = [
  'admin.overview.read',
  'admin.users.read',
  'admin.users.write',
  'admin.wallets.read',
  'admin.wallets.freeze',
  'admin.cards.read',
  'admin.cards.freeze',
  'admin.transactions.read',
  'admin.banknotes.read',
  'admin.banknotes.write',
  'admin.rates.read',
  'admin.reserve.read',
  'admin.treasury.read',
  'admin.audit.read',
  'admin.security.read',
  'admin.health.read',
  'admin.issuance.read',
  'admin.burning.read',
  'treasury.issue.request',
  'treasury.issue.approve',
  'treasury.burn.request',
  'treasury.burn.approve',
  'treasury.redemption.request',
  'treasury.redemption.approve',
  'treasury.reserve.request',
  'treasury.reserve.approve',
  'treasury.policy.request',
  'treasury.policy.approve',
  'admin.approvals.request',
  'admin.approvals.decide',
  'admin.roles.request',
  'admin.roles.approve',
  'admin.controls.toggle.request',
  'admin.controls.toggle.approve',
  'admin.banknote.status.request',
  'admin.banknote.status.approve',
  'cms.read',
  // Approver-only design capabilities: the head of the institution authorises a
  // published theme (and can roll one back in an emergency) but cannot draft,
  // edit tokens, assets, pages or navigation — those belong to the design office.
  'cms.theme.publish',
  'cms.theme.rollback',
];

const DESIGN_ADMIN_PERMISSIONS: Permission[] = [
  'cms.read',
  'cms.tokens.write',
  'cms.theme.draft',
  'cms.theme.preview',
  'cms.theme.publish',
  'cms.theme.rollback',
  'cms.assets.write',
  'cms.content.write',
  'cms.navigation.write',
  'cms.pages.write',
  // A design administrator may LOOK at the section index of the control plane but
  // holds no monetary, user, wallet, card, treasury or audit permission.
  'admin.overview.read',
];

export const ROLE_PERMISSIONS: Record<ProfileRole, readonly Permission[]> = {
  USER: USER_PERMISSIONS,
  AUDITOR: AUDITOR_PERMISSIONS,
  TREASURY_OFFICER: TREASURY_PERMISSIONS,
  SUPER_ADMIN: SUPER_ADMIN_PERMISSIONS,
  DESIGN_ADMIN: DESIGN_ADMIN_PERMISSIONS,
};

export function permissionsFor(role: ProfileRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function can(role: ProfileRole, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}

/** Server-side gate. Every admin endpoint and every money service calls this. */
export function assertCan(role: ProfileRole, permission: Permission): void {
  if (!can(role, permission)) {
    throw new DomainError('INSUFFICIENT_ROLE', {
      messageEn: `role ${role} lacks permission ${permission}`,
      context: { role, permission },
    });
  }
}

export function isAdminRole(role: ProfileRole): role is AdminRole {
  return role !== 'USER';
}

/** The admin sections a role may open in the control plane. */
export const ADMIN_SECTIONS = [
  'overview',
  'users',
  'wallets',
  'cards',
  'transactions',
  'treasury',
  'issuance',
  'burning',
  'banknotes',
  'exchange-rates',
  'reserve',
  'audit',
  'cms',
  'design-system',
  'assets',
  'feature-flags',
  'security',
  'system-health',
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number];

const SECTION_PERMISSIONS: Record<AdminSection, Permission> = {
  overview: 'admin.overview.read',
  users: 'admin.users.read',
  wallets: 'admin.wallets.read',
  cards: 'admin.cards.read',
  transactions: 'admin.transactions.read',
  treasury: 'admin.treasury.read',
  issuance: 'admin.issuance.read',
  burning: 'admin.burning.read',
  banknotes: 'admin.banknotes.read',
  'exchange-rates': 'admin.rates.read',
  reserve: 'admin.reserve.read',
  audit: 'admin.audit.read',
  cms: 'cms.read',
  'design-system': 'cms.read',
  assets: 'cms.read',
  'feature-flags': 'admin.overview.read',
  security: 'admin.security.read',
  'system-health': 'admin.health.read',
};

export function canAccessSection(role: ProfileRole, section: AdminSection): boolean {
  const required = SECTION_PERMISSIONS[section];
  return required ? can(role, required) : false;
}

export function allowedSections(role: ProfileRole): AdminSection[] {
  return ADMIN_SECTIONS.filter((section) => canAccessSection(role, section));
}
