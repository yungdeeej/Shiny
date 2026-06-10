/**
 * Server-seed encryption at rest: AES-256-GCM with a key derived from
 * SERVER_SEED_ENCRYPTION_KEY (sha256 of the env string). Payload format:
 * base64(iv) . base64(tag) . base64(ciphertext) joined with ".".
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function deriveKey(keyString: string): Buffer {
  return createHash("sha256").update(keyString).digest();
}

export function encryptSecret(plaintext: string, keyString: string): string {
  const key = deriveKey(keyString);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decryptSecret(payload: string, keyString: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("crypto: malformed payload");
  const key = deriveKey(keyString);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
