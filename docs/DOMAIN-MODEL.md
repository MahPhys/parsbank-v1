# BANK PARS — Domain Model & Transaction Rules

Pure logic lives in `packages/domain` (no I/O). The database is the last line of defence; the domain
package is the first.

## 1. Entities

| Entity | Table(s) | Notes |
| --- | --- | --- |
| Person | `profiles` | display name (fa/en), role, status, KYC-ish flags; never holds money |
| Wallet | `wallets` → `accounts` | one ledger account per wallet; balance derived |
| Card | `cards`, `card_credentials`, `card_qr_tokens` | 12-digit number, Persian name, expiry, CVV (hashed), PIN (hashed), QR token (hashed) |
| Business transaction | `transactions` | what the user sees: type, amount, counterparties, reference, status |
| Posting set | `ledger_transactions`, `ledger_entries` | double-entry truth |
| Physical note | `banknotes`, `banknote_events`, `banknote_transfers` | serial-registered bearer records |
| Treasury | `treasury_accounts`, `treasury_reserves`, `reserve_valuations` | reserve book, USD-valued |
| Monetary events | `issuances`, `burns`, `redemptions` | each 1:1 with a ledger transaction |
| Rate | `exchange_rates` | immutable snapshots |
| Governance | `admin_actions`, `admin_action_nonces`, `audit_logs` | dual approval + audit |
| Content | `assets`, `asset_versions`, `design_tokens`, `theme_versions`, `content_blocks`, `pages`, `navigation_items` | design plane |
| Operations | `feature_flags`, `system_settings`, `notifications`, `system_events` | runtime control |

## 2. Wallet lifecycle

```
CREATED ─► ACTIVE ─► FROZEN ─► ACTIVE
                  └► CLOSED   (terminal; balance must be 0)
```

Rules: a wallet is created together with its ledger account in one transaction. `FROZEN` blocks all
debits and credits except `ISSUANCE` corrections by SUPER_ADMIN (dual approved) and `REVERSAL`.
`CLOSED` requires `balance = 0`, enforced by the same DB trigger that guards overdrafts.

## 3. Transfer rules (the atomic contract)

Authorisation (server-side, all must hold):

1. caller owns the source wallet (`profile_id = session.profile_id`);
2. source wallet `ACTIVE`, destination wallet `ACTIVE` (closing/closed rejected);
3. `amount_minor ≥ 1`, integer, `≤ policy.max_transfer_minor`;
4. `amount_minor + fee ≤ balance(source)`;
5. daily limits: `policy.daily_transfer_limit_minor` per wallet (rolling 24h from `transactions`);
6. `feature_flags.transfers_enabled` and `system_settings.financial_controls.transfers` both enabled;
7. transaction credential valid (see §7) — a *separate* authorization from login;
8. source ≠ destination wallet.

Execution (single DB transaction, `SERIALIZABLE`):

```
BEGIN
  lock wallets (ORDER BY account id) FOR UPDATE
  re-read balances from wallet_balances (authoritative view)
  INSERT transactions(status='PENDING', reference=…, idempotency_key=…)
  INSERT ledger_transactions(type='TRANSFER', status='POSTED')
  INSERT ledger_entries (DR sender, CR receiver) [+ fee legs]
  REFRESH wallet_balance_cache
  UPDATE transactions SET status='COMPLETED', ledger_transaction_id=…, completed_at=now()
  INSERT audit_logs
COMMIT   -- deferred triggers verify L1..L5
```

Failure at any point rolls back the whole thing: there is no partial ledger state, no "pending debit"
left behind. The caller receives a typed error from the taxonomy in §8.

## 4. Limits, fees and policy switches

| Setting (`system_settings`) | Default | Effect |
| --- | --- | --- |
| `max_supply_minor` | 10000 | hard ceiling, dual-approval to change |
| `policy.max_transfer_minor` | 10000 | per-transaction cap |
| `policy.daily_transfer_limit_minor` | 10000 | rolling 24 h per wallet |
| `policy.min_coverage_ratio` | 1.00 | issuance gate |
| `policy.par_value_usd_minor` | 100 | accounting par for coverage |
| `policy.issuance_requires_reserve` | true | issuance gate |
| `fees.transfer_fee_minor` | 0 | fee leg to `2500` |
| `financial_controls.transfers` | true | kill switch (dual approved to change) |
| `financial_controls.issuance` | true | kill switch |
| `financial_controls.withdrawals` | true | kill switch |

Every kill-switch flip and every policy edit is a `CRITICAL` admin action → dual approval + audit,
and the current state is displayed on the admin *Security* page.

## 5. Physical note state machine (registry)

```
REGISTERED ──assign──► ASSIGNED ──hand-over──► IN_CIRCULATION
     │                                              │
     │                                     deposit  │  withdraw
     │                                              ▼
     └──store──► IN_VAULT ◄──receive── DEPOSITED ───┘
                    │
        freeze ─────┼─────► FROZEN ──► IN_VAULT | IN_CIRCULATION
                    │
   LOST / STOLEN ◄──┘            DESTROYED / RETIRED (terminal)
```

Monetary weight: `ASSIGNED`, `IN_CIRCULATION`, `FROZEN`, `LOST`, `STOLEN` carry outstanding value and
must reconcile with ledger account `2300`. `REGISTERED`, `IN_VAULT`, `DEPOSITED`, `DESTROYED`,
`RETIRED` carry no outstanding face value (`DEPOSITED` value already sits in a wallet).

Serial format (Crookford Base32, typo-detecting):

```
PRS-<denom:3>-<batch:4>-<seq:5>-<check:1>      e.g. PRS-100-0007-00042-K
```

The check character is a mod-37 weighted checksum from `packages/domain/src/banknote-serial.ts`, so a
mistyped serial is rejected before any lookup happens — the same discipline a real note registry uses.

## 6. Card & QR rules

* Card number: 12 digits, `Luhn`-checked, unique, generated server-side.
* Cardholder name: Persian, as printed on the card; stored for display only.
* CVV: 3 digits, hashed at rest (scrypt), used for card-presence verification only, **never** a
  standalone payment authorisation.
* PIN: 4 digits, hashed, never logged, never returned, never printable (`NOT NULL` + `CHECK
  (length(pin_hash) > 40)`).
* `card_qr_tokens`: token = `prs1_` + 26 chars Base32 (130 bits). Stored as `sha256(token)`; the raw
  token exists only inside the QR image. Nothing in the row can be used to reconstruct the QR.
* QR payload (exact): the text `PRSQR1:<token>` plus the public URL path `/secure/card/{token}`.
  It contains **no** PIN, no CVV, no password, no balance, no name, no account/wallet/database id.
* `/secure/card/{token}` renders: Bank Pars branding, the 12-digit card number, the expiry date.
  Nothing else — no balance, no CVV, no profile, no history.
* Payment flow: scanning opens a *payment session* bound to the token with a 10-minute TTL. The
  destination card number is resolved server-side from the payee card and shown as verified before
  the payer confirms; the payer supplies amount + destination card number + CVV + transaction
  credential. A wrong destination card number (≠ the one bound to the session) aborts the flow.

## 7. Authentication vs transaction authorization

| Layer | Credential | Storage | Notes |
| --- | --- | --- | --- |
| Login | 12-digit card number + account password | scrypt(N=2^15,r=8,p=1) + HMAC pepper | generic error messages, lockout after 5 failures/15 min |
| Second factor (optional) | TOTP (RFC 6238, 30 s, ±1 window) | secret encrypted with `APP_ENCRYPTION_KEY` | required by policy flag for admin accounts |
| Session | opaque 256-bit token in `HttpOnly; Secure; SameSite=Strict` cookie | `sessions.token_hash = sha256` | sliding expiry, absolute expiry, rotation on privilege change |
| Transaction | transaction PIN **or** account password + optional TOTP | PIN hashed like a password | separate endpoint `/security/verify-transaction`, issues a 120-second `txn_authorization` grant bound to (session, wallet, amount range) |
| Card presence | CVV | hashed | *additional* factor; never sufficient alone |

Card-number-only login is impossible: the API requires the password and applies constant-time
comparison plus per-credential and per-IP rate limits.

## 8. Error taxonomy (domain → HTTP)

| Domain error | HTTP | User-visible message (fa) |
| --- | --- | --- |
| `INSUFFICIENT_FUNDS` | 422 | موجودی کافی نیست |
| `ACCOUNT_FROZEN` / `ACCOUNT_CLOSED` | 423 | حساب غیرفعال است |
| `WALLET_NOT_OWNED` | 403 | — |
| `DUPLICATE_IDEMPOTENCY_KEY` | 200 replayed / 409 mismatch | — |
| `SUPPLY_CAP_EXCEEDED` | 422 | سقف عرضه |
| `RESERVE_COVERAGE_INSUFFICIENT` | 422 | پشتوانه کافی نیست |
| `DUAL_APPROVAL_REQUIRED` | 409 | نیازمند تأیید دوم |
| `SELF_APPROVAL_FORBIDDEN` | 403 | — |
| `RATE_LIMITED` | 429 | — |
| `SESSION_EXPIRED` | 401 | — |
| `VALIDATION_FAILED` | 422 | — |

Errors never leak internal identifiers, SQL, stack traces, or whether a card number exists.
