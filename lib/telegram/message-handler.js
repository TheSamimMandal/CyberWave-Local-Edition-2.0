/**
 * lib/telegram/message-handler.js
 *
 * Processes Telegram text messages, custom auth duration prompts, and menu triggers.
 * Kept strictly under 250 lines.
 */

import { escapeMarkdown } from '../../api/request.js';
import {
  MAC_REGEX,
  parseCustomAuthMessage,
  normalizeCommandText
} from './parsers.js';
import {
  buildDefaultAuthKeyboard,
  buildUnlimitedKeyboard,
  TELEGRAM_MENU_KEYBOARD,
  TELEGRAM_INLINE_MENU
} from './keyboards.js';
import {
  fetchUserRecords,
  registerBotCommands,
  trackChatMessage
} from './chat-cleaner.js';
import {
  sendTelegramMessage,
  updateTelegramMessage
} from './client.js';
import { processMenuCommand } from './commands.js';
import { handleExtendedCommand } from './extended-commands.js';
import { saveDeviceAlias, formatAliasSuccessMessage } from './alias.js';

export async function handleTelegramMessage(message, redis, botToken, configuredChatId) {
  const chatId = message.chat?.id;
  const currentMsgId = message.message_id;

  if (chatId && currentMsgId) {
    trackChatMessage(redis, chatId, currentMsgId).catch(() => {});
  }

  if (configuredChatId && chatId && String(chatId) !== String(configuredChatId)) {
    await sendTelegramMessage(
      botToken,
      chatId,
      '⛔ *অননুমোদিত প্রবেশাধিকার:* আপনি এই ওয়াইফাই অ্যাডমিন বটের অনুমোদিত অ্যাডমিনিস্ট্রেটর নন।'
    );
    return { status: 200, data: { ok: false, error: 'Unauthorized chat.' } };
  }

  // 1. Process extended commands (/rename, /voucher, /limit, /report)
  if (chatId) {
    const ext = await handleExtendedCommand(message, redis, botToken, chatId);
    if (ext && ext.handled) {
      return { status: ext.status, data: ext.data };
    }

    if (message.text) {
      const pendingRenameMac = await redis.get(`last_rename_mac:${chatId}`).catch(() => null);
      if (
        typeof pendingRenameMac === 'string' &&
        MAC_REGEX.test(pendingRenameMac) &&
        !message.text.startsWith('/') &&
        !normalizeCommandText(message.text) &&
        !parseCustomAuthMessage(message.text, message.reply_to_message?.text)
      ) {
        const alias = message.text.trim();
        await saveDeviceAlias(redis, pendingRenameMac, alias);
        await redis.del(`last_rename_mac:${chatId}`).catch(() => {});
        const replyMsg = formatAliasSuccessMessage(pendingRenameMac, alias);
        await sendTelegramMessage(botToken, chatId, replyMsg, null, redis);
        return { status: 200, data: { ok: true, action: 'renamed', mac: pendingRenameMac, alias } };
      }
    }
  }

  // 2. Process custom duration authorization or rejection
  const customAuth = parseCustomAuthMessage(message.text, message.reply_to_message?.text);
  if (customAuth) {
    let { action, mac, duration } = customAuth;

    if (action === 'prompt_duration' && mac) {
      if (chatId) {
        await redis.set(`last_prompted_mac:${chatId}`, mac, { ex: 600 }).catch(() => {});
      }
      const durationPrompt = [
        '⏱ *অনুমোদনের সময়কাল নির্ধারণ করুন*',
        '━━━━━━━━━━━━━━━━━━━━',
        `🏷 *ডিভাইস MAC:* \`${mac}\``,
        '',
        'এই ডিভাইসটিকে আপনি কতক্ষণের জন্য পারমিশন দিতে চান?',
        'নিচের অপশনগুলো থেকে বেছে নিন অথবা সময় লিখে পাঠান (যেমন: `15m`, `1h`, বা `unlimited`):'
      ].join('\n');

      await sendTelegramMessage(botToken, chatId, durationPrompt, { inline_keyboard: buildDefaultAuthKeyboard(mac) }, redis);
      return { status: 200, data: { ok: true, action: 'prompt_duration_sent', mac } };
    }

    if (!mac) {
      try {
        if (chatId) {
          const cachedPromptedMac = await redis.get(`last_prompted_mac:${chatId}`);
          if (cachedPromptedMac && MAC_REGEX.test(cachedPromptedMac)) {
            mac = cachedPromptedMac.toLowerCase().replace(/-/g, ':');
          }
        }
        if (!mac) {
          const pendingMacs = await redis.lrange('pending_macs', -1, -1);
          if (pendingMacs && pendingMacs.length > 0 && MAC_REGEX.test(pendingMacs[0])) {
            mac = pendingMacs[0].toLowerCase().replace(/-/g, ':');
          } else {
            const users = await fetchUserRecords(redis);
            const pendingUser = users.find(u => String(u.status).toLowerCase() === 'pending');
            if (pendingUser && pendingUser.mac) {
              mac = pendingUser.mac.toLowerCase().replace(/-/g, ':');
            }
          }
        }
      } catch (dbErr) {
        console.warn('[Pending MAC Lookup Error]', dbErr);
      }
    }

    if (!mac) {
      const durationPrompt = duration === null ? 'বাতিল' : (duration === 0 ? 'আনলিমিটেড' : `${duration} মিনিট`);
      const helpMsg = [
        `ℹ️ *কাকে অনুমোদন দিতে চান তা নির্দিষ্ট করা যায়নি (${durationPrompt})।*`,
        '━━━━━━━━━━━━━━━━━━━━',
        'আপনি যে ইউজারকে অনুমোদন দিতে চান তার কার্ড মেসেজটিতে *Reply* করে সময় লিখুন, অথবা সরাসরি কমান্ড লিখুন:',
        '`/auth <MAC> <মিনিট>` (যেমন: `/auth 46:84:b7:da:39:73 15`)'
      ].join('\n');
      await sendTelegramMessage(botToken, chatId, helpMsg, null, redis);
      return { status: 200, data: { ok: false, error: 'Target MAC could not be resolved.' } };
    }

    if (action === 'auth' && duration === 0 && !customAuth.mode) {
      const modePrompt = [
        '♾ *আনলিমিটেড অ্যাক্সেস মোড নির্ধারণ করুন:*',
        `🏷 *ডিভাইস MAC:* \`${mac}\``,
        '━━━━━━━━━━━━━━━━━━━━',
        'নিচের কোন মোডে ইউজারকে আনলিমিটেড অ্যাক্সেস দিতে চান?',
        '• *🔄 এককালীন:* এই সেশনের জন্য আনলিমিটেড, কিন্তু সংযোগ বিচ্ছিন্ন হলে আবার লগইন পেজ আসবে।',
        '• *🛡️ স্থায়ী বিশ্বস্ত:* রাউটারে বিশ্বস্ত হিসেবে সংরক্ষিত থাকবে, লগইন পেজ আর কখনোই আসবে না।'
      ].join('\n');

      await sendTelegramMessage(botToken, chatId, modePrompt, { inline_keyboard: buildUnlimitedKeyboard(mac) }, redis);
      return { status: 200, data: { ok: true, action: 'unlimited_prompt_sent', mac } };
    }

    const adminName = message.from?.first_name || 'Admin';
    const safeAdminName = escapeMarkdown(adminName);
    let command = '';
    let statusNotice = '';
    let confirmText = '';
    let inlineKeyboard = [];
    const mode = customAuth.mode;

    if (action === 'auth') {
      if (mode === 'permanent') {
        command = `ndsctl trust ${mac}`;
        statusNotice = `✅ *Status:* Authorized (🛡️ স্থায়ী বিশ্বস্ত / Permanent Trusted) by ${safeAdminName}`;
        confirmText = `✅ *অনুমোদন সম্পন্ন:* \`${mac}\` কে *স্থায়ী বিশ্বস্ত (Permanent Trusted)* তালিকায় যুক্ত করা হয়েছে। (লগইন পেজ আর কখনোই আসবে না)`;
      } else if (duration === 0) {
        command = `ndsctl auth ${mac} 0`;
        statusNotice = `✅ *Status:* Authorized (♾ এককালীন / Session Unlimited) by ${safeAdminName}`;
        confirmText = `✅ *অনুমোদন সম্পন্ন:* \`${mac}\` কে *এককালীন আনলিমিটেড* এক্সেস দেওয়া হয়েছে। (ডিসকানেক্ট হলে আবার লগইন পেজ আসবে)`;
      } else {
        command = `ndsctl auth ${mac} ${duration}`;
        statusNotice = `✅ *Status:* Authorized (${duration}m) by ${safeAdminName}`;
        confirmText = `✅ *অনুমোদন সম্পন্ন:* \`${mac}\` কে ${duration} মিনিটের জন্য এক্সেস অনুমোদন দেওয়া হয়েছে এবং রাউটার কিউতে পাঠানো হয়েছে।`;
      }
      inlineKeyboard = [[{ text: '❌ Terminate', callback_data: `deauth_${mac}` }]];
    } else {
      command = `ndsctl deauth ${mac}`;
      statusNotice = `❌ *Status:* Terminated / Revoked by ${safeAdminName}`;
      confirmText = `❌ *সংযোগ বিচ্ছিন্ন:* \`${mac}\` এর এক্সেস বাতিল করা হয়েছে।`;
      inlineKeyboard = [];
    }

    try {
      if (chatId) {
        await redis.del(`last_prompted_mac:${chatId}`).catch(() => {});
      }
      await redis.rpush('pending_commands', command);
      await redis.hset(`request:${mac}`, {
        status: action === 'auth' ? 'authorized' : 'terminated',
        duration: duration ?? 0,
        mode: mode || (duration === 0 ? 'session' : 'timed'),
        trusted: mode === 'permanent' ? 'true' : 'false',
        reviewedBy: adminName,
        reviewedAt: new Date().toISOString()
      });

      if (message.reply_to_message) {
        await updateTelegramMessage(botToken, message.reply_to_message, statusNotice, inlineKeyboard);
      }
      await sendTelegramMessage(botToken, chatId, confirmText, null, redis);
      return {
        status: 200,
        data: { ok: true, action, mac, duration, mode: mode || null, commandQueued: command }
      };
    } catch (err) {
      console.error('[Custom Auth Queue Error]', err);
      await sendTelegramMessage(botToken, chatId, '⚠️ রাউটার কিউতে কমান্ড যোগ করতে সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।');
      return { status: 500, data: { error: 'Failed to push command to Redis queue.' } };
    }
  }

  const recognizedCommand = normalizeCommandText(message.text);
  if (recognizedCommand === 'menu' && chatId) {
    registerBotCommands(botToken).catch(() => {});
    const welcomeText = `👋 *স্বাগতম OpenWrt Wi-Fi অ্যাডমিন কন্ট্রোল সেন্টারে!*\n━━━━━━━━━━━━━━━━━━━━\n🔘 *প্রধান কন্ট্রোল অপশনসমূহ:*\n• ➕ *ম্যাক অথোরাইজ:* সরাসরি MAC দিয়ে সময় নির্ধারণ করে অনুমোদন\n• 🎟️ *গেস্ট ভাউচার:* মেহমানদের জন্য তাত্ক্ষণিক এক্সেস কোড তৈরি\n• ⚡ *স্পিড লিমিট:* নির্দিষ্ট ডিভাইসের ব্যান্ডউইথ ও স্পিড নিয়ন্ত্রণ\n• 🟢 *অ্যাক্টিভ ইউজার:* সংযুক্ত সক্রিয় ডিভাইস ও সরাসরি টার্মিনেশন বাটন\n• 👥 *পূর্ববর্তী ইউজার:* পূর্ববর্তী বা মেয়াদোত্তীর্ণ ইউজারদের তালিকা\n• 📊 *নেটওয়ার্ক রিপোর্ট:* লাইভ ট্রাফিক, কোটা ও হার্ডওয়্যার অবস্থা\n• 📋 *ইউজার ডিটেইলস:* প্রতিটি ইউজারের পূর্ণ লগ ও বিবরণ\n• 🧹 *ক্লিন চ্যাট ও ডাটা:* টার্মিনেট হওয়া ডাটা ও পূর্ববর্তী চ্যাট বার্তা অপসারণ\n• 🔄 *রাউটার রিবুট:* নিরাপদ রাউটার রিস্টার্ট\n• ❓ *হেল্প গাইড:* সকল ফিচার ও কমান্ড সহায়িকা\n━━━━━━━━━━━━━━━━━━━━\n_নিচের স্থায়ী মেনুবার থেকে যেকোনো অপশন বেছে নিন।_`;
    await sendTelegramMessage(botToken, chatId, welcomeText, TELEGRAM_MENU_KEYBOARD, redis);
    return { status: 200, data: { ok: true, action: 'menu_shown' } };
  }

  if (recognizedCommand && chatId) {
    const { text, replyMarkup } = await processMenuCommand(
      recognizedCommand,
      redis,
      botToken,
      chatId,
      currentMsgId
    );
    if (text) {
      await sendTelegramMessage(botToken, chatId, text, replyMarkup, redis);
    }
    return { status: 200, data: { ok: true, command: recognizedCommand } };
  }

  return {
    status: 200,
    data: { ok: true, message: 'No callback query or recognized command to process.' }
  };
}
