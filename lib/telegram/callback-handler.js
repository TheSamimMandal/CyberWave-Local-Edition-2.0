/**
 * lib/telegram/callback-handler.js
 *
 * Processes Telegram callback query button clicks (auth, deauth, menu, unlimited).
 * Kept strictly under 250 lines.
 */

import { escapeMarkdown } from '../../api/request.js';
import { parseCallbackData } from './parsers.js';
import {
  buildDefaultAuthKeyboard,
  buildUnlimitedKeyboard,
  buildSpeedLimitKeyboard
} from './keyboards.js';
import { deleteTelegramMessage } from './chat-cleaner.js';
import {
  answerCallbackQuery,
  updateTelegramMessage,
  sendTelegramMessage
} from './client.js';
import { processMenuCommand } from './commands.js';
import { createVoucher, formatVoucherCreatedCard } from '../voucher.js';

export async function handleTelegramCallback(callbackQuery, redis, botToken, configuredChatId) {
  const { id: callbackQueryId, data, message: cbMessage, from } = callbackQuery;
  const cbChatId = cbMessage?.chat?.id;

  const configuredChatIds = configuredChatId
    ? String(configuredChatId).split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const isAuthorized = configuredChatIds.length === 0 ||
    (cbChatId && configuredChatIds.includes(String(cbChatId))) ||
    (from?.id && configuredChatIds.includes(String(from.id)));

  if (!isAuthorized) {
    console.warn(`[Security Alert] Rejected unauthorized callback from chat ${cbChatId} (user: ${from?.id})`);
    await answerCallbackQuery(botToken, callbackQueryId, '⛔ Unauthorized access.', true);
    return { status: 200, data: { ok: false, error: 'Unauthorized callback.' } };
  }

  const parsed = parseCallbackData(data);
  if (!parsed) {
    await answerCallbackQuery(botToken, callbackQueryId, '❌ Error: Invalid or unrecognized button action.', true);
    return { status: 200, data: { ok: true, error: 'Unrecognized callback action format.' } };
  }

  if (parsed.action === 'menu') {
    const currentMsgId = cbMessage?.message_id;
    const { text, replyMarkup, ackText } = await processMenuCommand(
      parsed.command,
      redis,
      botToken,
      cbChatId,
      currentMsgId
    );
    await answerCallbackQuery(botToken, callbackQueryId, ackText || '✅ সম্পন্ন হয়েছে', false);
    if (cbChatId && text) {
      await sendTelegramMessage(botToken, cbChatId, text, replyMarkup, redis);
    }
    return { status: 200, data: { ok: true, action: 'menu', command: parsed.command } };
  }

  if (parsed.action === 'gen_voucher') {
    const duration = parsed.duration;
    const adminName = from?.first_name || 'Admin';
    const voucher = await createVoucher(redis, duration, adminName);
    const voucherCard = formatVoucherCreatedCard(voucher);
    await answerCallbackQuery(botToken, callbackQueryId, `🎟️ ভাউচার কোড: ${voucher.code}`, false);
    if (cbChatId) {
      await sendTelegramMessage(botToken, cbChatId, voucherCard, null, redis);
    }
    return { status: 200, data: { ok: true, action: 'voucher_created', voucher } };
  }

  if (parsed.action === 'speed_menu') {
    const mac = parsed.mac;
    await answerCallbackQuery(botToken, callbackQueryId, `⚡ স্পিড অপশন: ${mac}`, false);
    const speedPrompt = [
      '⚡ *ব্যান্ডউইথ স্পিড লিমিট নির্ধারণ করুন*',
      '━━━━━━━━━━━━━━━━━━━━',
      `🏷 *ডিভাইস MAC:* \`${mac}\``,
      'এই ডিভাইসটির জন্য সর্বোচ্চ কত স্পিড নির্ধারণ করতে চান?'
    ].join('\n');
    await updateTelegramMessage(botToken, cbMessage, speedPrompt, buildSpeedLimitKeyboard(mac));
    return { status: 200, data: { ok: true, action: 'speed_menu_shown', mac } };
  }

  if (parsed.action === 'set_speed') {
    const { mac, mbps } = parsed;
    const cleanSec = `limit_${mac.replace(/:/g, '')}`;
    const routerCmd = mbps > 0
      ? `uci set archer_guard.${cleanSec}=section && uci set archer_guard.${cleanSec}.mac='${mac}' && uci set archer_guard.${cleanSec}.mbps='${mbps}' && uci commit archer_guard`
      : `uci delete archer_guard.${cleanSec} 2>/dev/null && uci commit archer_guard`;

    await redis.rpush('pending_commands', routerCmd);
    if (mbps > 0) {
      await redis.set(`client_limit:${mac}`, mbps);
    } else {
      await redis.del(`client_limit:${mac}`);
    }

    const ack = mbps > 0 ? `⚡ ${mbps} Mbps লিমিট কার্যকর` : '🔄 ফুল স্পিড রিস্টোর';
    await answerCallbackQuery(botToken, callbackQueryId, ack, false);

    const notice = mbps > 0
      ? `⚡ *ব্যান্ডউইথ স্পিড লিমিট কার্যকর!*\n━━━━━━━━━━━━━━━━━━━━\n🏷 *ডিভাইস MAC:* \`${mac}\`\n🚀 *সর্বোচ্চ স্পিড:* *${mbps} Mbps*\n━━━━━━━━━━━━━━━━━━━━\n_রাউটারে ব্যান্ডউইথ নিয়ন্ত্রণ পাঠানো হয়েছে।_`
      : `⚡ *ব্যান্ডউইথ স্পিড লিমিট অপসারিত*\n━━━━━━━━━━━━━━━━━━━━\n🏷 *ডিভাইস MAC:* \`${mac}\`\n🚀 *বর্তমান স্পিড:* *স্বাভাবিক / ফুল স্পিড*\n━━━━━━━━━━━━━━━━━━━━`;

    await updateTelegramMessage(botToken, cbMessage, notice, []);
    return { status: 200, data: { ok: true, action: 'speed_limit_applied', mac, mbps } };
  }

  if (parsed.action === 'rename_prompt') {
    const mac = parsed.mac;
    if (cbChatId) {
      await redis.set(`last_rename_mac:${cbChatId}`, mac, 'EX', 300);
    }
    await answerCallbackQuery(botToken, callbackQueryId, `🏷️ নাম পরিবর্তন: ${mac}`, false);
    const promptMsg = `🏷️ *ডিভাইসের নাম পরিবর্তন (Rename Device)*\n━━━━━━━━━━━━━━━━━━━━\n🏷 *ডিভাইস MAC:* \`${mac}\`\n━━━━━━━━━━━━━━━━━━━━\nডিভাইসটির জন্য আপনি কী নাম রাখতে চান? নাম লিখে এই চ্যাটে মেসেজ পাঠান।\n_উদাহরণ: Sabbir Laptop বা Android TV_`;
    if (cbChatId) {
      await sendTelegramMessage(botToken, cbChatId, promptMsg, null, redis);
    }
    return { status: 200, data: { ok: true, action: 'rename_prompt_set', mac } };
  }

  if (parsed.action === 'reboot_confirm') {
    await redis.rpush('pending_commands', 'reboot');
    await answerCallbackQuery(botToken, callbackQueryId, '🔄 রাউটার রিবুট কমান্ড পাঠানো হয়েছে!', false);
    const notice = `🔄 *রাউটার রিবুট শুরু হয়েছে!*\n━━━━━━━━━━━━━━━━━━━━\nরাউটারে রিবুট সিগন্যাল পাঠানো হয়েছে। পরবর্তী সিঙ্ক ইন্টারভালে রাউটার রিস্টার্ট হবে।\n⚠️ _রিবুট সম্পন্ন হতে ১-২ মিনিট সময় লাগতে পারে।_`;
    await updateTelegramMessage(botToken, cbMessage, notice, []);
    return { status: 200, data: { ok: true, action: 'router_reboot_queued' } };
  }

  if (parsed.action === 'auth' && parsed.duration === 0) {
    await answerCallbackQuery(botToken, callbackQueryId, '♾ আনলিমিটেড মোড নির্বাচন করুন', false);
    const unlimKeyboard = buildUnlimitedKeyboard(parsed.mac);
    const modePrompt = '♾ *আনলিমিটেড অ্যাক্সেস মোড নির্ধারণ করুন:*\n• *এককালীন:* সংযোগ বিচ্ছিন্ন হলে পরবর্তী বার আবার লগইন পেজ আসবে\n• *স্থায়ী বিশ্বস্ত:* লগইন পেজ আর কখনোই আসবে না\n\n_নিচের যেকোনো একটি মোড নির্বাচন করুন:_';
    await updateTelegramMessage(botToken, cbMessage, modePrompt, unlimKeyboard);
    return { status: 200, data: { ok: true, action: 'unlimited_menu_prompted', mac: parsed.mac } };
  }

  if (parsed.action === 'unlim_back') {
    await answerCallbackQuery(botToken, callbackQueryId, '🔙 পূর্বের অপশনে ফিরে যাওয়া হয়েছে', false);
    const defaultKeyboard = buildDefaultAuthKeyboard(parsed.mac);
    const defaultPrompt = 'Select duration below or reply with custom minutes (e.g. 15):';
    await updateTelegramMessage(botToken, cbMessage, defaultPrompt, defaultKeyboard);
    return { status: 200, data: { ok: true, action: 'unlimited_menu_cancelled', mac: parsed.mac } };
  }

  const { action, mac, duration, mode } = parsed;
  let command = '';
  let ackMessage = '';
  let statusNotice = '';
  let confirmText = '';
  let inlineKeyboard = [];
  const adminName = from?.first_name || 'Admin';
  const safeAdminName = escapeMarkdown(adminName);

  if (action === 'unlim_perm') {
    command = `ndsctl trust ${mac}`;
    ackMessage = `✅ স্থায়ী বিশ্বস্ত অনুমোদিত (${mac})`;
    statusNotice = `✅ *Status:* Authorized (🛡️ স্থায়ী বিশ্বস্ত / Permanent Trusted) by ${safeAdminName}`;
    confirmText = `✅ *অনুমোদন সম্পন্ন:* \`${mac}\` কে *স্থায়ী বিশ্বস্ত (Permanent Trusted)* তালিকায় যুক্ত করা হয়েছে। (লগইন পেজ আর কখনোই আসবে না)`;
    inlineKeyboard = [[{ text: '❌ Terminate', callback_data: `deauth_${mac}` }]];
  } else if (action === 'unlim_sess') {
    command = `ndsctl auth ${mac} 0`;
    ackMessage = `✅ এককালীন আনলিমিটেড অনুমোদিত (${mac})`;
    statusNotice = `✅ *Status:* Authorized (♾ এককালীন / Session Unlimited) by ${safeAdminName}`;
    confirmText = `✅ *অনুমোদন সম্পন্ন:* \`${mac}\` কে *এককালীন আনলিমিটেড* এক্সেস দেওয়া হয়েছে। (ডিসকানেক্ট হলে আবার লগইন পেজ আসবে)`;
    inlineKeyboard = [[{ text: '❌ Terminate', callback_data: `deauth_${mac}` }]];
  } else if (action === 'auth') {
    command = `ndsctl auth ${mac} ${duration}`;
    const durationLabel = `${duration}m`;
    ackMessage = `✅ Authorized ${mac} (${durationLabel})`;
    statusNotice = `✅ *Status:* Authorized (${durationLabel}) by ${safeAdminName}`;
    confirmText = `✅ *অনুমোদন সম্পন্ন:* \`${mac}\` কে ${duration} মিনিটের জন্য এক্সেস অনুমোদন দেওয়া হয়েছে।`;
    inlineKeyboard = [[{ text: '❌ Terminate', callback_data: `deauth_${mac}` }]];
  } else if (action === 'deauth') {
    command = `ndsctl deauth ${mac}`;
    ackMessage = `❌ Terminated ${mac}`;
    statusNotice = `❌ *Status:* Terminated / Revoked by ${safeAdminName}`;
    confirmText = `❌ *সংযোগ বিচ্ছিন্ন:* \`${mac}\` এর এক্সেস বাতিল করা হয়েছে।`;
    inlineKeyboard = [];
  }

  try {
    if (cbChatId) {
      await redis.del(`last_prompted_mac:${cbChatId}`).catch(() => {});
    }

    await redis.rpush('pending_commands', command);
    const userUpdate = {
      status: action === 'deauth' ? 'terminated' : 'authorized',
      duration: duration ?? 0,
      mode: (action === 'unlim_perm' ? 'permanent' : (action === 'unlim_sess' ? 'session' : (mode || (duration === 0 ? 'session' : 'timed')))),
      trusted: action === 'unlim_perm' ? 'true' : 'false',
      reviewedBy: adminName,
      reviewedAt: new Date().toISOString()
    };
    await redis.hset(`request:${mac}`, userUpdate);

    await answerCallbackQuery(botToken, callbackQueryId, ackMessage, false);

    if (action === 'deauth') {
      const msgText = cbMessage?.text || '';
      const isCardFromActiveList = msgText.includes('সক্রিয়') ||
        msgText.includes('Active') ||
        msgText.includes('অনুমোদিত মেয়াদ') ||
        msgText.includes('কানেক্টেড সময়') ||
        msgText.includes('সংযোগ বিচ্ছিন্ন করতে নিচের বাটনে চাপ দিন');

      if (isCardFromActiveList && cbMessage?.message_id && cbChatId) {
        await deleteTelegramMessage(botToken, cbChatId, cbMessage.message_id);
      } else {
        await updateTelegramMessage(botToken, cbMessage, statusNotice, inlineKeyboard);
      }
    } else {
      await updateTelegramMessage(botToken, cbMessage, statusNotice, inlineKeyboard);
    }

    if ((action === 'unlim_perm' || action === 'unlim_sess') && cbChatId) {
      await sendTelegramMessage(botToken, cbChatId, confirmText, null, redis);
    }

    return {
      status: 200,
      data: { ok: true, action, mac, commandQueued: command }
    };
  } catch (error) {
    console.error('[Webhook Queue Exception]', error);
    await answerCallbackQuery(botToken, callbackQueryId, '⚠️ Error queuing command in Redis. Please try again.', true);
    return { status: 500, data: { error: 'Failed to push command to Redis queue.' } };
  }
}
