/**
 * SolanaChainProvider — the REAL signing provider (devnet / mainnet-beta).
 *
 * This is the only place in the stack that holds private keys and submits
 * transactions. The API never signs: it reads chain + enqueues work, and this
 * provider (run inside services/worker) performs the writes.
 *
 * SPL money ($SHINY, 6 decimals): @solana/web3.js + @solana/spl-token.
 *   - payWithdrawal  → transferChecked from the hot-wallet ATA to dest ATA
 *   - burnFromCustody → burnChecked from the hot-wallet/custody ATA
 *
 * NFT characters (Metaplex Core): umi + mpl-core.
 *   - mintCharacter  → create an asset into the core collection with an
 *                      Attributes plugin + PermanentFreeze/Burn delegates
 *   - setStaked      → toggle the freeze delegate (in-wallet staking)
 *   - burnAsset      → permanent burn (character death)
 *   - syncAttributes → update the Attributes plugin after stat upgrades
 *
 * Every write: priority fee, confirm `finalized`, retry up to 3 attempts with a
 * fresh blockhash on each try. Secret bytes are NEVER logged.
 *
 * NOTE on mpl-core v1: calls that could not be exercised against a live RPC here
 * are tagged `// UNVERIFIED — devnet rehearsal`. They follow the documented v1
 * API but must be confirmed in the devnet custody rehearsal before mainnet.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmRawTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  createBurnCheckedInstruction,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
} from "@solana/spl-token";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  generateSigner,
  keypairIdentity,
  publicKey as umiPublicKey,
  type Umi,
  type Signer,
} from "@metaplex-foundation/umi";
import {
  create,
  update,
  updatePlugin,
  burn,
  fetchAsset,
} from "@metaplex-foundation/mpl-core";
import { setComputeUnitPrice } from "@metaplex-foundation/mpl-toolbox";
import bs58 from "bs58";
import type { CharacterStats, Faction } from "@trash-wars/shared";
import type { ChainProvider } from "@trash-wars/chain";
import type { SolanaProviderConfig } from "./config.js";

const SHINY_DECIMALS = 6;
const SEASON = 1;
const MAX_ATTEMPTS = 3;

export interface SolanaProviderDeps {
  /** Override the umi instance (tests). */
  umi?: Umi;
  /** Override the web3 connection (tests). */
  connection?: Connection;
  logger?: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void };
}

export class SolanaChainProvider implements ChainProvider {
  readonly cluster: "devnet" | "mainnet-beta";

  private readonly conn: Connection;
  private readonly umi: Umi;
  private readonly mint: PublicKey;
  private readonly hot: Keypair;
  private readonly mintAuthority: Keypair;
  private readonly umiMintAuthority: Signer;
  private readonly collection: string | undefined;
  private readonly priorityFee: number;
  private readonly log: SolanaProviderDeps["logger"];

  constructor(private readonly cfg: SolanaProviderConfig, deps: SolanaProviderDeps = {}) {
    this.cluster = cfg.rpcUrl.includes("devnet") || cfg.rpcUrl.includes("localhost")
      ? "devnet"
      : "mainnet-beta";
    this.conn = deps.connection ?? new Connection(cfg.rpcUrl, "finalized");
    this.mint = new PublicKey(cfg.shinyMint);
    this.hot = cfg.hotWallet;
    this.mintAuthority = cfg.mintAuthority;
    this.collection = cfg.coreCollection;
    this.priorityFee = cfg.priorityFeeMicroLamports;
    this.log = deps.logger;

    // umi signs core asset ops with the MINT authority (freeze/burn delegate +
    // update authority). The hot wallet pays SPL fees.
    if (deps.umi) {
      this.umi = deps.umi;
      this.umiMintAuthority = this.umi.identity;
    } else {
      this.umi = createUmi(cfg.rpcUrl);
      const kp = this.umi.eddsa.createKeypairFromSecretKey(this.mintAuthority.secretKey);
      this.umiMintAuthority = this.umi.payer; // placeholder, replaced below
      this.umi.use(keypairIdentity(kp));
      this.umiMintAuthority = this.umi.identity;
    }
  }

  /* ── SPL money ────────────────────────────────────────────────── */

  /** Hot-wallet $SHINY ATA. The custody account: tokens physically sit here. */
  private async hotAta(): Promise<PublicKey> {
    return getAssociatedTokenAddress(this.mint, this.hot.publicKey);
  }

  async getShinyHolding(address: string): Promise<bigint> {
    try {
      const ata = await getAssociatedTokenAddress(this.mint, new PublicKey(address));
      const acc = await getAccount(this.conn, ata);
      return acc.amount;
    } catch (err) {
      if (err instanceof TokenAccountNotFoundError || err instanceof TokenInvalidAccountOwnerError) {
        return 0n;
      }
      throw err;
    }
  }

  async getReserves(): Promise<{ hotWallet: bigint; multisig: bigint }> {
    const hotAta = await this.hotAta();
    let hotWallet = 0n;
    try {
      hotWallet = (await getAccount(this.conn, hotAta)).amount;
    } catch (err) {
      if (!(err instanceof TokenAccountNotFoundError)) throw err;
    }
    // Multisig is read by the API-side DevnetChainProvider from MULTISIG_ATA;
    // the worker provider only owns the hot wallet, so it reports 0 there and
    // proof-of-reserves on the API merges the multisig leg.
    return { hotWallet, multisig: 0n };
  }

  async payWithdrawal(destAddress: string, amount: bigint): Promise<string> {
    const dest = new PublicKey(destAddress);
    const fromAta = await this.hotAta();
    const toAta = await getAssociatedTokenAddress(this.mint, dest);

    return this.withRetry("payWithdrawal", async () => {
      const ixs = [this.priorityIx()];
      // Create the destination ATA if missing (idempotent — skip if it exists).
      if (!(await this.accountExists(toAta))) {
        ixs.push(
          createAssociatedTokenAccountInstruction(this.hot.publicKey, toAta, dest, this.mint),
        );
      }
      ixs.push(
        createTransferCheckedInstruction(
          fromAta,
          this.mint,
          toAta,
          this.hot.publicKey,
          amount,
          SHINY_DECIMALS,
        ),
      );
      return this.sendTx(ixs, [this.hot]);
    });
  }

  async burnFromCustody(amount: bigint): Promise<string> {
    const fromAta = await this.hotAta();
    return this.withRetry("burnFromCustody", async () => {
      const ixs = [
        this.priorityIx(),
        createBurnCheckedInstruction(
          fromAta,
          this.mint,
          this.hot.publicKey,
          amount,
          SHINY_DECIMALS,
        ),
      ];
      return this.sendTx(ixs, [this.hot]);
    });
  }

  /* ── NFT characters (Metaplex Core) ───────────────────────────── */

  async mintCharacter(args: {
    owner: string;
    name: string;
    faction: Faction;
    stats: CharacterStats;
    uri: string;
  }): Promise<{ assetId: string; signature: string }> {
    const asset = generateSigner(this.umi);
    const owner = umiPublicKey(args.owner);

    return this.withRetry("mintCharacter", async () => {
      // UNVERIFIED — devnet rehearsal: plugin array shape + Attributes plugin key +
      // collection field. The arg object is cast to the create() parameter type
      // because the exact plugin/collection shapes vary across mpl-core v1 minors
      // and cannot be exercised against a live RPC here.
      const createArgs = {
        asset,
        collection: this.collection
          ? { publicKey: umiPublicKey(this.collection) }
          : undefined,
        name: args.name,
        uri: args.uri,
        owner,
        authority: this.umiMintAuthority,
        plugins: [
          {
            type: "Attributes",
            attributeList: attributeList(args.faction, 1, args.stats),
          },
          // Mint authority retains permanent freeze + burn delegates so the
          // game can stake (freeze) and kill (burn) the asset later.
          { type: "PermanentFreezeDelegate", frozen: false },
          { type: "PermanentBurnDelegate" },
        ],
      } as unknown as Parameters<typeof create>[1];
      let builder = create(this.umi, createArgs);
      builder = builder.prepend(setComputeUnitPrice(this.umi, { microLamports: this.priorityFee }));
      const res = await builder.sendAndConfirm(this.umi, {
        confirm: { commitment: "finalized" },
      });
      return {
        assetId: asset.publicKey.toString(),
        signature: signatureToString(res.signature),
      };
    });
  }

  async setStaked(assetId: string, staked: boolean): Promise<string> {
    return this.withRetry("setStaked", async () => {
      // UNVERIFIED — devnet rehearsal: updatePlugin with PermanentFreezeDelegate.
      const builder = updatePlugin(this.umi, {
        asset: umiPublicKey(assetId),
        collection: this.collection ? umiPublicKey(this.collection) : undefined,
        plugin: { type: "PermanentFreezeDelegate", frozen: staked },
        authority: this.umiMintAuthority,
      } as unknown as Parameters<typeof updatePlugin>[1]).prepend(
        setComputeUnitPrice(this.umi, { microLamports: this.priorityFee }),
      );
      const res = await builder.sendAndConfirm(this.umi, { confirm: { commitment: "finalized" } });
      return signatureToString(res.signature);
    });
  }

  async burnAsset(assetId: string): Promise<string> {
    return this.withRetry("burnAsset", async () => {
      // UNVERIFIED — devnet rehearsal: burn requires fetching the asset first.
      const asset = await fetchAsset(this.umi, umiPublicKey(assetId));
      const builder = burn(this.umi, {
        asset,
        collection: this.collection ? umiPublicKey(this.collection) : undefined,
        authority: this.umiMintAuthority,
      } as unknown as Parameters<typeof burn>[1]).prepend(
        setComputeUnitPrice(this.umi, { microLamports: this.priorityFee }),
      );
      const res = await builder.sendAndConfirm(this.umi, { confirm: { commitment: "finalized" } });
      return signatureToString(res.signature);
    });
  }

  async syncAttributes(
    assetId: string,
    stats: CharacterStats & { level: number },
  ): Promise<string> {
    return this.withRetry("syncAttributes", async () => {
      // UNVERIFIED — devnet rehearsal: updatePlugin replaces the whole Attributes list.
      const faction: Faction = stats.reputation > stats.stealth ? "bloodhound" : "raccoon";
      const builder = updatePlugin(this.umi, {
        asset: umiPublicKey(assetId),
        collection: this.collection ? umiPublicKey(this.collection) : undefined,
        plugin: {
          type: "Attributes",
          attributeList: attributeList(faction, stats.level, stats),
        },
        authority: this.umiMintAuthority,
      } as unknown as Parameters<typeof updatePlugin>[1]).prepend(
        setComputeUnitPrice(this.umi, { microLamports: this.priorityFee }),
      );
      const res = await builder.sendAndConfirm(this.umi, { confirm: { commitment: "finalized" } });
      return signatureToString(res.signature);
    });
  }

  /* ── plumbing ─────────────────────────────────────────────────── */

  private priorityIx() {
    return ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.priorityFee });
  }

  private async accountExists(addr: PublicKey): Promise<boolean> {
    try {
      await getAccount(this.conn, addr);
      return true;
    } catch (err) {
      if (err instanceof TokenAccountNotFoundError || err instanceof TokenInvalidAccountOwnerError) {
        return false;
      }
      throw err;
    }
  }

  /** Build, sign with a fresh blockhash, submit, confirm finalized. */
  private async sendTx(
    ixs: Parameters<Transaction["add"]>[number][],
    signers: Keypair[],
  ): Promise<string> {
    const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash("finalized");
    const tx = new Transaction({
      feePayer: this.hot.publicKey,
      blockhash,
      lastValidBlockHeight,
    }).add(...ixs);
    tx.sign(...signers);
    const sig = await sendAndConfirmRawTransaction(this.conn, tx.serialize(), {
      commitment: "finalized",
    });
    return sig;
  }

  /** Retry up to MAX_ATTEMPTS; each attempt grabs a fresh blockhash internally. */
  private async withRetry<T>(op: string, fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        this.log?.warn({ op, attempt, err: String(err) }, "chain op attempt failed");
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(`${op} failed after ${MAX_ATTEMPTS} attempts: ${String(lastErr)}`);
  }
}

/** Attributes plugin payload: faction, level, and the four stats + season. */
function attributeList(
  faction: Faction,
  level: number,
  stats: CharacterStats,
): Array<{ key: string; value: string }> {
  return [
    { key: "faction", value: faction },
    { key: "level", value: String(level) },
    { key: "stealth", value: String(stats.stealth) },
    { key: "muscle", value: String(stats.muscle) },
    { key: "luck", value: String(stats.luck) },
    { key: "reputation", value: String(stats.reputation) },
    { key: "season", value: String(SEASON) },
  ];
}

/** umi signatures are Uint8Array; render the base58 string explorers expect. */
function signatureToString(sig: unknown): string {
  if (typeof sig === "string") return sig;
  if (sig instanceof Uint8Array) return bs58.encode(sig);
  return String(sig);
}
