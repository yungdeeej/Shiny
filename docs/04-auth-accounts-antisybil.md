# 04 — AUTH, ACCOUNTS & ANTI-SYBIL

## Objective
Wallet-native auth (Sign-In With Solana), sessions, account model, and the anti-sybil layer that
protects the free tier and airdrops from farm wallets.

## Key decisions (made)
- **SIWS (message-signature) auth** → httpOnly session cookie (not JWT-in-localStorage). Nonce
  per attempt, 5-minute expiry, domain-bound message.
- One user can link multiple wallets; one **primary** wallet for withdrawals (change = 48h timelock
  + re-sign — drains via session hijack become survivable).
- **Compliance gating is external**: jurisdiction/access control is handled by a separate system
  added later — these services expose a single `complianceGate` middleware hook (no-op for now)
  on deposit/play/withdraw routes so it can be dropped in without refactoring. ToS acceptance
  recorded with timestamp + version.
- **Anti-sybil for free tier:** free-tier missions require holding ≥10k $SHINY (capital cost),
  device-fingerprint clustering flags, and per-cluster rate limits. Don't try to *prevent*
  sybils — make them unprofitable.

## Build checklist
- [ ] SIWS endpoints: nonce → verify → session
- [ ] Session middleware, refresh, logout, revoke-all
- [ ] Wallet linking + primary-wallet timelock flow
- [ ] complianceGate no-op middleware hook + ToS acceptance gating
- [ ] Fingerprint capture (FingerprintJS OSS or thumbmarkjs) + cluster flagging job
- [ ] Admin: user lookup, flag review, ban/freeze

## Claude Code prompt

```
In the trash-wars monorepo, implement wallet authentication and the account layer in services/api
+ apps/web.

BACKEND (services/api/src/modules/auth)
1. POST /auth/nonce {address} -> {nonce, message}. Build a SIWS-style message:
   domain, address, statement ("Sign in to Trash Wars"), nonce (crypto random, stored in Redis
   with 5 min TTL, single use), issuedAt. 
2. POST /auth/verify {address, signature} -> verifies ed25519 signature over the exact message
   (use tweetnacl), consumes nonce, upserts user+wallet, creates session row, sets httpOnly
   secure SameSite=Lax cookie (opaque session id, Redis-backed, 7d sliding expiry).
3. Session middleware decorating request.user; POST /auth/logout; POST /auth/logout-all.
4. Wallet linking: POST /wallets/link (same nonce flow, must be authed), 
   POST /wallets/primary {address} -> creates a pending change effective in 48h, requires a
   fresh signature from the CURRENT primary wallet; GET /me returns user, wallets, balances
   (via LedgerService), flags.
5. Compliance hook: implement a complianceGate(actions) middleware applied to deposit/play/
   withdraw routes that currently always allows, reads its decision from a pluggable provider
   interface (ComplianceProvider with check(user, action) -> allow|deny). A separate external
   system will implement this provider later — do NOT build any IP/geo logic here.
   ToS: POST /me/accept-tos {version}; playing endpoints require latest version accepted.
6. Anti-sybil: accept a client fingerprint hash on /auth/verify; store (user, fp_hash).
   Nightly BullMQ job clusters users sharing fp_hash with >3 accounts -> writes
   sybil_flags. Expose flags in GET /admin/users/:id (admin guard = role on users table).

FRONTEND (apps/web)
7. Wallet adapter setup (@solana/wallet-adapter-react, Phantom/Solflare/Backpack), a
   useAuth() hook implementing the nonce->sign->verify flow, session-aware layout,
   and a /login page. Fingerprint via thumbmarkjs computed client-side, sent on verify.

TESTS
- Signature verification rejects: wrong signer, expired nonce, replayed nonce, tampered message.
- Primary wallet change is inert for 48h and cancellable.
- complianceGate provider swap test: a deny-all stub provider blocks gated routes but allows /me.

Strict TS, zod schemas in packages/shared for all payloads.
```

## Acceptance criteria
- Login works with Phantom on devnet build; replay attacks fail in tests
- Withdrawal-address change provably timelocked
- complianceGate hook proven swappable via stub provider in tests
