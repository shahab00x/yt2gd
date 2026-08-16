/**
 * Bastyon node JSON-RPC client for UTXO retrieval and post broadcast.
 * Ported 1:1 from bastyon-poster-linux/src/rpc.py
 */

import axios from 'axios';
import { MAINNET } from './constants.js';
import { UTXO } from './transaction.js';

export class RPCError extends Error {
  constructor(message, code = null, data = null) {
    super(message);
    this.name = 'RPCError';
    this.code = code;
    this.data = data;
  }
}

export class NodeConnectionError extends RPCError {
  constructor(message) { super(message); this.name = 'NodeConnectionError'; }
}
export class MempoolConflictError extends RPCError {
  constructor(message, code = null, data = null) { super(message, code, data); this.name = 'MempoolConflictError'; }
}
export class DeserializationError extends RPCError {
  constructor(message, code = null, data = null) { super(message, code, data); this.name = 'DeserializationError'; }
}
export class AccountNotRegisteredError extends RPCError {
  constructor(message, code = null, data = null) { super(message, code, data); this.name = 'AccountNotRegisteredError'; }
}
export class PostingLimitError extends RPCError {
  constructor(message, code = null, data = null) { super(message, code, data); this.name = 'PostingLimitError'; }
}

export class BastyonRpcClient {
  constructor(nodeUrl = null, timeout = 15) {
    this.nodes = nodeUrl ? [String(nodeUrl).replace(/\/+$/, '')] : MAINNET.defaultNodes.map((n) => n.replace(/\/+$/, ''));
    this.timeout = timeout * 1000;
  }

  /** Execute a JSON-RPC request and handle errors, attempting fallback nodes if needed. */
  async _call(method, params) {
    let lastException = null;
    for (const node of this.nodes) {
      const endpoint = `${node}/rpc/${method}`;
      const payload = { method, parameters: params };
      const headers = { 'Content-Type': 'application/json' };

      let data;
      try {
        const resp = await axios.post(endpoint, payload, { headers, timeout: this.timeout });
        data = resp.data;
      } catch (e) {
        // Attempt to salvage a JSON body (proxy nodes may return errors with 200)
        if (e.response && e.response.data) {
          data = e.response.data;
        } else {
          console.warn(`[Bastyon RPC] Node call to ${node} failed (${e.message}). Trying next node...`);
          lastException = e;
          continue;
        }
      }

      if (data && data.error != null) {
        let err = data.error;
        if (err && typeof err === 'object' && err.error && typeof err.error === 'object') {
          err = err.error;
        }
        const code = err && typeof err === 'object' ? err.code : null;
        const msg = err && typeof err === 'object' ? (err.message ?? String(err)) : String(err);
        this._handleRpcError(code, msg, err);
      }

      if (data && data.data !== undefined && data.result === 'success') {
        return data.data;
      }
      return data && data.result;
    }

    throw new NodeConnectionError(`All Bastyon node RPC endpoints failed. Last error: ${lastException?.message || lastException}`);
  }

  _handleRpcError(code, message, rawError) {
    const msgLower = (message || '').toLowerCase();

    if (code === 2000 || msgLower.includes('mempool') || msgLower.includes('already in mempool')) {
      throw new MempoolConflictError(`Transaction conflict or already in mempool: ${message}`, code, rawError);
    }
    if (code === -26 || msgLower.includes('deserialization')) {
      throw new DeserializationError(`Transaction deserialization failed: ${message}`, code, rawError);
    }
    if (msgLower.includes('notregistered') || msgLower.includes('not registered')) {
      throw new AccountNotRegisteredError(
        `Account is not registered on-chain with an ACCOUNT_USER transaction: ${message}`, code, rawError
      );
    }
    if (msgLower.includes('limitexceeded') || msgLower.includes('limit exceeded')) {
      throw new PostingLimitError(`Account daily posting limit exceeded: ${message}`, code, rawError);
    }
    throw new RPCError(`RPC Error [${code}]: ${message}`, code, rawError);
  }

  /** Fetch unspent outputs (UTXOs) for an address via txunspent RPC. */
  async getUtxos(address) {
    const res = await this._call('txunspent', [[address], 1, 9999999]);
    if (!res || !Array.isArray(res)) return [];

    const utxos = [];
    for (const item of res) {
      const confirmations = item.confirmations ?? 1;
      let rawAmount = item.amountSat;
      if (rawAmount == null) {
        rawAmount = item.satoshis ?? Math.round((item.amount || 0) * 1e8);
      }
      utxos.push(new UTXO({
        txid: item.txid,
        vout: item.outputIndex ?? item.vout ?? 0,
        amount: Number(rawAmount),
        scriptPubkey: item.scriptPubKey ?? item.script ?? '',
        confirmations,
      }));
    }
    return utxos;
  }

  /** Broadcast signed transaction and JSON payload to node via sendrawtransactionwithmessage RPC. */
  async broadcast(signedTx) {
    const txid = await this._call('sendrawtransactionwithmessage', [signedTx.rawHex, signedTx.payloadJson, '']);
    return String(txid);
  }
}
