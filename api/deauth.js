/**
 * /api/deauth.js
 *
 * Receives client disconnect and session expiration notifications from OpenWrt
 * (triggered by openNDS binauth.sh or sync daemon) and sends a detailed Telegram
 * notification to the administrator.
 */

import { Redis } from '@upstash/redis';
import { timingSafeCompare } from './poll.js';
import { formatDisconnectCard, MAC_REGEX } from '../lib/bot-menu.js';
import { sendTelegramMessage } from './webhook.js';
import { decodeUpstashHash } from '../lib/redis-utils.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  // Authenticate router secret
  const configuredSecret = process.env.ROUTER_SECRET_KEY;
  if (configuredSecret) {
    const incomingSecret = req.headers['x-router-secret'];
    if (!timingSafeCompare(incomingSecret, configuredSecret)) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing x-router-secret.' });
    }
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Malformed JSON payload.' });
    }
  }

  const rawMac = body?.mac;
  if (!rawMac || !MAC_REGEX.test(String(rawMac).trim())) {
    return res.status(400).json({ error: 'Field "mac" is required and must be a valid MAC address.' });
  }

  const mac = String(rawMac).trim().toLowerCase().replace(/-/g, ':');
  const reason = body?.reason || 'timeout_deauth';
  const sessionStartEpoch = body?.session_start ? Number(body.session_start) * 1000 : null;
  const sessionEndEpoch = body?.session_end ? Number(body.session_end) * 1000 : Date.now();

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  let redis = null;
  let user = null;

  if (redisUrl && redisToken) {
    redis = new Redis({ url: redisUrl, token: redisToken });

    // Deduplication check: Avoid duplicate notifications within 10 seconds for the same MAC
    const dedupKey = `deauth_notified:${mac}`;
    const alreadyNotified = await redis.get(dedupKey).catch(() => null);
    if (alreadyNotified) {
      return res.status(200).json({ ok: true, deduplicated: true, mac });
    }
    await redis.set(dedupKey, Date.now(), { ex: 10 }).catch(() => {});

    // Fetch user record from database
    const rawUser = await redis.hgetall(`request:${mac}`).catch(() => null);
    user = decodeUpstashHash(rawUser);

    // Update user status in database to terminated
    const nowIso = new Date().toISOString();
    await redis.hset(`request:${mac}`, {
      status: 'terminated',
      disconnectedAt: nowIso,
      disconnectReason: reason
    }).catch(() => {});
  }

  // Send Telegram feedback notification
  if (botToken && chatId) {
    const disconnectInfo = {
      mac,
      reason,
      session_start: sessionStartEpoch ? new Date(sessionStartEpoch).toISOString() : (user?.authorizedAt || user?.requestedAt),
      session_end: sessionEndEpoch ? new Date(sessionEndEpoch).toISOString() : new Date().toISOString(),
      ip: body?.ip || user?.ip
    };

    const notificationText = formatDisconnectCard(user, disconnectInfo);
    await sendTelegramMessage(botToken, chatId, notificationText, null, redis);
  }

  return res.status(200).json({
    ok: true,
    mac,
    notified: true,
    reason
  });
}
