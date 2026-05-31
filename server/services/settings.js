import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, '../../data');
const SETTINGS_PATH = join(DATA_DIR, 'settings.json');
const OLD_SETTINGS_PATH = join(__dirname, '../../settings.json');

// Ensure the data directory exists
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// Auto-migrate: move root-level settings.json into data/ if it exists
if (existsSync(OLD_SETTINGS_PATH) && !existsSync(SETTINGS_PATH)) {
  try {
    renameSync(OLD_SETTINGS_PATH, SETTINGS_PATH);
    console.log('📦 Migrated settings.json → data/settings.json');
  } catch (e) {
    console.warn('⚠️ Could not migrate settings.json:', e.message);
  }
}

const DEFAULT_SETTINGS = {
  users: [],
  googleDrive: {
    clientId: '',
    clientSecret: '',
    redirectUri: '',
    refreshToken: ''
  },
  torrentBatchSizeGB: 12
};

/**
 * Load settings from disk. Returns defaults if file doesn't exist.
 */
export function loadSettings() {
  if (!existsSync(SETTINGS_PATH)) {
    saveSettings(DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }
  try {
    const raw = readFileSync(SETTINGS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch (e) {
    console.error('Failed to parse settings.json, using defaults.', e.message);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Save settings to disk.
 */
export function saveSettings(data) {
  writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Update only the Google Drive credentials portion of settings.
 */
export function updateGdriveSettings(gdriveConfig) {
  const settings = loadSettings();
  settings.googleDrive = { ...settings.googleDrive, ...gdriveConfig };
  saveSettings(settings);
}

/**
 * Update the path to the saved cookies.txt file.
 */
export function updateCookiesPath(cookiesPath) {
  const settings = loadSettings();
  settings.cookiesPath = cookiesPath;
  saveSettings(settings);
}
/**
 * Update the torrent batch size limit.
 */
export function updateBatchSize(sizeGB) {
  const settings = loadSettings();
  settings.torrentBatchSizeGB = parseFloat(sizeGB) || 12;
  saveSettings(settings);
}
