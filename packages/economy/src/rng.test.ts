import { describe, expect, it } from "vitest";
import { commitHash, generateServerSeed, makeRng, rollFromSeeds, sha256Hex } from "./rng.js";

describe("makeRng (xoshiro128**)", () => {
  it("is deterministic for the same seed", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    for (let i = 0; i < 1_000; i++) expect(a()).toBe(b());
  });

  it("differs across seeds and supports string seeds", () => {
    const a = makeRng("season-one");
    const b = makeRng("season-two");
    const c = makeRng("season-one");
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    const seqC = Array.from({ length: 10 }, () => c());
    expect(seqA).toEqual(seqC);
    expect(seqA).not.toEqual(seqB);
  });

  it("emits uniform values in [0,1)", () => {
    const rng = makeRng(7);
    let sum = 0;
    for (let i = 0; i < 100_000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 100_000).toBeGreaterThan(0.49);
    expect(sum / 100_000).toBeLessThan(0.51);
  });
});

describe("provably fair primitives", () => {
  it("generateServerSeed yields 64 hex chars, deterministic under a seeded rng", () => {
    const s1 = generateServerSeed(makeRng(1));
    const s2 = generateServerSeed(makeRng(1));
    const s3 = generateServerSeed(makeRng(2));
    expect(s1).toMatch(/^[0-9a-f]{64}$/);
    expect(s1).toBe(s2);
    expect(s1).not.toBe(s3);
  });

  it("generateServerSeed works without an rng (WebCrypto)", () => {
    expect(generateServerSeed()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("commitHash matches sha256 of the seed", () => {
    const seed = generateServerSeed(makeRng(99));
    expect(commitHash(seed)).toBe(sha256Hex(seed));
    expect(commitHash(seed)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rollFromSeeds is deterministic and sensitive to every input", () => {
    const seed = "a".repeat(64);
    const r1 = rollFromSeeds(seed, "client-1", "mission-1");
    expect(rollFromSeeds(seed, "client-1", "mission-1")).toBe(r1);
    expect(rollFromSeeds(seed, "client-2", "mission-1")).not.toBe(r1);
    expect(rollFromSeeds(seed, "client-1", "mission-2")).not.toBe(r1);
    expect(rollFromSeeds("b".repeat(64), "client-1", "mission-1")).not.toBe(r1);
  });

  it("rollFromSeeds stays in [0,1)", () => {
    const rng = makeRng(5);
    for (let i = 0; i < 2_000; i++) {
      const roll = rollFromSeeds(generateServerSeed(rng), `c${i}`, `m${i}`);
      expect(roll).toBeGreaterThanOrEqual(0);
      expect(roll).toBeLessThan(1);
    }
  });
});
