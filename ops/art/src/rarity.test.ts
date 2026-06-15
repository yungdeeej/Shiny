import { describe, expect, it } from "vitest";
import { makeRng } from "@trash-wars/economy";
import { pickTraits, rarityTier, statBands, traitHash, rollStats } from "./rarity.js";
import { composeCharacter } from "./compose.js";

describe("rarity engine", () => {
  it("pickTraits is deterministic for a given seed", () => {
    const a = pickTraits("raccoon", makeRng("seed:1"));
    const b = pickTraits("raccoon", makeRng("seed:1"));
    expect(a).toEqual(b);
  });

  it("fills every slot for each faction", () => {
    const rac = pickTraits("raccoon", makeRng("r"));
    expect(Object.keys(rac).sort()).toEqual(
      ["accessory", "background", "expression", "eyes", "fur", "headwear", "neckwear"].sort(),
    );
    const hound = pickTraits("bloodhound", makeRng("h"));
    expect(Object.keys(hound).sort()).toEqual(
      ["background", "coat", "collar", "ears", "expression", "eyes", "headwear", "jowls"].sort(),
    );
  });

  it("rarity tiers are one of the four buckets", () => {
    const rng = makeRng("tiers");
    for (let i = 0; i < 200; i++) {
      const sel = pickTraits("raccoon", rng);
      expect(["common", "rare", "epic", "legendary"]).toContain(rarityTier("raccoon", sel));
    }
  });

  it("the distribution is common-heavy (curve sanity)", () => {
    const rng = makeRng("dist");
    const counts: Record<string, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    const N = 3000;
    for (let i = 0; i < N; i++) {
      const f = rng() < 0.12 ? "bloodhound" : "raccoon";
      counts[rarityTier(f, pickTraits(f, rng))]!++;
    }
    expect(counts.common! / N).toBeGreaterThan(0.45);
    expect(counts.legendary! / N).toBeLessThan(0.1);
    expect(counts.common!).toBeGreaterThan(counts.rare!);
  });

  it("statBands honor doc-07 (rarity sets bands; raccoons have no reputation)", () => {
    expect(statBands("raccoon", "common").stealth).toEqual([1, 2]);
    expect(statBands("raccoon", "legendary").stealth).toEqual([3, 5]);
    expect(statBands("raccoon", "epic").reputation).toEqual([0, 0]);
    expect(statBands("bloodhound", "legendary").reputation).toEqual([3, 5]);
  });

  it("rolled base stats fall within their bands", () => {
    const rng = makeRng("stats");
    const bands = statBands("bloodhound", "epic");
    for (let i = 0; i < 100; i++) {
      const s = rollStats(bands, rng);
      expect(s.stealth).toBeGreaterThanOrEqual(bands.stealth[0]);
      expect(s.stealth).toBeLessThanOrEqual(bands.stealth[1]);
      expect(s.reputation).toBeGreaterThanOrEqual(bands.reputation[0]);
    }
  });

  it("traitHash is stable + faction-scoped", () => {
    const sel = pickTraits("raccoon", makeRng("hash"));
    expect(traitHash("raccoon", sel)).toEqual(traitHash("raccoon", sel));
    expect(traitHash("raccoon", sel)).toMatch(/^raccoon\|/);
  });
});

describe("compose", () => {
  it("composeCharacter yields a self-contained 2048 svg", () => {
    const sel = pickTraits("raccoon", makeRng("c"));
    const svg = composeCharacter("raccoon", sel, { tint: "#FFB627" });
    expect(svg).toContain('width="2048"');
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("is deterministic given the same tint + selection", () => {
    const sel = pickTraits("bloodhound", makeRng("d"));
    const a = composeCharacter("bloodhound", sel, { tint: "#4D9DE0" });
    const b = composeCharacter("bloodhound", sel, { tint: "#4D9DE0" });
    expect(a).toEqual(b);
  });
});
