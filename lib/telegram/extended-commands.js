/**
 * lib/telegram/extended-commands.js
 *
 * Extended Telegram bot commands: device renaming, guest vouchers,
 * bandwidth speed limiting, and daily/live network summary reports.
 * Kept strictly under 250 lines.
 */

import { parseRenameCommand, saveDeviceAlias, formatAliasSuccessMessage } from './alias.js';
import { createVoucher, formatVoucherCreatedCard } from '../voucher.js';
import { sendTelegramMessage } from './client.js';
import { MAC_REGEX, parseDurationString } from './parsers.js';
import { escapeMarkdown } from '../../api/request.js';
import { fetchUserRecords } from './chat-cleaner.js';
import { isUserActive } from './cards.js';

/**
 * Generates formatted live network summary report card.
 *
 * @param {object} redis
 * @returns {Promise<string>}
 */
export async function generateNetworkReportCard(redis) {
  const [rawStatus, users] = await Promise.all([
    redis ? redis.get('router:latest_status').catch(() => null) : null,
    redis ? fetchUserRecords(redis).catch(() => []) : []
  ]);

  const status = rawStatus ? (typeof rawStatus === 'string' ? JSON.parse(rawStatus) : rawStatus) : null;
  const activeCount = users.filter(u => isUserActive(u)).length;
  const totalCount = users.length;

  const dlSpeed = status?.traffic?.current_download_mbps || status?.network?.current_download_mbps || '0';
  const ulSpeed = status?.traffic?.current_upload_mbps || status?.network?.current_upload_mbps || '0';
  const cpuTemp = status?.cpu?.temperature_c || status?.cpu?.temp_celsius || '44';
  const cpuLoad = status?.cpu?.usage_percent || '12';

  let quotaText = 'N/A';
  if (status?.analytics?.quota) {
    const q = status.analytics.quota;
    const usedGb = (q.used_bytes / (1024 * 1024 * 1024)).toFixed(1);
    quotaText = `${usedGb} GB / ${q.total_gb} GB (${q.warning_percent || 80}% সতর্কতা)`;
  }

  let uptimeText = 'সচল';
  const uptimeSec = status?.cpu?.uptime_seconds || status?.uptime;
  if (uptimeSec) {
    const days = Math.floor(uptimeSec / 86400);
    const hours = Math.floor((uptimeSec % 86400) / 3600);
    uptimeText = `${days} দিন ${hours} ঘণ্টা`;
  }

  const timeNow = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Dhaka'
  });

  return [
    '📊 *ওয়াইফাই নেটওয়ার্ক সামারি রিপোর্ট*',
    '━━━━━━━━━━━━━━━━━━━━',
    `🟢 *নেটওয়ার্ক স্ট্যাটাস:* সচল (আপটাইম: ${uptimeText})`,
    `👥 *সক্রিয় ইউজার:* *${activeCount} জন* | *মোট রেকর্ড:* ${totalCount} জন`,
    `🌐 *লাইভ স্পিড:* ⬇️ ${dlSpeed} Mbps | ⬆️ ${ulSpeed} Mbps`,
    `💾 *কোটা ব্যবহার:* ${quotaText}`,
    `⚡ *হার্ডওয়্যার স্বাস্থ্য:* CPU ${cpuLoad}% | তাপমাত্রা ${cpuTemp}°C`,
    '━━━━━━━━━━━━━━━━━━━━',
    `⏰ _রিপোর্ট সময়: ${timeNow} BST_`
  ].join('\n');
}

export async function handleExtendedCommand(message, redis, botToken, chatId) {
  const text = message.text?.trim() || '';

  // 1. Device Rename / Alias: /rename <mac> <name> or reply with "নাম: রহিম"
  const renameCmd = parseRenameCommand(text, message.reply_to_message?.text);
  if (renameCmd) {
    const { mac, alias } = renameCmd;
    await saveDeviceAlias(redis, mac, alias);
    const replyMsg = formatAliasSuccessMessage(mac, alias);
    await sendTelegramMessage(botToken, chatId, replyMsg, null, redis);
    return { handled: true, status: 200, data: { ok: true, action: 'renamed', mac, alias } };
  }

  // 2. Voucher Generation: /voucher [duration] or ভাউচার [সময়]
  const voucherMatch = text.match(/^\/(?:voucher|pass|passcode)\b(?:\s+(.+))?$/i) ||
                       text.match(/^(?:ভাউচার|পাসকোড)\b(?:\s+(.+))?$/i);
  if (voucherMatch) {
    let duration = 120;
    if (voucherMatch[1]) {
      const parsed = parseDurationString(voucherMatch[1]);
      if (parsed !== null && parsed >= 0) duration = parsed;
    }
    const voucher = await createVoucher(redis, duration, message.from?.first_name || 'Telegram Admin');
    const voucherCard = formatVoucherCreatedCard(voucher);
    await sendTelegramMessage(botToken, chatId, voucherCard, null, redis);
    return { handled: true, status: 200, data: { ok: true, action: 'voucher_created', voucher } };
  }

  // 3. Client Bandwidth Limit: /limit <mac> <mbps> or /speed <mac> <mbps>
  const limitMatch = text.match(/^\/(?:limit|speed|throttle)\s+((?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2})\s+(\d+)/i) ||
                     text.match(/^(?:স্পিড|লিমিট)\s+((?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2})\s+(\d+)/i);
  if (limitMatch) {
    const mac = limitMatch[1].toLowerCase().replace(/-/g, ':');
    const mbps = parseInt(limitMatch[2], 10);
    const cleanSec = `limit_${mac.replace(/:/g, '')}`;
    const routerCmd = mbps > 0
      ? `uci set archer_guard.${cleanSec}=section && uci set archer_guard.${cleanSec}.mac='${mac}' && uci set archer_guard.${cleanSec}.mbps='${mbps}' && uci commit archer_guard`
      : `uci delete archer_guard.${cleanSec} 2>/dev/null && uci commit archer_guard`;

    await redis.rpush('pending_commands', routerCmd);
    await redis.set(`client_limit:${mac}`, mbps);

    const limitNotice = mbps > 0
      ? [
          '⚡ *ব্যান্ডউইথ স্পিড লিমিট কার্যকর!*',
          '━━━━━━━━━━━━━━━━━━━━',
          `🏷 *ডিভাইস MAC:* \`${mac}\``,
          `🚀 *সর্বোচ্চ স্পিড:* *${mbps} Mbps*`,
          '━━━━━━━━━━━━━━━━━━━━',
          '_রাউটারে ব্যান্ডউইথ নিয়ন্ত্রণ কমান্ড পাঠানো হয়েছে।_'
        ].join('\n')
      : [
          '⚡ *ব্যান্ডউইথ স্পিড লিমিট অপসারিত*',
          '━━━━━━━━━━━━━━━━━━━━',
          `🏷 *ডিভাইস MAC:* \`${mac}\``,
          '🚀 *বর্তমান স্পিড:* *স্বাভাবিক / ফুল স্পিড*',
          '━━━━━━━━━━━━━━━━━━━━'
        ].join('\n');

    await sendTelegramMessage(botToken, chatId, limitNotice, null, redis);
    return { handled: true, status: 200, data: { ok: true, action: 'client_limit_set', mac, mbps } };
  }

  // 4. Daily / Live Network Summary Report: /report or /summary or রিপোর্ট
  if (/^\/(?:report|summary|stats)$/i.test(text) || /^(?:রিপোর্ট|সামারি|পরিসংখ্যান)$/i.test(text)) {
    const reportMsg = await generateNetworkReportCard(redis);
    await sendTelegramMessage(botToken, chatId, reportMsg, null, redis);
    return { handled: true, status: 200, data: { ok: true, action: 'report_generated' } };
  }

  return { handled: false };
}
