/**
 * crypto.js — Client-side AES-256-GCM encryption/decryption.
 * 
 * Messages are encrypted HERE, in the browser, before being sent
 * to the backend or stored on-chain. The backend never sees plaintext
 * (except transiently for AI inference — see architecture notes in README).
 * 
 * Key derivation: PBKDF2 from wallet address + random salt, stored locally.
 * For production, use wallet signing to derive a deterministic key so
 * the user can recover history on any device.
 */

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // bytes for AES-GCM

/**
 * Generate a new AES-256 key.
 */
export async function generateKey() {
  return crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true, // extractable
    ['encrypt', 'decrypt'],
  );
}

/**
 * Export a CryptoKey to a base64 string for storage.
 */
export async function exportKey(cryptoKey) {
  const raw = await crypto.subtle.exportKey('raw', cryptoKey);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

/**
 * Import a base64 key string back to a CryptoKey.
 */
export async function importKey(base64Key) {
  const raw = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt a UTF-8 string with AES-256-GCM.
 * Returns { ciphertext: base64, iv: base64 }
 */
export async function encryptMessage(plaintext, cryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    cryptoKey,
    encoded,
  );

  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertextBuffer))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

/**
 * Decrypt a base64-encoded AES-256-GCM ciphertext.
 * Returns the plaintext string.
 */
export async function decryptMessage(ciphertextBase64, ivBase64, cryptoKey) {
  const ciphertext = Uint8Array.from(atob(ciphertextBase64), c => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));

  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    cryptoKey,
    ciphertext,
  );

  return new TextDecoder().decode(plaintextBuffer);
}

/**
 * Get or create the encryption key for a wallet address.
 * Stored in localStorage (keyed by wallet address).
 * 
 * Production upgrade: derive from wallet signature for cross-device recovery.
 */
export async function getOrCreateKey(walletAddress) {
  const storageKey = `aura_enc_key_${walletAddress}`;
  const stored = localStorage.getItem(storageKey);

  if (stored) {
    return importKey(stored);
  }

  const key = await generateKey();
  const exported = await exportKey(key);
  localStorage.setItem(storageKey, exported);
  return key;
}

/**
 * Export the raw key as base64 (for on-chain storage as encrypted_key field).
 * In production: this would be the key encrypted with the user's public key.
 */
export async function getExportedKey(walletAddress) {
  const key = await getOrCreateKey(walletAddress);
  return exportKey(key);
}
