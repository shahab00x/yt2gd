import { relative } from 'path';

function test(dirPath, filePath) {
    const rel = relative(dirPath, filePath);
    const relativePath = rel.replace(/\\/g, '/');
    const pathParts = relativePath.split('/');
    const fileName = pathParts.pop();
    const subPath = pathParts.join('/');
    
    console.log(`Dir:  ${dirPath}`);
    console.log(`File: ${filePath}`);
    console.log(`Rel:  ${rel}`);
    console.log(`Final RelPath: ${relativePath}`);
    console.log(`SubPath: ${subPath}`);
    console.log(`FileName: ${fileName}`);
    console.log('---');
}

console.log('Testing Linux-style paths:');
test('/app/tmp/torrent_123/MyTorrent', '/app/tmp/torrent_123/MyTorrent/folder1/file.txt');
test('/app/tmp/torrent_123/MyTorrent', '/app/tmp/torrent_123/MyTorrent/file.txt');

console.log('Testing Windows-style paths (simulated):');
// Note: path.relative uses process.platform. Since I am on Windows, it will use \.
test('C:\\tmp\\torrent_123\\MyTorrent', 'C:\\tmp\\torrent_123\\MyTorrent\\folder1\\file.txt');
test('C:\\tmp\\torrent_123\\MyTorrent', 'C:\\tmp\\torrent_123\\MyTorrent/folder1/file.txt'); // Mixed slashes
