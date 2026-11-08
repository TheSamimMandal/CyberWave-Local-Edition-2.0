/**
 * lib/telegram/chat-cleaner.js
 *
 * Chat history cleanup, Redis message tracking, and bot command registration.
 * Kept strictly under 250 lines.
 */

import { decodeUpstashHash } from '../redis-utils.js';

export async function fetchUserRecords(redis) {
  if (!redis) return [];

  try {
    const rawHistory = await redis.lrange('request_history', 0, 99);
    const parsedItems = [];
    const seenMacs = new Set();

    if (Array.isArray(rawHistory)) {
      for (const item of rawHistory) {
        try {
          const entry = typeof item === 'string' ? JSON.parse(item) : item;
          if (entry && entry.mac && !seenMacs.has(entry.mac)) {
            seenMacs.add(entry.mac);
            parsedItems.push(entry);
          }
        } catch {}
      }
    }

    if (parsedItems.length === 0) return [];

    let batchHashes = null;
    if (typeof redis.pipeline === 'function') {
      try {
        const pipe = redis.pipeline();
        for (const entry of parsedItems) {
          pipe.hgetall(`request:${entry.mac}`);
        }
        batchHashes = await pipe.exec();
      } catch {
        batchHashes = null;
      }
    }

    const users = await Promise.all(
      parsedItems.map(async (entry, idx) => {
        try {
          const rawHash = (batchHashes && batchHashes[idx]) ? batchHashes[idx] : await redis.hgetall(`request:${entry.mac}`);
          const hash = decodeUpstashHash(rawHash);
          return {
            name: hash?.name || entry.name || 'Guest User',
            mac: entry.mac,
            ip: hash?.ip || entry.ip || '',
            status: hash?.status || entry.status || 'pending',
            duration: hash?.duration !== undefined ? Number(hash.duration) : (entry.duration ? Number(entry.duration) : null),
            requestedAt: entry.requestedAt || hash?.requestedAt || null,
            reviewedAt: hash?.reviewedAt || entry.reviewedAt || null,
            authenticatedAt: hash?.authenticatedAt || entry.authenticatedAt || null,
            reviewedBy: hash?.reviewedBy || entry.reviewedBy || null
          };
        } catch {
          return entry;
        }
      })
    );

    return users;
  } catch (err) {
    console.error('[fetchUserRecords Error]', err);
    return [];
  }
}

export async function cleanTerminatedRecords(redis) {
  if (!redis) return { removedCount: 0, remainingCount: 0 };

  try {
    const rawHistory = await redis.lrange('request_history', 0, 499);
    if (!Array.isArray(rawHistory) || rawHistory.length === 0) {
      return { removedCount: 0, remainingCount: 0 };
    }

    const cleanedHistory = [];
    const terminatedMacs = new Set();

    for (const item of rawHistory) {
      try {
        const entry = typeof item === 'string' ? JSON.parse(item) : item;
        const rawHash = await redis.hgetall(`request:${entry.mac}`).catch(() => null);
        const hash = decodeUpstashHash(rawHash);
        const status = String(hash?.status || entry.status || '').toLowerCase();

        if (status === 'terminated' || status === 'rejected') {
          terminatedMacs.add(entry.mac);
        } else {
          cleanedHistory.push(JSON.stringify(entry));
        }
      } catch {}
    }

    if (terminatedMacs.size > 0) {
      const deletePromises = Array.from(terminatedMacs).map(mac =>
        redis.del(`request:${mac}`).catch(() => {})
      );
      await Promise.all(deletePromises);
    }

    await redis.del('request_history');
    if (cleanedHistory.length > 0) {
      await redis.rpush('request_history', ...cleanedHistory);
    }

    return {
      removedCount: terminatedMacs.size,
      remainingCount: cleanedHistory.length
    };
  } catch (err) {
    console.error('[cleanTerminatedRecords Error]', err);
    return { removedCount: 0, remainingCount: 0 };
  }
}

export async function registerBotCommands(botToken) {
  if (!botToken) return;
  try {
    const commands = [
      { command: 'menu', description: 'প্রধান কন্ট্রোল মেনুবার' },
      { command: 'auth', description: 'সরাসরি MAC এড্রেস অনুমোদন' },
      { command: 'voucher', description: 'গেস্ট ভাউচার কোড তৈরি' },
      { command: 'speed', description: 'ব্যান্ডউইথ স্পিড লিমিট' },
      { command: 'active', description: 'সক্রিয় ইউজার তালিকা ও টার্মিনেশন' },
      { command: 'previous', description: 'পূর্ববর্তী ইউজারদের তালিকা' },
      { command: 'details', description: 'ইউজারদের পূর্ণাঙ্গ বিবরণ' },
      { command: 'report', description: 'লাইভ নেটওয়ার্ক ও কোটা সামারি' },
      { command: 'clean', description: 'চ্যাট হিস্ট্রি ও ডাটা সম্পূর্ণ ক্লিন' },
      { command: 'reboot', description: 'রাউটার রিস্টার্ট / রিবুট' },
      { command: 'help', description: 'বট ও পোর্টাল সহায়িকা গাইড' }
    ];
    await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commands })
    });
    await fetch(`https://api.telegram.org/bot${botToken}/setChatMenuButton`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ menu_button: { type: 'commands' } })
    });
  } catch (err) {
    console.warn('[registerBotCommands Warning]', err);
  }
}

export async function trackChatMessage(redis, chatId, messageId) {
  if (!redis || !chatId || !messageId) return;
  try {
    const key = `telegram_messages:${chatId}`;
    await redis.rpush(key, messageId);
    await redis.ltrim(key, -200, -1);
  } catch {}
}

export async function deleteTelegramMessages(botToken, chatId, messageIds) {
  if (!botToken || !chatId || !Array.isArray(messageIds) || messageIds.length === 0) return 0;

  const validIds = Array.from(new Set(
    messageIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id) && id > 0)
  ));
  if (validIds.length === 0) return 0;

  const chunkSize = 100;
  let totalProcessed = 0;

  for (let i = 0; i < validIds.length; i += chunkSize) {
    const chunk = validIds.slice(i, i + chunkSize);
    let bulkSuccess = false;

    try {
      const url = `https://api.telegram.org/bot${botToken}/deleteMessages`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_ids: chunk })
      });
      const data = await res.json().catch(() => null);
      if (data && data.ok) {
        bulkSuccess = true;
        totalProcessed += chunk.length;
      }
    } catch {}

    if (!bulkSuccess) {
      await Promise.allSettled(
        chunk.map(async (msgId) => {
          try {
            await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, message_id: msgId })
            });
            totalProcessed++;
          } catch {}
        })
      );
    }
  }

  return totalProcessed;
}

export async function deleteTelegramMessage(botToken, chatId, messageId) {
  if (!botToken || !chatId || !messageId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId })
    });
    const data = await res.json().catch(() => null);
    return Boolean(data && data.ok);
  } catch {
    return false;
  }
}

export async function clearChatHistory(redis, botToken, chatId, currentMessageId = null) {
  if (!botToken || !chatId) return 0;
  const idsToDelete = new Set();

  if (redis) {
    try {
      const trackedIds = await redis.lrange(`telegram_messages:${chatId}`, 0, -1);
      if (Array.isArray(trackedIds)) {
        trackedIds.forEach(id => {
          const p = parseInt(id, 10);
          if (p > 0) idsToDelete.add(p);
        });
      }
      await redis.del(`telegram_messages:${chatId}`).catch(() => {});
    } catch {}
  }

  if (currentMessageId && typeof currentMessageId === 'number' && currentMessageId > 0) {
    const minId = Math.max(1, currentMessageId - 50);
    for (let id = currentMessageId; id >= minId; id--) idsToDelete.add(id);
  }

  const idsArray = Array.from(idsToDelete);
  return idsArray.length === 0 ? 0 : await deleteTelegramMessages(botToken, chatId, idsArray);
}
