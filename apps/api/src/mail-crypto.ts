/**
 * Encryption for what the tool keeps of each salesperson's Microsoft connection (the refresh token) and for the
 * short-lived sign-in state cookie. AES-256-GCM with the MAIL_TOKEN_KEY secret; each value is bound to a purpose
 * (the additional data, e.g. the owner's email), so a stored value cannot be moved to another row and still open.
 *
 * Sealed form: "v1.<iv>.<ciphertext>" in base64url. open() returns undefined for anything it cannot open (a changed
 * key, a tampered or foreign value): the caller treats that as "connect Outlook again", never as an error.
 * Nothing here logs.
 */

const b64url = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64 = (s: string): Uint8Array => {
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/** The key from its base64 form; undefined unless it is exactly 32 bytes. */
export async function importTokenKey(base64: string | undefined): Promise<CryptoKey | undefined> {
  if (!base64) return undefined;
  let raw: Uint8Array;
  try {
    raw = fromB64(base64.trim());
  } catch {
    return undefined;
  }
  if (raw.byteLength !== 32) return undefined;
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function seal(key: CryptoKey, plaintext: string, purpose: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(purpose) }, key, new TextEncoder().encode(plaintext));
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

export async function open(key: CryptoKey, sealed: string, purpose: string): Promise<string | undefined> {
  const [v, iv, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !ct) return undefined;
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv), additionalData: new TextEncoder().encode(purpose) }, key, fromB64(ct));
    return new TextDecoder().decode(pt);
  } catch {
    return undefined;
  }
}
