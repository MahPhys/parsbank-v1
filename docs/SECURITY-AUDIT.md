# BANK PARS — Security & Financial-Ledger Audit

**بانک پارس · BANK PARS · PRS**

| | |
|---|---|
| Scope | entire repository: `apps/api`, `apps/public`, `apps/admin`, `packages/*`, `db/migrations/*` |
| Method | read-only source review + live black-box probing of a running instance + throwaway-database probes for database-level guarantees |
| Date | 2026-09-24 |
| Verdict | **The ledger core is genuinely sound and enforces its invariants in the database.** The surrounding security posture has real gaps, the most important of which is that **row-level security is currently inert** and **append-only history can be erased with `TRUNCATE`**. One critical defect found during the audit was repaired and verified live (A-1); one further defect is recorded and awaiting a policy decision (B-5). |

> This audit does **not** conclude that the system is secure. It concludes that the
> monetary engine is trustworthy and that the defensive layers around it are not yet.

## Findings at a glance

| id | what | severity | status |
|---|---|---|---|
| A-1 | member send/QR path broken — API rejected its own wallet reference, 500 on malformed ids | critical | **fixed, verified live, regression test added** |
| B-1 | RLS defined but never in force; service connects as schema owner | high | **forced + role + grants done**; per-request identity wiring is the remaining half |
| B-2 | append-only history erasable with `TRUNCATE` | high | **fixed (0017), attack test added** |
| B-3 | `system_settings`, wallet ownership and the balance cache are directly writable by SQL | high | **fixed (0017), attack test added** |
| B-4 | admin routes guarded per-route, not fail-closed | high | open |
| B-5 | first issuance with no eligible reserve fails on a raw constraint | high | decision made: **refuse the operation**; fix pending |
| B-6 | `MAX_SUPPLY_CHANGE` could never execute (`42P18`, reported as 500) | high | **fixed, verified live end-to-end, test added** |
| C-1 | design-token values interpolated into injected CSS | medium | open |
| C-2 | preview frame-ancestor compiled in for all environments | medium | open |
| C-3 | no dedicated rate limit on money endpoints | medium | open |
| C-4 | no cap on unconsumed transaction authorizations | medium | open |
| C-5 | session binding skipped for null-session authorizations | medium | open |
| D-1..D-4 | missing backup/restore path, trusted forwarded headers, empty-param errors | low | open |

---

## 0. How to read the evidence

Every claim below carries either a `file:line` citation or a reproduced probe
output. The probes live in the repository under `tests/audit/` and run against
throwaway migrated databases — they never touch a live book:

| probe | answers |
|---|---|
| `tests/audit/rls-and-immutability.probe.ts` | is RLS in force, can history be rewritten or erased, is configuration writable |
| `tests/audit/direct-write.probe.ts` | what a raw SQL writer can reach: the balance cache, settings, wallet ownership |
| `tests/audit/database-guarantees.probe.ts` | can the database itself be talked into an overdraft or an over-cap mint |

They are run by hand (`npx tsx tests/audit/<name>.probe.ts`); they are not part
of the test suite, because they assert *attack outcomes*, not features.

Three probe outputs are load-bearing and are reproduced verbatim throughout:

```
── RLS (probe 2)
  as prs_app identity=user  → wallets visible: 2      (correctly filtered)
  other wallet via pars_app → 0 rows                  (correctly refused)
  with NO identity set      → wallets visible: 3      (nothing filtered)
  connection role           → postgres, is_superuser = true

── history (probe 2/3)
  UPDATE prs.audit_logs → blocked  (IMMUTABLE_TABLE)
  DELETE prs.audit_logs → blocked  (IMMUTABLE_TABLE)
  TRUNCATE prs.audit_logs → ALLOWED
  TRUNCATE prs.ledger_entries / prs.transactions / prs.ledger_transactions → ALLOWED

── monetary guarantees at the database layer (probe 4, raw SQL, no service layer)
  overdraft a wallet by raw SQL     → blocked (LEDGER_OVERDRAFT)
  mint past the 10 000 PRS cap      → blocked (SUPPLY_CAP_EXCEEDED)
```

---

## A. Critical

### A-1 — Money movement was completely broken; malformed identifiers returned 500
**Status: FIXED and verified live.**

`issueTransactionAuthorization` accepted the client's `walletRef` and passed it
straight into a `uuid` column. The public app sends exactly what the API handed
it (`apps/public/src/pages/Send.tsx:116` → `walletRef: activeWallet.publicRef`,
e.g. `PRS-W-001005`), so **every** `POST /auth/transaction-authorization` and
therefore every send and every QR payment failed:

```
POST /api/v1/auth/transaction-authorization → 500 INTERNAL_ERROR
  error: invalid input syntax for type uuid: "PRS-W-001005"   (22P02)
```

The same class of defect made any malformed identifier in a path parameter a
500 (`POST /admin/cards//pin` → `invalid input syntax for type uuid: ""`).

Why this is category A rather than a functional bug: `22P02` was unmapped, so
the response was a 500 with a stack trace in the server log and no usable
message — and it collapsed the single most security-sensitive user journey in
the product, which is also the journey the acceptance criteria are written
against.

**Fix** (both parts verified live):
- `apps/api/src/services/auth.service.ts:450` — the service now resolves the
  caller's wallet itself, accepting the public reference *or* the internal id,
  and requires ownership (`WALLET_NOT_FOUND` otherwise, never a foreign wallet).
- `apps/api/src/db/index.ts:45` + `apps/api/src/db/types.ts:64` — `22P02`
  translates to a 422 validation failure instead of leaking as a 500.

```
after fix:
  POST /auth/transaction-authorization {walletRef:"PRS-W-001005"} → 200 {authorizationId, expiresAt}
  POST /transfers (publicRef sender)                            → 200 ref PRS-TRX-YXCBNWNB6S, balance 285 → 278
  GET  /transactions/not-a-uuid                                 → 404 (was 500)
```

---

## B. High

### B-1 — Row-level security is defined but never in force
**`db/migrations/0012_rls.sql` contains 46 `ENABLE ROW LEVEL SECURITY` and 0 `FORCE ROW LEVEL SECURITY`; `setIdentity` has no caller anywhere in `apps/api/src`.**

`setIdentity` is declared in `apps/api/src/db/types.ts` and implemented in both
drivers, and is referenced by nothing else. Every request therefore runs as the
table **owner**, and PostgreSQL exempts a table owner from its own RLS policies
unless `FORCE ROW LEVEL SECURITY` is set. The policies themselves are correct —
they are simply never consulted:

| probe | result |
|---|---|
| connection role / superuser | `postgres` / `true` |
| wallets visible with no identity set | **3** (all of them) |
| profiles visible with no identity set | **6** (all of them) |
| wallets visible as `pars_app`, identity set | 2 (own only) |
| another member's wallet via `pars_app` | 0 rows |
| `wallets_own` policy | `db/migrations/0012_rls.sql:95` — `USING (profile_id = prs.current_profile_id())` |

**Consequence.** Row-level security is decorative today. Authorization rests
entirely on the service layer being correct in every query. That layer is
currently disciplined — a live broken-object-level-authorization probe was
refused correctly:

```
GET  /me/wallets/PRS-W-001006   (member2's wallet, as member1) → 403 WALLET_NOT_OWNED
GET  /transactions/PRS-TRX-H79… (member2's txn, as member1)    → 404 TRANSACTION_NOT_FOUND
POST /me/cards/<member2 card>/qr/rotate, as member1            → 403 FORBIDDEN
```

…which is exactly the point: it is one forgotten `WHERE profile_id = $1` away
from a cross-tenant read, and nothing would catch it. Note also that
`FORCE ROW LEVEL SECURITY` is required *in addition to* connecting as a
non-owner role.

**Fix.** (1) a dedicated login role for the service, `NOLOGIN`-free, not the
owner, `NOBYPASSRLS`; (2) `FORCE ROW LEVEL SECURITY` on every table in the RLS
migration; (3) call `setIdentity(profileId, role)` at the start of each
request-scoped transaction (the `SET LOCAL` form the existing driver
implements, which requires being inside a transaction).

### B-2 — Append-only history can be erased with `TRUNCATE`
Row-level `BEFORE UPDATE/DELETE` triggers guard the history tables correctly,
but **row-level triggers do not fire on `TRUNCATE`** and no statement-level
trigger was created:

```
UPDATE prs.audit_logs  → blocked (IMMUTABLE_TABLE: prs.audit_logs is append-only, UPDATE is forbidden)
DELETE prs.audit_logs  → blocked (IMMUTABLE_TABLE)
TRUNCATE prs.audit_logs           → ALLOWED
TRUNCATE prs.ledger_entries       → ALLOWED
TRUNCATE prs.transactions         → ALLOWED
TRUNCATE prs.ledger_transactions  → ALLOWED
```

Affects every append-only relation: `ledger_entries`, `ledger_transactions`,
`transactions`, `audit_logs`, `card_events`, `banknote_events`, `burns`,
`issuances`, `reserve_valuations`.

This directly violates a stated requirement — *"no deleted transaction
disappears from history"* — with a single statement that leaves no audit trail
(the audit log itself is erased by the same statement).

**Fix.** `BEFORE TRUNCATE` statement triggers on each append-only table raising
`IMMUTABLE_TABLE`, plus `REVOKE TRUNCATE` from the service role; add an
`EVENT TRIGGER` as belt-and-braces against future tables.

### B-3 — Monetary and ownership state is directly writable by SQL
No guard stands between a SQL writer and configuration or ownership:

```
UPDATE prs.system_settings SET value='99' WHERE key='fees.transfer_fee_minor'  → ALLOWED
UPDATE prs.wallet_balance_cache SET balance_minor = 999999                     → ALLOWED
UPDATE prs.wallets SET profile_id = <another profile>                          → ALLOWED (wallet reassigned)
```

Severity is capped by the fact that the authoritative guards are *elsewhere*
(see section E) — the balance cache is rebuilt from the ledger on the next
entry, and overdrafts are refused by a deferred constraint trigger — so none of
these three yields free money. But `max_supply_minor`, `min_coverage_ratio` and
`financial_controls.*` live in `prs.system_settings`, and those are precisely
the parameters the dual-approval design exists to protect; the same is true of
`wallets.profile_id`, which is the ownership boundary itself.

**Fix.** Guard rows with triggers requiring a session flag that only the
approval executor sets (`prs.monetary_write_authorized`), and revoke
`UPDATE`/`DELETE` on `wallet_balance_cache` from the service role entirely —
it is a derived cache and should only ever be written by its trigger.

### B-4 — Administrative routes are guarded per-route, not fail-closed
`apps/api/src/http/routes/admin.routes.ts` defines 59 routes and 59 guard calls
(`guard(request, permission)` at `:106`), and a broken-object probe confirms the
guard works. There is, however, no global `onRequest` hook for `/admin/*`, so a
future route added without a guard is open by default and no test would fail.

**Fix.** A `preHandler` hook on the `/admin` scope that rejects unless the
request already carries a resolved admin session, making the per-route
permission check the *second* gate rather than the only one.

### B-5 — The first issuance into a book with no eligible reserve crashes on a raw constraint violation
**Found by the regression suite written for A-1** (`tests/integration/send-path.test.ts`),
on a fresh database against a book with no pledged reserve:

```
error: new row for relation "exchange_rates" violates check constraint
       "exchange_rates_rate_prs_per_usd_check"
```

`prs.refresh_monetary_state()` (`db/migrations/0009_treasury.sql:265`) computes
`v_rate := round(v_nav / v_circulating, 8)` whenever `circulating > 0`, and the
parity fallback (`db/migrations/0009_treasury.sql:294`) is only taken when
`circulating = 0`. With `circulating > 0` and `nav = 0` — issuing before any
reserve is pledged, or after a redemption drains the eligible reserve — the rate
is `0`, and `prs.exchange_rates.rate_prs_per_usd` requires `> 0`
(`db/migrations/0009_treasury.sql:125`). The append then fails and takes the
whole posting transaction with it.

This is reachable by configuration (`policy.issuance_requires_reserve` can be
disabled) and by a legitimate market path (a fully redeemed reserve), and it
fails with a database constraint name rather than a domain error.

**Remediation requires a policy decision** — there are two defensible answers and
they have different monetary meanings:

- **(a) Parity fallback:** publish `rate = par_value_usd_minor` with
  `is_parity_fallback = true` and a `reserve_valuation` recording the degraded
  state. Issuance continues; the snapshot tells the truth about why.
- **(b) Hard refusal:** raise `RESERVE_INSUFFICIENT_FOR_RATE` and refuse the
  posting. A reserve-backed currency cannot be priced without a reserve, so the
  operation must not exist.

Option (b) is the more conservative reading of the reserve-backed model and is
what the coverage floor (`min_coverage_ratio = 1.00`) already implies; option (a)
keeps a papered-over rate in circulation. **This audit recommends (b)** and does
not implement either until the choice is confirmed.

### B-6 — A critical treasury operation could never execute, and failed as a 500
**Status: FIXED and verified live end-to-end.**

Found while testing the B-3 guard: the `MAX_SUPPLY_CHANGE` executor wrote its new
ceiling with a statement that bound `$2` and `$3` but no `$1`:

```sql
UPDATE prs.system_settings SET value = $2, updated_by = $3 WHERE key = 'max_supply_minor'
```

PostgreSQL cannot infer the type of an unreferenced parameter, so every execution
died with `42P18 could not determine data type of parameter $1`. A scan of every
SQL string in `apps/api/src` and `db/migrations` found exactly this one instance
(`tests/audit/param-binding.probe.ts` demonstrates both forms side by side).

Two defects compounded it:
- the API reported it as `500 INTERNAL_ERROR`, because `42P18` was unmapped;
- `executeAdminAction`'s failure handler writes its `FAILED` bookkeeping through
  `context.db` — a *different* connection under `pg`, but the *same* connection
  under PGlite, so those statements ran inside the already-aborted transaction and
  masked the original error with `25P02`. The real cause never reached the log.

Verified live after the fix (officer requests → director approves → director
executes): `max supply now 9500`, an immediate replay returns
`APPROVAL_ALREADY_DECIDED`, and the audit trail carries both people.

---

## C. Medium

### C-1 — Design-token values are interpolated into CSS that is injected as raw HTML
`packages/design-system/src/index.ts:68` builds CSS by direct interpolation
(`${tokenCssVar(key)}:${value};`), the published theme is served at
`/content/theme` (`apps/api/src/services/design.service.ts:460`), the public
client fetches it (`apps/public/src/lib/content.tsx:87`) and renders it with
`dangerouslySetInnerHTML` (`packages/ui/src/chrome.tsx:25`). Validation accepts
any string up to 400 characters (`packages/validation/src/index.ts:276`).

A `DESIGN_ADMIN` can therefore inject arbitrary markup into every page for every
visitor. Exploitation is constrained by CSP — `scriptSrc: ["'self'"]` blocks
inline script, and `imgSrc`/`connectSrc` exclude third-party origins — so this
is currently **CSS injection / UI redressing** rather than script execution. It
becomes script execution the day the CSP is relaxed or a nonce-less inline
script is introduced.

**Fix.** Allow-list token values by token type (colour, length, font, shadow) at
write time, and escape `<`, `>`, `&` and `}` when compiling CSS. The design
system already knows each token's category — the validator does not yet use it.

### C-2 — No fail-closed default for the frame policy in production
`apps/api/src/http/security.ts` adds `https://*.e2b.app` to `frameAncestors()`
for the hosted preview, and that value is compiled in regardless of environment.
The comment is honest about the compromise, but the allow-list should be
conditional on `isProduction` so a deployed instance inherits `'self'` only.

### C-3 — Rate limiting is per-route for authentication, global elsewhere
`authLimit` is applied to the four authentication routes
(`apps/api/src/http/routes/auth.routes.ts:34,80,81,119,142`) and a global limit
covers the rest. There is no dedicated limit on the money-moving endpoints
(`/transfers`, `/me/banknotes/*`, `/admin/cards/:id/pin`), so a compromised
session can enumerate the transfer surface at the global rate.

### C-4 — Authorizations and QR sessions have no per-profile cap
`prs.transaction_authorizations` rows are consumed exactly once and expire
(`security.txn_authorization_seconds`, default 120 s) and are single-use, which
is correct. Nothing limits how many *unconsumed* authorizations one profile may
hold at once, so a script can mint them in bulk. Low impact today (each still
requires the PIN or password and is bound to session + wallet + ceiling), but it
is an unnecessary amplification surface.

### C-5 — `session_id` binding is skipped when the authorization was minted without one
`consumeTransactionAuthorization` (`apps/api/src/services/auth.service.ts:530`)
only compares `row.session_id` if `input.sessionId` is truthy. An authorization
created by a code path that passes `null` is therefore usable from any session
holding the id. All current callers pass a real session, so this is latent — but
the check should be unconditional.

---

## D. Low

- **D-1 — No backup or restore procedure exists.** No `pg_dump` path, no
  snapshot script, no documented restore drill. `docs/OPERATIONS.md` is still
  pending. Acceptable for a sandbox, disqualifying for a system that claims to be
  a financial record.
- **D-2 — `X-Forwarded-*` is trusted without an explicit proxy allow-list.**
  Correct behind the platform proxy, but it also means a directly reachable port
  lets a caller choose the scheme the cookie policy observes.
- **D-3 — Migration files are checksum-gated** (`apps/api/src/db/migrate.ts`),
  which is exactly right; note that this also means **remediation must arrive as
  new migrations** (`0017_*` onward), never as edits to applied files.
- **D-4 — Empty route parameters surface as validation errors rather than 400s**
  for some paths; now at least they are 422s rather than 500s (see A-1).

---

## E. Financial-integrity assessment

The strongest part of the system. Verified against the live seeded book and by
direct raw-SQL attack on throwaway databases.

| Invariant | Result | Evidence |
|---|---|---|
| Debits = credits, institution-wide | **PASS** | `/admin/ledger-audit` → `balanced: true`, `totalDebitsMinor 3023 == totalCreditsMinor 3023`, `unbalancedPostingSets: []`, `findings: 0` |
| No account can go negative | **PASS (database-enforced)** | raw SQL overdraft → `LEDGER_OVERDRAFT`; trigger at `db/migrations/0006_ledger_invariants.sql:83`, `DEFERRABLE INITIALLY DEFERRED` |
| Supply ≤ 10 000 PRS | **PASS (database-enforced)** | raw SQL mint of 20 000 → `SUPPLY_CAP_EXCEEDED`; trigger at `db/migrations/0006_ledger_invariants.sql:118` |
| No successful transfer without balanced entries | **PASS** | every posting goes through `postPostingSet` (`apps/api/src/services/ledger.service.ts:162`), which validates the set before writing; zero unbalanced sets in the live book |
| Duplicate idempotency key cannot duplicate money | **PASS** | same key twice → second returns the *same* reference with `replayed: true`, balance moved once (−6) |
| Concurrent duplicate submission | **PASS** | 6 simultaneous identical requests, same key → exactly **1** distinct transaction reference, balance moved once (−5) |
| Failed transfer leaves no partial state | **PASS** | amount &gt; balance → `VALIDATION_FAILED`, balance unchanged (267 → 267), no entries written |
| Balance field is not the source of truth | **PASS** | `wallet_balance_cache` is refreshed *by a trigger* on every ledger entry (`db/migrations/0006_ledger_invariants.sql:157`), and a forged cache value was overwritten back to the ledger value (999 999 → 500) |
| History is immutable | **PARTIAL** | `UPDATE`/`DELETE` blocked with `IMMUTABLE_TABLE` on `audit_logs`, `card_events`, `banknote_events`, `ledger_entries`, `issuances`, `burns`, `reserve_valuations`; **`TRUNCATE` is not blocked — see B-2** |
| No user can modify another's ledger | **PASS at API level** | BOLA probes refused (`WALLET_NOT_OWNED`, `TRANSACTION_NOT_FOUND`, `FORBIDDEN`); see B-1 for the missing database-level backstop |
| No non-treasury role can issue | **PASS** | issuance requires `TREASURY` execution permission and a completed dual approval; `DESIGN_ADMIN` receives 403 on treasury endpoints |
| No single admin can execute a dual-approval operation | **PASS** | self-approval → `403 SELF_APPROVAL_FORBIDDEN`; 15 policies in `packages/domain/src/approval.ts:27`; critical settings → `409 DUAL_APPROVAL_REQUIRED` |
| `DESIGN_ADMIN` cannot change monetary rules | **PASS** | settings/treasury/simulate → 403 for `DESIGN_ADMIN`; token/content/theme-draft → 200 |
| No QR token exposes secrets | **PASS** | live unauthenticated `GET /secure/card/<token>` returns only `brandNameFa/En`, `cardNumber`, `expiryMonth/Year`, `scheme`, `tokenPrefix`, `sessionRef`, `sessionExpiresAt`, `payable` — no PIN, CVV, password, balance, wallet id or profile id |
| All monetary operations are server-authorized | **PASS** | no client-supplied balance is ever accepted; affordability is computed server-side and re-checked by the database |
| Reproducibility | **PASS** | `tests/integration/ledger-invariants.test.ts` 8/8 |

**Nothing in the ledger engine was found to be manipulable from the client.**
The financial weaknesses in this report are all *defence-in-depth erosions*
(B-1, B-2, B-3, C-5) plus one real availability defect that is now fixed (A-1).

---

## F. Authorization assessment (live matrix, unchanged and correct)

| Probe | Expected | Observed |
|---|---|---|
| `AUDITOR` reads treasury / settings | allowed, read-only | 200 |
| `AUDITOR` mutates financial data | refused | 403 |
| `DESIGN_ADMIN` design tokens / content / theme draft | allowed | 200 |
| `DESIGN_ADMIN` settings / simulate / wallet freeze / treasury | refused | 403 |
| `SUPER_ADMIN` open setting / flag | applied | 200 `{ok:true, applied:true}` |
| `SUPER_ADMIN` critical setting / `DISABLE_FINANCIAL_CONTROLS` | dual approval | 409 `DUAL_APPROVAL_REQUIRED` |
| Self-approval of own request | refused | 403 `SELF_APPROVAL_FORBIDDEN` |
| Member A → member B's wallet / transaction / card | refused | 403 / 404 / 403 |
| Unknown approval id | refused | 404 |
| Missing CSRF token | refused | 403 |
| Zod body failure | refused | 422 |

No privilege-escalation path was found: roles carry independent permission sets
(`packages/domain/src/rbac.ts`), and `allowedSections(role)` (`rbac.ts:285`)
drives the console navigation from the same source of truth as the route
guards, so the UI cannot advertise a section the API would refuse.

---

## G. Database-design weaknesses

1. **RLS enabled but not forced, and never activated at runtime** (B-1) — the
   single largest structural gap.
2. **No `BEFORE TRUNCATE` guards** on append-only tables (B-2).
3. **Owner-level connection** — the service connects as the schema owner, so it
   can `ALTER`, `DROP` and `TRUNCATE` freely. Least privilege is not applied.
4. **Mutable configuration without a controlled write path** (B-3) —
   `system_settings`, `wallet_balance_cache`, `wallets.profile_id`.
5. **No `session_id` NOT NULL on `transaction_authorizations`** (C-5).
6. **Idempotency is enforced by a column constraint, not by a documented
   contract** — `ledger_transactions.idempotency_key` is `UNIQUE`
   (`db/migrations/0005_ledger.sql:49`), which is correct but undocumented; the
   `strict_idempotency` flag controls the HTTP-level behaviour and should be the
   only switch.
7. **`supply_summary` is a view, not materialised** — correct for accuracy
   (always true), at the cost of recomputation per posting. Fine at this scale;
   worth noting before scale.
8. **Migration immutability is correct** — remediation must be new files.

---

## H. Recommended fixes (grouped, in execution order)

**Group 1 — Database authority (B-1, B-2, B-3, G3) — migration `0017`**
1. Create role `pars_service` (login, `NOBYPASSRLS`, not owner); grant only DML
   on the tables it needs; never `TRUNCATE`, `ALTER` or `DROP`.
2. `FORCE ROW LEVEL SECURITY` on all 46 tables in the RLS migration.
3. `BEFORE TRUNCATE` statement triggers on the nine append-only relations.
4. Guard triggers on `system_settings` and `wallets.profile_id` that require a
   transaction-local `prs.control_plane` flag which only the approval executor
   sets; `REVOKE UPDATE, DELETE ON prs.wallet_balance_cache` from the service role.
5. Wire `setIdentity()` into the request transaction.

**Group 2 — Route-level default deny (B-4) and authorization backstops (C-5)**
6. `onRequest` hook for `/admin/*` and for the member money routes.
7. Unconditional `session_id` equality in `consumeTransactionAuthorization`.

**Group 3 — Injection and transport hardening (C-1, C-2, D-2)**
8. Token-value allow-list by token category + CSS escaping.
9. `frameAncestors` restricted to `'self'` outside development.
10. Explicit trusted-proxy configuration.

**Group 4 — Abuse control (C-3, C-4)**
11. Per-route limits on money endpoints; cap unconsumed authorizations per profile.

**Group 5 — Operations (D-1)**
12. `docs/OPERATIONS.md`: backup, restore drill, key rotation, incident runbook.

---

## I. Tests that prove each fix

| Fix | Test |
|---|---|
| A-1 | `tests/integration/send-path.test.ts` (written, passing 4/4) — full login → transaction-authorization → transfer over the real HTTP app using a **public reference**, asserting 200 and a single balance movement; a malformed-id case asserting 422/404 rather than 500; and a foreign-wallet case asserting an indistinguishable 404 |
| B-1 | `tests/integration/rls-enforcement.test.ts` — with the service role and identity set, `SELECT * FROM prs.wallets` returns only the caller's wallet; without identity, it returns zero rows; a profile id for another member returns zero rows |
| B-2 | `tests/integration/immutability.test.ts` — `UPDATE`, `DELETE` **and `TRUNCATE`** on each append-only table all raise; run against a populated table so the trigger must fire |
| B-3 | `tests/integration/control-plane.test.ts` — direct `UPDATE prs.system_settings`, `UPDATE prs.wallets SET profile_id`, `UPDATE prs.wallet_balance_cache` all refused without the control-plane flag, allowed with it |
| B-4 | `tests/integration/admin-default-deny.test.ts` — enumerate the registered route table; assert every `/admin/*` route has a guard and that an unauthenticated request to any of them is refused |
| C-1 | `tests/unit/design-token-validation.test.ts` — `</style><script>` in a token value is rejected at write time, and `compileTheme` escapes it |
| C-4/C-5 | `tests/integration/authorization-binding.test.ts` — an authorization minted in session A is refused in session B; the per-profile cap is enforced |
| E (regression) | existing `tests/integration/ledger-invariants.test.ts` 8/8 must stay green, plus the live acceptance script for idempotent replay, the concurrent-duplicate race, and failed-transfer atomicity |
| B-5 | `tests/integration/reserve-less-issuance.test.ts` — a supply-changing posting with `nav = 0` produces the chosen outcome (a domain error naming the reserve state, or a parity-fallback snapshot), never a constraint violation |

---

## J. Architecture improvements

1. **Two-role split.** `pars_service` (RLS-bound, DML only) for request traffic,
   and a separate `pars_control` role used *only* by the approval executor
   (`apps/api/src/services/approvals.service.ts`). This is the structural version
   of "no single admin can execute a dual-approval operation" and it makes
   B-3 solvable rather than cosmetic.
2. **Make the database the enforcement point, and keep the tests as attack
   scripts.** The overdraft and supply-cap triggers are the best thing in this
   codebase — they hold even when the service layer is bypassed. Extend the same
   pattern to ownership and configuration: the tests in section I are written as
   *attacks*, not as feature tests.
3. **`prs.monetary_audit_chain`.** Each ledger transaction currently records
   `sequence_no` and timestamps but nothing links a posting to its predecessor.
   A per-transaction hash chain (`prev_hash` → `hash`) would make silent
   rewriting detectable, not just blocked.
4. **Publish-time signing for design tokens.** The theme is data that becomes
   code (CSS). Sign the compiled CSS at publish time and verify it in the client,
   so a design change is attributable even if the token table is later tampered
   with.
5. **Restore drill in CI.** A backup nobody has restored is a hypothesis. A
   nightly `pg_dump` → restore into a throwaway database → run
   `ledger-invariants` is the only credible evidence that the book survives.
6. **Keep the console honest.** `SESSION_COOKIE_BLOCKED` (added when fixing the
   login bounce) is the right pattern: when the server detects that the browser
   refused the session, it says so in Persian instead of bouncing the operator to
   a login screen with no explanation. Apply the same principle to every silent
   failure path.

---

## Remediation plan (prioritized)

| # | Group | Findings | Blocks acceptance tests | Risk if deferred |
|---|---|---|---|---|
| 0 | **Reserve-less pricing (B-5)** — needs the policy decision above | B-5 | 9, 10 | an issuance fails with a constraint name, or a rate is published that the reserve does not support |
| 1 | Database authority — **in progress**: 0017 shipped and attacked; per-request identity wiring still to do | B-1, B-2, B-3, G3 | 1, 5, 13, 14 and the "no deleted transaction disappears" clause | cross-tenant read/write; historical erasure |
| 2 | Route default-deny + authz backstops | B-4, C-5 | 1, 5, 14 | a single unguarded future route opens the admin plane |
| 3 | Injection & transport | C-1, C-2, D-2 | 15 | UI redressing today; script execution if CSP is relaxed |
| 4 | Abuse control | C-3, C-4 | — | enumeration and authorization hoarding |
| 5 | Operations | D-1 | — | no recovery from data loss |

Groups are executed in this order, one group per change set, with the tests in
section I added alongside and the full suite re-run after each group.

### Already executed during this audit

- **A-1** (critical, fixed and verified live): wallet-reference resolution +
  `22P02` mapping. `npx tsc -p tsconfig.json --noEmit` clean;
  `tests/integration/ledger-invariants.test.ts` 8/8; live money path verified.
- **Console login bounce** (reported defect, fixed and verified live): adaptive
  cookie policy (`apps/api/src/http/session.ts:118`) with
  `COOKIE_SAME_SITE=auto` — cross-site + HTTPS yields `SameSite=None; Secure`,
  same-site keeps `SameSite=Strict` — plus a `SESSION_COOKIE_BLOCKED` message in
  the console login instead of a silent bounce.
- **Card issuance and PIN reset** (requested feature): `POST /admin/cards`
  returns number, name, PIN, CVV and QR token exactly once;
  `POST /admin/cards/:cardId/pin` resets the PIN with a `PIN_RESET` card event
  and a `SECURITY/WARNING` audit entry; migration
  `db/migrations/0016_card_pin_reset_event.sql` extends the event vocabulary.

### Group 1 — database authority (migration `0017_database_authority.sql`)

| finding | what changed | proof |
|---|---|---|
| B-2 | `BEFORE TRUNCATE` statement triggers on 15 append-only relations (`prs.reject_truncate`) | `tests/integration/database-authority.test.ts` — 10 tables refuse `TRUNCATE`, populated tables refuse `UPDATE` and `DELETE` with `23001` |
| B-3 | `prs.require_control_plane()` guards `system_settings` and `feature_flags`; a second guard protects `wallets.profile_id`; a third protects the derived `wallet_balance_cache` (`prs.refresh_wallet_balance` declares itself the writer) | same file — direct writes refused with `42501`, approved writes succeed, the cache still tracks the ledger |
| B-1 (part 1) | `FORCE ROW LEVEL SECURITY` on all 46 tables that have RLS enabled | same file — zero tables remain enabled-but-unforced |
| B-1 (part 2) | role `pars_service`: `NOLOGIN`, `NOBYPASSRLS`, DML-only grants, no `TRUNCATE`, membership in the four policy roles for `SET LOCAL ROLE` | grants applied and asserted through `setIdentity` in the same test file |
| B-6 | the max-supply statement now binds `$1` | `tests/integration/dual-approval.test.ts` — 4/4, including the live-restored ceiling |

Test suite at this point: **37 passed** (`ledger-invariants` 8, `send-path` 4,
`database-authority` 21, `dual-approval` 4); `tsc --noEmit` clean; the running
server re-verified end to end (console 200s, member authorization, debits =
credits 3023, findings 0).

**What group 1 still owes:** the request path does not yet call `setIdentity`
inside each request transaction, so the policies — though now forced and bound to
a service role — are not yet applied to live traffic. That change touches every
query in the application (services use `db.query` outside transactions as well as
inside them) and would break the anonymous login path, which has no identity by
design and must keep running with privileged access. It is the next change set,
with its own enforcement test: *a member session must not see a foreign wallet
even when the service layer forgets its `WHERE` clause*.

No other finding in this report has been acted on. Everything else in the audit
still stands as written.
