/**
 * Admin CLI — Add a user to settings.json
 * Usage: node scripts/add-user.js <username> <password>
 *
 * This is the ONLY way to add users. There is no self-registration.
 */
import bcrypt from 'bcryptjs';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SETTINGS_PATH = join(__dirname, '../settings.json');

const [,, username, password] = process.argv;

if (!username || !password) {
  console.error('Usage: node scripts/add-user.js <username> <password>');
  process.exit(1);
}

let settings = { users: [], googleDrive: { clientId: '', clientSecret: '', redirectUri: '', refreshToken: '' } };
if (existsSync(SETTINGS_PATH)) {
  settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
}

if (!settings.users) settings.users = [];

if (settings.users.find(u => u.username === username)) {
  console.error(`❌ User "${username}" already exists.`);
  process.exit(1);
}

const SALT_ROUNDS = 12;
const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

settings.users.push({ username, passwordHash });
writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');

console.log(`✅ User "${username}" added successfully.`);
