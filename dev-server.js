/**
 * dev-server.js
 *
 * Lightweight local development server using Node.js built-in modules.
 * - Serves static files from `public/` (e.g. index.html)
 * - Emulates Vercel Serverless Functions (/api/request, /api/poll, /api/webhook)
 * - Automatically loads .env or .env.local if present
 * - Provides realistic simulation fallback if Telegram/Redis tokens are not yet configured,
 *   enabling full local UI testing without external cloud dependencies.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Import our serverless handlers
import requestHandler from './api/request.js';
import webhookHandler, { parseCallbackData } from './api/webhook.js';
import pollHandler from './api/poll.js';
import adminHandler from './api/admin.js';
import loginHandler from './api/login.js';
import pendingAuthHandler from './api/pending-auth.js';
import confirmAuthHandler from './api/confirm-auth.js';
import statusHandler from './api/status.js';
import routerHandler from './api/router.js';
import deauthHandler from './api/deauth.js';
import voucherHandler from './api/voucher.js';
import configHandler from './api/config.js';
import { getSystemSettings, saveSystemSettings } from './lib/admin/settings.js';
import { checkAdminAuth, changeAdminPassword, getAdminAuthStatus } from './lib/admin/auth.js';
import { parseFasToken } from './lib/opennds.js';
import { answerCallbackQuery, updateTelegramMessage } from './lib/telegram/client.js';
import { buildUnlimitedKeyboard, buildDefaultAuthKeyboard } from './lib/telegram/keyboards.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try loading local environment variables if available
const envFiles = ['.env.local', '.env'];
for (const envFile of envFiles) {
  const envPath = path.join(__dirname, envFile);
  if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(envPath);
      console.log(`[Dev Server] Loaded environment from ${envFile}`);
      break;
    } catch (e) {
      console.warn(`[Dev Server] Notice: Could not parse ${envFile}:`, e.message);
    }
  }
}

const portArgIndex = process.argv.indexOf('--port');
const cliPort = portArgIndex !== -1 && process.argv[portArgIndex + 1] ? Number(process.argv[portArgIndex + 1]) : null;
const PORT = process.env.PORT || cliPort || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

/**
 * Creates standard Express/Vercel-like response helpers (res.status, res.json, res.setHeader)
 */
function enhanceResponse(res) {
  res.status = function (statusCode) {
    res.statusCode = statusCode;
    return res;
  };

  res.json = function (data) {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify(data));
    return res;
  };

  return res;
}

/**
 * Parses JSON request bodies
 */
async function parseBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
  });
}

// In-memory queue and requests list used for local dev simulation if Upstash Redis credentials are not configured
const localDevQueue = [];
globalThis.__localDevQueue = localDevQueue;
const localDevPendingMacs = ['4a:8b:9c:1d:2e:3f', '6c:7d:8e:9f:0a:1b'];
const localDevRequests = [
  {
    name: 'রহিম আহমেদ (Rahim)',
    mac: '4a:8b:9c:1d:2e:3f',
    ip: '192.168.1.105',
    status: 'pending',
    requestedAt: new Date(Date.now() - 1000 * 60 * 3).toISOString()
  },
  {
    name: 'সাদিয়া ইসলাম (Sadia)',
    mac: '6c:7d:8e:9f:0a:1b',
    ip: '192.168.1.112',
    status: 'pending',
    requestedAt: new Date(Date.now() - 1000 * 60 * 12).toISOString()
  }
];

const localDevVouchers = [
  { code: 'PASS-1DAY', duration: 1440, note: '1D ৳10', createdAt: new Date().toISOString() },
  { code: 'PASS-7DAY', duration: 10080, note: '7D ৳40', createdAt: new Date().toISOString() },
  { code: 'PASS-30DAY', duration: 43200, note: '30D ৳100', createdAt: new Date().toISOString() }
];

process.on('uncaughtException', (err) => {
  console.error('[Dev Server Uncaught Exception]', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.warn('[Dev Server Unhandled Rejection]', reason?.message || reason);
});

const server = http.createServer(async (req, res) => {
  enhanceResponse(res);

  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // Enable CORS for local testing
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-router-secret, x-admin-password, x-admin-secret');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

  // Handle Captive Portal Detection Probes from iOS, Android, Windows
  if (
    pathname === '/generate_204' ||
    pathname === '/gen_204' ||
    pathname === '/hotspot-detect.html' ||
    pathname === '/canonical.html' ||
    pathname === '/ncsi.txt' ||
    pathname === '/connecttest.txt'
  ) {
    const query = parsedUrl.search || '';
    res.writeHead(302, { Location: '/' + query });
    res.end();
    return;
  }

  // --- API Routing ---
  if (pathname === '/api/login') {
    req.body = await parseBody(req);
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      return loginHandler(req, res);
    }

    const { fas, name, mac, ip } = req.body || {};
    let clientMac = mac;
    let clientIp = ip;
    if (fas && typeof fas === 'string') {
      const parsed = parseFasToken(fas);
      if (parsed.clientMac) clientMac = parsed.clientMac;
      if (parsed.clientIp) clientIp = parsed.clientIp;
    }

    if (!clientMac) {
      return res.status(400).json({ error: 'Valid client MAC not found' });
    }

    const cleanMac = clientMac.trim().toLowerCase();
    const cleanName = name?.trim() || 'Guest User';

    const existingIdx = localDevPendingMacs.indexOf(cleanMac);
    if (existingIdx !== -1) localDevPendingMacs.splice(existingIdx, 1);
    localDevPendingMacs.push(cleanMac);

    const existingReq = localDevRequests.find(r => r.mac === cleanMac);
    if (existingReq) {
      existingReq.status = 'PENDING';
      existingReq.name = cleanName;
      existingReq.ip = clientIp || existingReq.ip;
      existingReq.requestedAt = new Date().toISOString();
    } else {
      localDevRequests.unshift({
        name: cleanName,
        mac: cleanMac,
        ip: clientIp || '',
        status: 'PENDING',
        requestedAt: new Date().toISOString()
      });
    }

    console.log(`\n--- 🔑 [LOCAL DEV: FAS LOGIN] ---`);
    console.log(`MAC:         ${cleanMac}`);
    console.log(`IP:          ${clientIp || '(none)'}`);
    console.log(`Status:      PENDING`);
    console.log(`Queue Size:  ${localDevPendingMacs.length}`);
    console.log(`---------------------------------\n`);

    return res.status(200).json({ success: true, mac: cleanMac, ip: clientIp, simulated: true });
  }

  if (pathname === '/api/pending-auth') {
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      return pendingAuthHandler(req, res);
    }

    const pendingMac = localDevPendingMacs[0] || null;
    const accept = req.headers['accept'] || '';
    if (accept.includes('application/json') || parsedUrl.searchParams.get('format') === 'json') {
      return res.status(200).json({ mac: pendingMac, simulated: true });
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).end(pendingMac || '');
  }

  if (pathname === '/api/confirm-auth') {
    req.body = await parseBody(req);
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      return confirmAuthHandler(req, res);
    }

    let targetMac = null;
    if (typeof req.body === 'string') {
      const params = new URLSearchParams(req.body);
      targetMac = params.get('mac') || req.body.trim();
    } else if (req.body && typeof req.body === 'object') {
      targetMac = req.body.mac;
    }
    if (!targetMac) {
      targetMac = parsedUrl.searchParams.get('mac');
    }

    if (!targetMac) {
      return res.status(400).json({ error: 'Field "mac" is required and must be a valid MAC address.' });
    }

    const cleanMac = targetMac.trim().toLowerCase();
    const idx = localDevPendingMacs.indexOf(cleanMac);
    if (idx !== -1) {
      localDevPendingMacs.splice(idx, 1);
    }

    const reqRecord = localDevRequests.find(r => r.mac === cleanMac);
    if (reqRecord) {
      reqRecord.status = 'AUTHENTICATED';
      reqRecord.authenticatedAt = new Date().toISOString();
    }

    console.log(`\n--- ✅ [LOCAL DEV: AUTH CONFIRMED] ---`);
    console.log(`MAC:         ${cleanMac}`);
    console.log(`Status:      AUTHENTICATED`);
    console.log(`Remaining:   ${localDevPendingMacs.length}`);
    console.log(`--------------------------------------\n`);

    return res.status(200).json({ success: true, mac: cleanMac, status: 'AUTHENTICATED', simulated: true });
  }

  if (pathname === '/api/router' || pathname === '/cgi-bin/api') {
    req.body = await parseBody(req);
    return routerHandler(req, res);
  }

  if (pathname === '/api/deauth') {
    req.body = await parseBody(req);
    return deauthHandler(req, res);
  }

  if (pathname === '/api/config') {
    return configHandler(req, res);
  }

  if (pathname === '/api/status') {
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      return statusHandler(req, res);
    }

    const targetMac = parsedUrl.searchParams.get('mac');
    if (!targetMac) {
      return res.status(400).json({ error: 'Query parameter "mac" is required.' });
    }

    const cleanMac = targetMac.trim().toLowerCase();
    const reqRecord = localDevRequests.find(r => r.mac.toLowerCase() === cleanMac);

    if (!reqRecord) {
      return res.status(200).json({ mac: cleanMac, status: 'pending', simulated: true });
    }

    const st = (reqRecord.status || 'pending').toLowerCase();
    return res.status(200).json({
      mac: cleanMac,
      name: reqRecord.name,
      status: st,
      duration: reqRecord.duration !== undefined ? reqRecord.duration : 0,
      simulated: true
    });
  }

  if (pathname === '/api/request') {
    req.body = await parseBody(req);

    // If Telegram credentials are configured, execute the real production handler
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      return requestHandler(req, res);
    }

    // Otherwise, simulate Telegram dispatch locally so the frontend UI can be fully previewed
    const { name, mac, ip } = req.body || {};
    console.log('\n--- 📱 [LOCAL DEV: DATABASE & TELEGRAM SIMULATION] ---');
    console.log(`👤 Name:      ${name || '(none)'}`);
    console.log(`🏷  MAC:       ${mac || '(none)'}`);
    console.log(`🌐 IP:        ${ip || '(not provided)'}`);
    console.log(`💾 DB Store:  Saved to Upstash Redis -> key: "request:${mac}" [status: pending]`);
    console.log('🔘 Buttons simulated: [30 Mins] [1 Hour] [Unlimited] [Reject / Terminate]');
    console.log('------------------------------------------------------\n');

    if (!name || !mac) {
      return res.status(400).json({ error: 'Field "name" and "mac" are required.' });
    }

    // Store in dev simulation requests list
    localDevRequests.unshift({
      name: name.trim(),
      mac: mac.trim().toLowerCase(),
      ip: ip ? ip.trim() : '',
      status: 'pending',
      requestedAt: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      simulated: true,
      message: 'Local Simulation: Request stored in database & sent to Telegram (Dev Mode).'
    });
  }

  if (pathname === '/api/webhook' || pathname === '/api/telegram') {
    req.body = await parseBody(req);
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.UPSTASH_REDIS_REST_URL) {
      return webhookHandler(req, res);
    }

    // In local dev simulation mode:
    const message = req.body?.message;
    if (message && message.text) {
      console.log(`\n--- 📱 [LOCAL DEV: SIMULATED TELEGRAM MESSAGE] ---`);
      console.log(`Text: "${message.text}"`);
      console.log(`-------------------------------------------------\n`);
      return res.status(200).json({ ok: true, simulated: true, text: message.text });
    }

    const callbackQuery = req.body?.callback_query;
    if (callbackQuery) {
      const parsed = parseCallbackData(callbackQuery.data);
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const cbId = callbackQuery.id;
      const cbMessage = callbackQuery.message;

      if (parsed) {
        if (parsed.action === 'menu') {
          console.log(`\n--- 📱 [LOCAL DEV: SIMULATED TELEGRAM MENU CALLBACK] ---`);
          console.log(`Command: ${parsed.command}`);
          console.log(`------------------------------------------------------\n`);
          if (botToken && cbId) {
            await answerCallbackQuery(botToken, cbId, '✅ সম্পন্ন হয়েছে', false).catch(() => {});
          }
          return res.status(200).json({ ok: true, simulated: true, menuCommand: parsed.command });
        }

        const { action, mac, duration } = parsed;
        let cmd = '';
        let ackText = '';
        let notice = '';
        let nextKeyboard = [];

        if (action === 'unlim_perm') {
          cmd = `ndsctl trust ${mac}`;
          ackText = `✅ স্থায়ী বিশ্বস্ত অনুমোদিত (${mac})`;
          notice = `✅ *Status:* Authorized (Permanent Trusted) by Admin`;
          nextKeyboard = [[{ text: '❌ Terminate', callback_data: `deauth_${mac}` }]];
        } else if (action === 'unlim_sess') {
          cmd = `ndsctl auth ${mac} 0`;
          ackText = `✅ এককালীন আনলিমিটেড অনুমোদিত (${mac})`;
          notice = `✅ *Status:* Authorized (Session Unlimited) by Admin`;
          nextKeyboard = [[{ text: '❌ Terminate', callback_data: `deauth_${mac}` }]];
        } else if (action === 'auth') {
          if (duration === 0) {
            ackText = '♾ আনলিমিটেড মোড নির্বাচন করুন';
            notice = '♾ *আনলিমিটেড অ্যাক্সেস মোড নির্ধারণ করুন:*';
            nextKeyboard = buildUnlimitedKeyboard(mac);
            if (botToken && cbId) await answerCallbackQuery(botToken, cbId, ackText, false).catch(() => {});
            if (botToken && cbMessage) await updateTelegramMessage(botToken, cbMessage, notice, nextKeyboard).catch(() => {});
            return res.status(200).json({ ok: true, simulated: true, action: 'unlimited_prompted' });
          }
          cmd = `ndsctl auth ${mac} ${duration}`;
          ackText = `✅ Authorized ${mac} (${duration}m)`;
          notice = `✅ *Status:* Authorized (${duration}m) by Admin`;
          nextKeyboard = [[{ text: '❌ Terminate', callback_data: `deauth_${mac}` }]];
        } else if (action === 'unlim_back') {
          ackText = '🔙 পূর্বের অপশনে ফিরে যাওয়া হয়েছে';
          notice = 'Select duration below:';
          nextKeyboard = buildDefaultAuthKeyboard(mac);
          if (botToken && cbId) await answerCallbackQuery(botToken, cbId, ackText, false).catch(() => {});
          if (botToken && cbMessage) await updateTelegramMessage(botToken, cbMessage, notice, nextKeyboard).catch(() => {});
          return res.status(200).json({ ok: true, simulated: true, action: 'unlimited_cancelled' });
        } else {
          cmd = `ndsctl deauth ${mac}`;
          ackText = `❌ Terminated ${mac}`;
          notice = `❌ *Status:* Terminated by Admin`;
          nextKeyboard = [];
        }

        if (cmd) localDevQueue.push(cmd);

        // Update in-memory dev requests status
        const cleanMac = mac.toLowerCase();
        const found = localDevRequests.find(r => r.mac.toLowerCase() === cleanMac);
        if (found) {
          found.status = action === 'deauth' ? 'rejected' : 'authorized';
          found.duration = duration;
          found.reviewedAt = new Date().toISOString();
          found.reviewedBy = 'Telegram Bot Admin';
        }

        // Always answer Telegram callback query so buttons stop spinning
        if (botToken && cbId) {
          await answerCallbackQuery(botToken, cbId, ackText, false).catch(() => {});
        }
        if (botToken && cbMessage) {
          await updateTelegramMessage(botToken, cbMessage, notice, nextKeyboard).catch(() => {});
        }

        console.log(`\n--- 📱 [LOCAL DEV: TELEGRAM CALLBACK HANDLED] ---`);
        console.log(`Action:         ${action.toUpperCase()}`);
        console.log(`MAC:            ${mac}`);
        console.log(`Duration:       ${duration !== null ? (duration === 0 ? 'Unlimited' : `${duration}m`) : 'N/A'}`);
        console.log(`Router Command: ${cmd}`);
        console.log(`Queue Size:     ${localDevQueue.length}`);
        console.log(`-------------------------------------------------\n`);
        return res.status(200).json({ ok: true, simulated: true, commandQueued: cmd });
      }
    }

    return res.status(200).json({ ok: true, simulated: true });
  }

  if (pathname === '/api/poll') {
    if (process.env.ROUTER_SECRET_KEY && process.env.UPSTASH_REDIS_REST_URL) {
      return pollHandler(req, res);
    }

    // Simulation for router polling
    const secret = req.headers['x-router-secret'];
    if (!secret) {
      return res.status(401).json({ error: 'Missing x-router-secret header.' });
    }

    const cmd = localDevQueue.shift() || null;
    return res.status(200).json({ command: cmd, simulated: true });
  }

  if (pathname === '/api/admin') {
    req.body = await parseBody(req);

    // Verify admin credentials strictly using persistent checkAdminAuth
    if (!checkAdminAuth(req)) {
      return res.status(401).json({ error: 'Unauthorized: Invalid admin credentials.' });
    }

    const { action } = req.body || {};

    if (action === 'change_password') {
      const { currentPassword, newPassword } = req.body || {};
      const result = changeAdminPassword(currentPassword, newPassword);
      return res.status(result.ok ? 200 : 400).json(result);
    }

    if (action === 'auth_status') {
      return res.status(200).json({ ok: true, ...getAdminAuthStatus() });
    }

    if (action === 'login') {
      return res.status(200).json({ ok: true, simulated: true, message: 'Logged in successfully.', authStatus: getAdminAuthStatus() });
    }

    // If production Redis is configured along with admin password or router secret, run real handler
    if (process.env.UPSTASH_REDIS_REST_URL) {
      return adminHandler(req, res);
    }

    if (req.method === 'GET') {
      const queryAction = parsedUrl.searchParams.get('action');
      if (queryAction === 'auth_status') {
        return res.status(200).json({ ok: true, ...getAdminAuthStatus() });
      }
      return res.status(200).json({
        ok: true,
        simulated: true,
        pendingQueueCount: localDevQueue.length,
        requests: localDevRequests
      });
    }

    if (req.method === 'POST') {
      const { mac, duration = 60, name } = req.body || {};

      if (action === 'clean') {
        const initialCount = localDevRequests.length;
        const filtered = localDevRequests.filter(r => r.status !== 'rejected' && r.status !== 'terminated');
        const removedCount = initialCount - filtered.length;
        localDevRequests.length = 0;
        localDevRequests.push(...filtered);
        console.log(`\n--- 🧹 [LOCAL DEV: ADMIN CLEAN] Removed ${removedCount} terminated records ---\n`);
        return res.status(200).json({ ok: true, simulated: true, removedCount, remainingCount: filtered.length });
      }

      if (action === 'telegram_webhook_info') {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) {
          return res.status(200).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN কনফিগার করা নেই।', botConfigured: false, simulated: true });
        }
        try {
          const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
          const tgData = await tgRes.json();
          return res.status(200).json({ ok: true, webhook: tgData.result, botConfigured: true });
        } catch (e) {
          return res.status(500).json({ ok: false, error: e.message });
        }
      }

      if (action === 'set_telegram_webhook') {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) {
          return res.status(400).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN কনফিগার করা নেই।', simulated: true });
        }
        const targetUrl = req.body?.url;
        if (!targetUrl) {
          return res.status(400).json({ ok: false, error: 'Field "url" is required.' });
        }
        try {
          const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(targetUrl)}`);
          const tgData = await tgRes.json();
          return res.status(200).json({ ok: tgData.ok, result: tgData });
        } catch (e) {
          return res.status(500).json({ ok: false, error: e.message });
        }
      }

      if (action === 'get_settings') {
        const settings = await getSystemSettings(null);
        return res.status(200).json({ ok: true, simulated: true, settings });
      }

      if (action === 'save_settings') {
        const result = await saveSystemSettings(req.body, null);
        console.log(`\n--- ⚙️ [LOCAL DEV: SETTINGS UPDATED & PERSISTED TO DISK] ---\n`);
        return res.status(200).json({ ...result, simulated: true });
      }

      if (action === 'test_telegram') {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        if (!botToken || !chatId) {
          return res.status(200).json({ ok: true, simulated: true, message: 'Simulated: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing, message printed to dev console.' });
        }
        try {
          const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: '⚡ CyberWave Admin Test: Integration active!' })
          });
          const tgData = await tgRes.json();
          return res.status(tgData.ok ? 200 : 400).json({ ok: tgData.ok, simulated: false, result: tgData });
        } catch (e) {
          return res.status(500).json({ ok: false, error: e.message });
        }
      }

      if (action === 'delete_voucher') {
        const code = String(req.body?.code || '').trim().toUpperCase();
        const idx = localDevVouchers.findIndex(v => v.code === code);
        if (idx !== -1) {
          localDevVouchers.splice(idx, 1);
        }
        return res.status(200).json({ ok: true, simulated: true, code, message: `Voucher ${code} deleted.` });
      }

      if (action !== 'auth' && action !== 'deauth') {
        return res.status(400).json({ error: 'Invalid action.' });
      }

      if (!mac) {
        return res.status(400).json({ error: 'MAC address required.' });
      }

      const cleanMac = mac.trim().toLowerCase();
      const dur = action === 'auth' ? parseInt(duration, 10) || 0 : null;
      const cmd = action === 'auth' ? `ndsctl auth ${cleanMac} ${dur}` : `ndsctl deauth ${cleanMac}`;

      localDevQueue.push(cmd);

      // Update in local requests
      const found = localDevRequests.find(r => r.mac.toLowerCase() === cleanMac);
      if (found) {
        found.status = action === 'auth' ? 'authorized' : 'rejected';
        found.duration = dur;
        found.reviewedAt = new Date().toISOString();
        found.reviewedBy = 'Dev Admin';
      } else {
        localDevRequests.unshift({
          name: name || 'Manual Entry',
          mac: cleanMac,
          status: action === 'auth' ? 'authorized' : 'rejected',
          duration: dur,
          requestedAt: new Date().toISOString(),
          reviewedAt: new Date().toISOString(),
          reviewedBy: 'Dev Admin'
        });
      }

      console.log(`\n--- 🛡️ [LOCAL DEV: ADMIN ACTION] ---`);
      console.log(`Action:         ${action.toUpperCase()}`);
      console.log(`MAC:            ${cleanMac}`);
      console.log(`Duration:       ${dur !== null ? (dur === 0 ? 'Unlimited' : `${dur}m`) : 'N/A'}`);
      console.log(`Router Command: ${cmd}`);
      console.log(`Queue Size:     ${localDevQueue.length}`);
      console.log(`------------------------------------\n`);

      return res.status(200).json({
        ok: true,
        success: true,
        simulated: true,
        action,
        mac: cleanMac,
        duration: dur,
        commandQueued: cmd
      });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (pathname === '/api/voucher') {
    req.body = await parseBody(req);
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      return voucherHandler(req, res);
    }

    // 1. GET: List active vouchers (Admin)
    if (req.method === 'GET') {
      if (!checkAdminAuth(req)) {
        return res.status(401).json({ error: 'Unauthorized: Invalid admin credentials.' });
      }
      return res.status(200).json({ ok: true, vouchers: localDevVouchers, simulated: true });
    }

    // 2. POST: Create voucher (Admin) or Redeem voucher (Guest)
    if (req.method === 'POST') {
      let payload = req.body;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch {
          return res.status(400).json({ error: 'Malformed JSON payload.' });
        }
      }
      payload = payload || {};

      // A. Admin creating voucher
      if (payload.action === 'create') {
        if (!checkAdminAuth(req)) {
          return res.status(401).json({ error: 'Unauthorized: Invalid admin credentials.' });
        }
        const duration = parseInt(payload.duration, 10) || 120;
        const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
        const code = `PASS-${rand}`;
        const newVoucher = {
          code,
          duration,
          createdAt: new Date().toISOString(),
          createdBy: payload.createdBy || 'Dev Admin',
          note: payload.note || ''
        };
        localDevVouchers.unshift(newVoucher);
        console.log(`\n--- 🎟️ [LOCAL DEV: VOUCHER CREATED] Code: ${code} (${duration}m) ---\n`);
        return res.status(200).json({ ok: true, voucher: newVoucher, simulated: true });
      }

      // B. Guest redeeming voucher
      const { code, mac, ip, name } = payload;
      if (!code || !mac) {
        return res.status(400).json({ error: 'Field "code" and "mac" are required.' });
      }
      const cleanCode = code.trim().toUpperCase();
      const cleanMac = mac.trim().toLowerCase();

      const vIdx = localDevVouchers.findIndex(v => v.code === cleanCode);
      let duration = 1440;
      let note = 'Dev Voucher';
      if (vIdx !== -1) {
        const v = localDevVouchers.splice(vIdx, 1)[0];
        duration = v.duration;
        note = v.note;
      }

      const cmd = `ndsctl auth ${cleanMac} ${duration}`;
      localDevQueue.push(cmd);

      const existingReq = localDevRequests.find(r => r.mac === cleanMac);
      if (existingReq) {
        existingReq.status = 'authorized';
        existingReq.duration = duration;
        existingReq.name = name || existingReq.name || `Voucher Guest`;
        existingReq.reviewedAt = new Date().toISOString();
        existingReq.reviewedBy = `Voucher ${cleanCode}`;
      } else {
        localDevRequests.unshift({
          name: name || `Voucher Guest (${cleanCode})`,
          mac: cleanMac,
          ip: ip || '',
          status: 'authorized',
          duration,
          requestedAt: new Date().toISOString(),
          reviewedAt: new Date().toISOString(),
          reviewedBy: `Voucher ${cleanCode}`
        });
      }

      console.log(`\n--- 🎟️ [LOCAL DEV: VOUCHER REDEEMED] ---`);
      console.log(`Code:     ${cleanCode}`);
      console.log(`MAC:      ${cleanMac}`);
      console.log(`Duration: ${duration}m`);
      console.log(`----------------------------------------\n`);

      return res.status(200).json({ success: true, duration, mac: cleanMac, note, simulated: true });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // --- Static File Serving ---
  let filePath;
  if (pathname === '/' || pathname === '/index.html' || pathname === '/fas' || pathname === '/fas/') {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  } else if (pathname === '/admin' || pathname === '/admin.html') {
    filePath = path.join(PUBLIC_DIR, 'admin.html');
  } else if (pathname === '/router' || pathname === '/router/' || pathname === '/router/index.html') {
    filePath = path.join(PUBLIC_DIR, 'router', 'index.html');
  } else {
    filePath = path.join(PUBLIC_DIR, pathname);
  }

  // Security check to avoid path traversal and sensitive file access
  if (!filePath.startsWith(PUBLIC_DIR) || (pathname.endsWith('.json') && pathname !== '/manifest.json' && pathname !== '/metadata.json' && pathname !== '/portal-config.json')) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for single-page captive portal
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.sh': 'text/x-shellscript; charset=utf-8'
    };

    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  });
  } catch (serverErr) {
    console.error('[Dev Server Request Error]', serverErr);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: serverErr?.message || 'Internal dev server error' }));
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Wi-Fi Captive Portal Dev Server running!`);
  console.log(`🌐 Captive Portal URL:     http://localhost:${PORT}`);
  console.log(`🛡️ Admin Console URL:      http://localhost:${PORT}/admin`);
  console.log(`🔗 openNDS Simulation:     http://localhost:${PORT}/?clientmac=4a:8b:9c:1d:2e:3f&clientip=192.168.1.105&gatewayname=Guest-WiFi`);
  console.log(`======================================================\n`);
});
