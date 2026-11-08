/**
 * lib/telegram/client.js
 *
 * Core Telegram Bot API HTTP client methods.
 * Kept strictly under 250 lines.
 */

import { escapeMarkdown } from '../../api/request.js';
import { trackChatMessage } from './chat-cleaner.js';

export async function answerCallbackQuery(botToken, callbackQueryId, text, showAlert = false) {
  if (!botToken || !callbackQueryId) return;
  try {
    const url = `https://api.telegram.org/bot${botToken}/answerCallbackQuery`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert
      })
    });
  } catch (err) {
    console.error('[answerCallbackQuery Failed]', err);
  }
}

export async function sendTelegramMessage(botToken, chatId, text, replyMarkup = null, redis = null) {
  if (!botToken || !chatId) return null;
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown'
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const resData = await res.json().catch(() => null);
    if (resData?.ok && resData?.result?.message_id && redis) {
      trackChatMessage(redis, chatId, resData.result.message_id).catch(() => {});
    }
    return resData;
  } catch (err) {
    console.error('[sendTelegramMessage Failed]', err);
    return null;
  }
}

export async function updateTelegramMessage(botToken, message, statusText, inlineKeyboard = []) {
  if (!message || !message.chat || !message.message_id) return;

  try {
    const originalText = message.text || '';
    const cleanBaseText = originalText
      .replace(/\n*Select (?:access )?duration below[^\n]*/gi, '')
      .replace(/\n*Select (?:unlimited )?access mode below[^\n]*/gi, '')
      .replace(/\n*♾.*?[\s\S]*?(?:মোড নির্বাচন করুন:_|$)/gi, '')
      .replace(/\n*(?:✅|❌)\s*\*?Status:\*?[^\n]*/gi, '')
      .trim();

    const escapedBase = escapeMarkdown(cleanBaseText);
    const updatedText = `${escapedBase}\n\n${statusText}`;
    const url = `https://api.telegram.org/bot${botToken}/editMessageText`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: updatedText,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineKeyboard }
      })
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || (data && !data.ok)) {
      console.warn('[updateTelegramMessage Warning] Markdown failed, retrying plain text:', data?.description || res.statusText);
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: message.chat.id,
          message_id: message.message_id,
          text: `${cleanBaseText}\n\n${statusText.replace(/[*_`]/g, '')}`,
          reply_markup: { inline_keyboard: inlineKeyboard }
        })
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[updateTelegramMessage Failed]', err);
  }
}

export async function editTelegramMessageText(botToken, chatId, messageId, text, inlineKeyboard = []) {
  if (!botToken || !chatId || !messageId) return;
  try {
    const url = `https://api.telegram.org/bot${botToken}/editMessageText`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineKeyboard }
      })
    });
  } catch (err) {
    console.error('[editTelegramMessageText Failed]', err);
  }
}
