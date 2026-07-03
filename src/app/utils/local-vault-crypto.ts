/**
 * Browser-local AES-GCM encryption for optional YAML secrets.
 * DEK is stored separately (see SecretsYamlVaultService). Same-origin XSS can still exfiltrate — not a substitute for server-side secrets.
 */

const PREFIX = 'v1:';

function uint8ToB64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i++) {
    s += String.fromCharCode(u8[i]);
  }
  return btoa(s);
}

function b64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

async function importDek(raw32: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw32, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function getOrCreateDataEncryptionKey(): Promise<{ key: CryptoKey; rawB64: string }> {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const key = await importDek(raw);
  return { key, rawB64: uint8ToB64(raw) };
}

export async function importDekFromBase64(rawB64: string): Promise<CryptoKey> {
  const raw = b64ToUint8(rawB64);
  if (raw.length !== 32) {
    throw new Error('Invalid DEK length');
  }
  return importDek(raw);
}

export async function encryptWithKey(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  );
  const combined = new Uint8Array(iv.length + enc.length);
  combined.set(iv);
  combined.set(enc, iv.length);
  return PREFIX + uint8ToB64(combined);
}

export async function decryptWithKey(key: CryptoKey, stored: string): Promise<string> {
  if (!stored.startsWith(PREFIX)) {
    throw new Error('Not encrypted payload');
  }
  const combined = b64ToUint8(stored.slice(PREFIX.length));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(dec);
}
