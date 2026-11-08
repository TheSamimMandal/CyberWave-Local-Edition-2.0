/**
 * /api/status.js
 *
 * Client-facing status polling endpoint.
 * Allows guest devices on the waiting page to poll their authorization status
 * using their MAC address (?mac=aa:bb:cc:dd:ee:ff).
 *
 * Returns:
 * {
 *   mac: string,
 *   name: string,
 *   status: 'pending' | 'authorized' | 'authenticated' | 'terminated' | 'rejected' | 'not_found',
 *   duration: number | null,
 *   reviewedBy: string | null,
 *   reviewedAt: string | null,
 *   authenticatedAt: string | null
 * }
 */

import { Redis } from '@upstash/redis';
import { normalizeMac } from './request.js';

// Regular expression to validate standard MAC addresses
const MAC_REGEX = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

export default async function handler(req, res) {
  // Prevent caching so polling is always real-time
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: `Method ${req.method} Not Allowed. Use GET.` });
  }

  // Extract MAC from query parameter
  let targetMac = null;
  if (req.query && req.query.mac) {
    targetMac = req.query.mac;
  } else if (req.url) {
    try {
      const url = new URL(req.url, 'http://localhost');
      targetMac = url.searchParams.get('mac');
    } catch {
      // Ignore URL parsing errors
    }
  }

  if (!targetMac || !MAC_REGEX.test(String(targetMac).trim())) {
    return res.status(400).json({ error: 'Field "mac" is required and must be a valid MAC address.' });
  }

  const cleanMac = normalizeMac(targetMac);
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    // If Redis is not configured, return fallback status
    return res.status(200).json({
      mac: cleanMac,
      status: 'pending',
      note: 'Database credentials not configured in environment.'
    });
  }

  try {
    const redis = new Redis({
      url: redisUrl,
      token: redisToken
    });

    const record = await redis.hgetall(`request:${cleanMac}`);

    if (!record || Object.keys(record).length === 0) {
      return res.status(200).json({
        mac: cleanMac,
        status: 'not_found'
      });
    }

    const rawStatus = String(record.status || 'pending').toLowerCase();
    const duration = record.duration !== undefined && record.duration !== null
      ? Number(record.duration)
      : (record.status === 'authorized' ? 0 : null);

    return res.status(200).json({
      mac: cleanMac,
      name: record.name || '',
      status: rawStatus, // 'pending', 'authorized', 'authenticated', 'terminated', 'rejected'
      duration,
      reviewedBy: record.reviewedBy || null,
      reviewedAt: record.reviewedAt || null,
      authenticatedAt: record.authenticatedAt || null
    });
  } catch (error) {
    console.warn('[Status Query Warning] Redis unavailable, checking local store:', error.message);
    const localReq = Array.isArray(globalThis.__localDevRequests)
      ? globalThis.__localDevRequests.find(r => r.mac.toLowerCase() === cleanMac)
      : null;
    if (localReq) {
      return res.status(200).json({
        mac: cleanMac,
        name: localReq.name || '',
        status: (localReq.status || 'pending').toLowerCase(),
        duration: localReq.duration !== undefined ? Number(localReq.duration) : null,
        simulated: true
      });
    }
    return res.status(200).json({
      mac: cleanMac,
      status: 'pending',
      simulated: true
    });
  }
}
