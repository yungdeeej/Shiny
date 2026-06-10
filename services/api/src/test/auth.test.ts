import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
// pnpm-isolated deps: reuse @trash-wars/chain's own copies for signing in tests.
// @ts-ignore tweetnacl ships no types for a direct file import
import nacl from "../../../../packages/chain/node_modules/tweetnacl/nacl-fast.js";
// @ts-ignore bs58 types only resolve via its package exports
import bs58 from "../../../../packages/chain/node_modules/bs58/src/esm/index.js";
import { TOS_VERSION } from "@trash-wars/shared";
import { buildTestApp, guest, as, userBalance, ledgerTotal } from "./helpers.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
});
afterAll(async () => {
  await app.close();
});

function keypair() {
  const kp = nacl.sign.keyPair();
  return {
    address: bs58.encode(kp.publicKey) as string,
    sign: (message: string) =>
      bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey)) as string,
  };
}

describe("guest auth (beta)", () => {
  it("grants faucet balance + a starter raccoon and auto-accepts ToS", async () => {
    const session = await guest(app, "trash_panda");
    expect(await userBalance(app, session.userId)).toBe(100_000_000_000n);

    const me = await app.inject(as(session, { method: "GET", url: "/me" }));
    expect(me.statusCode).toBe(200);
    expect(me.json().tosAcceptedVersion).toBe(TOS_VERSION);
    expect(me.json().balance).toBe("100000000000");

    const chars = await app.inject(as(session, { method: "GET", url: "/game/characters" }));
    expect(chars.statusCode).toBe(200);
    const list = chars.json();
    expect(list).toHaveLength(1);
    expect(list[0].faction).toBe("raccoon");
    expect(list[0].stats).toEqual({ stealth: 1, muscle: 1, luck: 1, reputation: 0 });
    expect(list[0].name).toBe("Sly trash_panda");

    expect(await ledgerTotal(app)).toBe(0n);
  });

  it("rejects duplicate handles with 409", async () => {
    await guest(app, "dupe_handle");
    const res = await app.inject({
      method: "POST",
      url: "/auth/guest",
      payload: { handle: "dupe_handle" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("HANDLE_TAKEN");
  });
});

describe("SIWS verify", () => {
  it("accepts a valid signature and creates a session + primary wallet", async () => {
    const kp = keypair();
    const nonceRes = await app.inject({
      method: "POST",
      url: "/auth/nonce",
      payload: { address: kp.address },
    });
    expect(nonceRes.statusCode).toBe(200);
    const { message } = nonceRes.json();
    expect(message).toContain("Sign in to Trash Wars");
    expect(message).toContain(kp.address);

    const verifyRes = await app.inject({
      method: "POST",
      url: "/auth/verify",
      payload: { address: kp.address, signature: kp.sign(message) },
    });
    expect(verifyRes.statusCode).toBe(200);
    const cookie = verifyRes.cookies[0]!;
    const me = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { [cookie.name]: cookie.value },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().wallets).toEqual([
      { address: kp.address, isPrimary: true, pendingPrimaryAt: null },
    ]);
    expect(me.json().handle).toBe(`racc_${kp.address.slice(0, 8)}`);
  });

  it("rejects the wrong signer", async () => {
    const kp = keypair();
    const intruder = keypair();
    const { message } = (
      await app.inject({ method: "POST", url: "/auth/nonce", payload: { address: kp.address } })
    ).json();
    const res = await app.inject({
      method: "POST",
      url: "/auth/verify",
      payload: { address: kp.address, signature: intruder.sign(message) },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a replayed nonce (single use)", async () => {
    const kp = keypair();
    const { message } = (
      await app.inject({ method: "POST", url: "/auth/nonce", payload: { address: kp.address } })
    ).json();
    const signature = kp.sign(message);
    const first = await app.inject({
      method: "POST",
      url: "/auth/verify",
      payload: { address: kp.address, signature },
    });
    expect(first.statusCode).toBe(200);
    const replay = await app.inject({
      method: "POST",
      url: "/auth/verify",
      payload: { address: kp.address, signature },
    });
    expect(replay.statusCode).toBe(401);
  });

  it("rejects a tampered message", async () => {
    const kp = keypair();
    const { message } = (
      await app.inject({ method: "POST", url: "/auth/nonce", payload: { address: kp.address } })
    ).json();
    const tampered = (message as string).replace("Trash Wars", "Cash Wars");
    const res = await app.inject({
      method: "POST",
      url: "/auth/verify",
      payload: { address: kp.address, signature: kp.sign(tampered) },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("beta faucet", () => {
  it("pays once then rate-limits to one claim per hour", async () => {
    const session = await guest(app, "faucet_racc");
    const first = await app.inject(as(session, { method: "POST", url: "/beta/faucet" }));
    expect(first.statusCode).toBe(200);
    expect(await userBalance(app, session.userId)).toBe(200_000_000_000n);
    const second = await app.inject(as(session, { method: "POST", url: "/beta/faucet" }));
    expect(second.statusCode).toBe(429);
  });
});
