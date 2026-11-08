/**
 * /api/webhook.js
 *
 * Telegram Webhook receiver entry point.
 * Modularized: routes incoming messages and callbacks to sub-handlers.
 * Kept strictly under 250 lines.
 */

import { Redis } from '@upstash/redis';
import { handleTelegramMessage } from '../lib/telegram/message-handler.js';
import { handleTelegramCallback } from '../lib/telegram/callback-handler.js';

export {
  MAC_REGEX,
  parseCallbackData,
  normalizeDigits,
  parseDurationString,
  parseCustomAuthMessage,
  normalizeCommandText
} from '../lib/telegram/parsers.js';

export {
  answerCallbackQuery,
  sendTelegramMessage,
  updateTelegramMessage,
  editTelegramMessageText
} from '../lib/telegram/client.js';

export { processMenuCommand } from '../lib/telegram/commands.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  let update = req.body;
  if (typeof update === 'string') {
    try {
      update = JSON.parse(update);
    } catch {
      return res.status(400).json({ error: 'Malformed JSON update payload.' });
    }
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!botToken || !redisUrl || !redisToken) {
    console.error('[Config Error] Missing TELEGRAM_BOT_TOKEN or UPSTASH credentials in environment.');
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  const redis = new Redis({
    url: redisUrl,
    token: redisToken
  });

  const configuredChatId = process.env.TELEGRAM_CHAT_ID;

  if (update?.message && update.message.text) {
    const result = await handleTelegramMessage(update.message, redis, botToken, configuredChatId);
    return res.status(result.status).json(result.data);
  }

  if (update?.callback_query) {
    const result = await handleTelegramCallback(update.callback_query, redis, botToken, configuredChatId);
    return res.status(result.status).json(result.data);
  }

  return res.status(200).json({
    ok: true,
    message: 'No callback query or recognized command to process.'
  });
}
