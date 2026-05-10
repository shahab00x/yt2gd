import { loadSettings } from '../server/services/settings.js';
const s = loadSettings();
console.log('Settings:', JSON.stringify(s, null, 2));
if (s.torrentBatchSizeGB === 12) {
    console.log('✅ Task 1.1 Verified: torrentBatchSizeGB is present.');
} else {
    console.error('❌ Task 1.1 Failed: torrentBatchSizeGB is missing or incorrect.');
}
