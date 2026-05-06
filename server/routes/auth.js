import { Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createReadStream } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { loadSettings, updateGdriveSettings, updateCookiesPath } from '../services/settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cookies file upload — use memory storage to avoid locking issues during stream parsing
const uploadCookies = multer({ storage: multer.memoryStorage() });

const router = Router();

/**
 * POST /api/auth/login
 * Body: { username, password }
 * Validates against admin-defined users in settings.json
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const settings = loadSettings();
  const user = (settings.users || []).find(u => u.username === username);

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  req.session.user = { username: user.username };
  res.json({ success: true, username: user.username });
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

/**
 * GET /api/auth/me
 * Returns current session user, or 401 if not logged in.
 */
router.get('/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  res.json({ username: req.session.user.username });
});

/**
 * GET /api/auth/settings
 * Returns current Google Drive settings (secrets masked for safety).
 */
router.get('/settings', requireAuth, (req, res) => {
  const settings = loadSettings();
  const gd = settings.googleDrive || {};
  res.json({
    clientId: gd.clientId || '',
    clientSecret: gd.clientSecret ? '••••••••' : '',
    redirectUri: gd.redirectUri || '',
    hasRefreshToken: !!gd.refreshToken
  });
});

/**
 * POST /api/auth/settings
 * Saves Google Drive credentials. Only updates provided fields.
 */
router.post('/settings', requireAuth, (req, res) => {
  const { clientId, clientSecret, redirectUri, refreshToken } = req.body;
  const current = loadSettings().googleDrive || {};

  updateGdriveSettings({
    clientId: clientId ?? current.clientId,
    clientSecret: clientSecret && clientSecret !== '••••••••' ? clientSecret : current.clientSecret,
    redirectUri: redirectUri ?? current.redirectUri,
    refreshToken: refreshToken ?? current.refreshToken
  });

  res.json({ success: true });
});

/**
 * POST /api/auth/save-cookie-data
 * Accepts Base64 encoded cookies.txt content.
 */
router.post('/save-cookie-data', requireAuth, async (req, res) => {
  const { data } = req.body;
  if (!data) {
    return res.status(400).json({ error: 'No cookie data provided.' });
  }

  const cookiesPath = join(__dirname, '../../cookies.txt');
  try {
    const decoded = Buffer.from(data, 'base64').toString('utf8');
    console.log(`[AUTH] Decoded ${decoded.length} characters. Writing to ${cookiesPath}`);
    await writeFile(cookiesPath, decoded, 'utf8');
    updateCookiesPath(cookiesPath);
    res.json({ success: true, message: 'cookies.txt saved.' });
  } catch (err) {
    console.error('[AUTH] Save error:', err);
    res.status(500).json({ error: `Failed to save: ${err.message}` });
  }
});

/**
 * DELETE /api/auth/cookies
 * Removes the stored cookies.txt reference from settings.
 */
router.delete('/cookies', requireAuth, (req, res) => {
  updateCookiesPath(null);
  res.json({ success: true, message: 'Cookies removed.' });
});

/**
 * GET /api/auth/cookies/status
 * Returns whether a cookies.txt is currently saved.
 */
router.get('/cookies/status', requireAuth, (req, res) => {
  const settings = loadSettings();
  const hasCookies = !!(settings.cookiesPath && existsSync(settings.cookiesPath));
  res.json({ hasCookies });
});

/**
 * GET /api/info
 * Returns server version from package.json.
 */
router.get('/info', async (req, res) => {
  try {
    const pkgPath = join(__dirname, '../../package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
    res.json({ version: pkg.version, name: pkg.name });
  } catch {
    res.json({ version: 'unknown' });
  }
});

// Middleware: require authenticated session
export function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  next();
}

export default router;
