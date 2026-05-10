import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../../data');
const STORE_PATH = join(DATA_DIR, 'transfers.json');

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Load all transfers from the persistent store.
 */
export function getTransfers() {
  if (!existsSync(STORE_PATH)) return {};
  try {
    const raw = readFileSync(STORE_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse transfers.json', e.message);
    return {};
  }
}

/**
 * Save a transfer to the store.
 * @param {string} id - Unique transfer ID (e.g. sessionId or torrentId)
 * @param {object} data - Transfer metadata and state
 */
export function saveTransfer(id, data) {
  ensureDataDir();
  const transfers = getTransfers();
  transfers[id] = { ...transfers[id], ...data, id, updatedAt: Date.now() };
  writeFileSync(STORE_PATH, JSON.stringify(transfers, null, 2), 'utf-8');
}

/**
 * Delete a transfer from the store.
 */
export function deleteTransfer(id) {
  const transfers = getTransfers();
  if (transfers[id]) {
    delete transfers[id];
    writeFileSync(STORE_PATH, JSON.stringify(transfers, null, 2), 'utf-8');
  }
}

/**
 * Update the status of a transfer.
 */
export function updateTransferStatus(id, status, extra = {}) {
  saveTransfer(id, { status, ...extra });
}
