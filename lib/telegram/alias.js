/**
 * lib/telegram/alias.js
 *
 * Device Nickname & Alias Management for Captive Portal clients.
 * Stores friendly device names across sessions in Redis.
 * Kept strictly under 250 lines.
 */

import { MAC_REGEX } from './parsers.js';
import { escapeMarkdown } from '../../api/request.js';

/**
 * Saves a custom nickname/alias for a device MAC address.
 *
 * @param {object} redis - Redis client instance
 * @param {string} mac - MAC address
 * @param {string} alias - Friendly name (e.g. "রহিম ভাই (iPhone)")
 * @returns {Promise<boolean>}
 */
export async function saveDeviceAlias(redis, mac, alias) {
  if (!redis || !mac || typeof mac !== 'string' || !alias) return false;
  const cleanMac = mac.toLowerCase().replace(/-/g, ':');
  if (!MAC_REGEX.test(cleanMac)) return false;

  const cleanAlias = String(alias).trim().slice(0, 64);
  if (!cleanAlias) return false;

  try {
    // 1. Save in permanent alias key
    await redis.set(`device_alias:${cleanMac}`, cleanAlias);

    // 2. Update current request record if exists
    const currentHash = await redis.hgetall(`request:${cleanMac}`).catch(() => null);
    if (currentHash) {
      await redis.hset(`request:${cleanMac}`, { name: cleanAlias });
    }

    return true;
  } catch (err) {
    console.error('[saveDeviceAlias Error]', err);
    return false;
  }
}

/**
 * Retrieves a saved nickname/alias for a device MAC address.
 *
 * @param {object} redis - Redis client instance
 * @param {string} mac - MAC address
 * @returns {Promise<string|null>}
 */
export async function getDeviceAlias(redis, mac) {
  if (!redis || !mac) return null;
  const cleanMac = mac.toLowerCase().replace(/-/g, ':');
  if (!MAC_REGEX.test(cleanMac)) return null;

  try {
    return await redis.get(`device_alias:${cleanMac}`);
  } catch {
    return null;
  }
}

/**
 * Parses /rename or /alias command from Telegram text.
 *
 * Supported formats:
 *  - "/rename <mac> <alias>"
 *  - "/alias <mac> <alias>"
 *  - "নাম <mac> <alias>"
 *  - Reply to a card with: "নাম: রহিম ভাই" or "/name রহিম ভাই"
 *
 * @param {string} text
 * @param {string} [replyToText]
 * @returns {{ mac: string, alias: string } | null}
 */
export function parseRenameCommand(text, replyToText = null) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();

  // 1. Direct command: /rename <mac> <alias>
  const directMatch = trimmed.match(/^\/(?:rename|alias|name)\s+((?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2})\s+(.+)$/i);
  if (directMatch) {
    const mac = directMatch[1].toLowerCase().replace(/-/g, ':');
    const alias = directMatch[2].trim();
    return { mac, alias };
  }

  // 1.1 Bengali command: নাম <mac> <alias>
  const bnMatch = trimmed.match(/^(?:নাম|ডিভাইস\s*নাম)\s+((?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2})\s+(.+)$/i);
  if (bnMatch) {
    const mac = bnMatch[1].toLowerCase().replace(/-/g, ':');
    const alias = bnMatch[2].trim();
    return { mac, alias };
  }

  // 2. Reply to card with alias
  if (replyToText && typeof replyToText === 'string') {
    const macMatch = replyToText.match(/([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}/);
    if (macMatch) {
      const mac = macMatch[0].toLowerCase().replace(/-/g, ':');
      const replyAliasMatch = trimmed.match(/^(?:\/rename|\/name|\/alias|নাম\s*[:=-]?|name\s*[:=-]?)\s*(.+)$/i);
      if (replyAliasMatch) {
        const alias = replyAliasMatch[1].trim();
        if (alias) return { mac, alias };
      }
    }
  }

  return null;
}

/**
 * Formats alias confirmation message for Telegram.
 */
export function formatAliasSuccessMessage(mac, alias) {
  return [
    '✅ *ডিভাইসের নাম সফলভাবে সংরক্ষিত হয়েছে!*',
    '━━━━━━━━━━━━━━━━━━━━',
    `🏷 *MAC অ্যাড্রেস:* \`${mac}\``,
    `👤 *সংরক্ষিত নাম:* *${escapeMarkdown(alias)}*`,
    '━━━━━━━━━━━━━━━━━━━━',
    '_এখন থেকে এই ডিভাইস কানেক্ট হলে বা রিকোয়েস্ট পাঠালে এই নাম প্রদর্শিত হবে।_'
  ].join('\n');
}
