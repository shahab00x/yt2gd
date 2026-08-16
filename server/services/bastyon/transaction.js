/**
 * Bitcoin/Pocketcoin transaction builder, script generation, signing, and serialization.
 * Ported 1:1 from bastyon-poster-linux/src/transaction.py
 */

import { DUST_THRESHOLD, DEFAULT_FEE } from './constants.js';
import { base58checkDecode, hash256, signDigest } from './crypto.js';
import { computeContentHash, serializePayload } from './payload.js';

export class TransactionError extends Error {}
export class InsufficientFundsError extends TransactionError {}

export class UTXO {
  constructor({ txid, vout, amount, scriptPubkey = '', confirmations = 1 }) {
    this.txid = txid;                    // TxID hex string (big-endian display format)
    this.vout = vout;                    // Output index
    this.amount = amount;                // Satoshis (int)
    this.scriptPubkey = scriptPubkey;    // Hex locking script
    this.confirmations = confirmations;
  }
}

export class TxInput {
  constructor({ txidHex, vout, scriptSig = Buffer.alloc(0), sequence = 0xffffffff }) {
    this.txidHex = txidHex;
    this.vout = vout;
    this.scriptSig = scriptSig;
    this.sequence = sequence;
  }
}

export class TxOutput {
  constructor({ amount, scriptPubkey }) {
    this.amount = amount;              // Satoshis
    this.scriptPubkey = scriptPubkey;  // Raw scriptPubKey bytes
  }
}

export class Transaction {
  constructor({ version = 1, ntime = 0, inputs = [], outputs = [], locktime = 0 } = {}) {
    this.version = version;
    this.ntime = ntime;
    this.inputs = inputs;
    this.outputs = outputs;
    this.locktime = locktime;
  }
}

export class SignedTransaction {
  constructor({ rawHex, txid, payloadJson }) {
    this.rawHex = rawHex;
    this.txid = txid;
    this.payloadJson = payloadJson;
  }
}

/** Encode an integer as Bitcoin CompactSize / VarInt bytes. */
export function encodeVarint(n) {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {
    const b = Buffer.alloc(3);
    b[0] = 0xfd;
    b.writeUInt16LE(n, 1);
    return b;
  }
  if (n <= 0xffffffff) {
    const b = Buffer.alloc(5);
    b[0] = 0xfe;
    b.writeUInt32LE(n, 1);
    return b;
  }
  const b = Buffer.alloc(9);
  b[0] = 0xff;
  b.writeBigUInt64LE(BigInt(n), 1);
  return b;
}

/** Encode bytes as Bitcoin script pushdata. */
export function pushData(data) {
  const length = data.length;
  if (length < 0x4c) return Buffer.concat([Buffer.from([length]), data]);
  if (length <= 0xff) return Buffer.concat([Buffer.from([0x4c, length]), data]);
  if (length <= 0xffff) {
    const b = Buffer.alloc(3);
    b[0] = 0x4d;
    b.writeUInt16LE(length, 1);
    return Buffer.concat([b, data]);
  }
  const b = Buffer.alloc(5);
  b[0] = 0x4e;
  b.writeUInt32LE(length, 1);
  return Buffer.concat([b, data]);
}

/**
 * Construct OP_RETURN scriptPubKey bytes.
 * Script format: OP_RETURN (0x6a) | PUSH(tx_type_str) | PUSH(content_hash)
 */
export function buildOpReturnScript(txTypeStr, contentHash) {
  const opReturn = Buffer.from([0x6a]);
  const pushType = pushData(Buffer.from(txTypeStr, 'utf-8'));
  const pushHash = pushData(contentHash);
  return Buffer.concat([opReturn, pushType, pushHash]);
}

/**
 * Construct standard P2PKH locking script from Base58Check address.
 * OP_DUP (0x76) OP_HASH160 (0xa9) PUSH20 (0x14) <20-byte-hash160> OP_EQUALVERIFY (0x88) OP_CHECKSIG (0xac)
 */
export function buildP2pkhScript(address) {
  const { payload: pubkeyHash } = base58checkDecode(address);
  if (pubkeyHash.length !== 20) {
    throw new TransactionError(`Invalid pubkey hash length for address ${address}: ${pubkeyHash.length} bytes`);
  }
  return Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), pubkeyHash, Buffer.from([0x88, 0xac])]);
}

/**
 * Select UTXOs to cover required_amount satoshis.
 * Returns { selected, total }.
 */
export function selectUtxos(utxos, requiredAmount) {
  const confirmed = utxos.filter((u) => u.confirmations >= 1).sort((a, b) => b.amount - a.amount);

  const selected = [];
  let total = 0;
  for (const u of confirmed) {
    selected.push(u);
    total += u.amount;
    if (total >= requiredAmount) break;
  }

  if (total < requiredAmount) {
    throw new InsufficientFundsError(
      `Insufficient balance. Required: ${requiredAmount} satoshis, Available: ${total} satoshis.`
    );
  }
  return { selected, total };
}

/** Serialize Transaction object into binary raw transaction format. */
export function serializeTransaction(tx) {
  const chunks = [];

  const version = Buffer.alloc(4);
  version.writeUInt32LE(tx.version >>> 0, 0);
  chunks.push(version);

  const ntime = Buffer.alloc(4);
  ntime.writeUInt32LE((tx.ntime >>> 0), 0);
  chunks.push(ntime);

  chunks.push(encodeVarint(tx.inputs.length));
  for (const inp of tx.inputs) {
    // Prev txid is stored in little-endian (reversed hex)
    chunks.push(Buffer.from(inp.txidHex, 'hex').reverse());
    const vout = Buffer.alloc(4);
    vout.writeUInt32LE(inp.vout >>> 0, 0);
    chunks.push(vout);
    chunks.push(encodeVarint(inp.scriptSig.length));
    chunks.push(inp.scriptSig);
    const seq = Buffer.alloc(4);
    seq.writeUInt32LE(inp.sequence >>> 0, 0);
    chunks.push(seq);
  }

  chunks.push(encodeVarint(tx.outputs.length));
  for (const out of tx.outputs) {
    const amount = Buffer.alloc(8);
    amount.writeBigUInt64LE(BigInt(out.amount), 0);
    chunks.push(amount);
    chunks.push(encodeVarint(out.scriptPubkey.length));
    chunks.push(out.scriptPubkey);
  }

  const locktime = Buffer.alloc(4);
  locktime.writeUInt32LE(tx.locktime >>> 0, 0);
  chunks.push(locktime);

  return Buffer.concat(chunks);
}

/** Compute Transaction ID (txid) as reversed hex string of Double-SHA256 binary tx. */
export function computeTxid(rawTxBytes) {
  const h = hash256(rawTxBytes);
  return Buffer.from(h).reverse().toString('hex');
}

/**
 * Compute 32-byte SIGHASH digest for a given input index using legacy Bitcoin P2PKH sighash rules.
 */
export function computeSighash(tx, inputIndex, utxoScriptPubkey, sighashType = 1) {
  const txCopy = new Transaction({
    version: tx.version,
    ntime: tx.ntime,
    inputs: tx.inputs.map((inp, idx) => new TxInput({
      txidHex: inp.txidHex,
      vout: inp.vout,
      scriptSig: idx === inputIndex ? utxoScriptPubkey : Buffer.alloc(0),
      sequence: inp.sequence,
    })),
    outputs: tx.outputs.map((out) => new TxOutput({ amount: out.amount, scriptPubkey: out.scriptPubkey })),
    locktime: tx.locktime,
  });

  const serialized = serializeTransaction(txCopy);
  // Append 4-byte sighash_type uint32 (little-endian)
  const sighashBuf = Buffer.alloc(4);
  sighashBuf.writeUInt32LE(sighashType >>> 0, 0);
  return hash256(Buffer.concat([serialized, sighashBuf]));
}

/**
 * Build, sign, and return a complete SignedTransaction for a Bastyon post.
 * Output 0: OP_RETURN [tx_type, hash256(payload)] value=0
 * Output 1: P2PKH (change to sender address) value = inputs_total - fee
 */
export function buildAndSignPostTransaction({
  account,
  utxos,
  payload,
  feeSatoshis = DEFAULT_FEE,
  txType = 'share',
}) {
  const contentHash = computeContentHash(payload);
  const opReturnScript = buildOpReturnScript(txType, contentHash);
  const p2pkhScript = buildP2pkhScript(account.address);

  // Required satoshis: fee (op_return output value is 0) + dust for change output
  const { selected, total } = selectUtxos(utxos, feeSatoshis + DUST_THRESHOLD);

  const changeAmount = total - feeSatoshis;
  if (changeAmount < DUST_THRESHOLD) {
    throw new InsufficientFundsError(
      `Change output amount ${changeAmount} satoshis is below dust threshold ${DUST_THRESHOLD}.`
    );
  }

  const inputs = selected.map((u) => new TxInput({ txidHex: u.txid, vout: u.vout }));
  const outputs = [
    new TxOutput({ amount: 0, scriptPubkey: opReturnScript }),
    new TxOutput({ amount: changeAmount, scriptPubkey: p2pkhScript }),
  ];

  const tx = new Transaction({
    version: 2,
    ntime: Math.floor(Date.now() / 1000),
    inputs,
    outputs,
    locktime: 0,
  });

  // Sign each input
  selected.forEach((u, idx) => {
    // Derive scriptPubKey if missing from input UTXO
    const utxoScript = u.scriptPubkey ? Buffer.from(u.scriptPubkey, 'hex') : p2pkhScript;

    const sighash = computeSighash(tx, idx, utxoScript, 1);
    const sigDer = signDigest(account.privateKeyBytes, sighash);
    const sigWithHashtype = Buffer.concat([sigDer, Buffer.from([1])]); // SIGHASH_ALL

    // ScriptSig = PUSH(sig_with_hashtype) + PUSH(pubkey)
    tx.inputs[idx].scriptSig = Buffer.concat([pushData(sigWithHashtype), pushData(account.publicKeyBytes)]);
  });

  const rawTxBytes = serializeTransaction(tx);
  const txid = computeTxid(rawTxBytes);
  const serializedPayload = serializePayload(payload);

  return new SignedTransaction({
    rawHex: rawTxBytes.toString('hex'),
    txid,
    payloadJson: serializedPayload,
  });
}
