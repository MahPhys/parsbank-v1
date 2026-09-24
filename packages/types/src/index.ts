/**
 * BANK PARS — shared types (server ⇄ clients).
 * Contains no implementation and no secrets: the API contract lives here.
 */

export type Locale = 'fa-IR' | 'en-US';

export type ProfileRole = 'USER' | 'DESIGN_ADMIN' | 'AUDITOR' | 'TREASURY_OFFICER' | 'SUPER_ADMIN';
export type AdminRole = Exclude<ProfileRole, 'USER'>;
export type ProfileStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

export type SessionAudience = 'USER' | 'ADMIN';

export interface SessionUser {
  profileId: string;
  role: ProfileRole;
  fullNameFa: string;
  fullNameEn: string;
  publicRef: string;
  audience: SessionAudience;
  mfaSatisfied: boolean;
  /** CSRF token the client must echo on state-changing requests. */
  csrfToken: string;
  mustRotatePassword: boolean;
}

/* ------------------------------------------------------------------ money */

export interface MoneyAmount {
  /** integer PRS minor units (v1: 1 minor unit = 1 PRS) */
  minor: number;
  currency: 'PRS';
}

/* ------------------------------------------------------------------ wallets */

export interface WalletSummary {
  walletId: string;
  publicRef: string;
  labelFa: string;
  status: 'CREATED' | 'ACTIVE' | 'FROZEN' | 'CLOSED';
  isPrimary: boolean;
  balanceMinor: number;
  /** Server-derived reference value using the latest published snapshot. */
  referenceUsdMinor: number;
  openedAt: string;
}

export interface MonetarySnapshot {
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
  asOf: string;
  ledgerSequence: number;
}

/* ------------------------------------------------------------------ cards */

export interface CardSummary {
  cardId: string;
  cardNumber: string;
  cardholderNameFa: string;
  expiryMonth: number;
  expiryYear: number;
  status: 'PENDING' | 'ACTIVE' | 'FROZEN' | 'EXPIRED' | 'CANCELLED';
  scheme: string;
  networkLabel: string;
  contactless: boolean;
  issuedAt: string;
  /** masked QR token prefix, e.g. "prs1_7K2A" — never the token itself */
  qrTokenPrefix: string | null;
  qrTokenIssuedAt: string | null;
}

/** What /secure/card/{token} is allowed to reveal. Deliberately minimal. */
export interface SecureCardPublicView {
  brandNameFa: string;
  brandNameEn: string;
  cardNumberMaskedGrouped: string;
  cardNumber: string;
  expiryMonth: number;
  expiryYear: number;
  networkLabel: string;
  scheme: string;
  tokenPrefix: string;
  /** session reference the payer uses to continue the payment */
  sessionRef: string;
  sessionExpiresAt: string;
  /** true when the card is usable for payment at this moment */
  payable: boolean;
  payableReasonFa?: string;
}

export interface QrPaymentSession {
  sessionRef: string;
  destinationCardNumberMasked: string;
  destinationCardNumber: string;
  destinationCardholderNameFa: string;
  amountMinor: number | null;
  status: 'OPEN' | 'AWAITING_AUTHORIZATION' | 'COMPLETED' | 'EXPIRED' | 'ABORTED' | 'FAILED';
  expiresAt: string;
  transactionReference?: string;
}

/* ----------------------------------------------------------- transactions */

export type TransactionTypeDto =
  | 'TRANSFER'
  | 'QR_PAYMENT'
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'ISSUANCE'
  | 'BURN'
  | 'REDEMPTION'
  | 'FEE'
  | 'REVERSAL'
  | 'ADJUSTMENT';

export type TransactionStatusDto = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED' | 'EXPIRED';

export interface TransactionDto {
  id: string;
  reference: string;
  type: TransactionTypeDto;
  status: TransactionStatusDto;
  direction: 'IN' | 'OUT' | 'INTERNAL';
  amountMinor: number;
  feeMinor: number;
  currency: 'PRS';
  senderWalletRef: string | null;
  receiverWalletRef: string | null;
  counterpartyNameFa: string | null;
  counterpartyCardMasked: string | null;
  memo: string | null;
  createdAt: string;
  completedAt: string | null;
  /** true when this response is a replay of an idempotent request */
  replayed?: boolean;
}

export interface ReceiptDto {
  reference: string;
  issuedAt: string;
  type: TransactionTypeDto;
  status: TransactionStatusDto;
  amountMinor: number;
  feeMinor: number;
  totalMinor: number;
  currency: 'PRS';
  referenceUsdMinor: number | null;
  referenceRate: number | null;
  senderNameFa: string;
  senderCardMasked: string | null;
  receiverNameFa: string | null;
  receiverCardMasked: string | null;
  memo: string | null;
  verificationCode: string;
  ledgerSequence: number | null;
}

/* ------------------------------------------------------------- banknotes */

export interface BanknoteDto {
  id: string;
  serialNumber: string;
  denominationMinor: number;
  status: string;
  seriesLabel: string;
  holderNameFa: string | null;
  carriesOutstandingValue: boolean;
  issuedAt: string | null;
  lastEventAt: string | null;
  artworkKey: string | null;
}

export interface BanknoteVerificationResult {
  outcome:
    | 'GENUINE'
    | 'UNKNOWN_SERIAL'
    | 'INVALID_CHECKSUM'
    | 'REPORTED_LOST'
    | 'REPORTED_STOLEN'
    | 'FROZEN'
    | 'DESTROYED'
    | 'DENOMINATION_MISMATCH';
  found: boolean;
  checksumValid: boolean;
  serialNumber: string;
  denominationMinor: number | null;
  status: string | null;
  seriesLabel: string | null;
  messageFa: string;
  verifiedAt: string;
}

/* ------------------------------------------------------------ governance */

export type ApprovalActionType =
  | 'ISSUANCE'
  | 'BURN'
  | 'REDEMPTION'
  | 'MAX_SUPPLY_CHANGE'
  | 'RESERVE_RULE_CHANGE'
  | 'REDEMPTION_RULE_CHANGE'
  | 'ADMIN_ROLE_CHANGE'
  | 'DISABLE_FINANCIAL_CONTROLS'
  | 'RESERVE_VALUATION'
  | 'WALLET_FREEZE'
  | 'CARD_FREEZE'
  | 'BANKNOTE_STATUS_CHANGE'
  | 'SETTING_CHANGE_CRITICAL'
  | 'FEATURE_FLAG_CRITICAL'
  | 'THEME_PUBLISH';

export interface AdminActionDto {
  id: string;
  actionRef: string;
  actionType: ApprovalActionType;
  actionLabelFa: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  requiresSecondApprover: boolean;
  requestedBy: string;
  requestedByNameFa: string;
  requestedAt: string;
  expiresAt: string;
  reason: string;
  payloadPreview: Record<string, unknown>;
  decidedBy: string | null;
  decidedAt: string | null;
  executedAt: string | null;
  resultingEntityRef: string | null;
  canApprove: boolean;
  cantApproveReasonFa?: string;
}

export interface AuditLogDto {
  id: number;
  occurredAt: string;
  actorLabel: string | null;
  actorRole: string | null;
  action: string;
  category: string;
  severity: 'INFO' | 'NOTICE' | 'WARNING' | 'CRITICAL';
  outcome: 'SUCCESS' | 'DENIED' | 'FAILED';
  entityType: string | null;
  entityRef: string | null;
  reason: string | null;
  requestId: string | null;
}

/* ------------------------------------------------------------------- API */

export interface ApiError {
  error: {
    code: string;
    messageFa: string;
    messageEn?: string;
    /** field-level validation detail; never contains internal identifiers */
    fields?: Array<{ path: string; message: string }>;
    requestId?: string;
  };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/* --------------------------------------------------------------- design */

export interface DesignTokenDto {
  key: string;
  category: string;
  value: string;
  valueType: string;
  descriptionFa: string | null;
  isLocked: boolean;
  groupKey: string | null;
}

export interface ThemeVersionDto {
  id: string;
  versionNumber: number;
  name: string;
  status: 'DRAFT' | 'PREVIEW' | 'PUBLISHED' | 'SUPERSEDED' | 'ARCHIVED';
  tokenCount: number;
  createdAt: string;
  createdByNameFa: string | null;
  publishedAt: string | null;
  noteFa: string | null;
}

export interface PublicThemePayload {
  versionNumber: number;
  name: string;
  tokens: Record<string, string>;
  publishedAt: string | null;
}

export interface AssetDto {
  id: string;
  assetKey: string;
  nameFa: string;
  kind: string;
  mimeType: string;
  storagePath: string;
  denominationMinor: number | null;
  side: 'FRONT' | 'REVERSE' | null;
  currentVersion: number;
  status: string;
  tags: string[];
}

export interface SystemHealthDto {
  status: 'OK' | 'DEGRADED' | 'CRITICAL';
  checks: Array<{
    code: string;
    labelFa: string;
    status: 'OK' | 'WARNING' | 'CRITICAL';
    detailFa: string;
    value?: string | number | null;
  }>;
  monetary: MonetarySnapshot | null;
  database: { driver: string; latencyMs: number; version: string };
  version: string;
  generatedAt: string;
}
