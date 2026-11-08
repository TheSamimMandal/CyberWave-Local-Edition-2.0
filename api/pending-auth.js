/**
 * /api/pending-auth.js
 *
 * Endpoint for the OpenWrt router to retrieve pending client MAC addresses.
 * - Pops / queries the oldest client MAC with status 'PENDING'.
 * - Returns plain text by default for direct use in OpenWrt / BusyBox scripts:
 *   e.g. `curl -s https://wifihandler.vercel.app/api/pending-auth`
 * - Returns JSON `{ "mac": "..." }` when `Accept: application/json` or `?format=json` is requested.
 */

import { Redis } from '@upstash/redis';
import { timingSafeCompare } from './poll.js';

export default async function handler(req, res) {
  // Prevent any caching on polling responses
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: `Method ${req.method} Not Allowed. Use GET.` });
  }

  // Optional router secret validation if x-router-secret is supplied
  const routerSecret = process.env.ROUTER_SECRET_KEY;
  const clientSecret = req.headers['x-router-secret'];
  if (clientSecret && routerSecret && !timingSafeCompare(clientSecret, routerSecret)) {
    return res.status(401).json({ error: 'Unauthorized: Invalid x-router-secret header.' });
  }

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  let pendingMac = null;

  if (redisUrl && redisToken) {
    try {
      const redis = new Redis({
        url: redisUrl,
        token: redisToken
      });

      // Fetch candidate MACs from the head of the FIFO list
      const candidates = await redis.lrange('pending_macs', 0, 19);

      for (const candidate of candidates) {
        if (!candidate) continue;
        const record = await redis.hgetall(`request:${candidate}`);
        const status = (record?.status || '').toUpperCase();

        if (status === 'PENDING') {
          pendingMac = candidate;
          break;
        } else {
          // Stale or already handled entry; purge from pending queue
          await redis.lrem('pending_macs', 0, candidate);
        }
      }
    } catch (dbErr) {
      console.error('[Redis Pending Auth Error]', dbErr);
      return res.status(500).json({
        error: 'Database connection failed.',
        details: dbErr?.message || String(dbErr)
      });
    }
  }

  // Check if caller requests JSON format
  const acceptHeader = req.headers['accept'] || '';
  const isJson = acceptHeader.includes('application/json') || (req.url && req.url.includes('format=json'));

  if (isJson) {
    return res.status(200).json({
      mac: pendingMac || null
    });
  }

  // Default: Plain text output for direct shell variable capture
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.statusCode = 200;
  if (typeof res.send === 'function') {
    return res.send(pendingMac || '');
  }
  return res.end(pendingMac || '');
}
