/**
 * Network parameters and constants for Pocketcoin / Bastyon.
 * Ported 1:1 from bastyon-poster-linux/src/constants.py
 */

export const MAINNET = {
  name: 'mainnet',
  pubkeyPrefix: 55, // 0x37 -> 'P'
  scriptPrefix: 80, // 0x50 -> 'Z'
  wifPrefix: 33,    // 0x21
  p2pPort: 37070,
  defaultNodes: [
    'https://1.pocketnet.app:8899',
    'https://2.pocketnet.app:8899',
    'https://3.pocketnet.app:8899',
    'https://4.pocketnet.app:8899',
    'https://5.pocketnet.app:8899',
    'https://6.pocketnet.app:8899',
  ],
};

export const TESTNET = {
  name: 'testnet',
  pubkeyPrefix: 65, // 0x41 -> 'T'
  scriptPrefix: 78, // 0x4E -> 'Y'
  wifPrefix: 30,    // 0x1E
  p2pPort: 36060,
  defaultNodes: ['https://testnet.pocketnet.app:8899'],
};

// On-chain rules & size limits
export const DUST_THRESHOLD = 700;       // Satoshis (0.00000700 PKOIN)
export const DEFAULT_FEE = 1000;         // Satoshis (0.00001000 PKOIN)
export const MAX_PAYLOAD_SIZE = 60_000;  // Bytes (60 KB)
