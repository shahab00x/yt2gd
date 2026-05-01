import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { loadSettings, updateGdriveSettings } from '../services/settings.js';

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

// Middleware: require authenticated session
export function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  next();
}

export default router;
