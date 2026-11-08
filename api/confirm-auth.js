/**
 * /api/confirm-auth.js
 *
 * Endpoint for the OpenWrt router to confirm client authentication
 * and verified execution of queued commands. Sends instant Telegram
 * confirmation notice to admin upon successful execution.
 *
 * Supports payloads formatted as:
 * - URL-encoded form: `mac=...&command=...&status=success`
 * - JSON: `{ "mac": "...", "command": "...", "status": "success" }`
 * - Plain text string
 */

import { Redis } from '@upstash/redis';
import { normalizeMac } from './request.js';
import { timingSafeCompare } from './poll.js';
import { sendRouterConfirmationNotice } from '../lib/telegram/router-confirm.js';

// Regular expression to validate standard MAC addresses
const MAC_REGEX = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: `Method ${req.method} Not Allowed. Use POST.` });
  }

  // Optional router secret validation if x-router-secret is supplied
  const routerSecret = process.env.ROUTER_SECRET_KEY;
  const clientSecret = req.headers['x-router-secret'];
  if (clientSecret && routerSecret && !timingSafeCompare(clientSecret, routerSecret)) {
    return res.status(401).json({ error: 'Unauthorized: Invalid x-router-secret header.' });
  }

  let rawMac = null;
  let command = null;
  let status = 'success';
  let details = null;

  // Extract from body (URL-encoded form, JSON, plain text)
  if (typeof req.body === 'string') {
    const trimmed = req.body.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        rawMac = parsed.mac;
        command = parsed.command;
        status = parsed.status || status;
        details = parsed.details || parsed.output;
      } catch {
        // Fall back to URLSearchParams
      }
    }
    if (!rawMac && !command) {
      const params = new URLSearchParams(trimmed);
      rawMac = params.get('mac') || (MAC_REGEX.test(trimmed) ? trimmed : null);
      command = params.get('command');
      status = params.get('status') || status;
      details = params.get('details');
    }
  } else if (req.body && typeof req.body === 'object') {
    rawMac = req.body.mac;
    command = req.body.command;
    status = req.body.status || status;
    details = req.body.details || req.body.output;
  }

  // Also check query string if not in body
  if (!rawMac && req.url) {
    try {
      const url = new URL(req.url, 'http://localhost');
      rawMac = url.searchParams.get('mac') || rawMac;
      command = url.searchParams.get('command') || command;
      status = url.searchParams.get('status') || status;
      details = url.searchParams.get('details') || details;
    } catch {
      // Ignore URL parsing errors
    }
  }

  // Extract MAC from command if not provided explicitly
  if (!rawMac && typeof command === 'string') {
    const matched = command.match(/([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/);
    if (matched) rawMac = matched[0];
  }

  // Validate that either a valid MAC or a valid command is provided
  if (!rawMac && !command) {
    return res.status(400).json({ error: 'Field "mac" is required and must be a valid MAC address.' });
  }

  if (rawMac && !MAC_REGEX.test(String(rawMac).trim()) && !command) {
    return res.status(400).json({ error: 'Field "mac" is required and must be a valid MAC address.' });
  }

  const cleanMac = rawMac && MAC_REGEX.test(String(rawMac).trim()) ? normalizeMac(rawMac) : null;
  const nowIso = new Date().toISOString();

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  let redis = null;

  if (redisUrl && redisToken) {
    try {
      redis = new Redis({
        url: redisUrl,
        token: redisToken
      });

      if (cleanMac) {
        const updateData = {
          routerConfirmedAt: nowIso,
          updatedAt: nowIso
        };
        const cmdStr = (command || '').toLowerCase();
        if (status === 'failed') {
          updateData.status = 'FAILED';
          updateData.errorDetails = details || 'Router execution failed';
        } else if (!command || cmdStr.startsWith('ndsctl auth') || cmdStr.startsWith('ndsctl trust')) {
          updateData.status = 'AUTHENTICATED';
          updateData.authenticatedAt = nowIso;
        } else if (cmdStr.startsWith('ndsctl deauth')) {
          updateData.status = 'terminated';
          updateData.disconnectedAt = nowIso;
        }

        await redis.hset(`request:${cleanMac}`, updateData);
        await redis.lrem('pending_macs', 0, cleanMac);
      }
    } catch (dbErr) {
      console.error('[Redis Confirm Auth Error]', dbErr);
      return res.status(500).json({ error: 'Failed to update database record.' });
    }
  }

  // Dispatch real-time Telegram confirmation notice to admin bot
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (botToken && chatId) {
    try {
      await sendRouterConfirmationNotice({
        redis,
        botToken,
        chatId,
        payload: { mac: cleanMac, command, status, details }
      });
    } catch (err) {
      console.warn('[Telegram Confirmation Dispatch Warning]', err.message);
    }
  }

  return res.status(200).json({
    success: true,
    mac: cleanMac,
    command: command || null,
    status: status === 'failed' ? 'FAILED' : (cleanMac && (!command || command.startsWith('ndsctl auth')) ? 'AUTHENTICATED' : 'CONFIRMED')
  });
}
