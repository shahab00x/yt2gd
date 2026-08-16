/**
 * Cryptography module for Pocketcoin/Bastyon key derivation, Base58Check, and signing.
 * Ported 1:1 from bastyon-poster-linux/src/crypto.py.
 *
 * Hashing (sha256/ripemd160) uses Node's built-in crypto; secp256k1 ECDSA uses
 * @noble/curves (pure JS, matches libsecp256k1 behavior incl. low-S signatures).
 */

import { createHash, randomBytes } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { MAINNET, TESTNET } from './constants.js';

// Standard Bitcoin Base58 alphabet
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export class CryptoError extends Error {}
export class InvalidKeyError extends CryptoError {}

/** Compute single SHA-256 hash. */
export function sha256(data) {
  return createHash('sha256').update(data).digest();
}

/** Compute double SHA-256 hash (Bitcoin hash256). */
export function hash256(data) {
  return sha256(sha256(data));
}

/** Compute RIPEMD-160 of SHA-256 (Bitcoin hash160). */
export function hash160(data) {
  return createHash('ripemd160').update(sha256(data)).digest();
}

/** Encode bytes to Base58 string. */
export function base58Encode(data) {
  let num = 0n;
  for (const byte of data) num = num * 256n + BigInt(byte);

  let res = '';
  while (num > 0n) {
    const mod = Number(num % 58n);
    num = num / 58n;
    res = BASE58_ALPHABET[mod] + res;
  }

  // Add leading '1's for leading zero bytes
  let nPad = 0;
  for (const byte of data) {
    if (byte === 0) nPad += 1;
    else break;
  }
  return BASE58_ALPHABET[0].repeat(nPad) + res;
}

/** Decode Base58 string to bytes. */
export function base58Decode(s) {
  let num = 0n;
  for (const char of s) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx === -1) throw new CryptoError(`Invalid Base58 character: '${char}'`);
    num = num * 58n + BigInt(idx);
  }

  let hexStr = num.toString(16);
  if (hexStr.length % 2 !== 0) hexStr = '0' + hexStr;
  const decoded = hexStr === '00' || hexStr === '' ? Buffer.alloc(0) : Buffer.from(hexStr, 'hex');

  // Count leading '1's
  let nPad = 0;
  for (const char of s) {
    if (char === BASE58_ALPHABET[0]) nPad += 1;
    else break;
  }
  return Buffer.concat([Buffer.alloc(nPad), decoded]);
}

/** Encode payload with 1-byte network prefix and 4-byte double-SHA256 checksum. */
export function base58checkEncode(payload, prefix) {
  const data = Buffer.concat([Buffer.from([prefix]), payload]);
  const checksum = hash256(data).subarray(0, 4);
  return base58Encode(Buffer.concat([data, checksum]));
}

/** Decode Base58Check string into { payload, prefix }, validating the checksum. */
export function base58checkDecode(s) {
  const raw = base58Decode(s);
  if (raw.length < 5) throw new CryptoError('Base58Check data too short');

  const data = raw.subarray(0, -4);
  const checksum = raw.subarray(-4);
  const expectedChecksum = hash256(data).subarray(0, 4);
  if (!checksum.equals(expectedChecksum)) {
    throw new CryptoError('Base58Check checksum validation failed');
  }

  return { payload: data.subarray(1), prefix: data[0] };
}

/**
 * Parse a WIF private key string.
 * Returns { privateKeyBytes, network, compressed }.
 */
export function parseWif(wif) {
  let data, prefix;
  try {
    ({ payload: data, prefix } = base58checkDecode(wif.trim()));
  } catch (e) {
    if (e instanceof CryptoError) throw new InvalidKeyError(`Failed to decode WIF key: ${e.message}`);
    throw e;
  }

  let network;
  if (prefix === MAINNET.wifPrefix) network = MAINNET;
  else if (prefix === TESTNET.wifPrefix) network = TESTNET;
  else {
    throw new InvalidKeyError(
      `Unknown WIF network prefix byte ${prefix} (0x${prefix.toString(16).padStart(2, '0')}). ` +
      `Expected ${MAINNET.wifPrefix} (Mainnet) or ${TESTNET.wifPrefix} (Testnet).`
    );
  }

  let privateKeyBytes, compressed;
  if (data.length === 33 && data[32] === 0x01) {
    privateKeyBytes = data.subarray(0, 32);
    compressed = true;
  } else if (data.length === 32) {
    privateKeyBytes = data;
    compressed = false;
  } else {
    throw new InvalidKeyError(`Invalid WIF payload length: ${data.length} bytes`);
  }

  return { privateKeyBytes, network, compressed };
}

/** Derive compressed or uncompressed public key from 32-byte private key. */
export function derivePubkey(privateKeyBytes, compressed = true) {
  return Buffer.from(secp256k1.getPublicKey(privateKeyBytes, compressed));
}

/** Convert public key bytes to Base58Check P2PKH address. */
export function pubkeyToAddress(pubkeyBytes, network) {
  const h160 = hash160(pubkeyBytes);
  return base58checkEncode(h160, network.pubkeyPrefix);
}

export class Account {
  constructor({ privateKeyBytes, publicKeyBytes, address, wif, network, compressed = true }) {
    this.privateKeyBytes = privateKeyBytes;
    this.publicKeyBytes = publicKeyBytes;
    this.address = address;
    this.wif = wif;
    this.network = network;
    this.compressed = compressed;
  }

  /** Instantiate Account from a WIF string. */
  static fromWif(wif, overrideNetwork = null) {
    const { privateKeyBytes, network, compressed } = parseWif(wif);
    const net = overrideNetwork || network;
    const publicKeyBytes = derivePubkey(privateKeyBytes, compressed);
    const address = pubkeyToAddress(publicKeyBytes, net);
    return new Account({ privateKeyBytes, publicKeyBytes, address, wif, network: net, compressed });
  }
}

/** Sign a 32-byte hash digest using secp256k1 ECDSA with DER encoding (low-S). */
export function signDigest(privateKeyBytes, digest) {
  return Buffer.from(secp256k1.sign(digest, privateKeyBytes, { format: 'der', prehash: false, lowS: true }));
}

/**
 * Sign a 32-byte digest and return the 64-byte compact (r || s) signature,
 * matching coincurve's `sign_recoverable(...)[:64]` used for PeerTube auth.
 */
export function signRecoverableCompact(privateKeyBytes, digest) {
  // @noble/curves 'recovered' format is [recoveryByte, r, s]; Python's is [r, s, recoveryByte].
  // Both put r||s contiguously — we return exactly the 64 r||s bytes.
  const rec = secp256k1.sign(digest, privateKeyBytes, { format: 'recovered', prehash: false, lowS: true });
  return Buffer.from(rec.subarray(1));
}
