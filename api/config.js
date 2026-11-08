/**
 * /api/config.js
 *
 * Public configuration endpoint for CyberWave Captive Portal splash page.
 * Provides dynamic portal branding, welcome notice, and UPI payment IDs
 * configured by the administrator in the Admin Panel.
 * Kept strictly under 250 lines.
 */

import { Redis } from '@upstash/redis';
import { getPublicPortalConfig } from '../lib/admin/settings.js';
import { getAdminAuthStatus } from '../lib/admin/auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ status: 'ok' });
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  let redis = null;
  if (redisUrl && redisToken) {
    try {
      redis = new Redis({ url: redisUrl, token: redisToken });
    } catch (e) {
      console.warn('[Config API] Redis initialization notice:', e.message);
    }
  }

  try {
    const config = await getPublicPortalConfig(redis);
    const authStatus = getAdminAuthStatus();
    return res.status(200).json({ ok: true, config, adminAuth: authStatus });
  } catch (err) {
    console.error('[Config API Error]', err);
    return res.status(500).json({ error: 'Failed to retrieve portal configuration.' });
  }
}
