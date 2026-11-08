/**
 * lib/telegram/cards.js
 *
 * Markdown message and status card formatters for Telegram Bot.
 * Kept strictly under 250 lines.
 */

import { escapeMarkdown } from '../../api/request.js';

export const APP_TIMEZONE = process.env.TIMEZONE || 'Asia/Dhaka';

export function formatDateTime(isoString, timeZone = APP_TIMEZONE) {
  if (!isoString) return { date: 'N/A', time: 'N/A', rawDate: null };
  const dateObj = new Date(isoString);
  if (isNaN(dateObj.getTime())) return { date: 'N/A', time: 'N/A', rawDate: null };

  const tz = timeZone || APP_TIMEZONE || 'Asia/Dhaka';
  const dateStr = dateObj.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: tz
  });

  const timeStr = dateObj.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: tz
  }) + (tz === 'Asia/Dhaka' ? ' BST' : '');

  return { date: dateStr, time: timeStr, rawDate: dateObj };
}

export function isUserActive(user) {
  if (!user || typeof user !== 'object') return false;
  const status = String(user.status || '').toLowerCase();
  const isAuth = status === 'authorized' || status === 'authenticated';
  if (!isAuth) return false;

  const duration = Number(user.duration);
  if (duration === 0) return true;

  if (duration > 0 && user.reviewedAt) {
    const reviewedTime = new Date(user.reviewedAt).getTime();
    if (!isNaN(reviewedTime)) {
      const elapsedMs = Date.now() - reviewedTime;
      const durationMs = duration * 60 * 1000;
      if (elapsedMs > durationMs) return false;
    }
  }
  return true;
}

export function isUserTerminated(user) {
  if (!user || typeof user !== 'object') return false;
  const status = String(user.status || '').toLowerCase();
  return status === 'terminated' || status === 'rejected';
}

export function formatUserDetailsCard(user) {
  const timestampField = user.requestedAt || user.reviewedAt || user.authenticatedAt || new Date().toISOString();
  const { date, time } = formatDateTime(timestampField);
  const safeName = escapeMarkdown(user.name || 'Guest User');
  const safeMac = user.mac ? user.mac.toLowerCase() : 'N/A';
  const safeIp = escapeMarkdown(user.ip || 'N/A');

  const status = String(user.status || '').toLowerCase();
  let statusBadge = '⏳ অপেক্ষমান (Pending)';
  if (isUserActive(user)) statusBadge = '🟢 সক্রিয় (Active)';
  else if (status === 'terminated') statusBadge = '❌ টার্মিনেটেড (Terminated)';
  else if (status === 'rejected') statusBadge = '🚫 বাতিলকৃত (Rejected)';
  else if (status === 'authorized' || status === 'authenticated') statusBadge = '⏱ মেয়াদোত্তীর্ণ (Expired)';

  return [
    `👤 *নাম:* ${safeName}`,
    `📅 *তারিখ:* ${date}`,
    `🏷 *ম্যাক অ্যাড্রেস:* \`${safeMac}\``,
    `🌐 *আইপি অ্যাড্রেস:* \`${safeIp}\``,
    `⏰ *টাইমস্ট্যাম্প:* ${time}`,
    `📌 *স্ট্যাটাস:* ${statusBadge}`
  ].join('\n');
}

export function formatUserDetailsList(users) {
  if (!users || users.length === 0) {
    return '📋 *সমস্ত ইউজারদের বিস্তারিত তথ্য*\n━━━━━━━━━━━━━━━━━━━━\nℹ️ বর্তমানে কোনো ইউজারের রেকর্ড পাওয়া যায়নি।';
  }

  const header = `📋 *সমস্ত ইউজারদের বিস্তারিত তথ্য (মোট: ${users.length} জন)*\n━━━━━━━━━━━━━━━━━━━━`;
  const visible = users.slice(0, 25);
  const cards = visible.map(u => formatUserDetailsCard(u));
  let result = `${header}\n${cards.join('\n━━━━━━━━━━━━━━━━━━━━\n')}`;
  if (users.length > 25) {
    result += `\n━━━━━━━━━━━━━━━━━━━━\n_... এবং আরও ${users.length - 25} জন ইউজার তালিকায় রয়েছে।_`;
  }
  return result;
}

export function formatSingleActiveUserCard(user) {
  if (!user) return '';
  const duration = Number(user.duration);
  let durationLabel = 'N/A';
  if (duration === 0) {
    durationLabel = (user.mode === 'permanent' || user.trusted === 'true' || user.trusted === true)
      ? '🛡️ স্থায়ী বিশ্বস্ত (Permanent)'
      : '♾️ এককালীন (Unlimited)';
  } else if (duration > 0) {
    durationLabel = `⏳ ${duration} মিনিট`;
  }
  const { time, date } = formatDateTime(user.reviewedAt || user.authenticatedAt || user.requestedAt);
  const safeName = escapeMarkdown(user.name || 'Guest User');
  const safeIp = escapeMarkdown(user.ip || 'N/A');
  const safeMac = escapeMarkdown(user.mac || 'N/A');

  return [
    `👤 *ইউজার:* ${safeName}`,
    '━━━━━━━━━━━━━━━━━━━━',
    `🏷 *MAC অ্যাড্রেস:* \`${safeMac}\``,
    `🌐 *IP অ্যাড্রেস:* \`${safeIp}\``,
    `⏱ *অনুমোদিত মেয়াদ:* ${durationLabel}`,
    `⏰ *কানেক্টেড সময়:* ${time} (${date})`,
    '━━━━━━━━━━━━━━━━━━━━',
    '_সংযোগ বিচ্ছিন্ন করতে নিচের বাটনে চাপ দিন:_'
  ].join('\n');
}

export function formatActiveUsersList(activeUsers = [], pendingQueueCount = 0) {
  const count = Array.isArray(activeUsers) ? activeUsers.length : 0;
  const tz = APP_TIMEZONE || 'Asia/Dhaka';
  const now = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: tz
  }) + (tz === 'Asia/Dhaka' ? ' BST' : '');

  let msg = [
    '🟢 *সক্রিয় নেটওয়ার্ক ইউজার (Active Wi-Fi Users)*',
    '━━━━━━━━━━━━━━━━━━━━',
    `📊 *নেটওয়ার্ক স্ট্যাটাস:* 🟢 সচল | *পেন্ডিং কিউ:* ${pendingQueueCount} টি`,
    `👥 *মোট কানেক্টেড ইউজার:* ${count} জন`,
    `⏰ *সর্বশেষ লাইভ আপডেট:* ${now}`,
    '━━━━━━━━━━━━━━━━━━━━'
  ].join('\n');

  if (count === 0) {
    return msg + '\n\nℹ️ বর্তমানে কোনো ইউজার অ্যাক্টিভ বা কানেক্টেড নেই।\nনতুন রিকোয়েস্ট এলে অনুমোদন করতে পারবেন।';
  }

  msg += '\n\n';
  activeUsers.forEach((u, i) => {
    const duration = Number(u.duration);
    let durationLabel = 'N/A';
    if (duration === 0) {
      durationLabel = (u.mode === 'permanent' || u.trusted === 'true' || u.trusted === true) ? '🛡️ স্থায়ী বিশ্বস্ত' : '♾ এককালীন';
    } else if (duration > 0) {
      durationLabel = `${duration}m`;
    }
    const { time } = formatDateTime(u.reviewedAt || u.authenticatedAt || u.requestedAt);
    const safeName = escapeMarkdown(u.name || 'Guest User');
    const safeIp = escapeMarkdown(u.ip || 'N/A');
    msg += `${i + 1}. *${safeName}*\n   ├ 🏷 MAC: \`${u.mac}\`\n   ├ 🌐 IP: \`${safeIp}\`\n   ├ ⏱ মেয়াদ: ${durationLabel}\n   └ ⏰ কানেক্টেড: ${time}\n\n`;
  });

  return (msg + '━━━━━━━━━━━━━━━━━━━━\n_💡 যেকোনো অ্যাক্টিভ ইউজারকে টার্মিনেট করতে নিচের লাল বাটন প্রেস করুন:_').trim();
}

export function formatPreviousUsersList(previousUsers) {
  const count = Array.isArray(previousUsers) ? previousUsers.length : 0;
  let msg = [
    '👥 *প্রিভিয়াস ইউজারদের তালিকা (Previous Users)*',
    '━━━━━━━━━━━━━━━━━━━━',
    `📁 *মোট পূর্ববর্তী ইউজার:* ${count} জন\n`
  ].join('\n');

  if (count === 0) return msg + '\nℹ️ কোনো পূর্ববর্তী ইউজারের হিস্ট্রি পাওয়া যায়নি।';

  const visible = previousUsers.slice(0, 25);
  visible.forEach((u, i) => {
    const { date, time } = formatDateTime(u.reviewedAt || u.requestedAt);
    const status = String(u.status || '').toLowerCase();
    const statusBadge = status === 'terminated' ? '❌ Terminated' : (status === 'rejected' ? '🚫 Rejected' : '⏱ Expired');
    const safeName = escapeMarkdown(u.name || 'Guest User');
    msg += `${i + 1}. *${safeName}*\n   🏷 MAC: \`${u.mac}\` | ${statusBadge}\n   📅 সেশন: ${date} (${time})\n\n`;
  });

  if (previousUsers.length > 25) {
    msg += `_... এবং আরও ${previousUsers.length - 25} জন হিস্ট্রিতে রয়েছে।_`;
  }
  return msg.trim();
}

export function formatDashboardMessage(activeUsers = [], pendingQueueCount = 0) {
  return formatActiveUsersList(activeUsers, pendingQueueCount);
}

export function formatDisconnectCard(user, disconnectInfo = {}) {
  const name = user?.name || 'Guest User';
  const mac = (user?.mac || disconnectInfo.mac || 'N/A').toLowerCase();
  const ip = user?.ip || disconnectInfo.ip || null;
  const connectedIso = user?.authorizedAt || user?.requestedAt || disconnectInfo.session_start;
  const disconnectedIso = disconnectInfo.disconnectedAt || disconnectInfo.session_end || new Date().toISOString();

  const startFormatted = formatDateTime(connectedIso);
  const endFormatted = formatDateTime(disconnectedIso);

  let durationText = 'N/A';
  if (startFormatted.rawDate && endFormatted.rawDate) {
    const diffMs = Math.max(0, endFormatted.rawDate.getTime() - startFormatted.rawDate.getTime());
    const totalMinutes = Math.max(1, Math.round(diffMs / 60000));
    if (totalMinutes >= 60) {
      const hours = Math.floor(totalMinutes / 60);
      const mins = totalMinutes % 60;
      durationText = mins > 0 ? `${hours} ঘণ্টা ${mins} মিনিট` : `${hours} ঘণ্টা`;
    } else {
      durationText = `${totalMinutes} মিনিট`;
    }
  }

  let reasonText = '⏱ মেয়াদ শেষ (Session Timeout)';
  const rawReason = String(disconnectInfo.reason || '').toLowerCase();
  if (rawReason.includes('timeout') && !rawReason.includes('idle')) {
    reasonText = '⏱ মেয়াদ শেষ (Session Timeout)';
  } else if (rawReason.includes('idle')) {
    reasonText = '💤 নিষ্ক্রিয়তা (Idle Timeout)';
  } else if (rawReason.includes('downquota') || rawReason.includes('upquota')) {
    reasonText = '📊 ডাটা কোটা শেষ (Quota Exceeded)';
  } else if (rawReason.includes('client') || rawReason.includes('manual') || rawReason.includes('terminate') || rawReason.includes('deauth')) {
    reasonText = '❌ সংযোগ বিচ্ছিন্ন (Admin Terminated)';
  } else if (rawReason) {
    reasonText = `⚠️ ${rawReason}`;
  }

  const lines = [
    '🔴 *Wi-Fi Device Disconnected*',
    '━━━━━━━━━━━━━━━━━━━━',
    `👤 *User:* ${escapeMarkdown(name)}`,
    `🏷 *MAC:* \`${mac}\``,
    ip ? `🌐 *IP:* \`${escapeMarkdown(ip)}\`` : null,
    `⏰ *কানেক্ট হয়েছিল:* ${startFormatted.date}, ${startFormatted.time}`,
    `🛑 *ডিসকানেক্ট হয়েছে:* ${endFormatted.date}, ${endFormatted.time}`,
    `⌛ *মোট ব্যবহার:* ${durationText}`,
    `📌 *কারণ:* ${reasonText}`,
    '━━━━━━━━━━━━━━━━━━━━'
  ].filter(Boolean);

  return lines.join('\n');
}
