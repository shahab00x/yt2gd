import { downloadFile } from '../server/services/downloader.js';
import { existsSync, statSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';

// Debian 12.9.0 netinst magnet
const magnet = 'magnet:?xt=urn:btih:618f3d6117b35581177695ed24b896942c78f99e&dn=debian-12.9.0-amd64-netinst.iso&tr=http%3A%2F%2Fbttracker.debian.org%3A6969%2Fannounce';

async function test() {
  console.log('🧪 Starting Torrent Download Test...');
  try {
    const result = await downloadFile(magnet, 'video', 'best', null, (p) => {
      console.log('  [Progress]', p);
    });

    console.log('✅ Download Result:', result);

    if (typeof result === 'object' && result.zipPath) {
      if (existsSync(result.zipPath)) {
        console.log(`📦 ZIP file exists: ${result.zipPath} (${statSync(result.zipPath).size} bytes)`);
      } else {
        throw new Error('ZIP file NOT found!');
      }

      if (existsSync(result.downloadDir)) {
        console.log(`📁 Source dir exists: ${result.downloadDir}`);
      } else {
        throw new Error('Source directory NOT found!');
      }

      // Clean up
      console.log('🧹 Cleaning up...');
      unlinkSync(result.zipPath);
      rmSync(result.downloadDir, { recursive: true, force: true });
      console.log('✨ Cleanup done.');
    } else {
      throw new Error('Result was not an object with zipPath');
    }
  } catch (err) {
    console.error('❌ Test failed:', err.message);
    process.exit(1);
  }
}

test();
