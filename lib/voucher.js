/**
 * lib/voucher.js
 *
 * Guest Voucher & Passcode Management Engine for Captive Portal.
 * Enables self-service instant access for offline guests without admin delay.
 * Supports single & batch generation, MAC binding, activation tracking,
 * revocation, CSV/JSON export, and dual local disk / Redis persistence.
 * Kept modular and robust.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAC_REGEX } from './telegram/parsers.js';
import { escapeMarkdown } from '../api/request.js';
import { decodeUpstashHash } from './redis-utils.js';
import { enqueueCommandForRouter } from './router/bridge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../');
const VOUCHERS_FILE = path.join(ROOT_DIR, 'data/vouchers.json');

// Local in-memory cache for vouchers
let localVouchers = null;

function loadLocalVouchers() {
  if (localVouchers !== null) return localVouchers;
  try {
    if (fs.existsSync(VOUCHERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(VOUCHERS_FILE, 'utf8'));
      if (Array.isArray(data)) {
        localVouchers = new Map(data.map(v => [v.code, v]));
        return localVouchers;
      }
    }
  } catch (e) {
    console.warn('[Vouchers] Failed to load local vouchers:', e.message);
  }
  localVouchers = new Map();
  return localVouchers;
}

function saveLocalVouchers() {
  if (!localVouchers) return;
  try {
    const dir = path.dirname(VOUCHERS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const arr = Array.from(localVouchers.values());
    fs.writeFileSync(VOUCHERS_FILE, JSON.stringify(arr, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Vouchers] Failed to save local vouchers:', e.message);
  }
}

export function generateVoucherCode(prefix = 'PASS') {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let randomPart = '';
  for (let i = 0; i < 4; i++) {
    randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const cleanPrefix = (prefix || 'PASS').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return `${cleanPrefix}-${randomPart}`;
}

export async function createVoucher(redis, durationMinutes = 120, createdBy = 'Admin', note = '', prefix = 'PASS') {
  const duration = parseInt(durationMinutes, 10);
  const safeDuration = (!isNaN(duration) && duration >= 0) ? duration : 120;
  const code = generateVoucherCode(prefix);
  const nowIso = new Date().toISOString();
  const ttlSeconds = 86400 * 7; // Voucher valid to be redeemed within 7 days

  const voucherData = {
    code,
    duration: safeDuration,
    createdBy: createdBy || 'Admin',
    note: note || '',
    createdAt: nowIso,
    status: 'unused', // 'unused' | 'active' | 'expired' | 'revoked'
    redeemed: 'false',
    redeemedAt: '',
    redeemedByMac: '',
    expiresAt: ''
  };

  const map = loadLocalVouchers();
  map.set(code, voucherData);
  saveLocalVouchers();

  if (redis) {
    try {
      await redis.hset(`voucher:${code}`, voucherData);
      await redis.expire(`voucher:${code}`, ttlSeconds);
      await redis.sadd('active_vouchers', code);
    } catch (e) {
      console.warn('[Vouchers] Redis write warning:', e.message);
    }
  }

  return voucherData;
}

export async function createVouchers(redis, count = 5, durationMinutes = 120, createdBy = 'Admin', note = '', prefix = 'PASS') {
  const safeCount = Math.min(Math.max(1, parseInt(count, 10) || 1), 50);
  const created = [];
  for (let i = 0; i < safeCount; i++) {
    const v = await createVoucher(redis, durationMinutes, createdBy, note, prefix);
    created.push(v);
  }
  return created;
}

export async function redeemVoucher(redis, code, clientMac, clientIp = '', clientName = '') {
  if (!code || !clientMac) {
    return { ok: false, error: 'ভাউচার কোড এবং ম্যাক অ্যাড্রেস প্রয়োজন।' };
  }

  const cleanCode = String(code).trim().toUpperCase();
  const cleanMac = clientMac.toLowerCase().replace(/-/g, ':');

  if (!MAC_REGEX.test(cleanMac)) {
    return { ok: false, error: 'সঠিক MAC অ্যাড্রেস প্রদান করুন।' };
  }

  let voucher = null;
  if (redis) {
    try {
      const raw = await redis.hgetall(`voucher:${cleanCode}`);
      voucher = decodeUpstashHash(raw);
    } catch {}
  }

  if (!voucher || !voucher.code) {
    const map = loadLocalVouchers();
    voucher = map.get(cleanCode) || null;
  }

  if (!voucher || !voucher.code) {
    return { ok: false, error: 'ভাউচার কোডটি সঠিক নয় অথবা মেয়াদ উত্তীর্ণ হয়েছে।' };
  }

  if (voucher.status === 'revoked') {
    return { ok: false, error: 'এই ভাউচার কোডটি বাতিল (Revoked) করা হয়েছে।' };
  }

  if (voucher.redeemed === 'true') {
    // If bound to same MAC and not expired, allow re-auth
    if (voucher.redeemedByMac && voucher.redeemedByMac.toLowerCase() === cleanMac) {
      const now = Date.now();
      const expEpoch = voucher.expiresAt ? new Date(voucher.expiresAt).getTime() : 0;
      if (!expEpoch || now < expEpoch) {
        const remainingMin = expEpoch ? Math.max(1, Math.round((expEpoch - now) / 60000)) : parseInt(voucher.duration, 10);
        return {
          ok: true,
          code: cleanCode,
          mac: cleanMac,
          duration: remainingMin,
          reconnected: true,
          message: `আপনার ভাউচার সেশন চালু রয়েছে (${remainingMin} মিনিট বাকি)।`
        };
      }
    }
    return { ok: false, error: 'এই ভাউচার কোডটি ইতিমধ্যে ব্যবহার করা হয়েছে।' };
  }

  const duration = parseInt(voucher.duration, 10);
  const safeDuration = (!isNaN(duration) && duration >= 0) ? duration : 120;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const expiresAt = safeDuration === 0 ? '' : new Date(now + safeDuration * 60000).toISOString();

  // Mark voucher as redeemed and bound to this MAC
  voucher.redeemed = 'true';
  voucher.status = 'active';
  voucher.redeemedAt = nowIso;
  voucher.redeemedByMac = cleanMac;
  voucher.expiresAt = expiresAt;

  const map = loadLocalVouchers();
  map.set(cleanCode, voucher);
  saveLocalVouchers();

  const command = `ndsctl auth ${cleanMac} ${safeDuration}`;

  if (redis) {
    try {
      await redis.hset(`voucher:${cleanCode}`, voucher);
      await redis.srem('active_vouchers', cleanCode);
      await redis.sadd('used_vouchers', cleanCode);
      await redis.rpush('pending_commands', command);
      await redis.hset(`request:${cleanMac}`, {
        status: 'authorized',
        duration: safeDuration,
        mode: safeDuration === 0 ? 'session' : 'voucher',
        reviewedBy: `Voucher (${cleanCode})`,
        reviewedAt: nowIso,
        ip: clientIp || '',
        name: clientName || `Guest (${cleanCode})`
      });
    } catch (e) {
      console.warn('[Vouchers] Redis redeem sync warning:', e.message);
    }
  }

  // Dispatch nds_auth command to OpenWrt Router Bridge queue
  try {
    await enqueueCommandForRouter({
      action: 'nds_auth',
      command: 'nds_auth',
      target: cleanMac,
      value: safeDuration,
      routerCmd: command
    }, redis);
  } catch (err) {
    console.warn('[Vouchers] Router command enqueue warning:', err.message);
  }

  // Update in-memory local state if dev server or bridge is running
  if (Array.isArray(globalThis.__localDevQueue)) {
    globalThis.__localDevQueue.push({ command: 'nds_auth', target: cleanMac, value: safeDuration, routerCmd: command });
  }

  return {
    ok: true,
    code: cleanCode,
    mac: cleanMac,
    duration: safeDuration,
    commandQueued: command,
    message: `ভাউচার কোড সফলভাবে কার্যকর হয়েছে! ${safeDuration === 0 ? 'আনলিমিটেড' : `${safeDuration} মিনিট`} ইন্টারনেট সচল।`
  };
}

export async function listActiveVouchers(redis) {
  const map = loadLocalVouchers();
  const diskVouchers = Array.from(map.values()).filter(v => v.status !== 'revoked' && v.redeemed !== 'true');

  if (!redis) return diskVouchers;

  try {
    const codes = await redis.smembers('active_vouchers');
    if (!Array.isArray(codes) || codes.length === 0) return diskVouchers;

    const vouchers = await Promise.all(
      codes.map(async (c) => {
        const v = await redis.hgetall(`voucher:${c}`).catch(() => null);
        const decoded = decodeUpstashHash(v);
        return decoded && decoded.redeemed !== 'true' ? decoded : null;
      })
    );
    const valid = vouchers.filter(Boolean);
    return valid.length > 0 ? valid : diskVouchers;
  } catch {
    return diskVouchers;
  }
}

export async function listAllVouchers(redis) {
  const map = loadLocalVouchers();
  const all = Array.from(map.values());
  const now = Date.now();

  // Update expired statuses
  for (const v of all) {
    if (v.status === 'active' && v.expiresAt) {
      if (new Date(v.expiresAt).getTime() < now) {
        v.status = 'expired';
      }
    }
  }

  return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function revokeVoucher(redis, code, reason = 'admin_revocation') {
  if (!code) return { ok: false, error: 'Code required' };
  const cleanCode = String(code).trim().toUpperCase();
  const map = loadLocalVouchers();
  const voucher = map.get(cleanCode);

  if (!voucher) return { ok: false, error: 'Voucher not found' };

  voucher.status = 'revoked';
  voucher.revokedAt = new Date().toISOString();
  voucher.revocationReason = reason;
  saveLocalVouchers();

  if (redis) {
    try {
      await redis.hset(`voucher:${cleanCode}`, voucher);
      await redis.srem('active_vouchers', cleanCode);
      if (voucher.redeemedByMac) {
        const deauthCmd = `ndsctl deauth ${voucher.redeemedByMac}`;
        await redis.rpush('pending_commands', deauthCmd);
      }
    } catch {}
  }

  return { ok: true, message: `Voucher ${cleanCode} has been revoked.` };
}

export async function exportVouchers(redis, format = 'csv') {
  const vouchers = await listAllVouchers(redis);
  if (format === 'json') {
    return JSON.stringify(vouchers, null, 2);
  }

  // CSV format
  const headers = ['Code', 'Duration (Min)', 'Status', 'Created At', 'Created By', 'Redeemed By MAC', 'Redeemed At', 'Expires At', 'Note'];
  const rows = vouchers.map(v => [
    v.code,
    v.duration,
    v.status || (v.redeemed === 'true' ? 'used' : 'unused'),
    v.createdAt,
    v.createdBy,
    v.redeemedByMac || '',
    v.redeemedAt || '',
    v.expiresAt || '',
    `"${(v.note || '').replace(/"/g, '""')}"`
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

export function formatVoucherCreatedCard(voucher) {
  const durationText = Number(voucher.duration) === 0 ? '♾ এককালীন আনলিমিটেড' : `⏳ ${voucher.duration} মিনিট`;
  return [
    '🎟️ *নতুন গেস্ট ভাউচার তৈরি হয়েছে!*',
    '━━━━━━━━━━━━━━━━━━━━',
    `🔑 *পাসকোড:* \`${voucher.code}\``,
    `⏱ *মেয়াদ:* ${durationText}`,
    '━━━━━━━━━━━━━━━━━━━━',
    '_💡 মেহমানকে ক্যাপটিভ পোর্টাল পেজে এই কোডটি প্রদান করতে বলুন। কোড দিলেই তাৎক্ষণিক ইন্টারনেট চালু হবে।_'
  ].join('\n');
}

export function formatVoucherRedeemedNotice(code, mac, duration, clientName = 'Guest') {
  const durationText = Number(duration) === 0 ? 'এককালীন আনলিমিটেড' : `${duration} মিনিট`;
  return [
    '🎟️ *গেস্ট ভাউচার দিয়ে লগইন সম্পন্ন*',
    '━━━━━━━━━━━━━━━━━━━━',
    `👤 *ইউজার:* ${escapeMarkdown(clientName)}`,
    `🏷 *MAC:* \`${mac}\``,
    `🔑 *ব্যবহৃত ভাউচার:* \`${code}\``,
    `⏱ *অনুমোদিত সময়:* ${durationText}`,
    '━━━━━━━━━━━━━━━━━━━━',
    '✅ _রাউটার কিউতে অনুমোদন কমান্ড যোগ করা হয়েছে।_'
  ].join('\n');
}
