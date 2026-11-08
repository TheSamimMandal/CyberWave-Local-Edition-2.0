/**
 * lib/admin/settings.js
 *
 * System settings, environment configuration, payment methods,
 * and diagnostic tools for CyberWave Admin Panel.
 * Kept strictly under 250 lines.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');

export async function getSystemSettings(redis) {
  let redisConfig = {};
  if (redis) {
    try {
      redisConfig = (await redis.hgetall('system:settings')) || {};
    } catch {}
  }

  let fileConfig = {};
  try {
    const configPath = path.join(ROOT_DIR, 'public/portal-config.json');
    if (fs.existsSync(configPath)) {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch {}

  const merged = { ...fileConfig, ...redisConfig };

  const maskSecret = (val) => {
    if (!val) return '';
    if (val.length <= 8) return '••••••••';
    return `${val.slice(0, 4)}••••${val.slice(-4)}`;
  };

  return {
    telegramBotToken: maskSecret(process.env.TELEGRAM_BOT_TOKEN),
    telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
    redisRestUrl: process.env.UPSTASH_REDIS_REST_URL ? `${process.env.UPSTASH_REDIS_REST_URL.slice(0, 16)}...` : '',
    hasRedisToken: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
    routerSecretKey: maskSecret(process.env.ROUTER_SECRET_KEY),
    adminPassword: maskSecret(process.env.ADMIN_PASSWORD),
    timezone: merged.timezone || process.env.TIMEZONE || 'Asia/Kolkata',
    portalTitle: merged.portalTitle || process.env.PORTAL_TITLE || 'CyberWave WiFi',
    gatewayName: merged.gatewayName || process.env.GATEWAY_NAME || 'CyberWave Hotspot',
    supportPhone: merged.supportPhone || process.env.SUPPORT_PHONE || '+91 9876543210',
    welcomeNotice: merged.welcomeNotice || process.env.WELCOME_NOTICE || 'CyberWave হাই-স্পিড ওয়াইফাই জোনে স্বাগতম!',
    refreshInterval: Number(merged.refreshInterval) || 5,
    language: merged.language || 'bn',
    payments: {
      phonepe_upi: merged.phonepe_upi || process.env.PHONEPE_UPI || 'Q07543927@ybl',
      paytm_upi: merged.paytm_upi || process.env.PAYTM_UPI || 'Q07543927@ybl',
      gpay_upi: merged.gpay_upi || process.env.GPAY_UPI || 'Q07543927@ybl',
      instructions: merged.payment_instructions || 'যেকোনো UPI অ্যাপ দিয়ে পেমেন্ট করে Transaction ID দিন।'
    }
  };
}

export async function saveSystemSettings(payload, redis) {
  const allowedKeys = [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'ROUTER_SECRET_KEY',
    'ADMIN_PASSWORD',
    'TIMEZONE',
    'PORTAL_TITLE',
    'GATEWAY_NAME',
    'SUPPORT_PHONE',
    'PHONEPE_UPI',
    'PAYTM_UPI',
    'GPAY_UPI'
  ];

  const envUpdates = {};
  for (const key of allowedKeys) {
    const val = payload[key] || payload[key.toLowerCase()];
    if (val && typeof val === 'string' && !val.includes('•••') && val.trim()) {
      process.env[key] = val.trim();
      envUpdates[key] = val.trim();
    }
  }

  // Persist to local .env or .env.local if present
  try {
    const envPath = path.join(ROOT_DIR, '.env.local');
    const targetFile = fs.existsSync(envPath) ? envPath : path.join(ROOT_DIR, '.env');
    let existingContent = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, 'utf8') : '';

    for (const [k, v] of Object.entries(envUpdates)) {
      const regex = new RegExp(`^${k}=.*$`, 'm');
      if (regex.test(existingContent)) {
        existingContent = existingContent.replace(regex, `${k}="${v}"`);
      } else {
        existingContent += `\n${k}="${v}"`;
      }
    }
    fs.writeFileSync(targetFile, existingContent.trim() + '\n', 'utf8');
  } catch (err) {
    console.warn('[Settings] Notice: could not write local env file:', err.message);
  }

  // Persist general settings and payment options
  const redisSettings = {};
  const phonepe = payload.phonepe_upi || payload.PHONEPE_UPI;
  if (phonepe && typeof phonepe === 'string') {
    const val = phonepe.trim();
    redisSettings.phonepe_upi = val;
    process.env.PHONEPE_UPI = val;
  }
  const paytm = payload.paytm_upi || payload.PAYTM_UPI;
  if (paytm && typeof paytm === 'string') {
    const val = paytm.trim();
    redisSettings.paytm_upi = val;
    process.env.PAYTM_UPI = val;
  }
  const gpay = payload.gpay_upi || payload.GPAY_UPI;
  if (gpay && typeof gpay === 'string') {
    const val = gpay.trim();
    redisSettings.gpay_upi = val;
    process.env.GPAY_UPI = val;
  }
  const pTitle = payload.portalTitle || payload.PORTAL_TITLE;
  if (pTitle && typeof pTitle === 'string') {
    const val = pTitle.trim();
    redisSettings.portalTitle = val;
    process.env.PORTAL_TITLE = val;
  }
  const gwName = payload.gatewayName || payload.GATEWAY_NAME;
  if (gwName && typeof gwName === 'string') {
    const val = gwName.trim();
    redisSettings.gatewayName = val;
    process.env.GATEWAY_NAME = val;
  }
  const sPhone = payload.supportPhone || payload.SUPPORT_PHONE;
  if (sPhone && typeof sPhone === 'string') {
    const val = sPhone.trim();
    redisSettings.supportPhone = val;
    process.env.SUPPORT_PHONE = val;
  }
  const wNotice = payload.welcomeNotice || payload.WELCOME_NOTICE;
  if (wNotice && typeof wNotice === 'string') {
    const val = wNotice.trim();
    redisSettings.welcomeNotice = val;
    process.env.WELCOME_NOTICE = val;
  }
  if (payload.payment_instructions) {
    redisSettings.payment_instructions = String(payload.payment_instructions).trim();
  }
  if (payload.timezone) redisSettings.timezone = payload.timezone;
  if (payload.refreshInterval) redisSettings.refreshInterval = String(payload.refreshInterval);
  if (payload.language) redisSettings.language = payload.language;

  if (redis && Object.keys(redisSettings).length > 0) {
    try {
      await redis.hset('system:settings', redisSettings);
    } catch (e) {
      console.warn('[Settings] Failed to save settings in Redis:', e.message);
    }
  }

  // Also write to public/portal-config.json for instant frontend & static serving
  try {
    const configPath = path.join(ROOT_DIR, 'public/portal-config.json');
    let currentConfig = {};
    if (fs.existsSync(configPath)) {
      try { currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
    }
    const updated = {
      ...currentConfig,
      ...redisSettings,
      payments: {
        phonepe: {
          label: 'PhonePe',
          color: '#5f259f',
          to: redisSettings.phonepe_upi || currentConfig.phonepe_upi || process.env.PHONEPE_UPI || 'Q07543927@ybl'
        },
        paytm: {
          label: 'Paytm',
          color: '#00b9f1',
          to: redisSettings.paytm_upi || currentConfig.paytm_upi || process.env.PAYTM_UPI || 'Q07543927@ybl'
        },
        gpay: {
          label: 'Google Pay',
          color: '#1a73e8',
          to: redisSettings.gpay_upi || currentConfig.gpay_upi || process.env.GPAY_UPI || 'Q07543927@ybl'
        }
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Settings] Failed to write portal-config.json:', err.message);
  }

  return { ok: true, message: 'সেটিংস সফলভাবে সংরক্ষণ করা হয়েছে।' };
}

export async function getPublicPortalConfig(redis) {
  let redisConfig = {};
  if (redis) {
    try {
      redisConfig = (await redis.hgetall('system:settings')) || {};
    } catch {}
  }

  let fileConfig = {};
  try {
    const configPath = path.join(ROOT_DIR, 'public/portal-config.json');
    if (fs.existsSync(configPath)) {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch {}

  const merged = { ...fileConfig, ...redisConfig };

  const phonepe = merged.phonepe_upi || process.env.PHONEPE_UPI || 'Q07543927@ybl';
  const paytm = merged.paytm_upi || process.env.PAYTM_UPI || 'Q07543927@ybl';
  const gpay = merged.gpay_upi || process.env.GPAY_UPI || 'Q07543927@ybl';

  return {
    portalTitle: merged.portalTitle || process.env.PORTAL_TITLE || 'CyberWave WiFi',
    gatewayName: merged.gatewayName || process.env.GATEWAY_NAME || 'CyberWave Hotspot',
    supportPhone: merged.supportPhone || process.env.SUPPORT_PHONE || '+91 9876543210',
    welcomeNotice: merged.welcomeNotice || process.env.WELCOME_NOTICE || 'CyberWave হাই-স্পিড ওয়াইফাই জোনে স্বাগতম!',
    phonepe_upi: phonepe,
    paytm_upi: paytm,
    gpay_upi: gpay,
    payment_instructions: merged.payment_instructions || 'যেকোনো UPI অ্যাপ দিয়ে পেমেন্ট করে Transaction ID দিন।',
    payments: {
      phonepe: {
        label: 'PhonePe',
        color: '#5f259f',
        to: phonepe
      },
      paytm: {
        label: 'Paytm',
        color: '#00b9f1',
        to: paytm
      },
      gpay: {
        label: 'Google Pay',
        color: '#1a73e8',
        to: gpay
      }
    }
  };
}

export async function sendTelegramTestMessage(botToken, chatId) {
  if (!botToken || !chatId) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN এবং TELEGRAM_CHAT_ID দুটোই প্রয়োজন।' };
  }

  const text = [
    '⚡ *CyberWave Admin Test Message*',
    '━━━━━━━━━━━━━━━━━━━━',
    '✅ *টেলিগ্রাম ইন্টিগ্রেশন সক্রিয় ও কার্যকরী!*',
    'ক্যাপটিভ পোর্টাল আবেদন, অনুমোদন এবং রাউটার সংক্রান্ত সকল অ্যালার্ট এই চ্যাটে পাওয়া যাবে।',
    '━━━━━━━━━━━━━━━━━━━━',
    `🕒 *সময়:* ${new Date().toLocaleString('en-US', { timeZone: process.env.TIMEZONE || 'Asia/Kolkata' })}`
  ].join('\n');

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown'
      })
    });
    const data = await res.json();
    return { ok: data.ok, result: data.result, error: data.description };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function deleteVoucher(redis, code) {
  if (!redis || !code) {
    return { ok: false, error: 'Redis instance and voucher code are required.' };
  }
  const cleanCode = String(code).trim().toUpperCase();
  try {
    await redis.srem('active_vouchers', cleanCode);
    await redis.del(`voucher:${cleanCode}`);
    return { ok: true, code: cleanCode, message: `ভাউচার ${cleanCode} অপসারিত হয়েছে।` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
