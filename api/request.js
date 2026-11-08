/**
 * /api/request.js
 *
 * Serverless function to handle Wi-Fi access requests from the captive portal landing page.
 * 1. Validates user input (name, client MAC).
 * 2. Persists the access request record directly in Upstash Redis database.
 * 3. Delivers a notification to the administrator via Telegram Bot API with inline approval buttons.
 */

import { Redis } from '@upstash/redis';
import { parseFasToken } from '../lib/opennds.js';
import { trackChatMessage } from '../lib/bot-menu.js';

// Regular expression to validate standard MAC addresses (colon or hyphen separated)
const MAC_REGEX = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

/**
 * Escapes special Markdown characters in user-supplied strings
 * to prevent Markdown parsing issues or format injection in Telegram.
 *
 * @param {string} text - Raw input string
 * @returns {string} - Escaped string safe for Telegram Markdown (legacy mode)
 */
export function escapeMarkdown(text) {
  if (!text) return '';
  return String(text).replace(/([*_`\[\]])/g, '\\$1');
}

/**
 * Normalizes a MAC address to lowercase colon-separated format (e.g., "aa:bb:cc:dd:ee:ff").
 *
 * @param {string} mac - Raw MAC address string
 * @returns {string} - Normalized MAC address
 */
export function normalizeMac(mac) {
  return mac.trim().toLowerCase().replace(/-/g, ':');
}

/**
 * Vercel Serverless Function Handler
 */
export default async function handler(req, res) {
  // Enforce HTTP POST method
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: `Method ${req.method} Not Allowed. Use POST.` });
  }

  // Parse request body (supports pre-parsed object or raw string)
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Malformed JSON payload in request body.' });
    }
  }

  const { name, mac, ip, fas } = body || {};

  // Extract from FAS token if provided
  let candidateMac = mac;
  let candidateIp = ip;
  if (fas && typeof fas === 'string') {
    const parsedFas = parseFasToken(fas);
    if (parsedFas.clientMac) candidateMac = parsedFas.clientMac;
    if (parsedFas.clientIp) candidateIp = parsedFas.clientIp;
  }

  // Validate Name input
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Field "name" is required and cannot be empty.' });
  }
  const cleanName = name.trim().slice(0, 64);

  // Validate MAC input
  if (!candidateMac || typeof candidateMac !== 'string' || !MAC_REGEX.test(candidateMac.trim())) {
    return res.status(400).json({
      error: 'Field "mac" is required and must be a valid MAC address (e.g. AA:BB:CC:DD:EE:FF).'
    });
  }
  const cleanMac = normalizeMac(candidateMac);

  // Validate environment variables
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!botToken || !chatId) {
    console.error('[Config Error] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in environment variables.');
    return res.status(500).json({
      error: 'Server configuration error: Telegram credentials are not configured.'
    });
  }

  // Sanitize IP if provided
  const cleanIp = candidateIp && typeof candidateIp === 'string' ? candidateIp.trim().slice(0, 45) : null;
  const nowIso = new Date().toISOString();

  // ---------------------------------------------------------------------------
  // 1. Direct Database Persistence in Upstash Redis
  // ---------------------------------------------------------------------------
  if (redisUrl && redisToken) {
    try {
      const redis = new Redis({
        url: redisUrl,
        token: redisToken
      });

      // Save user access request record as a Redis Hash
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

      // Append request to chronological history list (stores last 500 requests)
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
      // Log DB error but proceed to send Telegram notification so the admin still receives it
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Deliver Telegram Bot Notification to Network Administrator
  // ---------------------------------------------------------------------------
  const tz = process.env.TIMEZONE || 'Asia/Dhaka';
  const timestamp = new Date().toLocaleString('en-US', {
    timeZone: tz,
    dateStyle: 'medium',
    timeStyle: 'medium'
  });
  const tzSuffix = tz === 'Asia/Dhaka' ? 'BST' : tz;

  const messageText = [
    '📶 *New Wi-Fi Access Request*',
    '━━━━━━━━━━━━━━━━━━━━',
    `👤 *User:* ${escapeMarkdown(cleanName)}`,
    `🏷 *MAC:* \`${cleanMac}\``,
    cleanIp ? `🌐 *IP:* \`${escapeMarkdown(cleanIp)}\`` : null,
    `⏰ *Timestamp:* ${timestamp} (${tzSuffix})`,
    '━━━━━━━━━━━━━━━━━━━━',
    'Select duration below or reply with custom minutes (e.g. 15):'
  ].filter(Boolean).join('\n');

  // Inline keyboard configuration with quick minutes
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
    const tgResponse = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: messageText,
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
      })
    });

    const tgData = await tgResponse.json();

    if (!tgResponse.ok || !tgData.ok) {
      console.error('[Telegram API Error]', tgData);
      return res.status(502).json({
        error: 'Failed to deliver notification to Telegram.',
        details: tgData.description || 'Unknown Telegram API error'
      });
    }

    // Track notification message ID in Redis so it can be purged when Clean Dashboard is triggered
    if (tgData?.result?.message_id && redisUrl && redisToken) {
      try {
        const redis = new Redis({ url: redisUrl, token: redisToken });
        await trackChatMessage(redis, chatId, tgData.result.message_id);
      } catch {}
    }

    return res.status(200).json({
      success: true,
      message: 'Access request successfully stored in database and delivered to administrator.'
    });
  } catch (error) {
    console.error('[Request Handler Exception]', error);
    return res.status(500).json({
      error: 'An unexpected internal error occurred while processing the request.'
    });
  }
}
