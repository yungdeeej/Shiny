/** Character creation (guest starter / mint / raffle grant) and wire serialization. */
import { sha256Hex, makeRng } from "@trash-wars/economy";
import type { Character, CharacterStats, Faction } from "@trash-wars/shared";
import { characters } from "@trash-wars/db";
import type { AppContext } from "./context.js";
import { generateCharacterName } from "./names.js";

export type CharacterRow = typeof characters.$inferSelect;

const RACCOON_BASE: CharacterStats = { stealth: 1, muscle: 1, luck: 1, reputation: 0 };
const BLOODHOUND_BASE: CharacterStats = { stealth: 0, muscle: 0, luck: 0, reputation: 2 };

function rollBonusStats(faction: Faction, dna: string, points: number): CharacterStats {
  const base = { ...(faction === "bloodhound" ? BLOODHOUND_BASE : RACCOON_BASE) };
  const pool: (keyof CharacterStats)[] =
    faction === "bloodhound"
      ? ["reputation", "muscle", "stealth"]
      : ["stealth", "muscle", "luck"];
  const rng = makeRng(`stats:${dna}`);
  for (let i = 0; i < points; i++) {
    const key = pool[Math.floor(rng() * pool.length)] ?? pool[0]!;
    base[key] += 1;
  }
  return base;
}

export interface CreateCharacterOpts {
  ownerUserId: string;
  faction: Faction;
  /** Deterministic source for dna (orderId, userId, raffle grant key…). */
  dnaSeed: string;
  name?: string;
  /** Bonus stat points on top of the faction base (mints get 2; starters get 0). */
  bonusPoints?: number;
  mintNft?: boolean;
}

export async function createCharacter(
  ctx: AppContext,
  opts: CreateCharacterOpts,
): Promise<CharacterRow> {
  const dna = sha256Hex(opts.dnaSeed).slice(0, 16);
  const name = opts.name ?? generateCharacterName(dna);
  const stats = rollBonusStats(opts.faction, dna, opts.bonusPoints ?? 0);

  let nftMint: string | null = null;
  if (opts.mintNft) {
    const minted = await ctx.chain.mintCharacter({
      owner: opts.ownerUserId,
      name,
      faction: opts.faction,
      stats,
      uri: `trash-wars://character/${dna}`,
    });
    nftMint = minted.assetId;
  }

  const rows = await ctx.db
    .insert(characters)
    .values({
      ownerUserId: opts.ownerUserId,
      name,
      faction: opts.faction,
      level: 1,
      stats,
      dna,
      status: "idle",
      inGame: true,
      nftMint,
    })
    .returning();
  return rows[0]!;
}

export function characterToApi(row: CharacterRow): Character {
  return {
    id: row.id,
    name: row.name,
    faction: row.faction,
    level: row.level,
    stats: row.stats,
    status: row.status,
    stationedAt: row.stationedAt,
    jailedUntil: row.jailedUntil ? row.jailedUntil.toISOString() : null,
    nftMint: row.nftMint,
    inGame: row.inGame,
    lastClaimedAt: row.lastClaimedAt ? row.lastClaimedAt.toISOString() : null,
    dna: row.dna,
    cosmetics: row.cosmetics ?? [],
  };
}
