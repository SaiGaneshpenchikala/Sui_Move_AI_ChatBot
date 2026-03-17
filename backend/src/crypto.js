/**
 * crypto.js — Encryption utilities.
 * 
 * The backend never sees plaintext messages. It receives ciphertext from
 * the frontend, stores it on-chain, and retrieves it. Decryption happens
 * only on the client side using the user's key.
 * 
 * This module contains helpers for the backend to verify ciphertext
 * format integrity (length, IV presence) without decrypting.
 */

/**
 * Validate that a ciphertext submission looks well-formed.
 * Does NOT decrypt — just sanity checks the structure.
 */
export function validateCiphertextBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') return false;
  if (!bundle.ciphertext || typeof bundle.ciphertext !== 'string') return false;
  if (!bundle.iv || typeof bundle.iv !== 'string') return false;
  
  // IV for AES-256-GCM should be 12 bytes = 16 base64 chars
  const ivBytes = Buffer.from(bundle.iv, 'base64');
  if (ivBytes.length !== 12) return false;
  
  // Ciphertext should not be empty and not too large (8KB limit matches contract)
  const ctBytes = Buffer.from(bundle.ciphertext, 'base64');
  if (ctBytes.length === 0 || ctBytes.length > 8192) return false;
  
  return true;
}

/**
 * Convert base64 string to Uint8Array for Sui transactions.
 */
export function base64ToBytes(b64) {
  return Buffer.from(b64, 'base64');
}

/**
 * Convert Uint8Array/Buffer to base64 string.
 */
export function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}
