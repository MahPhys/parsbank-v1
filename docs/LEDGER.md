# BANK PARS — Ledger Rules

The ledger is the **only** authoritative source of monetary truth. There is no mutable
`balance = x` column anywhere in the write path; balances are derived, and the database itself
re-verifies the invariants at commit time.

---

## 1. Chart of accounts

| Code | Account | Class | Normal balance | In circulation? |
| --- | --- | --- | --- | --- |
| `1100` | `CURRENCY_IN_EXISTENCE` | `ASSET` | debit | no — control account, balance = total issued |
| `2100` | `WALLET:<wallet_id>` (one account per wallet) | `LIABILITY` | credit | **yes** |
| `2200` | `ESCROW_IN_FLIGHT` | `LIABILITY` | credit | **yes** (user money in transit) |
| `2300` | `PHYSICAL_NOTES_OUTSTANDING` | `LIABILITY` | credit | **yes** (value held as paper) |
| `2500` | `FEE_REVENUE` | `EQUITY` | credit | no |
| `2600` | `TREASURY_OPERATING` | `BANK` | credit | no |
| `2700` | `SUSPENSE_CLEARING` | `BANK` | credit | no |

`1100` is the mirror of every unit in existence: because the whole ledger always balances,

```
balance(1100) = Σ balance(circulating accounts) + Σ balance(bank-held accounts)
total_issued  = balance(1100)   (debit-normal, computed as debits − credits)
supply        = Σ over circulating accounts of (credits − debits)
```

Money enters the system by debiting `1100` (issuance) and leaves by crediting it (burn). Transfers
between circulating accounts never touch `1100`, which is what makes transfers supply-neutral **by
construction** rather than by convention.

## 2. Entry model

```
ledger_transactions            ledger_entries                     accounts
────────────────────           ──────────────────                 ────────
id                     ◄────── ledger_transaction_id              id
type (TRANSFER, …)             id                                 code (2100…)
status (PENDING|POSTED|…)      account_id ───────────────────►    class
idempotency_key (unique)       direction (DEBIT|CREDIT)           allow_negative
initiated_by_profile_id        amount_minor  BIGINT > 0           is_system
memo / reason                  created_at                         wallet_id (nullable)
reverses_ledger_tx_id          sequence  (monotone per tx)
created_at / posted_at
```

Amounts are integer minor units (v1: 1 minor unit = 1 PRS) stored as `BIGINT`. `NUMERIC` is banned in
money columns to make floating-point drift impossible.

## 3. Invariants — enforced by the database, not by convention

| # | Invariant | Mechanism |
| --- | --- | --- |
| L1 | Every ledger transaction balances: Σ debits = Σ credits | deferred `CONSTRAINT TRIGGER` on `ledger_entries` (fires at `COMMIT`) |
| L2 | Entries are append-only | `BEFORE UPDATE OR DELETE` trigger raising `40001`-class exception |
| L3 | Posted transactions are immutable | same trigger on `ledger_transactions` (status/amount locked once `POSTED`) |
| L4 | No overdraft on non-negative accounts | deferred constraint trigger recomputing affected account balances |
| L5 | Supply ≤ max supply | deferred constraint trigger on postings touching `1100` |
| L6 | Amounts positive integers | `CHECK (amount_minor > 0)` + typed column |
| L7 | One posting set per business transaction | `UNIQUE (transactions.ledger_transaction_id)` |
| L8 | Duplicate submission impossible | `UNIQUE (initiator_wallet_id, idempotency_key)`, `UNIQUE (ledger_transactions.idempotency_key)` |
| L9 | Balance cache cannot drift from the ledger | cache refreshed from ledger inside the same transaction + `prs.verify_balance_cache()` audit function |
| L10 | Circulating supply equals ledger outstanding supply | `prs.monetary_snapshot()` recomputation; asserted by tests and by the admin *System Health* panel |

L1–L5 are **deferred to commit**, so a service bug that posts an unbalanced or overdrafting set can
never be committed — the counter stays correct even if the application layer is wrong.

## 4. Transaction types

| Type | Entries | Supply effect |
| --- | --- | --- |
| `TRANSFER` | DR sender wallet / CR receiver wallet | none |
| `QR_PAYMENT` | DR payer wallet / CR payee wallet (+ `2500` fee) | none (fee reduces circulation) |
| `ISSUANCE` | DR `1100` / CR target wallet or `2300` | **+amount** |
| `BURN` | DR wallet or `2300` / CR `1100` | **−amount** |
| `REDEMPTION` | DR wallet / CR `1100` (+ reserve release record) | **−amount** |
| `DEPOSIT` (physical note) | DR `2300` / CR user wallet | none (value changes form) |
| `WITHDRAWAL` (physical note) | DR user wallet / CR `2300` | none |
| `FEE` | DR wallet / CR `2500` | −amount from circulation |
| `ESCROW_HOLD` | DR payer wallet / CR `2200` | none |
| `ESCROW_CAPTURE` | DR `2200` / CR payee wallet | none |
| `ESCROW_RELEASE` | DR `2200` / CR payer wallet | none |
| `REVERSAL` | mirror of an earlier posted set | inverse of original |

Escrow exists so that a QR payment intent can be authorised, then captured, or expire safely — the
payer's money is never in limbo and never double-counted.

## 5. Isolation, locking and concurrency

* Financial operations run at `SERIALIZABLE` isolation with a bounded retry loop on `40001`
  (serialization failure) and `40P01` (deadlock).
* All accounts that will be debited are locked with `SELECT … FROM accounts WHERE id = ANY($1)
  ORDER BY id FOR UPDATE` — a *deterministic lock order* that makes deadlocks structurally unlikely
  and always detectable.
* The deferred triggers then re-check balances under the same snapshot; the second line of defence
  catches anything the application lock missed.
* Concurrency tests (`tests/integration/race-conditions.test.ts`) fire N simultaneous transfers from
  the same wallet and assert: exactly the affordable number succeed, balances never go negative, and
  Σ debits = Σ credits afterwards.

## 6. Idempotency & replay protection

1. Clients MUST send `Idempotency-Key` on every money-moving request (validated: 16–80 chars,
   `[A-Za-z0-9._:-]`), and a per-session nonce is required for admin approvals.
2. `transactions(initiator_wallet_id, idempotency_key)` is `UNIQUE`. A replay hits the unique index,
   the service returns the **original** transaction (same reference, `replayed: true`) and writes no
   new ledger entries.
3. `ledger_transactions.idempotency_key` is `UNIQUE` as a second net.
4. A hash of the request payload (`request_fingerprint`) is stored next to the key: replaying a key
   with a *different* payload is rejected with `409 IDEMPOTENCY_KEY_REUSED` instead of silently
   returning the old result.
5. Admin approvals consume a single-use `admin_action_nonces` row, so an approval cannot be replayed.

## 7. Corrections, reversals, and the end of history editing

Errors are corrected by **reversal**, never by mutation:

```
REVERSAL transaction
  ├─ references reverses_ledger_transaction_id = <original>
  ├─ entries are the mirror image of the original (DR↔CR)
  ├─ supply effect = inverse of the original
  └─ original rows remain byte-for-byte untouched
```

The original transaction is marked `status = REVERSED` on the *business* row (`transactions`), which
is permitted; the ledger rows underneath are frozen forever. `audit_logs` records who reversed what,
why, and under which approval.

## 8. Monetary state snapshots

`monetary_state` (single row, `id = 1`) is a **derived cache**. It is refreshed only by
`prs.refresh_monetary_state()` inside the posting transaction and holds: `max_supply_minor`,
`total_issued_minor`, `circulating_supply_minor`, `bank_held_minor`, `treasury_reserve_usd_minor`,
`eligible_reserve_nav_usd_minor`, `reserve_coverage_ratio`, `reference_rate`, `as_of`,
`ledger_sequence`, `version`.

Every refresh additionally appends an immutable `reserve_valuations` row and, when the rate changes,
an `exchange_rates` row — the "timestamped valuation snapshot" required by policy. A mismatch
between the cache and a fresh recomputation is reported as a `CRITICAL` finding by
`prs.check_monetary_integrity()` and shown on the admin *System Health* page.

## 9. Reading a balance

```sql
-- authoritative (view, no stored balance column):
SELECT balance_minor FROM wallet_balances WHERE wallet_id = $1;
```

`wallet_balances` is a `VIEW` over `ledger_entries`. `wallet_balance_cache` exists purely for
list/filter performance, is refreshed by trigger inside the posting transaction, and is verified
against the ledger by `prs.verify_balance_cache()` in tests, in the audit script, and on the System
Health screen. If they ever disagree, the ledger wins and the disagreement is a P1 incident.
