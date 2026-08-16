/**
 * Unit tests for the ported Bastyon modules.
 * Mirrors bastyon-poster-linux/tests/{test_crypto,test_payload,test_transaction,test_rpc}.py
 * Run: node --test server/services/bastyon/bastyon.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import axios from 'axios';
import { mock } from 'node:test';

import { MAINNET, TESTNET } from './constants.js';
import {
  base58checkEncode, base58checkDecode, parseWif, derivePubkey, pubkeyToAddress,
  Account, signDigest, hash256, hash160, InvalidKeyError, base58Encode, base58Decode,
  hexToWif,
} from './crypto.js';
import { normalizePrivateKey } from './accounts.js';
import { buildPayload, computeContentHash, serializePayload, PayloadTooLargeError } from './payload.js';
import {
  selectUtxos, buildOpReturnScript, buildP2pkhScript, buildAndSignPostTransaction,
  computeTxid, UTXO, InsufficientFundsError,
} from './transaction.js';
import {
  BastyonRpcClient, MempoolConflictError, DeserializationError,
  AccountNotRegisteredError, PostingLimitError,
} from './rpc.js';
import { SignedTransaction } from './transaction.js';

const sha256 = (b) => createHash('sha256').update(b).digest();

// --- Crypto (test_crypto.py) ---

test('base58check roundtrip', () => {
  const payload = Buffer.from('hello pocketcoin');
  const encoded = base58checkEncode(payload, 55);
  const { payload: decoded, prefix } = base58checkDecode(encoded);
  assert.deepEqual(decoded, payload);
  assert.equal(prefix, 55);
});

test('base58 roundtrip', () => {
  const data = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff]);
  assert.deepEqual(base58Decode(base58Encode(data)), data);
});

test('parse wif mainnet', () => {
  const rawPriv = Buffer.alloc(32, 0x01);
  const mainnetWif = base58checkEncode(Buffer.concat([rawPriv, Buffer.from([0x01])]), MAINNET.wifPrefix);
  const { privateKeyBytes, network, compressed } = parseWif(mainnetWif);
  assert.deepEqual(privateKeyBytes, rawPriv);
  assert.equal(network, MAINNET);
  assert.equal(compressed, true);
});

test('parse wif testnet', () => {
  const rawPriv = Buffer.alloc(32, 0x01);
  const testnetWif = base58checkEncode(Buffer.concat([rawPriv, Buffer.from([0x01])]), TESTNET.wifPrefix);
  const { privateKeyBytes, network, compressed } = parseWif(testnetWif);
  assert.deepEqual(privateKeyBytes, rawPriv);
  assert.equal(network, TESTNET);
  assert.equal(compressed, true);
});

test('parse wif invalid checksum', () => {
  const mainnetWif = base58checkEncode(Buffer.concat([Buffer.alloc(32, 0x01), Buffer.from([0x01])]), MAINNET.wifPrefix);
  const badWif = mainnetWif.slice(0, -1) + (mainnetWif.endsWith('A') ? 'B' : 'A');
  assert.throws(() => parseWif(badWif), InvalidKeyError);
});

test('hex to wif matches python hex_to_wif.py vectors', () => {
  // Reference values computed with an independent Python implementation of
  // hex_to_wif.py (no coincurve needed): priv||0x01, Base58Check prefix 0x21.
  assert.equal(hexToWif('42'.repeat(32)), '5vMcBTmp98Dxjp1JTDRTMBwDCyrn7p69vN5oiXpPGkW3oxNAkNb7');
  assert.equal(hexToWif('AB'.repeat(32)), '5ytWmb3F3558r2N66JeHyG6J1sBDw3Vgvqh9tV254bTaTBSEToNj');
});

test('hex to wif roundtrips through parseWif', () => {
  const hex = 'ab12'.repeat(16);
  const wif = hexToWif(hex);
  const { privateKeyBytes, network, compressed } = parseWif(wif);
  assert.equal(privateKeyBytes.toString('hex'), hex.toLowerCase());
  assert.equal(network, MAINNET);
  assert.equal(compressed, true);
});

test('hex to wif rejects malformed input', () => {
  assert.throws(() => hexToWif('42'.repeat(31)), /64 hex/);
  assert.throws(() => hexToWif('42'.repeat(32) + 'zz'), /64 hex/);
  assert.throws(() => hexToWif(''), /64 hex/);
  assert.throws(() => hexToWif('gggg'.repeat(16)), /64 hex/);
});

test('normalizePrivateKey converts hex and passes wif through', () => {
  const hex = '42'.repeat(32);
  assert.equal(normalizePrivateKey(hex), '5vMcBTmp98Dxjp1JTDRTMBwDCyrn7p69vN5oiXpPGkW3oxNAkNb7');
  const wif = hexToWif('AB'.repeat(32));
  assert.equal(normalizePrivateKey(wif), wif);
});

test('pubkey and address derivation', () => {
  const mainnetWif = base58checkEncode(Buffer.concat([Buffer.alloc(32, 0x01), Buffer.from([0x01])]), MAINNET.wifPrefix);
  const account = Account.fromWif(mainnetWif);
  assert.deepEqual(account.privateKeyBytes, Buffer.alloc(32, 0x01));
  assert.equal(account.publicKeyBytes.length, 33);
  assert.ok(account.address.startsWith('P'), `Address ${account.address} does not start with P`);
});

test('testnet address derivation', () => {
  const testnetWif = base58checkEncode(Buffer.concat([Buffer.alloc(32, 0x01), Buffer.from([0x01])]), TESTNET.wifPrefix);
  const account = Account.fromWif(testnetWif);
  assert.ok(account.address.startsWith('T'), `Address ${account.address} does not start with T`);
});

test('sign and verify digest', async () => {
  const rawPriv = Buffer.alloc(32, 0x01);
  const digest = hash256(Buffer.from('Test Pocketcoin Post Data'));
  const sig = signDigest(rawPriv, digest);
  const pub = derivePubkey(rawPriv, true);
  // secp256k1.verify expects compact; convert DER by re-parsing via @noble signature class
  const { secp256k1 } = await import('@noble/curves/secp256k1.js');
  const compact = secp256k1.Signature.fromBytes(sig, 'der').toBytes('compact');
  assert.equal(secp256k1.verify(compact, digest, pub, { prehash: false }), true);
});

test('hash160 matches known vectors', () => {
  // RIPEMD160(SHA256("hello")) — verified identical to the Python implementation
  assert.equal(hash160(Buffer.from('hello')).toString('hex'), 'b6a9c8c230722b7c748331a8b450f05566dc7d0f');
  assert.equal(sha256(Buffer.from('hello')).toString('hex'), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
});

// --- Payload (test_payload.py) ---

test('build payload defaults', () => {
  const payload = buildPayload({ message: 'Hello Bastyon!' });
  assert.equal(payload.message, 'Hello Bastyon!');
  assert.equal(payload.language, 'en');
  assert.deepEqual(payload.tags, []);
  assert.deepEqual(payload.images, []);
});

test('serialize payload field mapping', () => {
  const payload = buildPayload({
    message: 'Test post content',
    caption: 'Title',
    tags: ['tech', 'python'],
    images: ['https://bastyon.com/img1.jpg'],
    url: 'https://peertube.com/video1',
    language: 'en',
  });
  const serialized = serializePayload(payload);
  assert.equal(serialized.m, 'Test post content');
  assert.equal(serialized.c, 'Title');
  // JS JSON.stringify has no spaces — this is the native format the Bastyon GUI sends;
  // the node parses both spellings identically (semantically equal JSON).
  assert.equal(serialized.t, '["tech","python"]');
  assert.equal(serialized.i, '["https://bastyon.com/img1.jpg"]');
  assert.equal(serialized.u, 'https://peertube.com/video1');
  assert.equal(serialized.l, 'en');
});

test('compute content hash', () => {
  const payload = buildPayload({
    message: 'Body text',
    caption: 'Title text',
    tags: ['t1', 't2'],
    images: ['img1'],
    url: 'http://url.com',
  });
  // Expected concatenation: "http://url.com" + "Title text" + "Body text" + "t1,t2" + "img1"
  const expectedRaw = 'http://url.comTitle textBody textt1,t2img1';
  const expectedHash = hash256(Buffer.from(expectedRaw, 'utf-8'));
  assert.deepEqual(computeContentHash(payload), expectedHash);
});

test('payload too large error', () => {
  const payload = buildPayload({ message: 'A'.repeat(65_000) });
  assert.throws(() => serializePayload(payload), PayloadTooLargeError);
});

// --- Transaction (test_transaction.py) ---

function makeAccount() {
  const rawPriv = Buffer.alloc(32, 0x02);
  const wif = base58checkEncode(Buffer.concat([rawPriv, Buffer.from([0x01])]), MAINNET.wifPrefix);
  return Account.fromWif(wif);
}

const sampleUtxo1 = () => new UTXO({
  txid: '1111111122222222333333334444444455555555666666667777777788888888',
  vout: 0,
  amount: 50_000,
  confirmations: 2,
});
const sampleUtxo2 = () => new UTXO({
  txid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  vout: 1,
  amount: 100_000,
  confirmations: 5,
});

test('select utxos success', () => {
  const { selected, total } = selectUtxos([sampleUtxo1(), sampleUtxo2()], 60_000);
  assert.equal(total, 100_000);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].txid, sampleUtxo2().txid);
});

test('select utxos insufficient', () => {
  assert.throws(() => selectUtxos([sampleUtxo1()], 60_000), InsufficientFundsError);
});

test('build op return script', () => {
  const payload = buildPayload({ message: 'Hello World' });
  const chash = computeContentHash(payload);
  const script = buildOpReturnScript('share', chash);
  // 0x6a (OP_RETURN) + 0x05 (PUSH 5) + "share" + 0x20 (PUSH 32) + chash
  assert.equal(script[0], 0x6a);
  assert.equal(script[1], 5);
  assert.equal(script.subarray(2, 7).toString(), 'share');
  assert.equal(script[7], 32);
  assert.deepEqual(script.subarray(8, 40), chash);
});

test('build p2pkh script', () => {
  const account = makeAccount();
  const script = buildP2pkhScript(account.address);
  assert.equal(script.length, 25);
  assert.deepEqual(script.subarray(0, 3), Buffer.from([0x76, 0xa9, 0x14]));
  assert.deepEqual(script.subarray(-2), Buffer.from([0x88, 0xac]));
});

test('build and sign post transaction', () => {
  const account = makeAccount();
  const payload = buildPayload({ message: 'Automated Bastyon Post Task Test' });
  const signedTx = buildAndSignPostTransaction({
    account,
    utxos: [sampleUtxo1()],
    payload,
    feeSatoshis: 1_000,
  });

  assert.equal(typeof signedTx.rawHex, 'string');
  assert.equal(signedTx.txid.length, 64);
  assert.equal(signedTx.payloadJson.m, 'Automated Bastyon Post Task Test');

  // Verify binary structure
  const rawBytes = Buffer.from(signedTx.rawHex, 'hex');
  assert.equal(signedTx.txid, computeTxid(rawBytes));
});

// --- RPC (test_rpc.py) ---

function mockAxiosPost(data) {
  return mock.method(axios, 'post', async () => ({ status: 200, data }));
}

test('rpc get_utxos success', async () => {
  const m = mockAxiosPost({
    result: [{
      txid: '1111111122222222333333334444444455555555666666667777777788888888',
      outputIndex: 0,
      satoshis: 50000,
      script: '76a914...',
      confirmations: 3,
    }],
    error: null,
  });
  try {
    const client = new BastyonRpcClient('https://1.pocketnet.app:8899');
    const utxos = await client.getUtxos('PxxxAddress');
    assert.equal(utxos.length, 1);
    assert.equal(utxos[0].amount, 50000);
    assert.equal(utxos[0].vout, 0);
    assert.equal(utxos[0].confirmations, 3);
  } finally {
    m.mock.restore();
  }
});

test('rpc broadcast success', async () => {
  const txid = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
  const m = mockAxiosPost({ result: txid, error: null });
  try {
    const client = new BastyonRpcClient('https://1.pocketnet.app:8899');
    const signedTx = new SignedTransaction({ rawHex: '010000...', txid: 'abc...', payloadJson: { m: 'hi' } });
    const result = await client.broadcast(signedTx);
    assert.equal(result, txid);
  } finally {
    m.mock.restore();
  }
});

test('rpc mempool conflict error', async () => {
  const m = mockAxiosPost({ result: null, error: { code: 2000, message: 'Transaction already in mempool' } });
  try {
    const client = new BastyonRpcClient('https://1.pocketnet.app:8899');
    const signedTx = new SignedTransaction({ rawHex: '010000...', txid: 'abc...', payloadJson: { m: 'hi' } });
    await assert.rejects(() => client.broadcast(signedTx), MempoolConflictError);
  } finally {
    m.mock.restore();
  }
});

test('rpc not registered error', async () => {
  const m = mockAxiosPost({ result: null, error: { code: -1, message: 'ConsensusResult_NotRegistered' } });
  try {
    const client = new BastyonRpcClient('https://1.pocketnet.app:8899');
    const signedTx = new SignedTransaction({ rawHex: '010000...', txid: 'abc...', payloadJson: { m: 'hi' } });
    await assert.rejects(() => client.broadcast(signedTx), AccountNotRegisteredError);
  } finally {
    m.mock.restore();
  }
});

test('rpc limit exceeded error', async () => {
  const m = mockAxiosPost({ result: null, error: { code: -1, message: 'ConsensusResult_LimitExceeded' } });
  try {
    const client = new BastyonRpcClient('https://1.pocketnet.app:8899');
    const signedTx = new SignedTransaction({ rawHex: '010000...', txid: 'abc...', payloadJson: { m: 'hi' } });
    await assert.rejects(() => client.broadcast(signedTx), PostingLimitError);
  } finally {
    m.mock.restore();
  }
});

test('rpc deserialization error', async () => {
  const m = mockAxiosPost({ result: null, error: { code: -26, message: 'Deserialization error' } });
  try {
    const client = new BastyonRpcClient('https://1.pocketnet.app:8899');
    const signedTx = new SignedTransaction({ rawHex: '010000...', txid: 'abc...', payloadJson: { m: 'hi' } });
    await assert.rejects(() => client.broadcast(signedTx), DeserializationError);
  } finally {
    m.mock.restore();
  }
});

// --- PeerTube instance list (media.js) ---

import { parsePeertubeList } from './media.js';

test('parse peertube instance list filters testnet, offline, non-upload and special hosts', () => {
  const list = {
    swarms: {
      s1: {
        list: [
          { host: 'peertube1.pocketnet.app', upload: true, online: true },
          { host: 'peertube2.pocketnet.app', upload: false, online: true },
          { host: 'peertube3.pocketnet.app', upload: true, online: false },
          { host: 'peertube4.pocketnet.app', upload: true, online: true, special: true },
          { host: 'peertube5.pocketnet.app', upload: true, online: true },
        ],
      },
      s2: { testnet: true, list: [{ host: 'test.peertube.pocketnet.app', upload: true, online: true }] },
      s3: { list: [] },
    },
  };
  assert.deepEqual(parsePeertubeList(list), [
    'https://peertube1.pocketnet.app',
    'https://peertube5.pocketnet.app',
  ]);
});

test('parse peertube instance list dedupes hosts and ignores malformed entries', () => {
  const list = {
    swarms: {
      s1: { list: [
        { host: 'peertube1.pocketnet.app', upload: true, online: true },
        { host: 'peertube1.pocketnet.app', upload: true, online: true },
        { host: 'nofields.pocketnet.app' },
        null,
      ] },
    },
  };
  assert.deepEqual(parsePeertubeList(list), ['https://peertube1.pocketnet.app']);
});

test('parse peertube instance list rejects empty and invalid input', () => {
  assert.deepEqual(parsePeertubeList(null), []);
  assert.deepEqual(parsePeertubeList({}), []);
  assert.deepEqual(parsePeertubeList({ swarms: {} }), []);
});
