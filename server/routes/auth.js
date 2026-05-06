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
 * POST /api/auth/cookies
 * Accepts a cookies.txt file upload and stores it in the project root.
 */
router.post('/cookies', requireAuth, (req, res, next) => {
  console.log(`[AUTH] Received POST /api/auth/cookies request. Content-Type: ${req.headers['content-type']}, Content-Length: ${req.headers['content-length']}`);
  next();
}, (req, res, next) => {
  uploadCookies.single('cookies')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error('[AUTH] Multer Error:', err);
      return res.status(500).json({ error: `Upload error: ${err.message}` });
    } else if (err) {
      console.error('[AUTH] Unknown Upload Error:', err);
      return res.status(500).json({ error: `Unknown upload error: ${err.message}` });
    }
    console.log('[AUTH] Multer finished parsing. req.file:', req.file ? 'exists' : 'missing');
    next();
  });
}, async (req, res) => {
  if (!req.file) {
    console.error('[AUTH] No file received by handler.');
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const cookiesPath = join(__dirname, '../../cookies.txt');
  try {
    console.log(`[AUTH] Writing ${req.file.size} bytes to ${cookiesPath}`);
    await writeFile(cookiesPath, req.file.buffer);
    updateCookiesPath(cookiesPath);
    console.log('[AUTH] cookies.txt saved successfully.');
    res.json({ success: true, message: 'cookies.txt saved.' });
  } catch (err) {
    console.error('[AUTH] File write error:', err);
    res.status(500).json({ error: `Failed to save cookies: ${err.message}` });
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
