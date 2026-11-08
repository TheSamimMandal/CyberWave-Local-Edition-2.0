/**
 * lib/admin/requests.js
 *
 * Fetches recent captive portal requests and queue metrics for Admin panel.
 * Kept strictly under 250 lines.
 */

import { decodeUpstashHash } from '../redis-utils.js';

export async function fetchAdminRequests(redis) {
  const pendingQueueCount = await redis.llen('pending_commands');
  const rawHistory = await redis.lrange('request_history', 0, 99);

  const parsedItems = [];
  const seenMacs = new Set();

  for (const item of rawHistory) {
    try {
      const entry = typeof item === 'string' ? JSON.parse(item) : item;
      if (entry && entry.mac && !seenMacs.has(entry.mac)) {
        seenMacs.add(entry.mac);
        parsedItems.push(entry);
      }
    } catch {}
  }

  const requests = await Promise.all(
    parsedItems.map(async (entry) => {
      try {
        const rawHash = await redis.hgetall(`request:${entry.mac}`);
        const hash = decodeUpstashHash(rawHash);
        return {
          name: entry.name || hash?.name || 'Guest User',
          mac: entry.mac,
          ip: entry.ip || hash?.ip || '',
          status: hash?.status || entry.status || 'pending',
          duration: hash?.duration !== undefined ? Number(hash.duration) : (entry.duration ? Number(entry.duration) : null),
          requestedAt: entry.requestedAt || hash?.requestedAt || null,
          reviewedAt: hash?.reviewedAt || entry.reviewedAt || null,
          reviewedBy: hash?.reviewedBy || entry.reviewedBy || null
        };
      } catch {
        return entry;
      }
    })
  );

  return {
    pendingQueueCount: Number(pendingQueueCount) || 0,
    requests
  };
}
