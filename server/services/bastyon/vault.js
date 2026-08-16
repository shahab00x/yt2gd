/**
 * Passphrase vault for WIF private keys.
 *
 * Keys are encrypted at rest with AES-256-GCM. The AES key is derived from a
 * master passphrase via scrypt and lives ONLY in server process memory — it is
 * never written to disk, so a server restart returns the vault to a locked
 * state. GCM authentication means a wrong passphrase is detected (auth-tag
 * mismatch) instead of producing garbage plaintext.
 */

import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export class VaultLockedError extends Error {
  constructor() {
    super('Vault is locked. Enter the master passphrase to continue.');
    this.name = 'VaultLockedError';
  }
}

export class VaultUnlockError extends Error {
  constructor() {
    super('Wrong passphrase.');
    this.name = 'VaultUnlockError';
  }
}

const KEY_LENGTH = 32;   // AES-256
const SALT_LENGTH = 16;
const IV_LENGTH = 12;    // GCM standard
const TAG_LENGTH = 16;

let masterKey = null;    // Buffer | null — in-memory only
let activeSalt = null;   // salt used to derive the current key

/** Generate a random scrypt salt. */
export function randomSalt() {
  return randomBytes(SALT_LENGTH).toString('hex');
}

/** Derive a 32-byte AES key from a passphrase and salt (synchronous scrypt). */
export function deriveKey(passphrase, saltHex) {
  return scryptSync(passphrase, Buffer.from(saltHex, 'hex'), KEY_LENGTH);
}

/** Whether the vault currently holds a key in memory. */
export function isUnlocked() {
  return masterKey != null;
}

/**
 * Unlock the vault with a passphrase and the store's salt.
 * Does NOT verify the passphrase — callers verify by attempting to decrypt an
 * existing account (auth-tag mismatch => wrong passphrase).
 */
export function unlock(passphrase, saltHex) {
  masterKey = deriveKey(passphrase, saltHex);
  activeSalt = saltHex;
}

/** Clear the in-memory key. */
export function lock() {
  masterKey = null;
  activeSalt = null;
}

/**
 * Rotate to a new passphrase: derive a fresh key from a NEW random salt and
 * keep the vault unlocked with it. Returns the new salt (caller persists it
 * alongside the re-encrypted accounts).
 */
export function rotate(passphrase) {
  const newSalt = randomSalt();
  masterKey = deriveKey(passphrase, newSalt);
  activeSalt = newSalt;
  return newSalt;
}

/**
 * Encrypt a WIF private key string with the in-memory key.
 * Returns { iv, tag, ciphertext } (all hex). Throws VaultLockedError if locked.
 */
export function encryptWif(wif) {
  if (!masterKey) throw new VaultLockedError();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(wif, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
}

/**
 * Decrypt a WIF private key string. Throws VaultLockedError if locked, or
 * VaultUnlockError when the auth tag fails (wrong passphrase / corrupted data).
 */
export function decryptWif(encrypted) {
  if (!masterKey) throw new VaultLockedError();
  try {
    const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(encrypted.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'hex'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'hex')),
      decipher.final(),
    ]);
    return plaintext.toString('utf-8');
  } catch (e) {
    throw new VaultUnlockError();
  }
}
