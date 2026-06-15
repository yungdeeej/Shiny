/**
 * Idempotent schema DDL for Trash Wars.
 *
 * Because the beta supports PGlite (zero-docker) as well as node-postgres, migrations are a
 * single ordered list of idempotent statements (CREATE TABLE IF NOT EXISTS / exception-safe
 * DO blocks for CREATE TYPE) executed one-by-one by `migrateDb()` — PGlite's query protocol
 * runs one statement at a time, so we keep them as an array rather than one multi-statement
 * string. `SCHEMA_SQL` (the joined form) is exported for tooling/inspection.
 *
 * Keep this file in sync with src/schema.ts.
 */

const ENUMS: ReadonlyArray<[name: string, values: readonly string[]]> = [
  ["user_role", ["player", "admin"]],
  ["account_owner_type", ["user", "system"]],
  [
    "account_kind",
    [
      "game_balance",
      "treasury",
      "burn_pool",
      "pd_pool",
      "emissions_budget",
      "emissions_reserve",
      "mission_escrow",
      "withdrawals_payable",
      "onchain_reserve_mirror",
      "burned",
      "jackpot_pool",
    ],
  ],
  ["faction", ["raccoon", "bloodhound", "crow"]],
  ["character_status", ["idle", "on_mission", "jailed", "on_patrol", "listed", "dead"]],
  ["mission_state", ["active", "resolving", "resolved", "cancelled"]],
  [
    "mission_outcome",
    ["win", "jackpot", "nothing", "arrest", "confiscation", "rekt_items", "rekt_character"],
  ],
  ["deposit_state", ["pending", "finalized", "credited", "unattributed"]],
  ["withdrawal_state", ["queued", "review", "sent", "failed", "denied"]],
  ["mint_event_state", ["upcoming", "open", "soldout", "closed"]],
  ["mint_order_state", ["pending", "fulfilled", "failed_retry"]],
  ["cosmetic_slot", ["hat", "coat", "mask", "companion", "banner", "nameplate"]],
  ["cosmetic_rarity", ["common", "rare", "epic", "legendary"]],
  ["raffle_type", ["recruitment", "cosmetic"]],
  ["raffle_state", ["upcoming", "open", "drawing", "drawn"]],
  ["listing_kind", ["character", "cosmetic"]],
  ["listing_state", ["active", "sold", "delisted"]],
  ["jackpot_event_kind", ["seed", "win"]],
  ["pass_track", ["free", "premium"]],
  ["pass_reward_kind", ["cosmetic", "insurance_voucher", "raffle_fragments", "nameplate"]],
];

const enumStatements = ENUMS.map(
  ([name, values]) =>
    `DO $$ BEGIN CREATE TYPE "${name}" AS ENUM (${values
      .map((v) => `'${v}'`)
      .join(", ")}); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
);

/**
 * v1.1 enum extension for databases created before the value existed. The CREATE
 * TYPE above is swallowed on existing DBs (duplicate_object), so the new value
 * is added with ALTER TYPE ... ADD VALUE IF NOT EXISTS — itself idempotent, and
 * a no-op on fresh DBs where CREATE TYPE already included it. Kept as a plain
 * top-level statement (NOT inside a DO block): in a function/transaction context
 * some engines reject ALTER TYPE ADD VALUE and an exception handler would
 * silently skip the migration.
 */
const enumValueAdditions: readonly string[] = [
  `ALTER TYPE "account_kind" ADD VALUE IF NOT EXISTS 'jackpot_pool'`,
];

export const SCHEMA_STATEMENTS: readonly string[] = [
  ...enumStatements,
  ...enumValueAdditions,

  /* ── identity ── */
  `CREATE TABLE IF NOT EXISTS "users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "handle" text NOT NULL UNIQUE,
    "role" "user_role" NOT NULL DEFAULT 'player',
    "is_guest" boolean NOT NULL DEFAULT false,
    "tos_version" text,
    "feed_anonymous" boolean NOT NULL DEFAULT false,
    "frozen" boolean NOT NULL DEFAULT false,
    "current_tier" text NOT NULL DEFAULT 'none',
    "tier_grace_started_at" timestamptz,
    "tier_grace_target" text,
    "insurance_vouchers" integer NOT NULL DEFAULT 0,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
  )`,
  // v1.1 column additions for pre-existing databases (idempotent).
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "current_tier" text NOT NULL DEFAULT 'none'`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tier_grace_started_at" timestamptz`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tier_grace_target" text`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "insurance_vouchers" integer NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS "wallets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "address" text NOT NULL UNIQUE,
    "chain" text NOT NULL DEFAULT 'solana',
    "is_primary" boolean NOT NULL DEFAULT false,
    "pending_primary_at" timestamptz
  )`,
  `CREATE TABLE IF NOT EXISTS "sessions" (
    "id" text PRIMARY KEY,
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "fingerprint_hash" text,
    "expires_at" timestamptz NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,

  /* ── ledger ── */
  `CREATE TABLE IF NOT EXISTS "accounts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "owner_type" "account_owner_type" NOT NULL,
    "owner_id" uuid,
    "kind" "account_kind" NOT NULL,
    "currency" text NOT NULL DEFAULT 'SHINY',
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,
  // Uniqueness: per-owner accounts are unique on (owner_id, kind); system singletons
  // (owner_id IS NULL) are unique on kind alone. Both via partial unique indexes.
  `CREATE UNIQUE INDEX IF NOT EXISTS "accounts_owner_kind_uq"
     ON "accounts" ("owner_id", "kind") WHERE "owner_id" IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "accounts_system_singleton_uq"
     ON "accounts" ("kind") WHERE "owner_type" = 'system' AND "owner_id" IS NULL`,
  // Parent table for logical double-entry transactions: one idempotency_key covers all
  // 2+ legs of a logical txn, so the UNIQUE lives here, not on the entries.
  `CREATE TABLE IF NOT EXISTS "ledger_txns" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "idempotency_key" text NOT NULL UNIQUE,
    "ref_type" text,
    "ref_id" text,
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "ledger_entries" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "txn_id" uuid NOT NULL REFERENCES "ledger_txns"("id"),
    "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
    "delta" bigint NOT NULL,
    "currency" text NOT NULL DEFAULT 'SHINY',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "ledger_entries_delta_nonzero" CHECK ("delta" <> 0)
  )`,
  `CREATE INDEX IF NOT EXISTS "ledger_entries_account_idx" ON "ledger_entries" ("account_id")`,
  `CREATE INDEX IF NOT EXISTS "ledger_entries_txn_idx" ON "ledger_entries" ("txn_id")`,

  /* ── world / game ── */
  `CREATE TABLE IF NOT EXISTS "locations" (
    "slug" text PRIMARY KEY,
    "name" text NOT NULL,
    "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "enabled" boolean NOT NULL DEFAULT true
  )`,
  `CREATE TABLE IF NOT EXISTS "characters" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "owner_user_id" uuid NOT NULL REFERENCES "users"("id"),
    "nft_mint" text,
    "name" text NOT NULL,
    "faction" "faction" NOT NULL,
    "level" integer NOT NULL DEFAULT 1,
    "stats" jsonb NOT NULL,
    "dna" text NOT NULL,
    "status" "character_status" NOT NULL DEFAULT 'idle',
    "stationed_at" text,
    "jailed_until" timestamptz,
    "in_game" boolean NOT NULL DEFAULT true,
    "last_claimed_at" timestamptz,
    "cosmetics" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "missions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "character_id" uuid REFERENCES "characters"("id"),
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "location_slug" text NOT NULL REFERENCES "locations"("slug"),
    "stake" bigint NOT NULL,
    "state" "mission_state" NOT NULL DEFAULT 'active',
    "server_seed_hash" text NOT NULL,
    "server_seed_enc" text,
    "client_seed" text NOT NULL,
    "effective_table" jsonb NOT NULL,
    "insurance" boolean NOT NULL DEFAULT false,
    "bribed" boolean NOT NULL DEFAULT false,
    "free_tier" boolean NOT NULL DEFAULT false,
    "started_at" timestamptz NOT NULL DEFAULT now(),
    "resolves_at" timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "missions_user_idx" ON "missions" ("user_id")`,
  `CREATE INDEX IF NOT EXISTS "missions_state_resolves_idx" ON "missions" ("state", "resolves_at")`,
  `CREATE TABLE IF NOT EXISTS "mission_outcomes" (
    "mission_id" uuid PRIMARY KEY REFERENCES "missions"("id"),
    "outcome" "mission_outcome" NOT NULL,
    "payout" bigint NOT NULL,
    "server_seed" text NOT NULL,
    "roll" double precision NOT NULL,
    "detail" jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "patrols" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "character_id" uuid NOT NULL REFERENCES "characters"("id"),
    "location_slug" text NOT NULL,
    "weight" double precision NOT NULL,
    "shift_start" timestamptz NOT NULL,
    "shift_end" timestamptz NOT NULL,
    "active" boolean NOT NULL DEFAULT true
  )`,

  /* ── bank ── */
  `CREATE TABLE IF NOT EXISTS "deposits" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid REFERENCES "users"("id"),
    "tx_sig" text NOT NULL UNIQUE,
    "amount" bigint NOT NULL,
    "state" "deposit_state" NOT NULL DEFAULT 'pending',
    "memo" text,
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "deposit_memos" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "memo" text NOT NULL UNIQUE,
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "withdrawals" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "amount" bigint NOT NULL,
    "fee" bigint NOT NULL,
    "dest_address" text NOT NULL,
    "state" "withdrawal_state" NOT NULL DEFAULT 'queued',
    "tx_sig" text,
    "reason" text,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "processed_at" timestamptz
  )`,

  /* ── mint ── */
  `CREATE TABLE IF NOT EXISTS "mint_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "faction" "faction" NOT NULL,
    "price" bigint NOT NULL,
    "supply" integer NOT NULL,
    "remaining" integer NOT NULL,
    "opens_at" timestamptz NOT NULL,
    "closes_at" timestamptz NOT NULL,
    "state" "mint_event_state" NOT NULL DEFAULT 'upcoming'
  )`,
  `CREATE TABLE IF NOT EXISTS "mint_orders" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "event_id" uuid NOT NULL REFERENCES "mint_events"("id"),
    "state" "mint_order_state" NOT NULL DEFAULT 'pending',
    "character_id" uuid,
    "idempotency_key" text NOT NULL UNIQUE,
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,

  /* ── cosmetics / raffles / marketplace ── */
  `CREATE TABLE IF NOT EXISTS "cosmetic_items" (
    "slug" text PRIMARY KEY,
    "name" text NOT NULL,
    "slot" "cosmetic_slot" NOT NULL,
    "rarity" "cosmetic_rarity" NOT NULL,
    "price_shiny" bigint,
    "price_sol" double precision,
    "supply_cap" integer,
    "sold" integer NOT NULL DEFAULT 0,
    "season" integer NOT NULL,
    "description" text NOT NULL,
    "art_uri" text
  )`,
  `CREATE TABLE IF NOT EXISTS "user_cosmetics" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "item_slug" text NOT NULL REFERENCES "cosmetic_items"("slug"),
    "equipped_character_id" uuid,
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "raffles" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "type" "raffle_type" NOT NULL,
    "title" text NOT NULL,
    "prize" jsonb NOT NULL,
    "ticket_price" bigint NOT NULL,
    "max_tickets" integer,
    "opens_at" timestamptz NOT NULL,
    "draws_at" timestamptz NOT NULL,
    "server_seed_hash" text NOT NULL,
    "server_seed" text,
    "state" "raffle_state" NOT NULL DEFAULT 'upcoming',
    "winners" jsonb
  )`,
  `CREATE TABLE IF NOT EXISTS "raffle_tickets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "raffle_id" uuid NOT NULL REFERENCES "raffles"("id"),
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "count" integer NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "login_fragments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "day" date NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "login_fragments_user_day_uq" UNIQUE ("user_id", "day")
  )`,
  `CREATE TABLE IF NOT EXISTS "listings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "seller_id" uuid NOT NULL REFERENCES "users"("id"),
    "kind" "listing_kind" NOT NULL,
    "ref_id" uuid NOT NULL,
    "price" bigint NOT NULL,
    "state" "listing_state" NOT NULL DEFAULT 'active',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "sold_at" timestamptz,
    "buyer_id" uuid
  )`,

  /* ── ops / telemetry ── */
  `CREATE TABLE IF NOT EXISTS "sybil_flags" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "cluster_key" text NOT NULL,
    "severity" text NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "reserves_snapshots" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "at" timestamptz NOT NULL DEFAULT now(),
    "onchain_hot" bigint NOT NULL,
    "onchain_multisig" bigint NOT NULL,
    "liabilities" bigint NOT NULL,
    "healthy" boolean NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "config_kv" (
    "key" text PRIMARY KEY,
    "value" jsonb NOT NULL,
    "updated_at" timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "pending_changes" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "key" text NOT NULL,
    "value" jsonb NOT NULL,
    "effective_at" timestamptz NOT NULL,
    "applied" boolean NOT NULL DEFAULT false
  )`,
  `CREATE TABLE IF NOT EXISTS "pd_distributions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "day" date NOT NULL UNIQUE,
    "pool_snapshot" bigint NOT NULL,
    "distributed" bigint NOT NULL,
    "recipients" integer NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "incidents" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "kind" text NOT NULL,
    "severity" text NOT NULL,
    "detail" jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "resolved" boolean NOT NULL DEFAULT false
  )`,
  `CREATE TABLE IF NOT EXISTS "audit_log" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "actor" text NOT NULL,
    "action" text NOT NULL,
    "detail" jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,
  /* ── v1.1 launch scope: jackpot / street cred / season pass ── */
  `CREATE TABLE IF NOT EXISTS "jackpot_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "kind" "jackpot_event_kind" NOT NULL,
    "mission_id" uuid,
    "user_id" uuid,
    "amount" bigint NOT NULL,
    "pool_after" bigint NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "tier_snapshots" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "wallet" text,
    "balance" bigint NOT NULL,
    "tier" text NOT NULL,
    "snapshotted_at" timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "tier_snapshots_user_idx" ON "tier_snapshots" ("user_id")`,
  `CREATE TABLE IF NOT EXISTS "tier_definitions" (
    "tier" text PRIMARY KEY,
    "min_balance" bigint NOT NULL,
    "perks" jsonb NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "season_passes" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "season" integer NOT NULL,
    "premium" boolean NOT NULL DEFAULT false,
    "purchased_at" timestamptz NOT NULL DEFAULT now(),
    "tx_sig" text,
    CONSTRAINT "season_passes_user_season_uq" UNIQUE ("user_id", "season")
  )`,
  `CREATE TABLE IF NOT EXISTS "pass_progress" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "season" integer NOT NULL,
    "xp" integer NOT NULL DEFAULT 0,
    "level" integer NOT NULL DEFAULT 0,
    CONSTRAINT "pass_progress_user_season_uq" UNIQUE ("user_id", "season")
  )`,
  `CREATE TABLE IF NOT EXISTS "pass_challenges" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "season" integer NOT NULL,
    "week" integer NOT NULL,
    "slug" text NOT NULL UNIQUE,
    "description" text NOT NULL,
    "kind" text NOT NULL,
    "ref_slug" text,
    "target" integer NOT NULL,
    "xp" integer NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "pass_challenge_progress" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "challenge_id" uuid NOT NULL REFERENCES "pass_challenges"("id"),
    "progress" integer NOT NULL DEFAULT 0,
    "completed_at" timestamptz,
    CONSTRAINT "pass_challenge_progress_user_challenge_uq" UNIQUE ("user_id", "challenge_id")
  )`,
  `CREATE TABLE IF NOT EXISTS "pass_rewards" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "season" integer NOT NULL,
    "level" integer NOT NULL,
    "track" "pass_track" NOT NULL,
    "kind" "pass_reward_kind" NOT NULL,
    "ref_slug" text,
    "amount" integer,
    CONSTRAINT "pass_rewards_season_level_track_uq" UNIQUE ("season", "level", "track")
  )`,
  `CREATE TABLE IF NOT EXISTS "pass_claims" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "reward_id" uuid NOT NULL REFERENCES "pass_rewards"("id"),
    "claimed_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "pass_claims_user_reward_uq" UNIQUE ("user_id", "reward_id")
  )`,
  `CREATE TABLE IF NOT EXISTS "raffle_weekly_grants" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "week" text NOT NULL,
    "raffle_id" uuid NOT NULL REFERENCES "raffles"("id"),
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "raffle_weekly_grants_user_week_uq" UNIQUE ("user_id", "week")
  )`,

  /* ── SOL payment rail (doc 11 §SOL): off-ledger receipts, idempotent on tx_sig ── */
  `CREATE TABLE IF NOT EXISTS "sol_payments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tx_sig" text NOT NULL UNIQUE,
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "product" text NOT NULL,
    "ref" text NOT NULL,
    "reference" text NOT NULL,
    "lamports" bigint NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS "feed_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "type" text NOT NULL,
    "location_slug" text,
    "actor" text,
    "multiplier_bps" integer,
    "amount_band" text,
    "message" text NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "feed_events_created_idx" ON "feed_events" ("created_at")`,
];

/** Full schema as one SQL string (for inspection/tooling). Execution uses SCHEMA_STATEMENTS. */
export const SCHEMA_SQL: string = SCHEMA_STATEMENTS.join(";\n\n") + ";\n";
