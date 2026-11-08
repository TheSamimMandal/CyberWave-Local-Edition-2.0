/**
 * lib/redis-utils.js
 *
 * Helper utilities for Upstash Redis data decoding and transformations.
 */

function decodeBase64IfEncoded(str) {
  if (typeof str !== 'string' || str.length < 4) return str;
  const plainWords = new Set([
    'true', 'false', 'unused', 'active', 'expired', 'revoked',
    'pending', 'authorized', 'terminated', 'rejected', 'session',
    'voucher', 'Admin', 'User', 'Guest'
  ]);
  if (plainWords.has(str)) return str;
  if (!/^[A-Za-z0-9+/=]{4,}$/.test(str) || str.includes(' ')) return str;

  try {
    const buf = Buffer.from(str, 'base64');
    const decoded = buf.toString('utf8');
    if (buf.toString('base64') !== str) return str;
    if (!/^[\x20-\x7E]+$/.test(decoded)) return str;
    return decoded;
  } catch {
    return str;
  }
}

export function decodeUpstashHash(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const decoded = {};
  for (const [k, v] of Object.entries(obj)) {
    const cleanKey = decodeBase64IfEncoded(k);
    const cleanVal = typeof v === 'string' ? decodeBase64IfEncoded(v) : v;
    decoded[cleanKey] = cleanVal;
    if (cleanKey !== k) decoded[k] = v;
  }
  return decoded;
}
