/**
 * /api/voucher.js
 *
 * Endpoint for voucher code redemption from the captive portal splash page,
 * and voucher management (single/batch generation, revoking, export) for administrators.
 * Kept strictly under 250 lines.
 */

import { Redis } from '@upstash/redis';
import {
  redeemVoucher,
  createVoucher,
  createVouchers,
  listActiveVouchers,
  listAllVouchers,
  revokeVoucher,
  exportVouchers,
  formatVoucherRedeemedNotice
} from '../lib/voucher.js';
import { checkAdminAuth } from '../lib/admin/auth.js';
import { sendTelegramMessage } from '../lib/telegram/client.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Password, X-Admin-Secret');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ status: 'ok' });
  }

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (process.env.NODE_ENV === 'test' && (!redisUrl || !redisToken)) {
    return res.status(500).json({ error: 'Database configuration missing.' });
  }

  let redis = null;
  if (redisUrl && redisToken) {
    try {
      redis = new Redis({ url: redisUrl, token: redisToken });
    } catch (e) {
      console.warn('[Voucher API] Redis init warning:', e.message);
    }
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const adminPass = process.env.ADMIN_PASSWORD || process.env.ROUTER_SECRET_KEY;

  // 1. GET: List active/all vouchers or export (Admin only)
  if (req.method === 'GET') {
    if (!checkAdminAuth(req)) {
      return res.status(401).json({ error: 'Unauthorized: Admin authentication required.' });
    }
    const url = new URL(req.url, 'http://localhost');
    const action = url.searchParams.get('action') || 'active';
    const format = url.searchParams.get('format') || 'csv';

    if (action === 'export') {
      const data = await exportVouchers(redis, format);
      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
        return res.status(200).send(data);
      }
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="cyberwave-vouchers.csv"');
      return res.status(200).send(data);
    }

    if (action === 'all') {
      const vouchers = await listAllVouchers(redis);
      return res.status(200).json({ ok: true, vouchers });
    }

    const vouchers = await listActiveVouchers(redis);
    return res.status(200).json({ ok: true, vouchers });
  }

  // 2. POST: Redeem voucher OR Admin creation/revocation
  if (req.method === 'POST') {
    let payload = req.body;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch {
        return res.status(400).json({ error: 'Malformed JSON payload.' });
      }
    }
    payload = payload || {};

    // A. Admin creating single voucher
    if (payload.action === 'create') {
      if (!checkAdminAuth(req)) {
        return res.status(401).json({ error: 'Unauthorized: Admin authentication required.' });
      }
      const duration = parseInt(payload.duration, 10) || 120;
      const voucher = await createVoucher(redis, duration, payload.createdBy || 'Web Admin', payload.note, payload.prefix);
      return res.status(200).json({ ok: true, voucher });
    }

    // B. Admin batch creating vouchers
    if (payload.action === 'batch_create') {
      if (!checkAdminAuth(req)) {
        return res.status(401).json({ error: 'Unauthorized: Admin authentication required.' });
      }
      const count = parseInt(payload.count, 10) || 5;
      const duration = parseInt(payload.duration, 10) || 120;
      const vouchers = await createVouchers(redis, count, duration, payload.createdBy || 'Web Admin', payload.note, payload.prefix);
      return res.status(200).json({ ok: true, vouchers, count: vouchers.length });
    }

    // C. Admin revoking voucher
    if (payload.action === 'revoke') {
      if (!checkAdminAuth(req)) {
        return res.status(401).json({ error: 'Unauthorized: Admin authentication required.' });
      }
      const result = await revokeVoucher(redis, payload.code, payload.reason || 'admin_revoked');
      return res.status(result.ok ? 200 : 400).json(result);
    }

    // D. Client redeeming voucher from Captive Portal
    const { code, mac, ip, name } = payload;
    if (!code || !mac) {
      return res.status(400).json({ ok: false, error: 'ভাউচার কোড এবং ম্যাক অ্যাড্রেস প্রদান করুন।' });
    }

    const result = await redeemVoucher(redis, code, mac, ip, name);
    if (!result.ok) {
      return res.status(400).json(result);
    }

    // Send Telegram alert to admin
    if (botToken && chatId) {
      const notice = formatVoucherRedeemedNotice(result.code, result.mac, result.duration, name);
      sendTelegramMessage(botToken, chatId, notice, null, redis).catch(() => {});
    }

    return res.status(200).json(result);
  }

  res.setHeader('Allow', 'GET, POST, OPTIONS');
  return res.status(405).json({ error: `Method ${req.method} Not Allowed.` });
}
