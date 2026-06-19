// IMAP/SMTP 帳密的 at-rest 加密 (AES-256-GCM, Web Crypto)。
// 金鑰來自 env.IMAP_ENCRYPTION_KEY (base64 編碼的 32 bytes)。
// 格式: "enc:v1:" + base64(iv(12) | ciphertext+tag)。
// 向後相容: 未加密 (無前綴) 的舊值原樣回傳；無金鑰時 encrypt 為 no-op。

const ENC_PREFIX = 'enc:v1:';

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(keyB64);
  if (raw.length !== 32) {
    throw new Error(`IMAP_ENCRYPTION_KEY must be base64 of 32 bytes, got ${raw.length}`);
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

export async function encryptSecret(plaintext: string, keyB64: string | undefined): Promise<string> {
  if (!plaintext) return plaintext;
  if (!keyB64) return plaintext; // 無金鑰 (本機/未設定) → 原樣儲存
  if (isEncrypted(plaintext)) return plaintext; // 已加密，避免重複
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const combined = new Uint8Array(iv.length + ct.length);
  combined.set(iv, 0);
  combined.set(ct, iv.length);
  return ENC_PREFIX + bytesToBase64(combined);
}

export async function decryptSecret(value: string, keyB64: string | undefined): Promise<string> {
  if (!isEncrypted(value)) return value; // 舊明文或空值 → 原樣回傳
  if (!keyB64) {
    throw new Error('遇到加密的憑證但未設定 IMAP_ENCRYPTION_KEY');
  }
  const key = await importKey(keyB64);
  const combined = base64ToBytes(value.slice(ENC_PREFIX.length));
  const iv = combined.slice(0, 12);
  const ct = combined.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}
