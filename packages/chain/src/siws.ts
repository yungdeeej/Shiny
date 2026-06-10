import nacl from "tweetnacl";
import bs58 from "bs58";

/** Sign-In With Solana message construction + verification (doc 04). */

export interface SiwsFields {
  domain: string;
  address: string;
  statement: string;
  nonce: string;
  issuedAt: string;
}

export function buildSiwsMessage(f: SiwsFields): string {
  return [
    `${f.domain} wants you to sign in with your Solana account:`,
    f.address,
    "",
    f.statement,
    "",
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
  ].join("\n");
}

/**
 * Verify an ed25519 signature over the exact SIWS message.
 * @param signature base58-encoded 64-byte signature
 * @param address   base58-encoded 32-byte ed25519 public key (the wallet)
 */
export function verifySiwsSignature(message: string, signature: string, address: string): boolean {
  try {
    const sig = bs58.decode(signature);
    const pub = bs58.decode(address);
    if (sig.length !== 64 || pub.length !== 32) return false;
    return nacl.sign.detached.verify(new TextEncoder().encode(message), sig, pub);
  } catch {
    return false;
  }
}

export function isValidSolanaAddress(address: string): boolean {
  try {
    return bs58.decode(address).length === 32;
  } catch {
    return false;
  }
}
