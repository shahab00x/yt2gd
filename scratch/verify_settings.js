import { loadSettings } from './server/services/settings.js';

console.log('Settings:', JSON.stringify(loadSettings(), null, 2));

try {
  const { google } = await import('googleapis');
  const settings = loadSettings();
  const { clientId, clientSecret, redirectUri, refreshToken } = settings.googleDrive || {};
  console.log('clientId:', clientId);
  console.log('clientSecret:', clientSecret ? '***' : undefined);
  console.log('redirectUri:', redirectUri);
  console.log('refreshToken:', refreshToken ? '***' : undefined);
} catch (err) {
  console.error(err.message);
}
