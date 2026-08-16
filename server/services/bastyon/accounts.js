/**
 * Bastyon account store — name + encrypted WIF in data/bastyon-accounts.json.
 *
 * The plaintext WIF never touches disk, is never returned by an API, and is
 * never logged. Accounts are stored as AES-256-GCM ciphertext (see vault.js);
 * the master passphrase is held only in server memory.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Account, InvalidKeyError } from './crypto.js';
import * as vault from './vault.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../../../data');
const ACCOUNTS_PATH = join(DATA_DIR, 'bastyon-accounts.json');

export class AccountStoreError extends Error {}
export class DuplicateAccountError extends AccountStoreError {}

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

/** Load the raw store: { salt, accounts: [...] }. */
export function loadStore() {
  ensureDataDir();
  if (!existsSync(ACCOUNTS_PATH)) return { salt: '', accounts: [] };
  try {
    return JSON.parse(readFileSync(ACCOUNTS_PATH, 'utf-8'));
  } catch (e) {
    console.error('Failed to parse bastyon-accounts.json', e.message);
    return { salt: '', accounts: [] };
  }
}

function saveStore(store) {
  ensureDataDir();
  writeFileSync(ACCOUNTS_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

/** Public listing — id, name, timestamps only; never the WIF (or ciphertext). */
export function listAccounts() {
  return loadStore().accounts.map((a) => ({
    id: a.id,
    name: a.name,
    createdAt: a.createdAt,
  }));
}

/** Raw account record by id, or null. */
export function getAccountById(id) {
  return loadStore().accounts.find((a) => a.id === id) || null;
}

/** Decrypt an account's WIF (requires an unlocked vault). */
export function decryptAccountWif(account) {
  return vault.decryptWif(account.encryptedWif);
}

/**
 * Create an account: validate the WIF, derive the address, encrypt, persist.
 * Requires an unlocked vault.
 */
export function createAccount({ name, wif }) {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new AccountStoreError('Account name is required.');
  if (!wif) throw new AccountStoreError('WIF private key is required.');

  const store = loadStore();
  if (store.accounts.some((a) => a.name.toLowerCase() === cleanName.toLowerCase())) {
    throw new DuplicateAccountError(`An account named "${cleanName}" already exists.`);
  }

  // Validates checksum/prefix/length; throws InvalidKeyError
  const account = Account.fromWif(wif);
  const encryptedWif = vault.encryptWif(wif); // throws VaultLockedError when locked

  const record = {
    id: `acc_${Date.now()}_${randomUUID().slice(0, 8)}`,
    name: cleanName,
    encryptedWif,
    address: account.address,
    network: account.network.name,
    createdAt: Date.now(),
  };
  store.accounts.push(record);
  saveStore(store);
  return { id: record.id, name: record.name, createdAt: record.createdAt };
}

/** Remove an account by id (no decryption needed). Returns true if removed. */
export function deleteAccount(id) {
  const store = loadStore();
  const before = store.accounts.length;
  store.accounts = store.accounts.filter((a) => a.id !== id);
  if (store.accounts.length !== before) {
    saveStore(store);
    return true;
  }
  return false;
}

/** Persist the raw store (used by passphrase rotation re-encryption). */
export function saveStoreExposed(store) {
  saveStore(store);
}

export { InvalidKeyError };
