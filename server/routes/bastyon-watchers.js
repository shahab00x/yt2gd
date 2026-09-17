/**
 * Bastyon Auto-Upload watcher routes — CRUD for channel/playlist watchers
 * plus manual "check now" runs. Mounted at /api/bastyon/watchers.
 */

import { Router } from 'express';
import { requireAuth } from './auth.js';
import * as watchers from '../services/bastyon/watchers.js';
import { getAccountById } from '../services/bastyon/accounts.js';
import { runWatcherCheck } from '../services/bastyon/scheduler.js';

const router = Router();
router.use(requireAuth);

function toError(res, err, fallback = 500) {
  const status = err?.statusCode || err?.status || fallback;
  return res.status(status).json({ error: err?.message || 'Internal Server Error' });
}

/**
 * GET /api/bastyon/watchers — list summaries (seen ids omitted for size).
 */
router.get('/', (req, res) => {
  res.json({ watchers: watchers.listWatchers({ summaries: true }) });
});

/**
 * GET /api/bastyon/watchers/:id — full record + recent upload history.
 */
router.get('/:id', (req, res) => {
  const watcher = watchers.getWatcher(req.params.id);
  if (!watcher) return res.status(404).json({ error: 'Watcher not found.' });
  res.json({ watcher, uploadLog: watchers.getUploadLog(watcher.id) });
});

/**
 * POST /api/bastyon/watchers — create. First scheduled check seeds existing
 * videos (only future videos upload).
 */
router.post('/', (req, res) => {
  try {
    const body = req.body || {};
    const account = body.accountId ? getAccountById(body.accountId) : null;
    if (!account) return res.status(400).json({ error: 'Selected Bastyon account not found. Add it in Bastyon Uploader first.' });
    const created = watchers.createWatcher({ ...body, accountName: account.name });
    res.status(201).json({ success: true, watcher: created });
  } catch (err) {
    toError(res, err, 400);
  }
});

/**
 * PUT /api/bastyon/watchers/:id — edit (partial). Source URL changes are
 * validated against the watcher's (possibly updated) type.
 */
router.put('/:id', (req, res) => {
  const existing = watchers.getWatcher(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Watcher not found.' });
  try {
    const body = { ...(req.body || {}) };
    if (body.sourceUrl !== undefined && body.type === undefined) {
      body.type = existing.type; // keep type-aware URL validation on partial edits
    }
    if (body.accountId !== undefined) {
      const account = getAccountById(body.accountId);
      if (!account) return res.status(400).json({ error: 'Selected Bastyon account not found.' });
      body.accountName = account.name;
    }
    const updated = watchers.updateWatcher(existing.id, body);
    res.json({ success: true, watcher: updated });
  } catch (err) {
    toError(res, err, 400);
  }
});

/**
 * DELETE /api/bastyon/watchers/:id
 */
router.delete('/:id', (req, res) => {
  const removed = watchers.deleteWatcher(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Watcher not found.' });
  res.json({ success: true, message: 'Watcher removed.' });
});

/**
 * POST /api/bastyon/watchers/:id/check — run a check immediately
 * (still respects vault lock, dedup, and the daily limit).
 */
router.post('/:id/check', async (req, res) => {
  try {
    const result = await runWatcherCheck(req.params.id, { reason: 'manual' });
    res.json({ success: true, result });
  } catch (err) {
    toError(res, err);
  }
});

/**
 * POST /api/bastyon/watchers/:id/reset — clear seen history, upload log and
 * errors (configuration is kept). The next check reseeds from the current
 * source state without uploading, then monitoring resumes.
 */
router.post('/:id/reset', (req, res) => {
  const reset = watchers.resetHistory(req.params.id);
  if (!reset) return res.status(404).json({ error: 'Watcher not found.' });
  res.json({ success: true, watcher: reset });
});

export default router;
