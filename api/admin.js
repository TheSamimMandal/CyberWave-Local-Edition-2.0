/**
 * /api/admin.js
 *
 * Secure serverless administration endpoint for the Wi-Fi captive portal.
 * Modularized: routes requests to auth, request fetching, and notification modules.
 * Kept strictly under 250 lines.
 */

import { Redis } from '@upstash/redis';
import { normalizeMac } from './request.js';
import { cleanTerminatedRecords } from '../lib/bot-menu.js';
import { MAC_REGEX, checkAdminAuth, changeAdminPassword, getAdminAuthStatus } from '../lib/admin/auth.js';
import { fetchAdminRequests } from '../lib/admin/requests.js';
import { sendAdminTelegramNotice } from '../lib/admin/notifications.js';
import { getSystemSettings, saveSystemSettings, sendTelegramTestMessage, deleteVoucher } from '../lib/admin/settings.js';

export { MAC_REGEX, checkAdminAuth, changeAdminPassword, getAdminAuthStatus };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: `Method ${req.method} Not Allowed. Use GET or POST.` });
  }

  if (req.method === 'POST' && typeof req.body === 'string') {
    try {
      req.body = JSON.parse(req.body);
    } catch {
      return res.status(400).json({ error: 'Malformed JSON payload in request body.' });
    }
  }

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  // Verify admin credentials against persistent store or environment configuration
  if (process.env.NODE_ENV === 'test' && !process.env.ADMIN_PASSWORD && !process.env.ROUTER_SECRET_KEY) {
    return res.status(500).json({ error: 'Admin credentials are not configured. Please set ADMIN_PASSWORD in environment.' });
  }

  if (!checkAdminAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing admin credentials.' });
  }

  // 1. GET: Retrieve requests list and router queue count
  if (req.method === 'GET') {
    try {
      const url = new URL(req.url, 'http://localhost');
      const queryAction = url.searchParams.get('action');
      if (queryAction === 'check') {
        return res.status(200).json({ ok: true, message: 'Authenticated successfully.' });
      }
      if (queryAction === 'auth_status') {
        return res.status(200).json({ ok: true, ...getAdminAuthStatus() });
      }
    } catch {}

    if (!redisUrl || !redisToken) {
      return res.status(200).json({
        ok: true,
        simulated: true,
        pendingQueueCount: globalThis.__localDevQueue?.length || 0,
        requests: globalThis.__localDevRequests || []
      });
    }

    try {
      const redis = new Redis({ url: redisUrl, token: redisToken });
      const data = await fetchAdminRequests(redis);
      return res.status(200).json({ ok: true, ...data });
    } catch (err) {
      console.warn('[Admin GET Warning] Redis unreachable, falling back to local store:', err.message);
      return res.status(200).json({
        ok: true,
        simulated: true,
        warning: 'Redis database is unreachable; falling back to local memory store.',
        pendingQueueCount: globalThis.__localDevQueue?.length || 0,
        requests: globalThis.__localDevRequests || []
      });
    }
  }

  // 2. POST: Execute action (auth / deauth / clean / login / change_password)
  const { action, mac, duration = 60, name, adminName = 'Web Admin' } = req.body || {};

  if (action === 'login') {
    return res.status(200).json({ ok: true, message: 'Admin login verified successfully.', authStatus: getAdminAuthStatus() });
  }

  if (action === 'change_password') {
    const { currentPassword, newPassword } = req.body || {};
    const result = changeAdminPassword(currentPassword, newPassword);
    return res.status(result.ok ? 200 : 400).json(result);
  }

  if (action === 'auth_status') {
    return res.status(200).json({ ok: true, ...getAdminAuthStatus() });
  }

  if (action === 'clean') {
    let cleanCount = 0;
    if (redisUrl && redisToken) {
      try {
        const redis = new Redis({ url: redisUrl, token: redisToken });
        const cleanResult = await cleanTerminatedRecords(redis);
        cleanCount = cleanResult.removedCount;
      } catch (cleanErr) {
        console.warn('[Admin Clean Warning] Redis unavailable:', cleanErr.message);
      }
    }
    if (Array.isArray(globalThis.__localDevRequests)) {
      const initialCount = globalThis.__localDevRequests.length;
      const filtered = globalThis.__localDevRequests.filter(r => r.status !== 'rejected' && r.status !== 'terminated');
      cleanCount = Math.max(cleanCount, initialCount - filtered.length);
      globalThis.__localDevRequests.length = 0;
      globalThis.__localDevRequests.push(...filtered);
    }
    return res.status(200).json({
      ok: true,
      success: true,
      message: `Successfully cleaned ${cleanCount} terminated records from database.`,
      removedCount: cleanCount,
      remainingCount: Array.isArray(globalThis.__localDevRequests) ? globalThis.__localDevRequests.length : 0
    });
  }

  if (action === 'telegram_webhook_info') {
    if (!botToken) {
      return res.status(200).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN কনফিগার করা নেই।', botConfigured: false });
    }
    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
      const tgData = await tgRes.json();
      return res.status(200).json({ ok: true, webhook: tgData.result, botConfigured: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  if (action === 'set_telegram_webhook') {
    if (!botToken) {
      return res.status(400).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN কনফিগার করা নেই।' });
    }
    const targetUrl = req.body?.url;
    if (!targetUrl) {
      return res.status(400).json({ ok: false, error: 'Field "url" is required.' });
    }
    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(targetUrl)}`);
      const tgData = await tgRes.json();
      return res.status(200).json({ ok: tgData.ok, result: tgData });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  if (action === 'get_settings') {
    let redis = null;
    if (redisUrl && redisToken) {
      try { redis = new Redis({ url: redisUrl, token: redisToken }); } catch {}
    }
    const settings = await getSystemSettings(redis);
    return res.status(200).json({ ok: true, settings });
  }

  if (action === 'save_settings') {
    let redis = null;
    if (redisUrl && redisToken) {
      try { redis = new Redis({ url: redisUrl, token: redisToken }); } catch {}
    }
    const result = await saveSystemSettings(req.body, redis);
    return res.status(200).json(result);
  }

  if (action === 'test_telegram') {
    const result = await sendTelegramTestMessage(botToken, chatId);
    return res.status(result.ok ? 200 : 400).json(result);
  }

  if (action === 'delete_voucher') {
    if (!redisUrl || !redisToken) {
      return res.status(500).json({ error: 'Database credentials missing.' });
    }
    const redis = new Redis({ url: redisUrl, token: redisToken });
    const result = await deleteVoucher(redis, req.body?.code);
    return res.status(result.ok ? 200 : 400).json(result);
  }

  if (action !== 'auth' && action !== 'deauth') {
    return res.status(400).json({
      error: 'Invalid action. Supported actions are "auth", "deauth", "clean", "get_settings", "save_settings", "test_telegram", "delete_voucher" (or "login").'
    });
  }

  if (!mac || typeof mac !== 'string' || !MAC_REGEX.test(mac.trim())) {
    return res.status(400).json({
      error: 'Field "mac" is required and must be a valid MAC address (e.g. AA:BB:CC:DD:EE:FF).'
    });
  }
  const cleanMac = normalizeMac(mac);

  let parsedDuration = 0;
  if (action === 'auth') {
    parsedDuration = parseInt(duration, 10);
    if (isNaN(parsedDuration) || parsedDuration < 0) {
      return res.status(400).json({
        error: 'Field "duration" must be a positive integer or 0 for unlimited access.'
      });
    }
  }

  const nowIso = new Date().toISOString();
  const command = action === 'auth' ? `ndsctl auth ${cleanMac} ${parsedDuration}` : `ndsctl deauth ${cleanMac}`;
  const newStatus = action === 'auth' ? 'authorized' : 'rejected';
  const cleanName = name ? String(name).trim().slice(0, 64) : null;
  let redisSuccess = false;

  if (redisUrl && redisToken) {
    try {
      const redis = new Redis({ url: redisUrl, token: redisToken });
      await redis.rpush('pending_commands', command);

      const hashUpdate = {
        status: newStatus,
        duration: parsedDuration,
        reviewedBy: adminName,
        reviewedAt: nowIso
      };
      if (cleanName) hashUpdate.name = cleanName;

      await redis.hset(`request:${cleanMac}`, hashUpdate);
      await redis.lpush('request_history', JSON.stringify({
        name: cleanName || 'Guest User',
        mac: cleanMac,
        status: newStatus,
        duration: parsedDuration,
        reviewedBy: adminName,
        requestedAt: nowIso,
        reviewedAt: nowIso
      }));
      await redis.ltrim('request_history', 0, 499);
      redisSuccess = true;
    } catch (err) {
      console.warn('[Admin Action Warning] Redis update failed, falling back to local store:', err.message);
    }
  }

  // Update in-memory fallback queue and requests list
  if (Array.isArray(globalThis.__localDevQueue)) {
    globalThis.__localDevQueue.push(command);
  }
  if (Array.isArray(globalThis.__localDevRequests)) {
    const existing = globalThis.__localDevRequests.find(r => r.mac.toLowerCase() === cleanMac);
    if (existing) {
      existing.status = newStatus;
      existing.duration = parsedDuration;
      existing.reviewedBy = adminName;
      existing.reviewedAt = nowIso;
    } else {
      globalThis.__localDevRequests.unshift({
        name: cleanName || 'Guest User',
        mac: cleanMac,
        ip: '',
        status: newStatus,
        duration: parsedDuration,
        reviewedBy: adminName,
        requestedAt: nowIso,
        reviewedAt: nowIso
      });
    }
  }

  sendAdminTelegramNotice(botToken, chatId, action, cleanMac, cleanName, parsedDuration, adminName);

  return res.status(200).json({
    ok: true,
    success: true,
    action,
    mac: cleanMac,
    duration: action === 'auth' ? parsedDuration : null,
    commandQueued: command,
    simulated: !redisSuccess,
    message: action === 'auth'
      ? `Successfully authorized ${cleanMac} (${parsedDuration === 0 ? 'Unlimited' : `${parsedDuration} min`}).`
      : `Successfully queued deauthorization for ${cleanMac}.`
  });
}
