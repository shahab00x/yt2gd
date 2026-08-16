/**
 * Post payload construction, serialization, hash calculation, and validation.
 * Ported 1:1 from bastyon-poster-linux/src/payload.py
 */

import { MAX_PAYLOAD_SIZE } from './constants.js';
import { hash256 } from './crypto.js';

export class PayloadError extends Error {}
export class PayloadTooLargeError extends PayloadError {}

export class PostPayload {
  constructor({
    message,
    caption = '',
    tags = [],
    images = [],
    url = '',
    language = 'en',
    settings = {},
    txidEdit = '',
    txidRepost = '',
  }) {
    if (!message) throw new PayloadError('Post payload requires a message');
    this.message = message;
    this.caption = caption || '';
    this.tags = tags || [];
    this.images = images || [];
    this.url = url || '';
    this.language = language || 'en';
    this.settings = settings || {};
    this.txidEdit = txidEdit || '';
    this.txidRepost = txidRepost || '';
  }
}

/**
 * Compute Double-SHA256 hash of post content according to Pocketnet consensus rules.
 * Concatenates: url + caption + message + comma_joined_tags + comma_joined_images
 *               [+ txid_edit] [+ txid_repost]
 * Matches Post.cpp:BuildHash() implementation.
 */
export function computeContentHash(payload) {
  let data = '';
  data += payload.url || '';
  data += payload.caption || '';
  data += payload.message || '';
  data += payload.tags && payload.tags.length ? payload.tags.join(',') : '';
  data += payload.images && payload.images.length ? payload.images.join(',') : '';
  if (payload.txidEdit) data += payload.txidEdit;
  if (payload.txidRepost) data += payload.txidRepost;
  return hash256(Buffer.from(data, 'utf-8'));
}

/**
 * Convert PostPayload to the dictionary format expected by Bastyon node RPC params[1].
 * Note: tags and images arrays are JSON-stringified within the dict.
 */
export function serializePayload(payload) {
  const result = {
    m: payload.message,
    l: payload.language || 'en',
  };

  if (payload.caption) result.c = payload.caption;
  if (payload.tags && payload.tags.length) result.t = JSON.stringify(payload.tags);
  if (payload.images && payload.images.length) result.i = JSON.stringify(payload.images);
  if (payload.url) result.u = payload.url;
  if (payload.settings && Object.keys(payload.settings).length) {
    result.s = typeof payload.settings === 'object' ? JSON.stringify(payload.settings) : payload.settings;
  }
  if (payload.txidEdit) result.txidEdit = payload.txidEdit;
  if (payload.txidRepost) result.txidRepost = payload.txidRepost;

  // Validate JSON payload size limit
  const jsonBytes = Buffer.byteLength(JSON.stringify(result), 'utf-8');
  if (jsonBytes > MAX_PAYLOAD_SIZE) {
    throw new PayloadTooLargeError(
      `Post payload size ${jsonBytes} bytes exceeds maximum allowed limit of ${MAX_PAYLOAD_SIZE} bytes.`
    );
  }
  return result;
}

/** Helper factory function to build and validate a PostPayload. */
export function buildPayload({
  message,
  caption = '',
  tags = null,
  images = null,
  url = '',
  language = 'en',
  settings = null,
  txidEdit = '',
  txidRepost = '',
}) {
  return new PostPayload({
    message,
    caption,
    tags: tags || [],
    images: images || [],
    url,
    language: language || 'en',
    settings: settings || {},
    txidEdit,
    txidRepost,
  });
}
