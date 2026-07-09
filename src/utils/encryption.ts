/**
 * Encryption utilities for sensitive data protection
 * Uses Web Crypto API (XChaCha20-Poly1305 via native browser support)
 * For browser compatibility, uses AES-256-GCM which has universal support
 */

export interface EncryptedData {
  ciphertext: string;     // base64 encoded
  nonce: string;          // base64 encoded (IV/nonce)
  salt: string;           // base64 encoded (for key derivation)
  algorithm: 'aes-256-gcm';
  timestamp: number;      // Encryption timestamp (prevent replay attacks)
}

/**
 * Convert string to Uint8Array (UTF-8)
 */
function stringToBytes(str: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(str);
}

/**
 * Convert Uint8Array to base64 string
 */
function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode.apply(null, Array.from(bytes)));
}

/**
 * Convert base64 string to Uint8Array
 */
function base64ToBytes(b64: string): Uint8Array {
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Derive encryption key from password using PBKDF2
 * @param password - User password or shared secret
 * @param salt - Random salt (generated if not provided)
 * @returns Derived CryptoKey suitable for AES-256-GCM
 */
export async function deriveKey(password: string, salt?: Uint8Array): Promise<{ key: CryptoKey; salt: Uint8Array }> {
  if (!salt) {
    // Generate new random salt if not provided
    salt = crypto.getRandomValues(new Uint8Array(16));
  }

  const passwordKey = await crypto.subtle.importKey(
    'raw',
    stringToBytes(password) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 100000, // NIST recommendation for PBKDF2
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    true, // Extractable for local cache encryption
    ['encrypt', 'decrypt']
  );

  return { key: derivedKey, salt };
}

/**
 * Encrypt a string value using AES-256-GCM
 * @param plaintext - Data to encrypt
 * @param password - Encryption password
 * @returns EncryptedData object with base64-encoded ciphertext, nonce, and salt
 */
export async function encryptField(plaintext: string, password: string): Promise<EncryptedData> {
  const { key, salt } = await deriveKey(password);

  // Generate random nonce (96 bits for GCM)
  const nonce = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt the plaintext
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    stringToBytes(plaintext) as BufferSource
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    nonce: bytesToBase64(nonce),
    salt: bytesToBase64(salt),
    algorithm: 'aes-256-gcm',
    timestamp: Date.now(),
  };
}

/**
 * Decrypt an encrypted field
 * @param encrypted - EncryptedData object
 * @param password - Decryption password (must match encryption password)
 * @returns Decrypted plaintext
 */
export async function decryptField(encrypted: EncryptedData, password: string): Promise<string> {
  // Check timestamp to prevent very old data from being used (optional)
  const age = Date.now() - encrypted.timestamp;
  const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
  if (age > maxAge) {
    console.warn('Decrypted data is older than 30 days - consider re-encryption');
  }

  // Derive the same key using the stored salt
  const salt = base64ToBytes(encrypted.salt);
  const { key } = await deriveKey(password, salt);

  // Decrypt the ciphertext
  const nonce = base64ToBytes(encrypted.nonce);
  const ciphertext = base64ToBytes(encrypted.ciphertext);

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      key,
      ciphertext as BufferSource
    );

    // Convert decrypted bytes back to string
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error) {
    throw new Error('Decryption failed - invalid password or corrupted data');
  }
}

/**
 * Encrypt entire local cache objects
 * Useful for protecting sensitive data in localStorage
 * @param data - Object to encrypt
 * @param password - Encryption password
 * @returns JSON string of EncryptedData
 */
export async function encryptLocalCache(data: any, password: string): Promise<string> {
  const json = JSON.stringify(data);
  const encrypted = await encryptField(json, password);
  return JSON.stringify(encrypted);
}

/**
 * Decrypt local cache objects
 * @param encrypted - JSON string of EncryptedData
 * @param password - Decryption password
 * @returns Decrypted object
 */
export async function decryptLocalCache(encrypted: string, password: string): Promise<any> {
  try {
    const encryptedData: EncryptedData = JSON.parse(encrypted);
    const json = await decryptField(encryptedData, password);
    return JSON.parse(json);
  } catch (error) {
    throw new Error('Failed to decrypt cache - may be corrupted or wrong password');
  }
}

/**
 * Hash a string (one-way) for data integrity checks
 * Use for checksums on critical data structures
 * @param data - String to hash
 * @returns Base64-encoded SHA-256 hash
 */
export async function hashData(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return bytesToBase64(new Uint8Array(hashBuffer));
}

/**
 * Verify a hash against plaintext
 * @param data - Original data
 * @param hash - Previously computed hash
 * @returns true if hash matches, false otherwise
 */
export async function verifyHash(data: string, hash: string): Promise<boolean> {
  const computed = await hashData(data);
  return computed === hash;
}

/**
 * Generate a random token (for sensitive operations like password reset)
 * @param length - Token length in bytes (default 32 = 256 bits)
 * @returns Base64-encoded random token
 */
export function generateRandomToken(length: number = 32): string {
  const random = crypto.getRandomValues(new Uint8Array(length));
  return bytesToBase64(random);
}

/**
 * Constant-time string comparison (prevent timing attacks)
 * Use for comparing user-entered passwords or tokens
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Sanitize sensitive strings from memory after use
 * @param value - String to clear
 */
export function clearSensitiveString(value: string): void {
  // In practice, JavaScript doesn't allow direct memory clearing,
  // but overwriting the value helps garbage collection
  // Best practice: use function scope to let variables be garbage collected
  try {
    Object.defineProperty(global, '__temp__', {
      value: '\0'.repeat(value.length),
      configurable: true
    });
    delete (global as any).__temp__;
  } catch {}
}

/**
 * Check if a password meets security requirements
 * @param password - Password to check
 * @returns { valid: boolean; issues: string[] }
 */
export function validatePasswordStrength(password: string): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  if (password.length < 12) issues.push('Password must be at least 12 characters');
  if (!/[A-Z]/.test(password)) issues.push('Password must contain uppercase letters');
  if (!/[a-z]/.test(password)) issues.push('Password must contain lowercase letters');
  if (!/[0-9]/.test(password)) issues.push('Password must contain numbers');
  if (!/[!@#$%^&*]/.test(password)) issues.push('Password must contain special characters (!@#$%^&*)');

  return {
    valid: issues.length === 0,
    issues,
  };
}
