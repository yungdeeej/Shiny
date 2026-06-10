import { describe, expect, it, vi } from "vitest";
import { DevnetChainProvider } from "./devnet.js";
import { createChainProvider, StubChainProvider } from "./provider.js";

const RPC_URL = "https://rpc.test";
const MINT = "So11111111111111111111111111111111111111112";
// Any 32-byte base58 strings work as ATAs for the provider's validation.
const HOT_ATA = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const MULTISIG_ATA = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const OWNER = "7VHUFJHWu2CuExkJcJrzhQPJ2oygupTWkL2A2For4BmE";

type RpcCall = { method: string; params: unknown[] };

function jsonRes(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/** fetchImpl that answers per JSON-RPC method and records calls. */
function mockRpc(handlers: Record<string, (params: unknown[]) => unknown>) {
  const calls: RpcCall[] = [];
  const fetchImpl = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    const req = JSON.parse(String((init as { body: string }).body)) as { method: string; params: unknown[] };
    calls.push({ method: req.method, params: req.params });
    const handler = handlers[req.method];
    if (!handler) return jsonRes({ error: { code: -32601, message: "method not found" } });
    return jsonRes({ result: handler(req.params) });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, mock: fetchImpl };
}

function tokenAccount(amount: string) {
  return { account: { data: { parsed: { info: { tokenAmount: { amount, decimals: 6 } } } } } };
}

describe("DevnetChainProvider.getShinyHolding", () => {
  it("sums token amounts across accounts into base-unit bigint", async () => {
    const { fetchImpl, calls } = mockRpc({
      getTokenAccountsByOwner: () => ({ value: [tokenAccount("1500000"), tokenAccount("2500000")] }),
    });
    const provider = new DevnetChainProvider({ rpcUrl: RPC_URL, shinyMint: MINT, fetchImpl });

    await expect(provider.getShinyHolding(OWNER)).resolves.toBe(4_000_000n);
    expect(calls[0]).toEqual({
      method: "getTokenAccountsByOwner",
      params: [OWNER, { mint: MINT }, { encoding: "jsonParsed" }],
    });
  });

  it("returns 0n when the owner has no token accounts", async () => {
    const { fetchImpl } = mockRpc({ getTokenAccountsByOwner: () => ({ value: [] }) });
    const provider = new DevnetChainProvider({ rpcUrl: RPC_URL, shinyMint: MINT, fetchImpl });
    await expect(provider.getShinyHolding(OWNER)).resolves.toBe(0n);
  });

  it("serves the 5-minute cache without re-hitting RPC, and refetches after TTL", async () => {
    let nowMs = 1_000_000;
    const { fetchImpl, mock } = mockRpc({
      getTokenAccountsByOwner: () => ({ value: [tokenAccount("777")] }),
    });
    const provider = new DevnetChainProvider({
      rpcUrl: RPC_URL,
      shinyMint: MINT,
      fetchImpl,
      now: () => nowMs,
    });

    await expect(provider.getShinyHolding(OWNER)).resolves.toBe(777n);
    await expect(provider.getShinyHolding(OWNER)).resolves.toBe(777n);
    expect(mock).toHaveBeenCalledTimes(1); // cache hit

    nowMs += 5 * 60 * 1000 + 1; // past TTL
    await expect(provider.getShinyHolding(OWNER)).resolves.toBe(777n);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("retries 3 times then fails closed (0n) and warns once", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const warn = vi.fn();
    const provider = new DevnetChainProvider({
      rpcUrl: RPC_URL,
      shinyMint: MINT,
      fetchImpl,
      retryBackoffMs: 1,
      logger: { warn },
    });

    await expect(provider.getShinyHolding(OWNER)).resolves.toBe(0n);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await expect(provider.getShinyHolding(OWNER)).resolves.toBe(0n);
    expect(warn).toHaveBeenCalledTimes(1); // warn-once

    // failures are not cached: a later successful RPC repopulates
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("recovers after a transient failure (retry within one call)", async () => {
    let attempt = 0;
    const fetchImpl = vi.fn(async () => {
      attempt += 1;
      if (attempt < 3) throw new Error("flaky");
      return jsonRes({ result: { value: [tokenAccount("42")] } });
    }) as unknown as typeof fetch;
    const provider = new DevnetChainProvider({ rpcUrl: RPC_URL, shinyMint: MINT, fetchImpl, retryBackoffMs: 1 });

    await expect(provider.getShinyHolding(OWNER)).resolves.toBe(42n);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("DevnetChainProvider.getReserves", () => {
  it("parses getTokenAccountBalance for both ATAs", async () => {
    const { fetchImpl, calls } = mockRpc({
      getTokenAccountBalance: (params) =>
        params[0] === HOT_ATA
          ? { value: { amount: "50000000000", decimals: 6 } }
          : { value: { amount: "700000000000", decimals: 6 } },
    });
    const provider = new DevnetChainProvider({
      rpcUrl: RPC_URL,
      shinyMint: MINT,
      depositAta: HOT_ATA,
      multisigAta: MULTISIG_ATA,
      fetchImpl,
    });

    await expect(provider.getReserves()).resolves.toEqual({
      hotWallet: 50_000_000_000n,
      multisig: 700_000_000_000n,
    });
    expect(calls.map((c) => c.params[0]).sort()).toEqual([HOT_ATA, MULTISIG_ATA].sort());
  });

  it("returns 0n for unset/placeholder ATAs without hitting RPC", async () => {
    const { fetchImpl, mock } = mockRpc({});
    const provider = new DevnetChainProvider({
      rpcUrl: RPC_URL,
      shinyMint: MINT,
      depositAta: "BETA-DEPOSIT", // placeholder, not a valid address
      fetchImpl,
    });
    await expect(provider.getReserves()).resolves.toEqual({ hotWallet: 0n, multisig: 0n });
    expect(mock).not.toHaveBeenCalled();
  });

  it("throws on persistent RPC failure (no fake healthy treasury)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    const provider = new DevnetChainProvider({
      rpcUrl: RPC_URL,
      shinyMint: MINT,
      depositAta: HOT_ATA,
      fetchImpl,
      retryBackoffMs: 1,
    });
    await expect(provider.getReserves()).rejects.toThrow("down");
  });

  it("surfaces JSON-RPC error envelopes as failures", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonRes({ error: { code: -32602, message: "could not find account" } }),
    ) as unknown as typeof fetch;
    const provider = new DevnetChainProvider({
      rpcUrl: RPC_URL,
      shinyMint: MINT,
      depositAta: HOT_ATA,
      fetchImpl,
      retryBackoffMs: 1,
    });
    await expect(provider.getReserves()).rejects.toThrow(/could not find account/);
  });
});

describe("DevnetChainProvider writes (simulated)", () => {
  it("returns DEVNET-SIM-tagged signatures and warns once", async () => {
    const warn = vi.fn();
    const { fetchImpl } = mockRpc({});
    const provider = new DevnetChainProvider({ rpcUrl: RPC_URL, shinyMint: MINT, fetchImpl, logger: { warn } });

    await expect(provider.payWithdrawal(OWNER, 1n)).resolves.toMatch(/^DEVNET-SIM-WD-/);
    await expect(provider.burnFromCustody(1n)).resolves.toMatch(/^DEVNET-SIM-BURN-/);
    await expect(provider.setStaked("a", true)).resolves.toMatch(/^DEVNET-SIM-STAKE-/);
    await expect(provider.burnAsset("a")).resolves.toMatch(/^DEVNET-SIM-DEATH-/);
    await expect(
      provider.syncAttributes("a", { stealth: 1, muscle: 1, luck: 1, reputation: 0, level: 2 }),
    ).resolves.toMatch(/^DEVNET-SIM-ATTR-/);
    const mint = await provider.mintCharacter({
      owner: OWNER,
      name: "Sly",
      faction: "raccoon",
      stats: { stealth: 1, muscle: 1, luck: 1, reputation: 0 },
      uri: "ipfs://x",
    });
    expect(mint.assetId).toMatch(/^DEVNET-SIM-ASSET-Sly-/);
    expect(mint.signature).toMatch(/^DEVNET-SIM-MINT-/);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("createChainProvider", () => {
  it("BETA_MODE=1 → stub (unchanged)", () => {
    expect(createChainProvider({ BETA_MODE: "1" })).toBeInstanceOf(StubChainProvider);
  });

  it("non-beta with RPC + mint → DevnetChainProvider", () => {
    const provider = createChainProvider({
      BETA_MODE: "0",
      SOLANA_RPC_URL: RPC_URL,
      SHINY_MINT: MINT,
      DEPOSIT_ADDRESS: HOT_ATA,
      MULTISIG_ATA,
    });
    expect(provider).toBeInstanceOf(DevnetChainProvider);
    expect(provider.cluster).toBe("devnet");
  });

  it("non-beta without config → helpful error", () => {
    expect(() => createChainProvider({ BETA_MODE: "0" })).toThrow(/SOLANA_RPC_URL \+ SHINY_MINT/);
  });
});
