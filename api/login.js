/**
 * /api/login.js
 *
 * Serverless function to handle guest login / submit requests from the captive portal.
 * 1. Decodes openNDS FAS token (?fas=<base64>) to extract client MAC and IP.
 * 2. Persists the MAC address in the Upstash Redis database with status 'PENDING'.
 * 3. Enqueues the MAC into the pending router queue for authorization.
 * 4. Dispatches an optional alert notification to the network administrator via Telegram.
 */

import { Redis } from '@upstash/redis';
import { parseFasToken } from '../lib/opennds.js';
import { normalizeMac, escapeMarkdown } from './request.js';

// Regular expression to validate standard MAC addresses
const MAC_REGEX = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

/**
 * Vercel Serverless Function Handler
 */
export default async function handler(req, res) {
  // Disallow caching on login responses
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  // Enforce HTTP POST method
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: `Method ${req.method} Not Allowed. Use POST.` });
  }

  // Parse request body
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Malformed JSON payload in request body.' });
    }
  }

  const { fas, name, mac, ip } = body || {};

  // 1. Decode FAS Token if provided
  let extractedMac = null;
  let extractedIp = null;

  if (fas && typeof fas === 'string') {
    const parsed = parseFasToken(fas);
    if (parsed.clientMac) {
      extractedMac = parsed.clientMac;
    }
    if (parsed.clientIp) {
      extractedIp = parsed.clientIp;
    }
  }

  // Fallback to direct MAC/IP parameters if fas was omitted or didn't contain MAC
  const targetMac = extractedMac || (typeof mac === 'string' ? mac.trim() : null);
  const targetIp = extractedIp || (typeof ip === 'string' ? ip.trim() : null);

  // Validate MAC address format
  if (!targetMac || !MAC_REGEX.test(targetMac)) {
    return res.status(400).json({ error: 'Valid client MAC not found' });
  }

  const cleanMac = normalizeMac(targetMac);
  const cleanIp = targetIp ? targetIp.slice(0, 45) : null;
  let cleanName = name && typeof name === 'string' && name.trim().length > 0
    ? name.trim().slice(0, 64)
    : 'Guest User';
  const nowIso = new Date().toISOString();

  // 2. Persist in Database (Upstash Redis)
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (redisUrl && redisToken) {
    try {
      const redis = new Redis({
        url: redisUrl,
        token: redisToken
      });

      if (cleanName === 'Guest User') {
        const savedAlias = await redis.get(`device_alias:${cleanMac}`).catch(() => null);
        if (savedAlias) cleanName = savedAlias;
      }

      // Save/update request state as PENDING
      await redis.hset(`request:${cleanMac}`, {
        name: cleanName,
        mac: cleanMac,
        ip: cleanIp || '',
        status: 'PENDING',
        requestedAt: nowIso,
        updatedAt: nowIso
      });

      // Maintain FIFO queue of pending MACs for router sync (/api/pending-auth)
      await redis.lrem('pending_macs', 0, cleanMac);
      await redis.rpush('pending_macs', cleanMac);

      // Append to request history (capped at 500 records)
      await redis.lpush('request_history', JSON.stringify({
        name: cleanName,
        mac: cleanMac,
        ip: cleanIp || '',
        status: 'PENDING',
        requestedAt: nowIso
      }));
      await redis.ltrim('request_history', 0, 499);
    } catch (dbErr) {
      console.error('[Redis Database Error]', dbErr);
    }
  }

  // 3. Deliver Telegram Bot Notification to Network Administrator (if configured)
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (botToken && chatId) {
    const tz = process.env.TIMEZONE || 'Asia/Dhaka';
    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: tz,
      dateStyle: 'medium',
      timeStyle: 'medium'
    });
    const tzSuffix = tz === 'Asia/Dhaka' ? 'BST' : tz;

    const messageText = [
      '📶 *New FAS Wi-Fi Login Request*',
      '━━━━━━━━━━━━━━━━━━━━',
      `👤 *User:* ${escapeMarkdown(cleanName)}`,
      `🏷 *MAC:* \`${cleanMac}\``,
      cleanIp ? `🌐 *IP:* \`${escapeMarkdown(cleanIp)}\`` : null,
      `⏰ *Timestamp:* ${timestamp} (${tzSuffix})`,
      '━━━━━━━━━━━━━━━━━━━━',
      'Select duration below or reply with custom minutes (e.g. 15):'
    ].filter(Boolean).join('\n');

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '⏱ 10 Mins', callback_data: `auth:${cleanMac}:10` },
          { text: '⏱ 15 Mins', callback_data: `auth:${cleanMac}:15` },
          { text: '⏱ 20 Mins', callback_data: `auth:${cleanMac}:20` }
        ],
        [
          { text: '⏱ 30 Mins', callback_data: `auth:${cleanMac}:30` },
          { text: '⏱ 1 Hour', callback_data: `auth:${cleanMac}:60` }
        ],
        [
          { text: '♾ Unlimited', callback_data: `auth:${cleanMac}:0` },
          { text: '❌ Reject', callback_data: `deauth_${cleanMac}` }
        ]
      ]
    };

    try {
      const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
      await fetch(telegramApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: messageText,
          parse_mode: 'Markdown',
          reply_markup: replyMarkup
        })
      });
    } catch (tgErr) {
      console.warn('[Telegram Notification Error]', tgErr);
    }
  }

  return res.status(200).json({
    success: true,
    mac: cleanMac,
    ip: cleanIp
  });
}
