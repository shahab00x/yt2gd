/**
 * Bastyon draft post store — persisted drafts in data/bastyon-drafts.json and
 * downloaded files in data/bastyon-staging/<draftId>/ (outside tmp/ so the
 * Dashboard's "Clear Tmp" never destroys pending posts).
 */

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync,
  statSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../../../data');
const DRAFTS_PATH = join(DATA_DIR, 'bastyon-drafts.json');
export const STAGING_DIR = join(DATA_DIR, 'bastyon-staging');

function ensureDirs() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(STAGING_DIR)) mkdirSync(STAGING_DIR, { recursive: true });
}

function loadDrafts() {
  ensureDirs();
  if (!existsSync(DRAFTS_PATH)) return { drafts: [] };
  try {
    return JSON.parse(readFileSync(DRAFTS_PATH, 'utf-8'));
  } catch (e) {
    console.error('Failed to parse bastyon-drafts.json', e.message);
    return { drafts: [] };
  }
}

function saveDrafts(data) {
  ensureDirs();
  writeFileSync(DRAFTS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

export function listDrafts() {
  return loadDrafts().drafts;
}

export function getDraft(id) {
  return loadDrafts().drafts.find((d) => d.id === id) || null;
}

export function createDraft(data) {
  const drafts = loadDrafts();
  const now = Date.now();
  const draft = {
    id: `draft_${now}_${randomUUID().slice(0, 8)}`,
    status: 'draft',
    sourceUrl: data.sourceUrl || '',
    accountId: data.accountId || null,
    accountName: data.accountName || '',
    title: data.title || '',
    description: data.description || '',
    tags: data.tags || [],
    thumbnailUrl: data.thumbnailUrl || '',
    trimStart: '',
    trimEnd: '',
    transcode: data.transcode !== false,
    filePath: data.filePath || '',
    fileSize: data.fileSize || 0,
    txid: '',
    error: '',
    createdAt: now,
    updatedAt: now,
  };
  drafts.drafts.unshift(draft);
  saveDrafts(drafts);
  return draft;
}

export function updateDraft(id, patch) {
  const drafts = loadDrafts();
  const draft = drafts.drafts.find((d) => d.id === id);
  if (!draft) return null;
  Object.assign(draft, patch, { updatedAt: Date.now() });
  saveDrafts(drafts);
  return draft;
}

export function deleteDraft(id) {
  const drafts = loadDrafts();
  const draft = drafts.drafts.find((d) => d.id === id);
  if (!draft) return false;
  drafts.drafts = drafts.drafts.filter((d) => d.id !== id);
  saveDrafts(drafts);
  // Remove staging files + the draft's staging folder
  try {
    if (existsSync(draft.filePath)) rmSync(draft.filePath, { force: true });
    const dir = draftStagingDir(id);
    if (existsSync(dir)) {
      const remaining = readdirSync(dir);
      if (remaining.length === 0) rmSync(dir, { recursive: true, force: true });
    }
  } catch (e) {
    console.warn(`⚠️ Failed to delete draft file ${draft.filePath}: ${e.message}`);
  }
  return true;
}

export function draftStagingDir(draftId) {
  return join(STAGING_DIR, draftId);
}

/** Directory size in bytes (recursive). */
function dirSize(p) {
  let total = 0;
  try {
    for (const entry of readdirSync(p, { withFileTypes: true })) {
      const full = join(p, entry.name);
      if (entry.isDirectory()) total += dirSize(full);
      else total += statSync(full).size;
    }
  } catch { /* ignore */ }
  return total;
}

/** Storage indicator payload: staging dir contents + size. */
export function stagingInfo() {
  ensureDirs();
  let files = [];
  try {
    files = readdirSync(STAGING_DIR, { withFileTypes: true }).map((entry) => {
      const full = join(STAGING_DIR, entry.name);
      return {
        name: entry.name,
        isDir: entry.isDirectory(),
        size: entry.isDirectory() ? dirSize(full) : (statSync(full).size || 0),
      };
    });
  } catch { /* ignore */ }
  return { path: STAGING_DIR, size: dirSize(STAGING_DIR), files };
}

/**
 * Clear the staging directory and remove all non-published drafts (their local
 * files are required to publish). Returns the number of removed drafts.
 */
export function clearStaging() {
  ensureDirs();
  const drafts = loadDrafts();
  const kept = [];
  let removed = 0;
  for (const d of drafts.drafts) {
    if (d.status === 'published') {
      kept.push(d);
    } else {
      removed += 1;
    }
  }
  drafts.drafts = kept;
  saveDrafts(drafts);

  try {
    for (const entry of readdirSync(STAGING_DIR)) {
      rmSync(join(STAGING_DIR, entry), { recursive: true, force: true });
    }
  } catch (e) {
    console.warn(`⚠️ Failed to fully clear staging dir: ${e.message}`);
  }
  return removed;
}
