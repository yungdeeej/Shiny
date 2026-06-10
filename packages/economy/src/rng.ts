/**
 * Deterministic RNG + provably-fair primitives.
 *
 * Everything here is pure and isomorphic (browser + node): hashing is done with
 * @noble/hashes — never node:crypto.
 */
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

/** A uniform [0,1) generator. */
export type Rng = () => number;

/**
 * Human-readable description of the provably-fair roll derivation, published so a
 * verifier page can print exactly what to recompute.
 */
export const PROVABLY_FAIR_ALGORITHM =
  "commit = sha256(serverSeedHex) published before the mission starts. " +
  "After resolution the serverSeed is revealed. " +
  "roll derivation: mac = HMAC-SHA256(key = utf8(serverSeedHex), message = utf8(clientSeed + ':' + missionId)); " +
  "u64 = first 8 bytes of mac as a big-endian unsigned 64-bit integer; " +
  "roll = u64 / 2^64, evaluated at IEEE-754 double precision as Number(u64 >> 11) / 2^53, giving roll in [0, 1). " +
  "outcome = first row of the mission's effective probability table (in stored order) whose cumulative " +
  "probabilityBps exceeds floor(roll * 10000).";

/** sha256 of a UTF-8 string, hex-encoded. */
export function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}

/** splitmix32 — used only to expand a numeric seed into xoshiro state. */
function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return t >>> 0;
  };
}

/**
 * Seedable xoshiro128** PRNG. Returns a function yielding uniform doubles in [0,1).
 * String seeds are expanded via sha256; numeric seeds via splitmix32.
 * NOT for cryptographic use — missions use rollFromSeeds (HMAC) instead.
 */
export function makeRng(seed: number | string): Rng {
  let s0: number, s1: number, s2: number, s3: number;
  if (typeof seed === "string") {
    const h = sha256(utf8ToBytes(seed));
    const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
    s0 = dv.getUint32(0);
    s1 = dv.getUint32(4);
    s2 = dv.getUint32(8);
    s3 = dv.getUint32(12);
  } else {
    const sm = splitmix32(seed);
    s0 = sm();
    s1 = sm();
    s2 = sm();
    s3 = sm();
  }
  if ((s0 | s1 | s2 | s3) === 0) s0 = 0x9e3779b9; // all-zero state is degenerate

  const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

  return () => {
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    return result / 4294967296; // 2^32
  };
}

/**
 * 32 random bytes, hex-encoded (64 chars). Pass an entropy function (e.g. a seeded
 * Rng in the simulator) for determinism; defaults to the WebCrypto CSPRNG, which is
 * available in browsers and node >= 19 via globalThis.crypto.
 */
export function generateServerSeed(rng?: Rng): string {
  const bytes = new Uint8Array(32);
  if (rng) {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(rng() * 256) & 0xff;
  } else {
    const g = globalThis as { crypto?: { getRandomValues(b: Uint8Array): Uint8Array } };
    if (!g.crypto) throw new Error("no CSPRNG available: pass an entropy function to generateServerSeed");
    g.crypto.getRandomValues(bytes);
  }
  return bytesToHex(bytes);
}

/** The pre-mission commitment: sha256 of the (hex string) server seed. */
export function commitHash(serverSeed: string): string {
  return sha256Hex(serverSeed);
}

const TWO_53 = 9007199254740992; // 2^53

/**
 * Provably-fair roll in [0,1). See PROVABLY_FAIR_ALGORITHM for the exact derivation.
 * Deterministic given (serverSeed, clientSeed, missionId).
 */
export function rollFromSeeds(serverSeed: string, clientSeed: string, missionId: string): number {
  const mac = hmac(sha256, utf8ToBytes(serverSeed), utf8ToBytes(`${clientSeed}:${missionId}`));
  const dv = new DataView(mac.buffer, mac.byteOffset, mac.byteLength);
  const u64 = dv.getBigUint64(0, false); // big-endian, first 8 bytes
  // u64 / 2^64 at double precision: keep the top 53 bits so the result is strictly < 1.
  return Number(u64 >> 11n) / TWO_53;
}
