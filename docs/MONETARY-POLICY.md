# BANK PARS — Monetary Policy

Currency: **پارسه (PRS)** · Internal code: **PRS** · Smallest unit: **1 PRS** (no fractional PRS in v1).
Maximum supply: **10,000 PRS**. Denomination series: **1, 2, 5, 10, 50, 100, 200**.

> PRS is an internal unit of account of a closed private network. It is not legal tender, it is not
> redeemable for any real-world currency, and no component of this system talks to a real bank or
> payment rail.

---

## 1. Supply definitions

| Term | Definition | Where it lives |
| --- | --- | --- |
| **Maximum supply** | Hard ceiling, `system_settings.max_supply_minor` (default 10 000). Changeable only by a dual-approved `SUPPLY_POLICY_CHANGE`. | `system_settings`, DB trigger enforced |
| **Total issued** | Cumulative PRS ever created by authorised issuance = balance of ledger account `1100 CURRENCY_IN_EXISTENCE`. | Derived from `ledger_entries` |
| **Bank-held** | PRS held by the institution itself (fee revenue, treasury operating, clearing) — inside `1100`, outside circulation. | Derived from `ledger_entries` |
| **Circulating supply** | PRS held by the public: user wallets + escrow in flight + physical notes outstanding. | Derived from `ledger_entries` |
| **Treasury reserve** | Custodial record of backing assets contributed for issuance (USD-denominated book value). | `treasury_reserves` |
| **Eligible reserve NAV** | Σ (reserve book value × eligibility haircut) for reserves with `eligibility = ELIGIBLE` and `status = ACTIVE`, expressed in USD cents. | `treasury_reserves`, `reserve_valuations` |
| **Reserve coverage ratio** | `eligible_reserve_nav / (circulating_supply × par_value)` | `reserve_valuations` snapshot |
| **Reference exchange rate** | `PRS/USD = eligible_reserve_nav / circulating_supply` | `exchange_rates` snapshot |

Invariant (checked by `tests/ledger/consistency.test.ts` and `prs.check_monetary_integrity()`):

```
circulating_supply + bank_held = total_issued = balance(1100)
total_issued                   ≤ max_supply
banknote_registry_outstanding  = balance(2300)
```

## 2. Parity, coverage and the reference rate

The system does not promise a peg. It publishes a *reference* derived from its own book:

* `par_value_usd_minor` — accounting par, initially `100` (1 PRS = 1.00 USD par). Used only to make
  the coverage ratio a dimensionless number that can be compared with 100 %.
* `reserve_coverage_ratio = eligible_reserve_nav_minor / (circulating_supply_minor × par_value_usd_minor)`
* `reference_rate (PRS per USD) = eligible_reserve_nav_minor / circulating_supply_minor`, with 8
  decimal places.

Both are recomputed **server-side only** (`MonetaryStateService.recompute()`), stored as an
immutable, timestamped snapshot in `reserve_valuations` and `exchange_rates`, and never accepted
from a client. Edge case: when `circulating_supply = 0` the rate is recorded as the par value with
`is_parity_fallback = true` so that no division-by-zero fiction enters history.

Policy floors:

* `policy.min_coverage_ratio` (default `1.00`) — issuance is blocked when the post-issuance coverage
  would fall below this floor unless a dual-approved `RESERVE_RULE_CHANGE` raises/waives it.
* `policy.issuance_requires_reserve` (default `true`) — every issuance row must reference a reserve
  contribution whose eligible value ≥ `amount × par_value`.

## 3. Money creation (issuance)

PRS can be created **only** by an authorised treasury issuance. The path is:

```
TREASURY_OFFICER creates issuance draft ──► admin_actions(PENDING, type=ISSUANCE)
        │
        ├─ second eligible approver (≠ requester) approves
        │        requiring: reason, amount, reserve contribution, resulting supply,
        │        resulting coverage ratio, resulting reference rate
        ▼
BEGIN SERIALIZABLE
  lock 1100 CURRENCY_IN_EXISTENCE (FOR UPDATE)
  assert total_issued + amount ≤ max_supply
  assert reserve contribution eligible value ≥ amount × par  (when policy enabled)
  assert post-issuance coverage ≥ policy floor
  insert ledger_transaction(ISSUANCE) + entries:
        DR 1100 CURRENCY_IN_EXISTENCE   amount
        CR <destination wallet | 2300 PHYSICAL_NOTES_OUTSTANDING> amount
  insert issuances row (amount, reserve, reason, authorizer, second approver,
                        timestamp, ledger_transaction_id, resulting supply,
                        resulting coverage ratio, resulting reference rate)
  recompute monetary state snapshot
COMMIT
```

Every issuance row therefore *contains* exactly the audit fields demanded by policy: amount, reserve
contribution, reason, authorizer, second approver, timestamp, transaction id, resulting supply,
resulting coverage ratio.

Creation without such a row is impossible: the only SQL that can credit a circulating account is
inside `TreasuryService.issue()`, and the DB additionally rejects any posting that pushes
`balance(1100)` above `max_supply` or that fails the debit=credit invariant.

## 4. Money destruction (burning)

Burning is **ledger-based** and never deletes anything:

```
DR <wallet | 2300 PHYSICAL_NOTES_OUTSTANDING>  amount     ← value leaves circulation
CR 1100 CURRENCY_IN_EXISTENCE                  amount     ← supply extinguished
```

Rules:

* A burn row (`burns`) records amount, reason, authoriser, second approver, the ledger transaction,
  resulting supply and resulting coverage.
* Historic ledger entries are never mutated — a burn is *new* entries. Corrections are made by a
  `REVERSAL` ledger transaction (mirror entries) referencing the original, never by editing.
* `balance(1100)` may never go negative (DB trigger), so the system cannot burn PRS that does not
  exist.
* Physical destruction of a note is a burn only if the note carried outstanding value
  (`IN_CIRCULATION`, `ASSIGNED`, `FROZEN`, `LOST`, `STOLEN`); destroying blank vault stock is a
  registry-only event.

## 5. Redemption

Redemption returns PRS to the reserve and takes PRS out of circulation. It is dual-approved, rate
based on a *frozen* snapshot (`exchange_rates` row), capped by `policy.redemption_limits`, and
subject to `REDEMPTION_RULE_CHANGE` for rule edits. Redemption never touches a real rail; it only
re-balances internal books (`redemptions` + burn-style ledger postings + reserve release record).

## 6. Denomination series

The note series exists so the monetary model has a physical substrate. Each denomination maps to one
historical figure and one thematic motif:

| PRS | Figure | Motif family |
| --- | --- | --- |
| 1 | Muhammad ibn Musa al-Khwarizmi | numerals / algorithm |
| 2 | Muhammad al-Razi | pharmacy / distillation |
| 5 | Abu Rayhan al-Biruni | celestial measurement |
| 10 | Avicenna (Ibn Sina) | medicine / canon |
| 50 | Omar Khayyam | astronomy / quatrain |
| 100 | Ferdowsi | epic / Shahnameh |
| 200 | Hafez | poetry / garden |

Artwork is generated by this project's own procedural engraving pipeline (see
`docs/BANKNOTES.md`) — engraved security-print aesthetics, original geometry, no imitation of any
existing banknote.

## 7. Prohibited

* Fractional PRS (v1). Amounts are integers; the DB rejects non-integer or non-positive amounts.
* Client-side mutation of supply, reserve, rate, balances, limits.
* Issuance without reserve contribution while `policy.issuance_requires_reserve = true` (default).
* Any real-world payment/banking integration: there is no such code path, and the security tests
  assert that no network egress module exists in the money services.
