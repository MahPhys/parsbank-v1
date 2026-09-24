/**
 * @parsbank/domain — pure business logic for BANK PARS.
 *
 * No I/O, no framework, no database. This package is the first line of defence for
 * monetary integrity; the SQL layer is the second (deferred constraint triggers),
 * and the service layer's authorization checks are the third.
 */
export * from './errors.ts';
export * from './money.ts';
export * from './ledger.ts';
export * from './treasury.ts';
export * from './banknote.ts';
export * from './card.ts';
export * from './rbac.ts';
export * from './approval.ts';
export * from './idempotency.ts';
