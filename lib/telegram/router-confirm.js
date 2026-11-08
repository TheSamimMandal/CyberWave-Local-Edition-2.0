/**
 * lib/telegram/router-confirm.js
 *
 * Formats and dispatches Telegram confirmation cards when commands
 * are executed and verified on the OpenWrt router (Archer C6).
 * Kept strictly under 250 lines.
 */

import { escapeMarkdown } from '../../api/request.js';
import { formatDateTime } from './cards.js';
import { getDeviceAlias } from './alias.js';
import { sendTelegramMessage } from './client.js';

/**
 * Formats a clean Bengali Markdown confirmation card for router execution.
 *
 * @param {object} params
 * @param {string} [params.command]
 * @param {string} [params.mac]
 * @param {object} [params.user]
 * @param {string} [params.alias]
 * @param {string} [params.status]
 * @param {string} [params.details]
 * @returns {string}
 */
export function formatRouterActionNotice({
  command = '',
  mac = '',
  user = null,
  alias = null,
  status = 'success',
  details = ''
}) {
  const cleanMac = (mac || '').toLowerCase().replace(/-/g, ':');
  const cmd = String(command || '').trim();
  const rawStatus = String(status || 'success').toLowerCase();
  const isSuccess = rawStatus === 'success' || rawStatus === 'ok';

  const rawName = alias || user?.alias || user?.name || (cleanMac ? 'Guest User' : 'Router System');
  const safeName = escapeMarkdown(rawName.trim());
  const nowIso = new Date().toISOString();
  const { time } = formatDateTime(nowIso);

  const lines = [
    '⚡ *রাউটার অ্যাকশন সম্পন্ন (Router Verified)*',
    '━━━━━━━━━━━━━━━━━━━━'
  ];

  // 1. Client Authentication: ndsctl auth <mac> <duration>
  if (cmd.startsWith('ndsctl auth') || (!cmd && cleanMac)) {
    const parts = cmd.split(/\s+/);
    const duration = parts[3] !== undefined ? parseInt(parts[3], 10) : (user?.duration !== undefined ? parseInt(user.duration, 10) : null);
    let durText = '৩০ মিনিট';
    if (duration === 0) {
      durText = user?.mode === 'permanent' ? '🛡️ স্থায়ী বিশ্বস্ত (Permanent)' : '♾ এককালীন আনলিমিটেড';
    } else if (duration !== null && !isNaN(duration)) {
      durText = `${duration} মিনিট`;
    }

    lines.push('✅ *অ্যাকশন:* ওয়াইফাই এক্সেস সক্রিয়');
    lines.push(`👤 *ইউজার / ডিভাইস:* ${safeName}`);
    lines.push(`🏷 *ম্যাক অ্যাড্রেস:* \`${cleanMac}\``);
    lines.push(`⏱ *অনুমোদিত মেয়াদ:* ${durText}`);
    lines.push(`📡 *রাউটার স্ট্যাটাস:* ${isSuccess ? '🟢 ফায়ারওয়াল অথোরাইজেশন কার্যকর' : '🔴 ব্যর্থ হয়েছে'}`);
    lines.push(`⏰ *কনফার্মেশন সময়:* ${time}`);
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('_রাউটারে openNDS ফায়ারওয়াল রুল সফলভাবে কার্যকর হয়েছে।_');
    return lines.join('\n');
  }

  // 2. Client Deauthentication: ndsctl deauth <mac>
  if (cmd.startsWith('ndsctl deauth')) {
    lines.push('❌ *অ্যাকশন:* সংযোগ বিচ্ছিন্ন (Deauthenticated)');
    lines.push(`👤 *ইউজার / ডিভাইস:* ${safeName}`);
    lines.push(`🏷 *ম্যাক অ্যাড্রেস:* \`${cleanMac}\``);
    lines.push(`📡 *রাউটার স্ট্যাটাস:* ${isSuccess ? '🔴 ওয়াইফাই ও ফায়ারওয়াল থেকে ড্রপ করা হয়েছে' : '⚠️ ব্যর্থ হয়েছে'}`);
    lines.push(`⏰ *কনফার্মেশন সময়:* ${time}`);
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('_রাউটারে ডিভাইসটির এক্সেস সম্পূর্ণ বন্ধ করা হয়েছে।_');
    return lines.join('\n');
  }

  // 3. Permanent Trust: ndsctl trust <mac>
  if (cmd.startsWith('ndsctl trust')) {
    lines.push('🛡️ *অ্যাকশন:* স্থায়ী বিশ্বস্ত অনুমোদন (Permanent Trusted)');
    lines.push(`👤 *ইউজার / ডিভাইস:* ${safeName}`);
    lines.push(`🏷 *ম্যাক অ্যাড্রেস:* \`${cleanMac}\``);
    lines.push(`📡 *রাউটার স্ট্যাটাস:* ${isSuccess ? '🟢 বিশ্বস্ত ডিভাইসের তালিকায় অন্তর্ভুক্ত' : '🔴 ব্যর্থ হয়েছে'}`);
    lines.push(`⏰ *কনফার্মেশন সময়:* ${time}`);
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('_ক্যাপটিভ পোর্টাল ছাড়াই ডিভাইসটি স্থায়ীভাবে ইন্টারনেট পাবে।_');
    return lines.join('\n');
  }

  // 4. Untrust: ndsctl untrust <mac>
  if (cmd.startsWith('ndsctl untrust')) {
    lines.push('🛡️ *অ্যাকশন:* স্থায়ী বিশ্বস্ত তালিকা থেকে অপসারিত');
    if (cleanMac) lines.push(`🏷 *ম্যাক অ্যাড্রেস:* \`${cleanMac}\``);
    lines.push(`📡 *রাউটার স্ট্যাটাস:* ${isSuccess ? '⚠️ আন-ট্রাস্ট কার্যকর' : '🔴 ব্যর্থ হয়েছে'}`);
    lines.push(`⏰ *কনফার্মেশন সময়:* ${time}`);
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('_ডিভাইসটিকে পরবর্তী সংযোগে পুনরায় ক্যাপটিভ পোর্টালে লগইন করতে হবে।_');
    return lines.join('\n');
  }

  // 5. Bandwidth Speed Limit: uci set archer_guard.limit_...
  if (cmd.includes('archer_guard.limit') || cmd.includes('limit_')) {
    const mbpsMatch = cmd.match(/mbps=['"]?(\d+)['"]?/i);
    const mbps = mbpsMatch ? parseInt(mbpsMatch[1], 10) : null;
    const isRemove = cmd.includes('delete') || mbps === 0;

    if (isRemove) {
      lines.push('🔄 *অ্যাকশন:* ব্যান্ডউইথ লিমিট অপসারিত (ফুল স্পিড)');
      if (cleanMac) lines.push(`🏷 *ম্যাক অ্যাড্রেস:* \`${cleanMac}\``);
      lines.push('🚀 *বর্তমান গতি:* *স্বাভাবিক / আনলিমিটেড স্পিড*');
      lines.push(`📡 *রাউটার স্ট্যাটাস:* ${isSuccess ? '🟢 স্পিড লিমিটেশন রিমুভ সম্পন্ন' : '🔴 ব্যর্থ হয়েছে'}`);
    } else {
      lines.push('⚡ *অ্যাকশন:* ব্যান্ডউইথ স্পিড লিমিট কার্যকর');
      if (cleanMac) lines.push(`🏷 *ম্যাক অ্যাড্রেস:* \`${cleanMac}\``);
      if (mbps !== null) lines.push(`🚀 *ব্যান্ডউইথ সীমা:* *${mbps} Mbps*`);
      lines.push(`📡 *রাউটার স্ট্যাটাস:* ${isSuccess ? '🟢 SQM ফায়ারওয়াল কিউ সক্রিয়' : '🔴 ব্যর্থ হয়েছে'}`);
    }
    lines.push(`⏰ *কনফার্মেশন সময়:* ${time}`);
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('_রাউটারে ব্যান্ডউইথ কনফিগারেশন বাস্তবায়িত হয়েছে।_');
    return lines.join('\n');
  }

  // 6. Router Reboot
  if (cmd === 'reboot' || cmd.startsWith('reboot')) {
    lines.push('🔄 *অ্যাকশন:* রাউটার রিবুট (Reboot)');
    lines.push(`📡 *রাউটার স্ট্যাটাস:* ${isSuccess ? '🟢 রিস্টার্ট প্রক্রিয়া শুরু হয়েছে' : '🔴 ব্যর্থ হয়েছে'}`);
    lines.push(`⏰ *কনফার্মেশন সময়:* ${time}`);
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('_রাউটার হার্ডওয়্যার সিস্টেম কয়েক মিনিটের মধ্যে রিস্টার্ট হবে।_');
    return lines.join('\n');
  }

  // 7. Wi-Fi Configuration / Wireless
  if (cmd.includes('wireless') || cmd.includes('wifi reload')) {
    lines.push('📶 *অ্যাকশন:* ওয়াইফাই সেটিংস আপডেট');
    lines.push(`📡 *রাউটার স্ট্যাটাস:* ${isSuccess ? '🟢 ওয়াইফাই রিলোড সম্পন্ন' : '🔴 ব্যর্থ হয়েছে'}`);
    lines.push(`⏰ *কনফার্মেশন সময়:* ${time}`);
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    return lines.join('\n');
  }

  // 8. General router command execution fallback
  const safeCmd = escapeMarkdown(cmd.length > 50 ? cmd.slice(0, 48) + '…' : cmd);
  lines.push(`⚙️ *অ্যাকশন:* \`${safeCmd}\``);
  if (cleanMac) lines.push(`🏷 *ম্যাক অ্যাড্রেস:* \`${cleanMac}\``);
  lines.push(`📡 *রাউটার স্ট্যাটাস:* ${isSuccess ? '🟢 সফলভাবে সম্পন্ন হয়েছে (Success)' : '🔴 ব্যর্থ হয়েছে'}`);
  if (details && isSuccess) {
    const safeDetails = escapeMarkdown(String(details).slice(0, 100));
    lines.push(`📋 *আউটপুট:* \`${safeDetails}\``);
  }
  lines.push(`⏰ *কনফার্মেশন সময়:* ${time}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  return lines.join('\n');
}

/**
 * Sends a verified router action notification to the Telegram chat.
 *
 * @param {object} options
 * @param {object} [options.redis]
 * @param {string} options.botToken
 * @param {string|number} options.chatId
 * @param {object} options.payload
 * @returns {Promise<object>}
 */
export async function sendRouterConfirmationNotice({
  redis = null,
  botToken,
  chatId,
  payload = {}
}) {
  if (!botToken || !chatId) {
    return { ok: false, reason: 'missing_telegram_credentials' };
  }

  const { mac = '', command = '', status = 'success', details = '' } = payload;
  const cleanMac = (mac || '').toLowerCase().replace(/-/g, ':');
  const actionKey = String(command || cleanMac || 'action').slice(0, 30).replace(/[^a-zA-Z0-9_:-]/g, '_');

  // Deduplication: prevent multiple notifications for the same action within 8 seconds
  if (redis) {
    const dedupKey = `router_confirmed:${cleanMac || 'cmd'}:${actionKey}`;
    try {
      const alreadyNotified = await redis.get(dedupKey);
      if (alreadyNotified) {
        return { ok: true, deduplicated: true };
      }
      await redis.set(dedupKey, Date.now(), { ex: 8 });
    } catch {
      // Ignore Redis dedup error
    }
  }

  let user = null;
  let alias = null;
  if (cleanMac && redis) {
    try {
      const [userRecord, aliasVal] = await Promise.all([
        redis.hgetall(`request:${cleanMac}`),
        getDeviceAlias(redis, cleanMac)
      ]);
      user = userRecord;
      alias = aliasVal;
    } catch {
      // Ignore Redis fetch error
    }
  }

  const noticeText = formatRouterActionNotice({
    command,
    mac: cleanMac,
    user,
    alias,
    status,
    details
  });

  const sendResult = await sendTelegramMessage(botToken, chatId, noticeText, null, redis);
  return { ok: true, notified: true, sendResult };
}
