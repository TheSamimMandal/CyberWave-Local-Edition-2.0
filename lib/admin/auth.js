/**
 * lib/admin/auth.js
 *
 * Secure server-side persistent Admin authentication and password management
 * for CyberWave Admin Panel on Google AI Studio.
 * Uses cryptographically strong scrypt hashing with per-installation random salts.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { timingSafeCompare } from '../../api/poll.js';

export const MAC_REGEX = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');
const AUTH_FILE_PATH = path.join(ROOT_DIR, 'data/admin-auth.json');

export const DEFAULT_INITIAL_PASSWORD = 'CyberWave@2026';

let authCache = null;
let lastMtime = 0;

/**
 * Computes scrypt hash of a password with a hex salt
 */
export function hashPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

/**
 * Reads or initializes the persistent admin authentication record
 */
export function getAdminAuthConfig() {
  try {
    if (fs.existsSync(AUTH_FILE_PATH)) {
      const stats = fs.statSync(AUTH_FILE_PATH);
      if (!authCache || stats.mtimeMs !== lastMtime) {
        const raw = fs.readFileSync(AUTH_FILE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.salt && parsed.hash) {
          authCache = parsed;
          lastMtime = stats.mtimeMs;
        }
      }
      if (authCache) return authCache;
    }
  } catch (err) {
    console.warn('[Admin Auth] Error reading data/admin-auth.json:', err.message);
  }

  // Initialize with initial password or process.env.ADMIN_PASSWORD
  const seedPassword = process.env.ADMIN_PASSWORD?.trim() || DEFAULT_INITIAL_PASSWORD;
  const isDefault = !process.env.ADMIN_PASSWORD;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(seedPassword, salt);

  const initialRecord = {
    salt,
    hash,
    updatedAt: new Date().toISOString(),
    isDefault
  };

  try {
    fs.mkdirSync(path.dirname(AUTH_FILE_PATH), { recursive: true });
    fs.writeFileSync(AUTH_FILE_PATH, JSON.stringify(initialRecord, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Admin Auth] Error creating data/admin-auth.json:', err.message);
  }

  authCache = initialRecord;
  return authCache;
}

/**
 * Returns safe metadata about admin authentication status (no secrets)
 */
export function getAdminAuthStatus() {
  const config = getAdminAuthConfig();
  return {
    isConfigured: true,
    isDefault: Boolean(config.isDefault),
    updatedAt: config.updatedAt || null
  };
}

/**
 * Verifies candidate password against stored hash or environment variables
 */
export function verifyAdminPassword(candidate) {
  if (!candidate || typeof candidate !== 'string') return false;

  const trimmed = candidate.trim();
  if (!trimmed) return false;

  // 1. Direct env variable check if set
  if (process.env.ADMIN_PASSWORD && timingSafeCompare(trimmed, process.env.ADMIN_PASSWORD)) {
    return true;
  }
  if (process.env.ROUTER_SECRET_KEY && timingSafeCompare(trimmed, process.env.ROUTER_SECRET_KEY)) {
    return true;
  }

  // 2. Persistent scrypt hash verification
  try {
    const config = getAdminAuthConfig();
    if (!config?.salt || !config?.hash) return false;

    const candidateHash = hashPassword(trimmed, config.salt);
    const candidateBuf = Buffer.from(candidateHash, 'hex');
    const storedBuf = Buffer.from(config.hash, 'hex');

    if (candidateBuf.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(candidateBuf, storedBuf);
  } catch (err) {
    console.error('[Admin Auth] Verification error:', err);
    return false;
  }
}

/**
 * Extracts and verifies the admin credentials from request headers, query string, or body.
 * Supports backward-compatible check with explicit expectedSecret.
 *
 * @param {object} req - HTTP request object
 * @param {string} [expectedSecret] - Optional explicit secret or password for unit tests
 * @returns {boolean} - True if authenticated, false otherwise
 */
export function checkAdminAuth(req, expectedSecret) {
  if (!req || typeof req !== 'object') return false;

  const authHeader = req.headers?.['authorization'] || '';
  const customHeader = req.headers?.['x-admin-password'] || req.headers?.['x-admin-secret'] || '';

  let candidate = '';

  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    candidate = authHeader.slice(7).trim();
  } else if (typeof customHeader === 'string' && customHeader.trim()) {
    candidate = customHeader.trim();
  } else if (req.url) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const querySecret = url.searchParams.get('password') || url.searchParams.get('secret');
      if (querySecret) candidate = querySecret.trim();
    } catch {
      // Ignore URL parsing errors
    }
  }

  if (!candidate && req.body && typeof req.body === 'object' && req.body.password) {
    candidate = String(req.body.password).trim();
  }

  if (!candidate) return false;

  if (expectedSecret && typeof expectedSecret === 'string') {
    return timingSafeCompare(candidate, expectedSecret);
  }

  return verifyAdminPassword(candidate);
}

/**
 * Changes admin password after verifying current password
 */
export function changeAdminPassword(currentPassword, newPassword) {
  if (!verifyAdminPassword(currentPassword)) {
    return {
      ok: false,
      error: 'Current password is incorrect (বর্তমান পাসওয়ার্ডটি সঠিক নয়)।'
    };
  }

  if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 6) {
    return {
      ok: false,
      error: 'New password must be at least 6 characters long (নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে)।'
    };
  }

  return resetAdminPassword(newPassword.trim(), false);
}

/**
 * Resets admin password directly and saves to persistent storage
 */
export function resetAdminPassword(newPassword, isDefault = false) {
  if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 4) {
    return {
      ok: false,
      error: 'Password must be at least 4 characters long.'
    };
  }

  const cleanPassword = newPassword.trim();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(cleanPassword, salt);

  const updatedRecord = {
    salt,
    hash,
    updatedAt: new Date().toISOString(),
    isDefault
  };

  try {
    fs.mkdirSync(path.dirname(AUTH_FILE_PATH), { recursive: true });
    fs.writeFileSync(AUTH_FILE_PATH, JSON.stringify(updatedRecord, null, 2), 'utf8');
    authCache = updatedRecord;
    // Also keep process.env in sync if applicable
    process.env.ADMIN_PASSWORD = cleanPassword;

    console.log(`[Admin Auth] Password updated successfully (isDefault=${isDefault})`);
    return {
      ok: true,
      success: true,
      message: 'Admin password updated successfully (অ্যাডমিন পাসওয়ার্ড সফলভাবে পরিবর্তিত হয়েছে)।',
      authStatus: {
        isConfigured: true,
        isDefault,
        updatedAt: updatedRecord.updatedAt
      }
    };
  } catch (err) {
    console.error('[Admin Auth] Failed to save password to disk:', err);
    return {
      ok: false,
      error: 'Failed to persist password to server disk: ' + err.message
    };
  }
}

