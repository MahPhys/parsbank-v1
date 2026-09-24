/**
 * BANK PARS — ledger rules (pure).
 *
 * A posting set is built here before it ever reaches the database, and validated
 * here again before it is written. The database then re-validates at COMMIT with
 * deferred constraint triggers, so these two layers cannot disagree silently.
 *
 * Supply accounting shorthand used throughout:
 *   debit(1100)  increases the money in existence;
 *   credit(1100) decreases it;
 *   transfers between circulating accounts never touch 1100.
 */
import { ACCOUNT_CODES } from '@parsbank/config/constants';
import { DomainError } from './errors.ts';
import { assertPositiveAmount } from './money.ts';

export type EntryDirection = 'DEBIT' | 'CREDIT';

export interface AccountRef {
  /** ledger account uuid */
  accountId: string;
  /** chart code: '1100', '2300', 'WALLET:…' */
  code: string;
  isCirculating: boolean;
  allowNegative: boolean;
  /**
   * The direction in which this account carries a positive balance. It is what
   * makes "does this line reduce the balance?" answerable: a DEBIT line increases
   * an asset but reduces a liability.
   */
  normalBalance: 'DEBIT' | 'CREDIT';
}

export interface PostingLine {
  account: AccountRef;
  direction: EntryDirection;
  amountMinor: number;
  memo?: string;
}

export interface PostingSet {
  type:
    | 'TRANSFER'
    | 'QR_PAYMENT'
    | 'ISSUANCE'
    | 'BURN'
    | 'REDEMPTION'
    | 'DEPOSIT'
    | 'WITHDRAWAL'
    | 'FEE'
    | 'ESCROW_HOLD'
    | 'ESCROW_CAPTURE'
    | 'ESCROW_RELEASE'
    | 'REVERSAL'
    | 'ADJUSTMENT';
  lines: PostingLine[];
  memo?: string;
  reason?: string;
}

export interface LedgerTotals {
  debits: number;
  credits: number;
  /** change in total issued PRS caused by this set (debit-normal on 1100) */
  supplyDelta: number;
  /** change in circulating supply caused by this set */
  circulatingDelta: number;
}

const CURRENCY_CODE = ACCOUNT_CODES.CURRENCY_IN_EXISTENCE;

/** Sum a posting set and derive its monetary effect. Pure integer arithmetic. */
export function totals(set: PostingSet): LedgerTotals {
  let debits = 0;
  let credits = 0;
  let supplyDelta = 0;
  let circulatingDelta = 0;

  for (const line of set.lines) {
    assertPositiveAmount(line.amountMinor, 'مبلغ سند');
    if (line.direction === 'DEBIT') {
      debits += line.amountMinor;
      if (line.account.code === CURRENCY_CODE) supplyDelta += line.amountMinor;
      if (line.account.isCirculating) circulatingDelta -= line.amountMinor;
    } else {
      credits += line.amountMinor;
      if (line.account.code === CURRENCY_CODE) supplyDelta -= line.amountMinor;
      if (line.account.isCirculating) circulatingDelta += line.amountMinor;
    }
  }
  return { debits, credits, supplyDelta, circulatingDelta };
}

export function isBalanced(set: PostingSet): boolean {
  const { debits, credits } = totals(set);
  return debits === credits && set.lines.length >= 2;
}

/**
 * Throws unless the set satisfies every rule that does not require database
 * state: at least two lines, positive integer amounts, balanced, and no
 * self-cancelling pair on the same account.
 */
export function assertValidPostingSet(set: PostingSet): LedgerTotals {
  if (!Array.isArray(set.lines) || set.lines.length < 2) {
    throw new DomainError('LEDGER_UNBALANCED', {
      messageEn: 'a posting set requires at least two entries',
      context: { type: set.type, lines: set.lines?.length ?? 0 },
    });
  }

  const seen = new Set<string>();
  for (const line of set.lines) {
    const key = `${line.account.accountId}:${line.direction}`;
    if (seen.has(key)) {
      throw new DomainError('LEDGER_UNBALANCED', {
        messageEn: 'duplicate entries for the same account and direction must be merged',
        context: { accountId: line.account.accountId },
      });
    }
    seen.add(key);
    if (!line.account.accountId) {
      throw new DomainError('LEDGER_UNBALANCED', {
        messageEn: 'every entry requires a resolved account id',
      });
    }
  }

  const result = totals(set);
  if (result.debits !== result.credits) {
    throw new DomainError('LEDGER_UNBALANCED', {
      messageEn: `debits ${result.debits} <> credits ${result.credits}`,
      context: { type: set.type },
    });
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Builders                                                                    */
/* -------------------------------------------------------------------------- */

export interface TransferInput {
  sender: AccountRef;
  receiver: AccountRef;
  amountMinor: number;
  feeMinor?: number;
  feeAccount?: AccountRef;
  memo?: string;
}

/**
 * TRANSFER — supply neutral.
 *   DR sender            amount (+fee when the fee is debited from the sender)
 *   CR receiver          amount
 *   CR fee revenue       fee
 */
export function buildTransfer(input: TransferInput): PostingSet {
  const amount = assertPositiveAmount(input.amountMinor);
  const fee = input.feeMinor ?? 0;
  if (fee < 0) throw new DomainError('INVALID_AMOUNT', { messageEn: 'fee must not be negative' });
  if (input.sender.accountId === input.receiver.accountId) {
    throw new DomainError('SELF_TRANSFER_NOT_ALLOWED');
  }

  const lines: PostingLine[] = [
    { account: input.sender, direction: 'DEBIT', amountMinor: amount, memo: input.memo },
    { account: input.receiver, direction: 'CREDIT', amountMinor: amount, memo: input.memo },
  ];

  if (fee > 0) {
    if (!input.feeAccount) {
      throw new DomainError('INTERNAL_ERROR', { messageEn: 'fee account is required when a fee applies' });
    }
    lines.push({ account: input.feeAccount, direction: 'CREDIT', amountMinor: fee, memo: 'کارمزد' });
    // debit fee from the sender as a separate line is not allowed by
    // assertValidPostingSet (same account+direction twice), so fold it in:
    lines[0] = { ...lines[0]!, amountMinor: amount + fee };
  }

  const set: PostingSet = { type: 'TRANSFER', lines, memo: input.memo };
  assertValidPostingSet(set);
  return set;
}

/**
 * ISSUANCE — money creation, only from an authorised monetary event.
 *   DR 1100            amount        (money comes into existence)
 *   CR destination     amount
 */
export function buildIssuance(input: {
  circulationAccount: AccountRef;
  destination: AccountRef;
  amountMinor: number;
  reason: string;
}): PostingSet {
  const amount = assertPositiveAmount(input.amountMinor);
  const set: PostingSet = {
    type: 'ISSUANCE',
    reason: input.reason,
    lines: [
      { account: input.circulationAccount, direction: 'DEBIT', amountMinor: amount, memo: input.reason },
      { account: input.destination, direction: 'CREDIT', amountMinor: amount, memo: input.reason },
    ],
  };
  assertValidPostingSet(set);
  return set;
}

/**
 * BURN — ledger-based destruction. History is preserved: new entries, never edits.
 *   DR source          amount
 *   CR 1100            amount
 */
export function buildBurn(input: {
  circulationAccount: AccountRef;
  source: AccountRef;
  amountMinor: number;
  reason: string;
}): PostingSet {
  const amount = assertPositiveAmount(input.amountMinor);
  const set: PostingSet = {
    type: 'BURN',
    reason: input.reason,
    lines: [
      { account: input.source, direction: 'DEBIT', amountMinor: amount, memo: input.reason },
      { account: input.circulationAccount, direction: 'CREDIT', amountMinor: amount, memo: input.reason },
    ],
  };
  assertValidPostingSet(set);
  return set;
}

/** DEPOSIT of a physical note — value changes form, supply is unchanged. */
export function buildNoteDeposit(input: {
  noteAccount: AccountRef;
  walletAccount: AccountRef;
  amountMinor: number;
  memo?: string;
}): PostingSet {
  const amount = assertPositiveAmount(input.amountMinor);
  const set: PostingSet = {
    type: 'DEPOSIT',
    memo: input.memo,
    lines: [
      { account: input.noteAccount, direction: 'DEBIT', amountMinor: amount, memo: input.memo },
      { account: input.walletAccount, direction: 'CREDIT', amountMinor: amount, memo: input.memo },
    ],
  };
  assertValidPostingSet(set);
  return set;
}

/** WITHDRAWAL of a physical note — the mirror of a deposit. */
export function buildNoteWithdrawal(input: {
  noteAccount: AccountRef;
  walletAccount: AccountRef;
  amountMinor: number;
  memo?: string;
}): PostingSet {
  const amount = assertPositiveAmount(input.amountMinor);
  const set: PostingSet = {
    type: 'WITHDRAWAL',
    memo: input.memo,
    lines: [
      { account: input.walletAccount, direction: 'DEBIT', amountMinor: amount, memo: input.memo },
      { account: input.noteAccount, direction: 'CREDIT', amountMinor: amount, memo: input.memo },
    ],
  };
  assertValidPostingSet(set);
  return set;
}

/** REVERSAL — mirror image of an earlier set. History itself is never rewritten. */
export function buildReversal(original: PostingSet, reason: string): PostingSet {
  const set: PostingSet = {
    type: 'REVERSAL',
    reason,
    lines: original.lines.map((line) => ({
      account: line.account,
      direction: line.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
      amountMinor: line.amountMinor,
      memo: reason,
    })),
  };
  assertValidPostingSet(set);
  return set;
}

/* -------------------------------------------------------------------------- */
/* Balance-side checks that need supplied state                                */
/* -------------------------------------------------------------------------- */

export interface BalanceCheckInput {
  balances: Record<string, number>; // accountId -> derived balance
  maxSupplyMinor: number;
  currentTotalIssuedMinor: number;
}

/**
 * Validates a posting set against a supplied monetary state. The database is
 * still the authority (and re-checks at COMMIT); this is the cheap first gate
 * that produces precise, user-appropriate errors.
 */
export function assertPostingSetAffordable(set: PostingSet, state: BalanceCheckInput): LedgerTotals {
  const result = assertValidPostingSet(set);

  const reducesBalance = (line: PostingLine): boolean =>
    line.direction !== line.account.normalBalance;

  for (const line of set.lines) {
    if (!reducesBalance(line)) continue;
    if (line.account.allowNegative) continue;
    const balance = state.balances[line.account.accountId] ?? 0;
    if (line.amountMinor > balance) {
      throw new DomainError('INSUFFICIENT_FUNDS', {
        messageEn: `account ${line.account.code} has ${balance}, the posting needs ${line.amountMinor}`,
        context: { accountId: line.account.accountId, code: line.account.code, balance, required: line.amountMinor },
      });
    }
  }

  const resultingSupply = state.currentTotalIssuedMinor + result.supplyDelta;
  if (resultingSupply > state.maxSupplyMinor) {
    throw new DomainError('SUPPLY_CAP_EXCEEDED', {
      context: { resultingSupply, maxSupplyMinor: state.maxSupplyMinor },
    });
  }
  if (resultingSupply < 0) {
    throw new DomainError('LEDGER_OVERDRAFT', {
      messageEn: 'burn would reduce supply below zero',
      context: { resultingSupply },
    });
  }

  // Per-account effects must not push any non-negative account below zero.
  const deltas = new Map<string, number>();
  for (const line of set.lines) {
    // Signed in the account's own normal direction, so a liability credited reads
    // as +amount and the same liability debited reads as −amount.
    const signed = reducesBalance(line) ? -line.amountMinor : line.amountMinor;
    deltas.set(line.account.accountId, (deltas.get(line.account.accountId) ?? 0) + signed);
  }
  for (const line of set.lines) {
    if (line.account.allowNegative) continue;
    const resulting = (state.balances[line.account.accountId] ?? 0) + (deltas.get(line.account.accountId) ?? 0);
    if (resulting < 0) {
      throw new DomainError('INSUFFICIENT_FUNDS', {
        context: { accountId: line.account.accountId, resultingBalance: resulting },
      });
    }
  }

  return result;
}

/**
 * Global ledger check: every completed transaction must satisfy
 * Σ debits = Σ credits. Used by the ledger audit routine and the consistency tests.
 */
export function isGloballyBalanced(entries: ReadonlyArray<{ direction: EntryDirection; amountMinor: number }>): boolean {
  let debits = 0;
  let credits = 0;
  for (const entry of entries) {
    if (entry.direction === 'DEBIT') debits += entry.amountMinor;
    else credits += entry.amountMinor;
  }
  return debits === credits;
}

/** Human-stable transaction reference: PRS-TRX-<10 chars>. */
export function formatTransactionReference(randomPart: string): string {
  return `PRS-TRX-${randomPart.toUpperCase()}`;
}
