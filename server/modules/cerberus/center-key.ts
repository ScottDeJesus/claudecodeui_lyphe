import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { getCerberusDatabasePath } from '@/modules/database/index.js';

/**
 * Center's identity: one ed25519 key pair, minted the first time it is needed and kept for good.
 *
 * WHAT THE KEY IS FOR. Every frame center sends a warden is signed with it (`signText`), and the
 * certificate it hands a warden at enrollment carries its public half (`centerPublicKey`), which the
 * warden pins. A warden therefore trusts a frame because it verifies against the key it was given at
 * enrollment, never because of where the socket came from. The same key pair's counterpart for a
 * warden is checked the other way round (`verifyNodeSignature`), once, at the upgrade.
 *
 * WHERE IT LIVES. `CERBERUS_KEY_PATH`, else `cerberus-center.key` beside the store (the store's
 * directory, `getCerberusDatabasePath()`), as a PKCS8 PEM written `0600`. A server booted on a scratch
 * store therefore gets a scratch key, and live it is `~/.cloudcli/cerberus-center.key`.
 *
 * MINTED ONLY WHEN ABSENT. The file is created with the `wx` flag, so a key already on disk is never
 * overwritten — not by a second process of a handover that boots while the first is still starting,
 * and not by a restart. Losing the file would orphan every enrolled warden (they pin the old public
 * key), so the one write that could destroy it is refused at the filesystem.
 *
 * The private key never leaves this file: callers get signatures and the PUBLIC key only.
 */

const KEY_FILE_NAME = 'cerberus-center.key';

let centerPrivateKey: crypto.KeyObject | null = null;

function resolveKeyPath(): string {
  return process.env.CERBERUS_KEY_PATH || path.join(path.dirname(getCerberusDatabasePath()), KEY_FILE_NAME);
}

/**
 * Reads the key file and refuses anything that is not an ed25519 private key. A PEM of another type
 * (RSA, X25519) would parse, then sign the wrong thing or throw on the first `signText` — after an
 * enrollment had committed — so the file is judged here, at the load, and left untouched.
 */
function readKeyFile(keyPath: string): crypto.KeyObject {
  const key = crypto.createPrivateKey(fs.readFileSync(keyPath, 'utf8'));
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`the key is ${key.asymmetricKeyType ?? 'of an unknown type'}, not ed25519`);
  }
  return key;
}

/**
 * Reads center's private key from disk, minting and saving a fresh one when the file is absent.
 * Throws for a file that cannot be read or is not an ed25519 key, leaving it as it found it.
 * Idempotent: the key is read once per process and kept.
 *
 * Consumers: the cerberus module's `start()` (so a key that cannot be read or written fails the
 * boot loudly, not the first warden's enrollment) and, lazily, every function below.
 */
export function loadCenterKey(): crypto.KeyObject {
  if (centerPrivateKey) return centerPrivateKey;

  const keyPath = resolveKeyPath();
  try {
    centerPrivateKey = readKeyFile(keyPath);
    return centerPrivateKey;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`[Cerberus] could not read the center key at ${keyPath}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  try {
    fs.writeFileSync(keyPath, pem, { mode: 0o600, flag: 'wx' });
    console.log(`[Cerberus] minted a new center key at ${keyPath}`);
    centerPrivateKey = privateKey;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      console.error(`[Cerberus] could not write the center key at ${keyPath}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
    // Another process minted it between our read and our write: its key is THE key.
    centerPrivateKey = readKeyFile(keyPath);
  }
  return centerPrivateKey;
}

/**
 * Signs `text`'s UTF-8 bytes with center's key; answers the base64 signature. The warden verifies
 * over the same exact bytes, so callers sign the text they then send, never a re-serialisation.
 * Consumers: `warden-link.ts` (every frame, and the certificate of an enrollment).
 */
export function signText(text: string): string {
  return crypto.sign(null, Buffer.from(text, 'utf8'), loadCenterKey()).toString('base64');
}

/**
 * Center's public key as base64 SPKI DER — the `centerKey` of a certificate, which a warden pins.
 * Consumers: `warden-link.ts` (the certificate it issues).
 */
export function centerPublicKey(): string {
  return crypto.createPublicKey(loadCenterKey()).export({ type: 'spki', format: 'der' }).toString('base64');
}

/**
 * The fingerprint of a public key: sha256, in hex, of its SPKI DER bytes. Recorded on the node row
 * and in its certificate at enrollment.
 * Consumers: `warden-link.ts` (enrollment).
 */
export function fingerprintOf(publicKeyB64: string): string {
  return crypto.createHash('sha256').update(Buffer.from(publicKeyB64, 'base64')).digest('hex');
}

/**
 * Reads a public key a peer sent — base64 SPKI DER — and answers it in its canonical base64 form, or
 * null when it is not an ed25519 key. Canonical, so what is stored and fingerprinted is the DER bytes
 * themselves and not whichever spelling of base64 the peer happened to use.
 * Consumers: `warden-auth.ts` (the `X-Cerberus-Key` header of an enrollment).
 */
export function canonicalEd25519PublicKey(publicKeyB64: string): string | null {
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') return null;
    return key.export({ type: 'spki', format: 'der' }).toString('base64');
  } catch {
    // A header that is not a key is the peer's mistake, answered as "not a key" — not an event for the log.
    return null;
  }
}

/**
 * Whether `sigB64` is `publicKeyB64`'s signature of `text`'s UTF-8 bytes. Answers false — never
 * throws — for a malformed key or signature: the one caller turns every "no" into a 401.
 * Consumers: `warden-auth.ts` (a connect header's signature).
 */
export function verifyNodeSignature(publicKeyB64: string, text: string, sigB64: string): boolean {
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(text, 'utf8'), key, Buffer.from(sigB64, 'base64'));
  } catch (error) {
    // The stored key is ours and well formed, so this is rare; say so once it happens rather than
    // let a key that cannot verify look like a node that signs wrongly.
    console.warn(`[Cerberus] could not verify a signature: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
