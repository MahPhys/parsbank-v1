# BANK PARS — Architecture

> **بانک پارس / BANK PARS** is a *closed private monetary system*. It issues `PRS` (**پارسه**), an
> internal unit of account that is **not legal tender**, is **not a public bank**, and is
> **intentionally not integrated with any real-world banking or payment rail**. Reserve records
> inside this system describe an internal backing model; they do not move real money and the
> system contains no integration point that could move real money.

---

## 1. System shape

```
                        ┌──────────────────────────────────────────────┐
                        │                BANK PARS                     │
                        │                                              │
   browser ──────────►  │  /apps/public     (user banking app)         │
                        │  /admin           (control plane)            │
                        │        │                    │                │
                        │        └────────┬───────────┘                │
                        │                 ▼                            │
                        │        /apps/api  (Fastify, server-side)      │
                        │        - authentication + sessions            │
                        │        - authorization (RBAC + dual approval) │
                        │        - money services (ledger, treasury…)   │
                        │                 │                            │
                        │                 ▼                            │
                        │        PostgreSQL 16                          │
                        │        - migrations (db/migrations)           │
                        │        - append-only ledger + DB invariants   │
                        │        - RLS as defence in depth              │
                        └──────────────────────────────────────────────┘
```

**Single writer of monetary truth: the API + the database.** No client (public or admin) can
express an intention that changes a balance, the supply, a reserve valuation or the reference
rate. Clients send *intents*; the server resolves them into balanced ledger postings inside a
database transaction that re-checks every invariant.

## 2. Monorepo layout

| Path | Responsibility |
| --- | --- |
| `apps/api` | HTTP API, authentication, authorization, money services, migrations runner, seeds, audit tooling |
| `apps/public` | User banking application (dashboard, wallet, card, QR pay, send, receive, history, receipts, profile, security) |
| `apps/admin` | Administrative control plane (19 sections, role-separated) |
| `packages/domain` | **Pure** business logic: money arithmetic, chart of accounts, ledger rules, treasury policy, note state machine, serials, RBAC matrix, error taxonomy. No I/O, no framework |
| `packages/types` | Shared domain types & DTO contracts |
| `packages/validation` | Zod schemas — the *only* shape-checking boundary for HTTP input |
| `packages/config` | Environment loading, constants, deployment config, feature defaults |
| `packages/design-system` | Token model, default theme (blue/white/red), theme compiler (tokens → CSS variables), primitives |
| `packages/ui` | Composed product components + product CSS, shared by both frontends |
| `db/migrations` | Version-controlled SQL migrations (the only sanctioned schema mutation path) |
| `docs` | Architecture, monetary policy, ledger rules, security model, operations |
| `tests` | Unit / integration / ledger-consistency / authorization / RLS / race / acceptance suites |

Dependency direction is strictly inward:

```
apps/*  ──►  packages/ui ──► packages/design-system
   │                            │
   └──────────► packages/validation ──► packages/types
                        │
                        └──► packages/domain ──► packages/types
```

`packages/domain` depends on nothing (not even the DB). That is what allows the monetary rules to be
unit-tested and reasoned about without a running system — and it is why *design* code can never
reach monetary logic.

## 3. Application separation

The two frontends are separate builds, separate bundles, separate cookie names, and separate
authorization roots:

* `apps/public` — user session (`prs_session`), user roles only.
* `apps/admin` — admin session (`prs_admin_session`), admin roles only.

They share *presentational* packages (`ui`, `design-system`) and nothing else. There is no code path
where the public app imports an admin route, and the API enforces the split again server-side:
admin endpoints require an admin session **and** an admin role; user endpoints reject admin-only
sessions for user-scoped resources unless the caller owns the resource.

## 4. Runtime & database drivers

Two drivers, one identical SQL dialect (PostgreSQL 16):

| Driver | Used for | Selection |
| --- | --- | --- |
| `pg` (node-postgres) | production / docker-compose | `DATABASE_URL` is set |
| `@electric-sql/pglite` (PostgreSQL compiled to WASM) | embedded local run, demo, integration tests | `DATABASE_URL` unset |

Both execute the same migrations from `db/migrations`, both support transactions, isolation levels,
row locks, check constraints, triggers and row-level security. The abstraction is a single
`Database` interface (`query`, `transaction`) in `apps/api/src/db`, so services never know which one
they are on. Integration tests run against PGlite in-memory — i.e. against a real PostgreSQL engine.

## 5. Request lifecycle (financial operation)

```
POST /api/v1/transfers
  1. transport      security headers, body size caps, rate limit
  2. session        signed cookie → session id → server-side session row (hashed token, expiry, rotation)
  3. csrf           double-submit token + Origin/Host check for state-changing verbs
  4. validation     Zod schema (packages/validation) → 422 with field errors
  5. authorization  RBAC matrix + ownership check (server-side only)
  6. idempotency    (initiator, idempotency_key) unique-hit → replay stored result
  7. money service  BEGIN SERIALIZABLE
                      SELECT ... FOR UPDATE on both wallet accounts (ordered by id)
                      verify state, limits, feature flags, account status
                      insert transactions row + ledger_transaction + balanced ledger_entries
                      recompute monetary state snapshot
                    COMMIT   ← DB constraint triggers re-verify: debit=credit,
                               no overdraft, supply ≤ max supply, ledger append-only
  8. audit          audit_logs entry (actor, action, target, before/after, request id, ip)
  9. response       DTO with human reference; no internal ids leak to other users
```

Steps 5–8 are denied *inside* the database transaction, not in the browser. A client that bypasses
the UI entirely gets exactly the same rejections.

## 6. Design vs business logic separation

The theme/CMS subsystem (`design_tokens`, `theme_versions`, `assets`, `content_blocks`, `pages`,
`navigation_items`) is a **content plane** with its own tables, its own services, and its own role
(`DESIGN_ADMIN`). It writes only to content tables. Monetary tables are protected by:

1. **RBAC** — `DESIGN_ADMIN` has no monetary permission in the matrix (not by omission but by an
   explicit deny test in `tests/acceptance/04-design-admin-cannot-issue.test.ts`).
2. **Database grants** — the runtime role `pars_app` has `SELECT`-only grants on monetary tables for
   the design service path; write grants are limited to a `pars_money` capability checked in the
   service layer, and the migration runner is the only role that can `ALTER` anything.
3. **Immutability triggers** — even a compromised service cannot rewrite history: `ledger_entries`,
   `audit_logs`, `banknote_events`, `issuances`, `burns` and `exchange_rates` reject `UPDATE`/`DELETE`.

## 7. Environments

| Env | Database | Notes |
| --- | --- | --- |
| dev | embedded PostgreSQL (`.data/pglite`) | zero-install, single command |
| test | embedded PostgreSQL (in-memory) | fresh schema per suite, RLS enforced |
| prod | PostgreSQL 16 (`DATABASE_URL`) | see `docker-compose.yml`, `docs/OPERATIONS.md` |

## 8. Build phases

Implementation order is fixed and reflected in the commit/PR history:

1. Architecture, schema, migrations, domain model, transaction rules
2. Authentication, roles, authorization
3. Double-entry ledger
4. Wallets, transfers
5. Treasury, issuance, burning
6. Cards, QR verification
7. Physical banknote registry
8. Public application
9. Admin control plane
10. Design CMS + theme system
11. Security hardening
12. Testing and audit

See `docs/ACCEPTANCE-TESTS.md` for the mapping from the acceptance criteria to executable tests.
