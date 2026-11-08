/**
 * /api/poll.js
 *
 * Endpoint for the OpenWrt router to poll pending commands.
 * Authenticates requests using the `x-router-secret` header against `ROUTER_SECRET_KEY`.
 * Pops the next pending command from Upstash Redis ('pending_commands' queue) via LPOP.
 *
 * Returns: { command: "ndsctl auth <MAC> <minutes>" | "ndsctl deauth <MAC>" | null }
 */

import { Redis } from '@upstash/redis';
import crypto from 'node:crypto';

/**
 * Constant-time string comparison to prevent timing attacks on the router secret.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Vercel Serverless Function Handler
 */
export default async function handler(req, res) {
  // Disallow caching on polling responses to guarantee real-time queue states
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // Allow GET or POST for polling
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: `Method ${req.method} Not Allowed. Use GET or POST.` });
  }

  const routerSecret = process.env.ROUTER_SECRET_KEY || process.env.ARCHER_C6_SECRET;
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  // Validate the router secret from header
  const clientSecret = req.headers['x-router-secret'] || req.headers['x-pairing-token'];

  // Check against env var first
  let isAuthed = !!(clientSecret && routerSecret && timingSafeCompare(clientSecret, routerSecret));

  // If not authed via env var, check against router profile credentials
  if (!isAuthed && clientSecret) {
    try {
      const { getRouterProfile, verifyRouterCredentials } = await import('../lib/router/bridge.js');
      const profile = await getRouterProfile(null);
      isAuthed = verifyRouterCredentials(req, profile?.routerSecret, profile?.pairingToken);
    } catch {}
  }

  if (!clientSecret || !isAuthed) {
    return res.status(401).json({
      error: 'Unauthorized: Invalid or missing x-router-secret header.'
    });
  }

  // If Redis credentials are fully present, use Upstash Redis
  if (redisUrl && redisToken) {
    try {
      const redis = new Redis({
        url: redisUrl,
        token: redisToken
      });

      const tasks = [redis.lpop('pending_commands')];

    // If router sent the list of physically connected Wi-Fi station MAC addresses,
    // cache it in Redis with 180s TTL so the Telegram bot displays strictly live devices.
    const connectedMacsHeader = req.headers['x-router-connected-macs'];
    if (typeof connectedMacsHeader === 'string' && connectedMacsHeader.trim().length > 0) {
      const liveMacs = connectedMacsHeader
        .split(',')
        .map(m => m.trim().toLowerCase().replace(/-/g, ':'))
        .filter(m => m.length > 0);
      tasks.push(redis.set('router:live_connected_macs', JSON.stringify(liveMacs), { ex: 180 }));
    }

      const [command] = await Promise.all(tasks);

      return res.status(200).json({
        command: command || null
      });
    } catch (error) {
      console.error('[Poll Queue Exception]', error);
      return res.status(500).json({
        error: 'Failed to retrieve command from Redis queue.',
        details: error?.message || String(error)
      });
    }
  }

  // Local fallback when running without Upstash Redis
  try {
    const { dequeuePendingCommands } = await import('../lib/router/bridge.js');
    const cmds = await dequeuePendingCommands(null, 1);
    const firstCmd = cmds[0] || null;
    const cmdStr = firstCmd ? (firstCmd.routerCmd || firstCmd.command || firstCmd) : null;
    return res.status(200).json({
      command: cmdStr
    });
  } catch (err) {
    return res.status(200).json({ command: null });
  }
}
