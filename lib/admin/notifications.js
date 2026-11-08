/**
 * lib/admin/notifications.js
 *
 * Telegram notifications for Web Admin operations.
 * Kept strictly under 250 lines.
 */

import { escapeMarkdown } from '../../api/request.js';

export async function sendAdminTelegramNotice(botToken, chatId, action, cleanMac, cleanName, parsedDuration, adminName) {
  if (!botToken || !chatId) return;

  try {
    const durationLabel = parsedDuration === 0 ? 'Unlimited' : `${parsedDuration}m`;
    const actionNotice = action === 'auth'
      ? [
          '🌐 *Web Admin: Wi-Fi Access Authorized*',
          '━━━━━━━━━━━━━━━━━━━━',
          cleanName ? `👤 *User:* ${escapeMarkdown(cleanName)}` : null,
          `🏷 *MAC:* \`${cleanMac}\``,
          `⏱ *Duration:* ${durationLabel}`,
          `🛡 *Authorized by:* ${escapeMarkdown(adminName)}`,
          '━━━━━━━━━━━━━━━━━━━━'
        ].filter(Boolean).join('\n')
      : [
          '🌐 *Web Admin: Wi-Fi Disconnected / Rejected*',
          '━━━━━━━━━━━━━━━━━━━━',
          `🏷 *MAC:* \`${cleanMac}\``,
          `🛡 *Action by:* ${escapeMarkdown(adminName)}`,
          '━━━━━━━━━━━━━━━━━━━━'
        ].join('\n');

    fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: actionNotice,
        parse_mode: 'Markdown'
      })
    }).catch(err => console.error('[Admin Telegram Sync Notice Failed]', err));
  } catch (err) {
    console.warn('[Telegram Dispatch Warning]', err);
  }
}
