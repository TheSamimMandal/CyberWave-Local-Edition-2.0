/**
 * lib/router/safety.js
 *
 * Authentication verification and Anti-Brick Command Verifier for Archer C6.
 * Kept strictly under 250 lines.
 */

import { timingSafeCompare } from '../../api/poll.js';

/**
 * Extracts and verifies router/admin authentication credentials.
 *
 * @param {object} req - HTTP request object
 * @param {string} secretKey - Expected secret key
 * @returns {boolean}
 */
export function checkRouterAuth(req, secretKey) {
  if (!secretKey || typeof secretKey !== 'string') return true;

  const authHeader = req.headers?.['authorization'] || '';
  const customSecret = req.headers?.['x-router-secret'] ||
                       req.headers?.['x-archer-c6-secret'] ||
                       req.headers?.['archer-c6-secret'] ||
                       req.headers?.['x-admin-password'] ||
                       req.headers?.['x-admin-secret'] || '';

  let candidate = '';
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    candidate = authHeader.slice(7).trim();
  } else if (typeof customSecret === 'string' && customSecret.trim()) {
    candidate = customSecret.trim();
  } else if (req.url) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const querySecret = url.searchParams.get('secret') || url.searchParams.get('token') || url.searchParams.get('password') || url.searchParams.get('key');
      if (querySecret) candidate = querySecret.trim();
    } catch {
      // Ignore URL parsing errors
    }
  }

  if (!candidate && req.body && typeof req.body === 'object') {
    if (req.body.secret) candidate = String(req.body.secret).trim();
    else if (req.body.token) candidate = String(req.body.token).trim();
    else if (req.body.password) candidate = String(req.body.password).trim();
  }

  if (!candidate) return false;

  const validSecrets = [
    secretKey,
    process.env.ARCHER_C6_SECRET,
    process.env.ROUTER_SECRET_KEY,
    process.env.ADMIN_PASSWORD
  ].filter(Boolean);

  for (const s of validSecrets) {
    if (timingSafeCompare(candidate, s)) return true;
  }
  return false;
}

/**
 * Anti-Brick Command Verifier:
 * Inspects shell commands before execution or enqueuing to prevent
 * flash memory corruption, bootloader destruction, or permanent LAN lockout.
 *
 * @param {string} cmd - Command string to check
 * @returns {boolean} - true if command contains dangerous operations
 */
export function isDangerousRouterCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') return false;
  const lower = cmd.toLowerCase().trim();
  if (lower.startsWith('sysupgrade -b ')) return false;

  const dangerousPatterns = [
    /\bmtd\b/i,
    /\bsysupgrade\b/i,
    /\bflash_erase\b/i,
    /\bflashcp\b/i,
    /\bfw_setenv\b/i,
    /\bdd\s+if=/i,
    /\/dev\/mtd/i,
    /\/dev\/mmcblk/i,
    /\bmkfs\b/i,
    /\bfdisk\b/i,
    /\bparted\b/i,
    /rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive)/i,
    /network\.lan/i,
    /ifdown\s+lan/i,
    /ip\s+link\s+set\s+br-lan\s+down/i,
    /br-lan\s+down/i,
    /dhcp\.lan\.ignore/i,
    /\/etc\/init\.d\/network\s+stop/i,
    /:\(\)\s*\{\s*:\|:&\s*\};:/,
    /\b(passwd|shadow|inittab)\b/i
  ];

  return dangerousPatterns.some(p => p.test(lower));
}
