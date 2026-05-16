import { exec } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getCommits() {
  return new Promise((resolve, reject) => {
    exec('git log -5 --pretty=format:"%H|%h|%s|%cr|%d"', { cwd: join(__dirname, '..') }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(stderr || error.message));
      }
      const lines = stdout.trim().split('\n').filter(Boolean);
      const commits = lines.map(line => {
        const [hash, shortHash, subject, date, refs] = line.split('|');
        const isActive = refs && refs.includes('HEAD');
        return { hash, shortHash, subject, date, isActive };
      });
      resolve(commits);
    });
  });
}

getCommits().then(commits => {
  console.log('Successfully retrieved commits:');
  console.log(JSON.stringify(commits, null, 2));
}).catch(err => {
  console.error('Failed to get commits:', err);
});
