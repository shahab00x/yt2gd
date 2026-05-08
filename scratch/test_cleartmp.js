import { clearTmp, TMP_DIR } from '../server/services/downloader.js';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
writeFileSync(join(TMP_DIR, 'test_file.txt'), 'hello');

console.log('Before cleanup, file exists:', existsSync(join(TMP_DIR, 'test_file.txt')));
clearTmp();
console.log('After cleanup, file exists:', existsSync(join(TMP_DIR, 'test_file.txt')));
console.log('TMP_DIR exists:', existsSync(TMP_DIR));
