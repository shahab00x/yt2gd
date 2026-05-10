import { saveTransfer, getTransfers, deleteTransfer } from '../server/services/store.js';

const testId = 'test_' + Date.now();
saveTransfer(testId, { name: 'Test Torrent', status: 'downloading', progress: 50 });

const transfers = getTransfers();
console.log('Transfers:', transfers);

if (transfers[testId] && transfers[testId].name === 'Test Torrent') {
  console.log('✅ Task 1.2 Verified: Store works.');
  deleteTransfer(testId);
} else {
  console.error('❌ Task 1.2 Failed: Store did not save/load correctly.');
}
