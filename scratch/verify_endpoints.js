import { Router } from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { exec } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper to manually run the version logic
function getVersion() {
  return new Promise((resolve) => {
    const binDir = join(__dirname, '../bin');
    const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    const localBin = join(binDir, binName);
    const cmd = existsSync(localBin) ? `"${localBin}" --version` : 'yt-dlp --version';
    
    console.log(`Executing cmd: ${cmd}`);
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: stderr || error.message });
      } else {
        resolve({ success: true, version: stdout.trim() });
      }
    });
  });
}

// Helper to manually run the update logic
function runUpdate() {
  return new Promise((resolve) => {
    const scriptPath = join(__dirname, '../scripts/download-yt-dlp.js');
    console.log(`Executing update script at: ${scriptPath}`);
    exec(`node "${scriptPath}" --force`, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: stderr || error.message });
      } else {
        resolve({ success: true, output: stdout.trim() });
      }
    });
  });
}

async function runTests() {
  console.log('--- Testing yt-dlp Version Retrieval ---');
  const ver = await getVersion();
  console.log('Result:', ver);

  console.log('\n--- Testing yt-dlp Update Trigger ---');
  const upd = await runUpdate();
  console.log('Result:', upd);
}

runTests();
