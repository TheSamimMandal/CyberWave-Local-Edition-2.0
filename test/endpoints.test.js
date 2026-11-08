import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import requestHandler from '../api/request.js';
import webhookHandler from '../api/webhook.js';
import telegramHandler from '../api/telegram.js';
import pollHandler from '../api/poll.js';
import adminHandler from '../api/admin.js';
import loginHandler from '../api/login.js';
import pendingAuthHandler from '../api/pending-auth.js';
import confirmAuthHandler from '../api/confirm-auth.js';
import statusHandler from '../api/status.js';
import routerHandler, { isDangerousRouterCommand } from '../api/router.js';
import deauthHandler from '../api/deauth.js';
import voucherHandler from '../api/voucher.js';

// Helper mock response factory
function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    send(data) {
      this.body = data;
      return this;
    },
    end(data) {
      this.body = data;
      return this;
    }
  };
}

describe('API Endpoints Validation & Status Codes', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('/api/request rejects non-POST requests with 405', async () => {
    const req = { method: 'GET' };
    const res = createMockRes();

    await requestHandler(req, res);

    assert.equal(res.statusCode, 405);
    assert.match(res.body.error, /Method GET Not Allowed/);
    assert.equal(res.headers['allow'], 'POST');
  });

  test('/api/request validates missing or empty name with 400', async () => {
    const req = {
      method: 'POST',
      body: { name: '', mac: '00:11:22:33:44:55' }
    };
    const res = createMockRes();

    await requestHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /name/i);
  });

  test('/api/request validates invalid MAC address with 400', async () => {
    const req = {
      method: 'POST',
      body: { name: 'John Doe', mac: 'invalid-mac-address' }
    };
    const res = createMockRes();

    await requestHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /mac/i);
  });

  test('/api/request returns 500 when Telegram environment variables are missing', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;

    const req = {
      method: 'POST',
      body: { name: 'John Doe', mac: '00:11:22:33:44:55' }
    };
    const res = createMockRes();

    await requestHandler(req, res);

    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /Telegram credentials/i);
  });

  test('/api/poll rejects non-GET/POST requests with 405', async () => {
    const req = { method: 'PUT', headers: {} };
    const res = createMockRes();

    await pollHandler(req, res);

    assert.equal(res.statusCode, 405);
    assert.equal(res.headers['allow'], 'GET, POST');
  });

  test('/api/poll rejects missing or invalid x-router-secret header with 401', async () => {
    process.env.ROUTER_SECRET_KEY = 'super-secret-123';
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const reqWithoutHeader = { method: 'GET', headers: {} };
    const resWithoutHeader = createMockRes();
    await pollHandler(reqWithoutHeader, resWithoutHeader);
    assert.equal(resWithoutHeader.statusCode, 401);

    const reqWrongHeader = { method: 'GET', headers: { 'x-router-secret': 'wrong-key' } };
    const resWrongHeader = createMockRes();
    await pollHandler(reqWrongHeader, resWrongHeader);
    assert.equal(resWrongHeader.statusCode, 401);
  });

  test('/api/webhook returns 200 and ignores non-callback updates', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const req = {
      method: 'POST',
      body: {
        update_id: 12345,
        message: { text: 'Hello' } // Regular text message, not callback_query
      }
    };
    const res = createMockRes();

    await webhookHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.match(res.body.message, /No callback query/);
  });

  test('/api/telegram behaves identically to /api/webhook', async () => {
    assert.equal(telegramHandler, webhookHandler);
  });

  test('/api/webhook processes auth callback and queues ndsctl auth with Terminate button', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const fetchCalls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      if (String(url).includes('upstash.io')) {
        return new Response(JSON.stringify([{ result: 1 }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ ok: true, result: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      const req = {
        method: 'POST',
        body: {
          callback_query: {
            id: 'cb_123',
            data: 'auth:aa:bb:cc:dd:ee:ff:30',
            message: {
              chat: { id: 98765 },
              message_id: 42,
              text: '📶 New Wi-Fi Access Request\n👤 User: Rahim\nSelect access duration below to authorize via router:'
            },
            from: { first_name: 'AdminUser' }
          }
        }
      };
      const res = createMockRes();
      await webhookHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.commandQueued, 'ndsctl auth aa:bb:cc:dd:ee:ff 30');

      // Verify Telegram editMessageText had the Terminate button
      const editMsgCall = fetchCalls.find(c => c.url.includes('editMessageText'));
      assert.ok(editMsgCall, 'editMessageText was called');
      const body = JSON.parse(editMsgCall.options.body);
      assert.deepEqual(body.reply_markup.inline_keyboard, [
        [{ text: '❌ Terminate', callback_data: 'deauth_aa:bb:cc:dd:ee:ff' }]
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('/api/webhook processes deauth_<mac> callback and queues ndsctl deauth', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const fetchCalls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      if (String(url).includes('upstash.io')) {
        return new Response(JSON.stringify([{ result: 1 }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ ok: true, result: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      const req = {
        method: 'POST',
        body: {
          callback_query: {
            id: 'cb_456',
            data: 'deauth_aa:bb:cc:dd:ee:ff',
            message: {
              chat: { id: 98765 },
              message_id: 42,
              text: '📶 New Wi-Fi Access Request\n👤 User: Rahim\n\n✅ *Status:* Authorized (30m) by AdminUser'
            },
            from: { first_name: 'AdminUser' }
          }
        }
      };
      const res = createMockRes();
      await webhookHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.commandQueued, 'ndsctl deauth aa:bb:cc:dd:ee:ff');

      // Verify Telegram editMessageText removed the buttons
      const editMsgCall = fetchCalls.find(c => c.url.includes('editMessageText'));
      assert.ok(editMsgCall, 'editMessageText was called');
      const body = JSON.parse(editMsgCall.options.body);
      assert.deepEqual(body.reply_markup.inline_keyboard, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('/api/webhook processes /start and /menu text messages by presenting keyboard menu', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const fetchCalls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      return new Response(JSON.stringify({ ok: true, result: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      const req = {
        method: 'POST',
        body: {
          update_id: 8888,
          message: {
            text: '/start',
            chat: { id: 12345 }
          }
        }
      };
      const res = createMockRes();
      await webhookHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.action, 'menu_shown');

      // Verify sendMessage was invoked with welcome text and persistent reply keyboard
      const sendCall = fetchCalls.find(c => c.url.includes('sendMessage'));
      assert.ok(sendCall, 'sendMessage was called');
      const body = JSON.parse(sendCall.options.body);
      assert.equal(body.chat_id, 12345);
      assert.match(body.text, /OpenWrt Wi-Fi অ্যাডমিন কন্ট্রোল সেন্টারে/);
      assert.ok(body.reply_markup.keyboard, 'Reply keyboard attached');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('/api/webhook processes /dashboard, /active, /previous, /details, /clean text commands', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('upstash.io')) {
        return new Response(JSON.stringify({ result: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ ok: true, result: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      const commands = ['/dashboard', '/active', '/previous', '/details', '/clean'];
      for (const cmd of commands) {
        const req = {
          method: 'POST',
          body: {
            update_id: 9999,
            message: {
              text: cmd,
              chat: { id: 12345 }
            }
          }
        };
        const res = createMockRes();
        await webhookHandler(req, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.ok, true);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('/api/webhook processes custom duration reply to access request card', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const fetchCalls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      if (String(url).includes('upstash.io')) {
        let count = 1;
        try {
          const parsed = JSON.parse(options?.body);
          if (Array.isArray(parsed)) count = parsed.length;
        } catch {}
        const resBody = Array.from({ length: count }, () => ({ result: 1 }));
        return new Response(JSON.stringify(resBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ ok: true, result: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      const req = {
        method: 'POST',
        body: {
          update_id: 9901,
          message: {
            message_id: 501,
            text: '15',
            chat: { id: 12345 },
            from: { first_name: 'AdminUser' },
            reply_to_message: {
              message_id: 500,
              chat: { id: 12345 },
              text: '📶 New Wi-Fi Access Request\n👤 User: Guest\n🏷 MAC: aa:bb:cc:dd:ee:ff\nSelect duration below or reply with custom minutes (e.g. 15):'
            }
          }
        }
      };
      const res = createMockRes();
      await webhookHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.action, 'auth');
      assert.equal(res.body.duration, 15);
      assert.equal(res.body.commandQueued, 'ndsctl auth aa:bb:cc:dd:ee:ff 15');

      // Verify original card was updated with editMessageText
      const editMsgCall = fetchCalls.find(c => c.url.includes('editMessageText'));
      assert.ok(editMsgCall, 'editMessageText was called on original card');
      const editBody = JSON.parse(editMsgCall.options.body);
      assert.equal(editBody.message_id, 500);
      assert.match(editBody.text, /Authorized \(15m\)/);
      assert.deepEqual(editBody.reply_markup.inline_keyboard, [
        [{ text: '❌ Terminate', callback_data: 'deauth_aa:bb:cc:dd:ee:ff' }]
      ]);

      // Verify confirmation message was sent to admin chat
      const sendMsgCall = fetchCalls.find(c => c.url.includes('sendMessage'));
      assert.ok(sendMsgCall, 'sendMessage was called for confirmation');
      const sendBody = JSON.parse(sendMsgCall.options.body);
      assert.equal(sendBody.chat_id, 12345);
      assert.match(sendBody.text, /15 মিনিটের জন্য/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('/api/webhook processes direct /auth command with minutes', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const fetchCalls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      if (String(url).includes('upstash.io')) {
        let count = 1;
        try {
          const parsed = JSON.parse(options?.body);
          if (Array.isArray(parsed)) count = parsed.length;
        } catch {}
        const resBody = Array.from({ length: count }, () => ({ result: 1 }));
        return new Response(JSON.stringify(resBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ ok: true, result: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      const req = {
        method: 'POST',
        body: {
          update_id: 9902,
          message: {
            message_id: 502,
            text: '/auth 00:11:22:33:44:55 45',
            chat: { id: 12345 },
            from: { first_name: 'SuperAdmin' }
          }
        }
      };
      const res = createMockRes();
      await webhookHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.action, 'auth');
      assert.equal(res.body.mac, '00:11:22:33:44:55');
      assert.equal(res.body.duration, 45);
      assert.equal(res.body.commandQueued, 'ndsctl auth 00:11:22:33:44:55 45');

      const sendMsgCall = fetchCalls.find(c => c.url.includes('sendMessage'));
      assert.ok(sendMsgCall, 'sendMessage was called');
      const sendBody = JSON.parse(sendMsgCall.options.body);
      assert.match(sendBody.text, /45 মিনিটের জন্য/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('/api/webhook prompts for MAC when /auth or ➕ ম্যাক অথোরাইজ menu command is triggered', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const fetchCalls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      return new Response(JSON.stringify({ ok: true, result: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      const req = {
        method: 'POST',
        body: {
          update_id: 9903,
          message: {
            message_id: 503,
            text: '➕ ম্যাক অথোরাইজ',
            chat: { id: 12345 }
          }
        }
      };
      const res = createMockRes();
      await webhookHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.command, 'auth');

      const sendMsgCall = fetchCalls.find(c => c.url.includes('sendMessage'));
      assert.ok(sendMsgCall);
      const sendBody = JSON.parse(sendMsgCall.options.body);
      assert.match(sendBody.text, /সরাসরি MAC অ্যাড্রেস অনুমোদন/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('/api/webhook prompts for duration when user provides bare MAC address', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const fetchCalls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      return new Response(JSON.stringify({ ok: true, result: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      const req = {
        method: 'POST',
        body: {
          update_id: 9904,
          message: {
            message_id: 504,
            text: '46:84:b7:da:39:73',
            chat: { id: 12345 }
          }
        }
      };
      const res = createMockRes();
      await webhookHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.action, 'prompt_duration_sent');
      assert.equal(res.body.mac, '46:84:b7:da:39:73');

      const sendMsgCall = fetchCalls.find(c => c.url.includes('sendMessage'));
      assert.ok(sendMsgCall);
      const sendBody = JSON.parse(sendMsgCall.options.body);
      assert.match(sendBody.text, /অনুমোদনের সময়কাল নির্ধারণ করুন/);
      assert.match(sendBody.text, /46:84:b7:da:39:73/);
      assert.ok(sendBody.reply_markup && sendBody.reply_markup.inline_keyboard);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('/api/webhook processes "১ মিনিট" message and auto-resolves pending MAC from Redis', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const fetchCalls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      if (String(url).includes('upstash.io')) {
        let count = 1;
        try {
          const parsed = JSON.parse(options?.body);
          if (Array.isArray(parsed)) {
            count = parsed.length;
            // If checking lrange pending_macs, return the pending MAC
            if (parsed[0] === 'lrange' || (Array.isArray(parsed[0]) && parsed[0][0] === 'lrange')) {
              const isPipeline = String(url).includes('/pipeline');
              const lrangeResult = isPipeline ? [{ result: ['46:84:b7:da:39:73'] }] : { result: ['46:84:b7:da:39:73'] };
              return new Response(JSON.stringify(lrangeResult), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              });
            }
          }
        } catch {}
        const resBody = Array.from({ length: count }, () => ({ result: 1 }));
        return new Response(JSON.stringify(resBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ ok: true, result: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      const req = {
        method: 'POST',
        body: {
          update_id: 9903,
          message: {
            message_id: 503,
            text: '১ মিনিট', // User sends Bengali "১ মিনিট" directly without reply
            chat: { id: 12345 },
            from: { first_name: 'AdminUser' }
          }
        }
      };
      const res = createMockRes();
      await webhookHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.action, 'auth');
      assert.equal(res.body.mac, '46:84:b7:da:39:73');
      assert.equal(res.body.duration, 1);
      assert.equal(res.body.commandQueued, 'ndsctl auth 46:84:b7:da:39:73 1');

      // Verify confirmation message was sent to admin chat
      const sendMsgCall = fetchCalls.find(c => c.url.includes('sendMessage'));
      assert.ok(sendMsgCall, 'sendMessage was called for confirmation');
      const sendBody = JSON.parse(sendMsgCall.options.body);
      assert.match(sendBody.text, /1 মিনিটের জন্য/);
      assert.match(sendBody.text, /46:84:b7:da:39:73/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('/api/webhook responds with guidance when duration is given but no pending MAC is found', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const fetchCalls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      if (String(url).includes('upstash.io')) {
        return new Response(JSON.stringify([{ result: [] }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ ok: true, result: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      const req = {
        method: 'POST',
        body: {
          update_id: 9904,
          message: {
            message_id: 504,
            text: '১ মিনিট',
            chat: { id: 12345 },
            from: { first_name: 'AdminUser' }
          }
        }
      };
      const res = createMockRes();
      await webhookHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.error, 'Target MAC could not be resolved.');

      const sendMsgCall = fetchCalls.find(c => c.url.includes('sendMessage'));
      assert.ok(sendMsgCall, 'sendMessage was called with guidance');
      const sendBody = JSON.parse(sendMsgCall.options.body);
      assert.match(sendBody.text, /কাকে অনুমোদন দিতে চান তা নির্দিষ্ট করা যায়নি/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('/api/webhook processes menu callback query triggers', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('upstash.io')) {
        return new Response(JSON.stringify({ result: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ ok: true, result: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      const req = {
        method: 'POST',
        body: {
          callback_query: {
            id: 'cb_menu_1',
            data: 'menu_dashboard',
            message: {
              chat: { id: 12345 },
              message_id: 100
            }
          }
        }
      };
      const res = createMockRes();
      await webhookHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.action, 'menu');
      assert.equal(res.body.command, 'dashboard');

      // Test menu_active callback
      const activeReq = {
        method: 'POST',
        body: {
          callback_query: {
            id: 'cb_menu_active',
            data: 'menu_active',
            message: { chat: { id: 12345 }, message_id: 101 }
          }
        }
      };
      const activeRes = createMockRes();
      await webhookHandler(activeReq, activeRes);
      assert.equal(activeRes.statusCode, 200);
      assert.equal(activeRes.body.ok, true);
      assert.equal(activeRes.body.command, 'active');
      // Test menu_report callback
      const reportReq = {
        method: 'POST',
        body: {
          callback_query: {
            id: 'cb_menu_report',
            data: 'menu_report',
            message: { chat: { id: 12345 }, message_id: 102 }
          }
        }
      };
      const reportRes = createMockRes();
      await webhookHandler(reportReq, reportRes);
      assert.equal(reportRes.statusCode, 200);
      assert.equal(reportRes.body.ok, true);
      assert.equal(reportRes.body.command, 'report');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('/api/webhook blocks unauthorized chat when TELEGRAM_CHAT_ID is set', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_CHAT_ID = '99999';
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result: 1 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

    try {
      const req = {
        method: 'POST',
        body: {
          update_id: 1111,
          message: {
            text: '/dashboard',
            chat: { id: 88888 }
          }
        }
      };
      const res = createMockRes();
      await webhookHandler(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.error, 'Unauthorized chat.');
    } finally {
      delete process.env.TELEGRAM_CHAT_ID;
      globalThis.fetch = originalFetch;
    }
  });

  test('/api/admin POST executes clean action successfully', async () => {
    process.env.ADMIN_PASSWORD = 'admin-secret-pass';
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ result: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      const req = {
        method: 'POST',
        headers: { authorization: 'Bearer admin-secret-pass' },
        body: { action: 'clean' }
      };
      const res = createMockRes();
      await adminHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.success, true);
      assert.match(res.body.message, /cleaned/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('/api/admin rejects unsupported HTTP method with 405', async () => {
    const req = { method: 'DELETE', headers: {} };
    const res = createMockRes();

    await adminHandler(req, res);

    assert.equal(res.statusCode, 405);
    assert.match(res.body.error, /Method DELETE Not Allowed/);
    assert.equal(res.headers['allow'], 'GET, POST');
  });

  test('/api/admin returns 500 when admin credentials are not configured', async () => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ROUTER_SECRET_KEY;

    const req = { method: 'GET', headers: {} };
    const res = createMockRes();

    await adminHandler(req, res);

    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /Admin credentials are not configured/);
  });

  test('/api/admin rejects unauthorized requests with 401', async () => {
    process.env.ADMIN_PASSWORD = 'super-secret-admin';

    const reqWithoutAuth = { method: 'GET', headers: {} };
    const resWithoutAuth = createMockRes();
    await adminHandler(reqWithoutAuth, resWithoutAuth);
    assert.equal(resWithoutAuth.statusCode, 401);

    const reqWrongAuth = {
      method: 'GET',
      headers: { authorization: 'Bearer wrong-password' }
    };
    const resWrongAuth = createMockRes();
    await adminHandler(reqWrongAuth, resWrongAuth);
    assert.equal(resWrongAuth.statusCode, 401);
  });

  test('/api/admin POST verifies login action successfully', async () => {
    process.env.ADMIN_PASSWORD = 'correct-password';

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer correct-password' },
      body: { action: 'login' }
    };
    const res = createMockRes();

    await adminHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
  });

  test('/api/admin POST rejects invalid MAC address with 400', async () => {
    process.env.ADMIN_PASSWORD = 'correct-password';

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer correct-password' },
      body: { action: 'auth', mac: 'invalid-mac', duration: 60 }
    };
    const res = createMockRes();

    await adminHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /valid MAC address/);
  });

  test('/api/admin POST rejects invalid action with 400', async () => {
    process.env.ADMIN_PASSWORD = 'correct-password';

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer correct-password' },
      body: { action: 'unknown-action', mac: '00:11:22:33:44:55' }
    };
    const res = createMockRes();

    await adminHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Invalid action/);
  });

  test('/api/admin POST rejects negative duration with 400', async () => {
    process.env.ADMIN_PASSWORD = 'correct-password';

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer correct-password' },
      body: { action: 'auth', mac: '00:11:22:33:44:55', duration: -10 }
    };
    const res = createMockRes();

    await adminHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /duration/);
  });

  // ---------------------------------------------------------------------------
  // /api/login tests
  // ---------------------------------------------------------------------------
  test('/api/login rejects non-POST requests with 405', async () => {
    const req = { method: 'GET' };
    const res = createMockRes();

    await loginHandler(req, res);

    assert.equal(res.statusCode, 405);
    assert.match(res.body.error, /Method GET Not Allowed/);
  });

  test('/api/login rejects request when no valid MAC is found', async () => {
    const req = {
      method: 'POST',
      body: { name: 'Test User' }
    };
    const res = createMockRes();

    await loginHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Valid client MAC not found/);
  });

  test('/api/login successfully decodes FAS token and returns 200', async () => {
    const rawFas = 'clientmac=b6:30:f7:f7:11:60, clientip=192.168.2.223, gatewayaddress=192.168.2.1';
    const fasToken = Buffer.from(rawFas).toString('base64');

    const req = {
      method: 'POST',
      body: { fas: fasToken, name: 'Guest User' }
    };
    const res = createMockRes();

    await loginHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.mac, 'b6:30:f7:f7:11:60');
    assert.equal(res.body.ip, '192.168.2.223');
  });

  test('/api/login accepts direct mac parameter when fas is omitted', async () => {
    const req = {
      method: 'POST',
      body: { mac: 'AA:BB:CC:DD:EE:FF', ip: '10.0.0.5', name: 'Direct User' }
    };
    const res = createMockRes();

    await loginHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.mac, 'aa:bb:cc:dd:ee:ff');
  });

  // ---------------------------------------------------------------------------
  // /api/pending-auth tests
  // ---------------------------------------------------------------------------
  test('/api/pending-auth rejects non-GET requests with 405', async () => {
    const req = { method: 'POST', headers: {} };
    const res = createMockRes();

    await pendingAuthHandler(req, res);

    assert.equal(res.statusCode, 405);
    assert.match(res.body.error, /Method POST Not Allowed/);
  });

  test('/api/pending-auth rejects invalid x-router-secret with 401 when configured', async () => {
    process.env.ROUTER_SECRET_KEY = 'secret-key-xyz';
    const req = {
      method: 'GET',
      headers: { 'x-router-secret': 'wrong-secret' }
    };
    const res = createMockRes();

    await pendingAuthHandler(req, res);

    assert.equal(res.statusCode, 401);
    assert.match(res.body.error, /Unauthorized/);
  });

  test('/api/pending-auth returns plain text by default', async () => {
    const req = { method: 'GET', headers: {} };
    const res = createMockRes();

    await pendingAuthHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/plain/);
  });

  test('/api/pending-auth returns JSON when requested', async () => {
    const req = {
      method: 'GET',
      headers: { accept: 'application/json' }
    };
    const res = createMockRes();

    await pendingAuthHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok('mac' in res.body);
  });

  // ---------------------------------------------------------------------------
  // /api/confirm-auth tests
  // ---------------------------------------------------------------------------
  test('/api/confirm-auth rejects non-POST requests with 405', async () => {
    const req = { method: 'GET', headers: {} };
    const res = createMockRes();

    await confirmAuthHandler(req, res);

    assert.equal(res.statusCode, 405);
    assert.match(res.body.error, /Method GET Not Allowed/);
  });

  test('/api/confirm-auth rejects missing MAC with 400', async () => {
    const req = { method: 'POST', headers: {}, body: {} };
    const res = createMockRes();

    await confirmAuthHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /valid MAC address/);
  });

  test('/api/confirm-auth confirms MAC via URLSearchParams string body', async () => {
    const req = {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'mac=b6:30:f7:f7:11:60'
    };
    const res = createMockRes();

    await confirmAuthHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.mac, 'b6:30:f7:f7:11:60');
    assert.equal(res.body.status, 'AUTHENTICATED');
  });

  test('/api/confirm-auth confirms MAC via JSON body', async () => {
    const req = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { mac: '00:11:22:33:44:55' }
    };
    const res = createMockRes();

    await confirmAuthHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.mac, '00:11:22:33:44:55');
  });

  test('/api/confirm-auth confirms deauth command and dispatches Telegram notification', async () => {
    const fetchCalls = [];
    const origFetch = globalThis.fetch;
    process.env.TELEGRAM_BOT_TOKEN = 'mock-bot-token';
    process.env.TELEGRAM_CHAT_ID = '123456';

    globalThis.fetch = async (url, opts) => {
      fetchCalls.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 999 } }));
    };

    try {
      const req = {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'mac=00:11:22:33:44:55&command=ndsctl+deauth+00:11:22:33:44:55&status=success'
      };
      const res = createMockRes();
      await confirmAuthHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.mac, '00:11:22:33:44:55');

      const sendCall = fetchCalls.find(c => c.url.includes('sendMessage'));
      assert.ok(sendCall);
      assert.ok(sendCall.body.text.includes('সংযোগ বিচ্ছিন্ন'));
      assert.ok(sendCall.body.text.includes('00:11:22:33:44:55'));
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('/api/confirm-auth confirms speed limit command and dispatches Telegram notification', async () => {
    const fetchCalls = [];
    const origFetch = globalThis.fetch;
    process.env.TELEGRAM_BOT_TOKEN = 'mock-bot-token';
    process.env.TELEGRAM_CHAT_ID = '123456';

    globalThis.fetch = async (url, opts) => {
      fetchCalls.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1000 } }));
    };

    try {
      const req = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: {
          command: "uci set archer_guard.limit_aabbccddeeff.mbps='5'",
          mac: 'aa:bb:cc:dd:ee:ff',
          status: 'success'
        }
      };
      const res = createMockRes();
      await confirmAuthHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);

      const sendCall = fetchCalls.find(c => c.url.includes('sendMessage'));
      assert.ok(sendCall);
      assert.ok(sendCall.body.text.includes('ব্যান্ডউইথ স্পিড লিমিট'));
      assert.ok(sendCall.body.text.includes('5 Mbps'));
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('/api/status rejects non-GET requests with 405', async () => {
    const req = { method: 'POST' };
    const res = createMockRes();

    await statusHandler(req, res);

    assert.equal(res.statusCode, 405);
    assert.match(res.body.error, /Method POST Not Allowed/);
  });

  test('/api/status rejects missing or invalid MAC with 400', async () => {
    const req = { method: 'GET', url: 'http://localhost/api/status' };
    const res = createMockRes();

    await statusHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Field "mac" is required/);

    const reqInvalid = { method: 'GET', url: 'http://localhost/api/status?mac=not-a-mac' };
    const resInvalid = createMockRes();

    await statusHandler(reqInvalid, resInvalid);

    assert.equal(resInvalid.statusCode, 400);
  });

  test('/api/status returns fallback status when Redis is not configured', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const req = { method: 'GET', url: 'http://localhost/api/status?mac=aa:bb:cc:dd:ee:ff' };
    const res = createMockRes();

    await statusHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.mac, 'aa:bb:cc:dd:ee:ff');
    assert.equal(res.body.status, 'pending');
  });

  test('/api/router OPTIONS returns 200 with status ok', async () => {
    const req = { method: 'OPTIONS' };
    const res = createMockRes();

    await routerHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'ok');
  });

  test('/api/router rejects unsupported HTTP methods with 405', async () => {
    const req = { method: 'DELETE' };
    const res = createMockRes();

    await routerHandler(req, res);

    assert.equal(res.statusCode, 405);
    assert.match(res.body.error, /Method DELETE Not Allowed/);
  });

  test('/api/router GET returns simulated Archer C6 status when Redis is not configured', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete globalThis.__localRouterStatus;

    const req = { method: 'GET', headers: {} };
    const res = createMockRes();

    await routerHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.source, 'cloud_bridge');
    assert.equal(res.body.cpu.model, 'MediaTek MT7621DAT @ 880MHz');
    assert.equal(res.body.memory.total_kb, 131072);
    assert.equal(res.body.storage.total_kb, 16384);
    assert.equal(res.body.ports.wan.speed_mbps, 1000);
    assert.equal(res.body.wireless.radio_2g.band, '2.4GHz');
    assert.equal(res.body.wireless.radio_5g.band, '5GHz');
    assert.equal(res.body.network.hw_offload.enabled, true);
    assert.equal(res.body.network.sqm.qdisc, 'cake');
    assert.equal(res.body.network.wireguard.interface, 'wg0');
    assert.equal(res.body.network.multi_wan.enabled, false);
    assert.equal(res.body.network.doh.enabled, true);
    assert.equal(res.body.analytics.quota.total_gb, 50);
    assert.equal(res.body.analytics.quota.wrtbwmon_active, true);
    assert.equal(Array.isArray(res.body.analytics.wrtbwmon_clients), true);
    assert.equal(res.body.crontab.midnight_reboot.enabled, true);
    assert.equal(res.body.crontab.wifi_sleep.enabled, true);
    assert.equal(res.body.smart_home.home_assistant.enabled, true);
    assert.equal(Array.isArray(res.body.clients), true);
    assert.equal(typeof res.body.timestamp, 'number');
  });

  test('/api/router GET rejects invalid x-router-secret when secret is configured', async () => {
    process.env.ROUTER_SECRET_KEY = 'super_secret_key';

    const req = {
      method: 'GET',
      headers: { 'x-router-secret': 'wrong_secret' }
    };
    const res = createMockRes();

    await routerHandler(req, res);

    assert.equal(res.statusCode, 401);
    assert.match(res.body.error, /Unauthorized/);
  });

  test('/api/router POST rejects unauthorized requests when ROUTER_SECRET_KEY is configured', async () => {
    process.env.ROUTER_SECRET_KEY = 'super_secret_key';

    const req = {
      method: 'POST',
      headers: {},
      body: { command: 'reboot' }
    };
    const res = createMockRes();

    await routerHandler(req, res);

    assert.equal(res.statusCode, 401);
    assert.match(res.body.error, /Unauthorized/);
  });

  test('/api/router POST rejects missing or empty command with 400', async () => {
    process.env.ROUTER_SECRET_KEY = 'test_secret';

    const req = {
      method: 'POST',
      headers: { 'x-router-secret': 'test_secret' },
      body: {}
    };
    const res = createMockRes();

    await routerHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Field "command" is required/);
  });

  test('/api/router POST rejects unsupported command with 400', async () => {
    process.env.ROUTER_SECRET_KEY = 'test_secret';

    const req = {
      method: 'POST',
      headers: { 'x-router-secret': 'test_secret' },
      body: { command: 'rm_everything' }
    };
    const res = createMockRes();

    await routerHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Unsupported command/);
  });

  test('/api/router POST rejects invalid MAC address for client commands with 400', async () => {
    process.env.ROUTER_SECRET_KEY = 'test_secret';

    const req = {
      method: 'POST',
      headers: { 'x-router-secret': 'test_secret' },
      body: { command: 'block_client', target: 'not-a-mac' }
    };
    const res = createMockRes();

    await routerHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Valid target MAC address required/);
  });

  test('/api/router POST enqueues valid hardware commands (reboot, drop_caches, wifi_toggle, block_client, etc.)', async () => {
    process.env.ROUTER_SECRET_KEY = 'test_secret';
    globalThis.__localDevQueue = [];

    const testCases = [
      {
        body: { command: 'reboot' },
        expectedCmd: 'reboot'
      },
      {
        body: { command: 'drop_caches' },
        expectedCmd: 'echo 3 > /proc/sys/vm/drop_caches'
      },
      {
        body: { command: 'wifi_toggle', target: 'radio0', value: 'off' },
        expectedCmd: "uci set wireless.radio0.disabled='1' && uci commit wireless && wifi reload"
      },
      {
        body: { command: 'set_txpower', target: 'radio1', value: '23' },
        expectedCmd: "uci set wireless.radio1.txpower='23' && uci commit wireless && wifi reload"
      },
      {
        body: { command: 'set_wifi_channel', target: 'radio0', value: '6' },
        expectedCmd: "uci set wireless.radio0.channel='6' && uci commit wireless && wifi reload"
      },
      {
        body: { command: 'set_wifi_htmode', target: 'radio0', value: 'HT40' },
        expectedCmd: "uci set wireless.radio0.htmode='HT40' && uci commit wireless && wifi reload"
      },
      {
        body: { command: 'set_wifi_ssid', target: 'default_radio0', value: 'Archer_C6_2.4G' },
        expectedCmd: "uci set wireless.default_radio0.ssid='Archer_C6_2.4G' && uci commit wireless && wifi reload"
      },
      {
        body: { command: 'guest_wifi_toggle', target: 'guest', value: 'on' },
        expectedCmd: "uci set wireless.guest.disabled='0' && uci commit wireless && wifi reload"
      },
      {
        body: { command: 'set_wifi_advanced', target: 'roaming', value: '1' },
        expectedCmd: "uci set wireless.@wifi-iface[0].roaming='1' && uci commit wireless && wifi reload"
      },
      {
        body: { command: 'block_client', target: '00:11:22:33:44:55' },
        expectedCmd: 'iptables -I FORWARD 1 -m mac --mac-source 00:11:22:33:44:55 -j DROP'
      },
      {
        body: { command: 'unblock_client', target: '00:11:22:33:44:55' },
        expectedCmd: 'iptables -D FORWARD -m mac --mac-source 00:11:22:33:44:55 -j DROP'
      },
      {
        body: { command: 'nds_auth', target: '00:11:22:33:44:55', value: 60 },
        expectedCmd: 'ndsctl auth 00:11:22:33:44:55 60'
      },
      {
        body: { command: 'nds_deauth', target: '00:11:22:33:44:55' },
        expectedCmd: 'ndsctl deauth 00:11:22:33:44:55'
      },
      {
        body: { command: 'wol', target: '00:11:22:33:44:55' },
        expectedCmd: 'etherwake -i br-lan 00:11:22:33:44:55'
      },
      {
        body: { command: 'set_static_lease', target: '00:11:22:33:44:55', value: '192.168.1.50' },
        expectedCmd: "uci set dhcp.host_001122334455=host && uci set dhcp.host_001122334455.mac='00:11:22:33:44:55' && uci set dhcp.host_001122334455.ip='192.168.1.50' && uci commit dhcp"
      },
      {
        body: { command: 'del_static_lease', target: '00:11:22:33:44:55' },
        expectedCmd: "uci delete dhcp.host_001122334455 && uci commit dhcp"
      },
      {
        body: { command: 'led_stealth', value: 'off' },
        expectedCmd: 'for _l in /sys/class/leds/*; do [ -d "$_l" ] && echo 0 > "$_l/brightness" 2>/dev/null; done'
      },
      {
        body: { command: 'set_hw_offload', value: '1' },
        expectedCmd: "uci set firewall.@defaults[0].flow_offloading='1' && uci set firewall.@defaults[0].flow_offloading_hw='0' && uci commit firewall && /etc/init.d/firewall restart"
      },
      {
        body: { command: 'set_sqm', value: '1' },
        expectedCmd: "uci set sqm.@queue[0].enabled='1' && uci commit sqm && /etc/init.d/sqm restart"
      },
      {
        body: { command: 'set_sqm_limits', target: 'cake', value: { download: 95000, upload: 20000 } },
        expectedCmd: "uci set sqm.@queue[0].qdisc='cake' && uci set sqm.@queue[0].download='95000' && uci set sqm.@queue[0].upload='20000' && uci commit sqm && /etc/init.d/sqm restart"
      },
      {
        body: { command: 'set_wireguard', value: 'on' },
        expectedCmd: 'ifup wg0'
      },
      {
        body: { command: 'set_wireguard', value: 'off' },
        expectedCmd: 'ifdown wg0'
      },
      {
        body: { command: 'set_multiwan', value: '1' },
        expectedCmd: "uci set mwan3.globals.enabled='1' && uci commit mwan3 && /etc/init.d/mwan3 restart"
      },
      {
        body: { command: 'set_doh', value: '1' },
        expectedCmd: '/etc/init.d/https-dns-proxy start'
      },
      {
        body: { command: 'set_dns', value: '1.1.1.1', target: '1.0.0.1' },
        expectedCmd: "uci set network.wan.peerdns='0' && uci delete network.wan.dns 2>/dev/null && uci add_list network.wan.dns='1.1.1.1' && uci add_list network.wan.dns='1.0.0.1' && uci commit network && /etc/init.d/network reload"
      },
      {
        body: { command: 'set_dns', value: 'auto' },
        expectedCmd: "uci set network.wan.peerdns='1' && uci delete network.wan.dns 2>/dev/null && uci commit network && /etc/init.d/network reload"
      },
      {
        body: { command: 'raw_cmd', value: 'ping -c 4 8.8.8.8' },
        expectedCmd: 'ping -c 4 8.8.8.8'
      },
      {
        body: { command: 'set_quota', value: 50, reset_day: 1, warning_percent: 80 },
        expectedCmd: "uci set archer_guard.quota=section && uci set archer_guard.quota.total_gb='50' && uci set archer_guard.quota.reset_day='1' && uci set archer_guard.quota.warn_pct='80' && uci commit archer_guard"
      },
      {
        body: { command: 'reset_quota' },
        expectedCmd: 'wrtbwmon reset || rm -f /tmp/usage.db /tmp/wrtbwmon/usage.db'
      },
      {
        body: { command: 'set_client_quota', target: '00:11:22:33:44:55', value: 20 },
        expectedCmd: "uci set archer_guard.quota_001122334455='20' && uci commit archer_guard"
      },
      {
        body: { command: 'toggle_cron_task', target: 'midnight_reboot', value: '1' },
        expectedCmd: "echo '0 4 * * * /sbin/reboot' >> /etc/crontabs/root && /etc/init.d/cron restart"
      },
      {
        body: { command: 'toggle_cron_task', target: 'wifi_sleep', value: '1' },
        expectedCmd: "echo '0 1 * * * /sbin/wifi down' >> /etc/crontabs/root && echo '0 7 * * * /sbin/wifi up' >> /etc/crontabs/root && /etc/init.d/cron restart"
      },
      {
        body: { command: 'set_homeassistant_webhook', value: 'http://ha.local:8123/webhook' },
        expectedCmd: "uci set archer_guard.ha=section && uci set archer_guard.ha.enabled='1' && uci set archer_guard.ha.webhook='http://ha.local:8123/webhook' && uci commit archer_guard"
      },
      {
        body: { command: 'trigger_ha_webhook', target: '00:11:22:33:44:55', value: 'connected' },
        expectedCmd: "curl -s -m 3 -X POST -H 'Content-Type: application/json' -d '{\"device\":\"archer_c6\",\"mac\":\"00:11:22:33:44:55\",\"state\":\"connected\"}' 'http://homeassistant.local:8123/api/webhook/archer_c6_presence'"
      }
    ];

    for (const tc of testCases) {
      const req = {
        method: 'POST',
        headers: { 'x-router-secret': 'test_secret' },
        body: tc.body
      };
      const res = createMockRes();

      await routerHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.routerCmd, tc.expectedCmd);
    }

    assert.equal(globalThis.__localDevQueue.length, testCases.length);
  });

  test('/api/router POST executes raw_cmd and returns simulated diagnostic output', async () => {
    process.env.ROUTER_SECRET_KEY = 'test_secret';

    const commands = ['ping 8.8.8.8', 'traceroute 1.1.1.1', 'iwinfo wlan0', 'iwinfo wlan1', 'logread -l 30', 'dmesg', 'cat /proc/cpuinfo', 'free -m', 'df -h', 'uptime'];

    for (const cmd of commands) {
      const req = {
        method: 'POST',
        headers: { 'x-router-secret': 'test_secret' },
        body: { command: 'raw_cmd', value: cmd }
      };
      const res = createMockRes();
      await routerHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.command, 'raw_cmd');
      assert.ok(typeof res.body.output === 'string');
      assert.ok(res.body.output.length > 0);
    }
  });

  test('/api/router POST blocks dangerous bricking commands with 403', async () => {
    process.env.ROUTER_SECRET_KEY = 'test_secret';

    const brickingCommands = [
      'mtd write /tmp/bad.bin firmware',
      'sysupgrade -F /tmp/bad.bin',
      'rm -rf /',
      'rm -rf /overlay',
      'dd if=/dev/zero of=/dev/mtdblock0',
      'mkfs.ext4 /dev/mtdblock3',
      'uci set network.lan.ipaddr=0.0.0.0',
      'ifdown lan',
      'ip link set br-lan down',
      '/etc/init.d/network stop',
      ':(){ :|:& };:'
    ];

    for (const cmd of brickingCommands) {
      const req = {
        method: 'POST',
        headers: { 'x-router-secret': 'test_secret' },
        body: { command: 'raw_cmd', value: cmd }
      };
      const res = createMockRes();
      await routerHandler(req, res);

      assert.equal(res.statusCode, 403);
      assert.equal(res.body.blocked, true);
      assert.ok(res.body.error.includes('SAFETY LOCK ACTIVATED'));
    }
  });

  test('/api/router POST rejects invalid DNS IP formats with 400', async () => {
    process.env.ROUTER_SECRET_KEY = 'test_secret';

    const invalidDnsReqs = [
      { command: 'set_dns', value: 'bad.ip.format' },
      { command: 'set_dns', value: '1.1.1.1; rm -rf /' },
      { command: 'set_dns', value: '1.1.1.1', target: '$(reboot)' }
    ];

    for (const body of invalidDnsReqs) {
      const req = {
        method: 'POST',
        headers: { 'x-router-secret': 'test_secret' },
        body
      };
      const res = createMockRes();
      await routerHandler(req, res);

      assert.equal(res.statusCode, 400);
      assert.ok(res.body.error.includes('Invalid DNS IP'));
    }
  });

  test('isDangerousRouterCommand correctly flags bricking and dangerous commands', () => {
    assert.equal(isDangerousRouterCommand('mtd erase firmware'), true);
    assert.equal(isDangerousRouterCommand('sysupgrade image.bin'), true);
    assert.equal(isDangerousRouterCommand('sysupgrade -b /tmp/backup.tar.gz'), false); // safe backup
    assert.equal(isDangerousRouterCommand('rm -rf /etc'), true);
    assert.equal(isDangerousRouterCommand('ifdown lan'), true);
    assert.equal(isDangerousRouterCommand('ping -c 4 8.8.8.8'), false);
    assert.equal(isDangerousRouterCommand('traceroute 1.1.1.1'), false);
    assert.equal(isDangerousRouterCommand('uptime'), false);
  });

  test('/api/router POST accepts report_status action and caches telemetry', async () => {
    process.env.ROUTER_SECRET_KEY = 'test_secret';

    const mockTelemetry = {
      cpu: { load_avg: '0.05, 0.08, 0.02' },
      memory: { total_kb: 131072, free_kb: 60000 },
      source: 'live_router_test'
    };

    const req = {
      method: 'POST',
      headers: { 'x-router-secret': 'test_secret' },
      body: {
        action: 'report_status',
        status: mockTelemetry
      }
    };
    const res = createMockRes();

    await routerHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'ok');
    assert.deepEqual(globalThis.__localRouterStatus, mockTelemetry);

    // Verify GET now returns this cached status
    const reqGet = { method: 'GET', headers: {} };
    const resGet = createMockRes();
    await routerHandler(reqGet, resGet);
    assert.equal(resGet.statusCode, 200);
    assert.equal(resGet.body.source, 'live_router_test');
  });

  test('/api/deauth rejects non-POST requests with 405', async () => {
    const req = { method: 'GET', headers: {} };
    const res = createMockRes();
    await deauthHandler(req, res);
    assert.equal(res.statusCode, 405);
  });

  test('/api/deauth rejects invalid x-router-secret when configured', async () => {
    process.env.ROUTER_SECRET_KEY = 'secret123';
    const req = {
      method: 'POST',
      headers: { 'x-router-secret': 'wrong' },
      body: { mac: 'aa:bb:cc:dd:ee:ff' }
    };
    const res = createMockRes();
    await deauthHandler(req, res);
    assert.equal(res.statusCode, 401);
  });

  test('/api/deauth rejects missing or invalid MAC with 400', async () => {
    const req = {
      method: 'POST',
      headers: {},
      body: { mac: 'invalid-mac' }
    };
    const res = createMockRes();
    await deauthHandler(req, res);
    assert.equal(res.statusCode, 400);
  });

  test('/api/deauth accepts valid deauth event, saves to Redis, and delivers disconnect card to Telegram', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_CHAT_ID = '12345';
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const fetchCalls = [];
    const enc = (s) => Buffer.from(String(s)).toString('base64');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      if (String(url).includes('upstash.io')) {
        const urlStr = String(url);
        const isPipeline = urlStr.includes('/pipeline');
        const bodyParsed = JSON.parse(options?.body || '[]');

        if (isPipeline && Array.isArray(bodyParsed)) {
          const results = bodyParsed.map(cmd => {
            const op = cmd[0];
            const key = cmd[1];
            if (op === 'get' && key && key.includes('deauth_notified')) return { result: null };
            if (op === 'hgetall') {
              return { result: [enc('name'), enc('Sabbir'), enc('mac'), enc('46:84:b7:da:39:73'), enc('ip'), enc('192.168.2.144')] };
            }
            return { result: 1 };
          });
          return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        const op = Array.isArray(bodyParsed) ? bodyParsed[0] : '';
        const key = Array.isArray(bodyParsed) ? bodyParsed[1] : '';
        if (op === 'get' && key && key.includes('deauth_notified')) return new Response(JSON.stringify({ result: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        if (op === 'hgetall') {
          return new Response(JSON.stringify({ result: [enc('name'), enc('Sabbir'), enc('mac'), enc('46:84:b7:da:39:73'), enc('ip'), enc('192.168.2.144')] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({ result: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 999 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      const req = {
        method: 'POST',
        headers: {},
        body: {
          mac: '46:84:b7:da:39:73',
          reason: 'timeout_deauth',
          session_start: 1760443200,
          session_end: 1760445000
        }
      };
      const res = createMockRes();
      await deauthHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.notified, true);
      assert.equal(res.body.mac, '46:84:b7:da:39:73');

      // Verify Telegram notification was dispatched
      const sendCall = fetchCalls.find(c => c.url.includes('sendMessage'));
      assert.ok(sendCall, 'sendMessage was called');
      const body = JSON.parse(sendCall.options.body);
      assert.equal(body.chat_id, '12345');
      assert.match(body.text, /Wi-Fi Device Disconnected/);
      assert.match(body.text, /Sabbir/);
      assert.match(body.text, /46:84:b7:da:39:73/);
      assert.match(body.text, /Session Timeout/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('/api/webhook prompts unlimited sub-options when auth duration is 0', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const fetchCalls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      if (String(url).includes('upstash.io')) {
        return new Response(JSON.stringify([{ result: 1 }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ ok: true, result: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      const req = {
        method: 'POST',
        body: {
          callback_query: {
            id: 'cb_unlim',
            data: 'auth:aa:bb:cc:dd:ee:ff:0',
            message: {
              chat: { id: 12345 },
              message_id: 50,
              text: '📶 New Wi-Fi Access Request\n👤 User: Sabbir\nSelect duration below:'
            },
            from: { first_name: 'Admin' }
          }
        }
      };
      const res = createMockRes();
      await webhookHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.action, 'unlimited_menu_prompted');

      const editMsgCall = fetchCalls.find(c => c.url.includes('editMessageText'));
      assert.ok(editMsgCall, 'editMessageText was called');
      const body = JSON.parse(editMsgCall.options.body);
      assert.match(body.text, /আনলিমিটেড অ্যাক্সেস মোড/);
      assert.equal(body.reply_markup.inline_keyboard[0][0].callback_data, 'unlim_sess:aa:bb:cc:dd:ee:ff');
      assert.equal(body.reply_markup.inline_keyboard[1][0].callback_data, 'unlim_perm:aa:bb:cc:dd:ee:ff');
      assert.equal(body.reply_markup.inline_keyboard[2][0].callback_data, 'unlim_back:aa:bb:cc:dd:ee:ff');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('/api/webhook executes unlim_sess and unlim_perm actions correctly', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('upstash.io')) {
        return new Response(JSON.stringify([{ result: 1 }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 123 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      // 1. Session Unlimited
      const reqSess = {
        method: 'POST',
        body: {
          callback_query: {
            id: 'cb_sess',
            data: 'unlim_sess:aa:bb:cc:dd:ee:ff',
            message: {
              chat: { id: 12345 },
              message_id: 51,
              text: '📶 New Wi-Fi Access Request'
            },
            from: { first_name: 'Admin' }
          }
        }
      };
      const resSess = createMockRes();
      await webhookHandler(reqSess, resSess);
      assert.equal(resSess.statusCode, 200);
      assert.equal(resSess.body.ok, true);
      assert.equal(resSess.body.action, 'unlim_sess');
      assert.equal(resSess.body.commandQueued, 'ndsctl auth aa:bb:cc:dd:ee:ff 0');

      // 2. Permanent Trusted
      const reqPerm = {
        method: 'POST',
        body: {
          callback_query: {
            id: 'cb_perm',
            data: 'unlim_perm:aa:bb:cc:dd:ee:ff',
            message: {
              chat: { id: 12345 },
              message_id: 52,
              text: '📶 New Wi-Fi Access Request'
            },
            from: { first_name: 'Admin' }
          }
        }
      };
      const resPerm = createMockRes();
      await webhookHandler(reqPerm, resPerm);
      assert.equal(resPerm.statusCode, 200);
      assert.equal(resPerm.body.ok, true);
      assert.equal(resPerm.body.action, 'unlim_perm');
      assert.equal(resPerm.body.commandQueued, 'ndsctl trust aa:bb:cc:dd:ee:ff');

      // 3. Back to default keyboard
      const reqBack = {
        method: 'POST',
        body: {
          callback_query: {
            id: 'cb_back',
            data: 'unlim_back:aa:bb:cc:dd:ee:ff',
            message: {
              chat: { id: 12345 },
              message_id: 53,
              text: '📶 New Wi-Fi Access Request'
            },
            from: { first_name: 'Admin' }
          }
        }
      };
      const resBack = createMockRes();
      await webhookHandler(reqBack, resBack);
      assert.equal(resBack.statusCode, 200);
      assert.equal(resBack.body.ok, true);
      assert.equal(resBack.body.action, 'unlimited_menu_cancelled');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('/api/webhook text commands handle permanent and session keywords directly', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('upstash.io')) {
        return new Response(JSON.stringify([{ result: 1 }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 123 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      const cardText = '📶 *New Wi-Fi Access Request*\n🏷 MAC: `46:84:b7:da:39:73`';

      // 1. Reply with "স্থায়ী"
      const reqPerm = {
        method: 'POST',
        body: {
          message: {
            text: 'স্থায়ী',
            chat: { id: 12345 },
            reply_to_message: { text: cardText }
          }
        }
      };
      const resPerm = createMockRes();
      await webhookHandler(reqPerm, resPerm);
      assert.equal(resPerm.statusCode, 200);
      assert.equal(resPerm.body.mode, 'permanent');
      assert.equal(resPerm.body.commandQueued, 'ndsctl trust 46:84:b7:da:39:73');

      // 2. Reply with "এককালীন"
      const reqSess = {
        method: 'POST',
        body: {
          message: {
            text: 'এককালীন',
            chat: { id: 12345 },
            reply_to_message: { text: cardText }
          }
        }
      };
      const resSess = createMockRes();
      await webhookHandler(reqSess, resSess);
      assert.equal(resSess.statusCode, 200);
      assert.equal(resSess.body.mode, 'session');
      assert.equal(resSess.body.commandQueued, 'ndsctl auth 46:84:b7:da:39:73 0');

      // 3. Reply with "unlimited" (unspecified mode prompts sub-options)
      const reqUnlim = {
        method: 'POST',
        body: {
          message: {
            text: 'unlimited',
            chat: { id: 12345 },
            reply_to_message: { text: cardText }
          }
        }
      };
      const resUnlim = createMockRes();
      await webhookHandler(reqUnlim, resUnlim);
      assert.equal(resUnlim.statusCode, 200);
      assert.equal(resUnlim.body.action, 'unlimited_prompt_sent');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('/api/poll saves x-router-connected-macs to Redis live MAC cache', async () => {
    process.env.ROUTER_SECRET_KEY = 'super-secret-123';
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const redisCommands = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (String(url).includes('upstash.io')) {
        const body = JSON.parse(opts.body);
        redisCommands.push(body);
        if (Array.isArray(body)) {
          const results = body.map(cmd => {
            const op = String(Array.isArray(cmd) ? cmd[0] : '').toLowerCase();
            if (op === 'lpop') {
              return { result: 'ndsctl auth 00:11:22:33:44:55 30' };
            }
            return { result: 'OK' };
          });
          return new Response(JSON.stringify(results), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify({ result: 'ndsctl auth 00:11:22:33:44:55 30' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    try {
      const req = {
        method: 'GET',
        headers: {
          'x-router-secret': 'super-secret-123',
          'x-router-connected-macs': '06:31:5b:7a:aa:e7, 46:84:b7:da:39:73'
        }
      };
      const res = createMockRes();
      await pollHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.command, 'ndsctl auth 00:11:22:33:44:55 30');

      // Verify that Redis was called with SET for router:live_connected_macs
      const flatCommands = redisCommands.flat();
      const setCall = flatCommands.find(cmd => Array.isArray(cmd) && String(cmd[0]).toLowerCase() === 'set' && cmd[1] === 'router:live_connected_macs');
      assert.ok(setCall, 'router:live_connected_macs was saved');
      const savedMacs = JSON.parse(setCall[2]);
      assert.deepEqual(savedMacs, ['06:31:5b:7a:aa:e7', '46:84:b7:da:39:73']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('/api/webhook /active sends separate user cards for live Wi-Fi users', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const telegramMessages = [];
    const originalFetch = globalThis.fetch;
    const enc = (s) => Buffer.from(String(s)).toString('base64');

    globalThis.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('upstash.io')) {
        const body = JSON.parse(opts.body);
        const executeRedisCmd = (cmd) => {
          const op = String(Array.isArray(cmd) ? cmd[0] : '').toLowerCase();
          const key = Array.isArray(cmd) ? cmd[1] : '';
          if (op === 'get' && key === 'router:live_connected_macs') {
            return JSON.stringify(['46:84:b7:da:39:73']);
          }
          if (op === 'lrange' && key === 'request_history') {
            return [
              JSON.stringify({ mac: '46:84:b7:da:39:73', name: 'Tanvir Live' }),
              JSON.stringify({ mac: 'aa:bb:cc:dd:ee:ff', name: 'Offline User' })
            ];
          }
          if (op === 'hgetall') {
            if (key === 'request:46:84:b7:da:39:73') {
              return [enc('name'), enc('Tanvir Live'), enc('mac'), enc('46:84:b7:da:39:73'), enc('status'), enc('authorized'), enc('duration'), enc('60'), enc('ip'), enc('192.168.2.229'), enc('reviewedAt'), enc(new Date().toISOString())];
            }
            return [enc('name'), enc('Offline User'), enc('mac'), enc('aa:bb:cc:dd:ee:ff'), enc('status'), enc('authorized'), enc('duration'), enc('60'), enc('ip'), enc('192.168.2.111'), enc('reviewedAt'), enc(new Date().toISOString())];
          }
          if (op === 'llen') return 0;
          return 1;
        };

        if (Array.isArray(body)) {
          if (body.length > 0 && Array.isArray(body[0])) {
            const results = body.map(cmd => ({ result: executeRedisCmd(cmd) }));
            return new Response(JSON.stringify(results), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          return new Response(JSON.stringify({ result: executeRedisCmd(body) }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify({ result: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (urlStr.includes('sendMessage')) {
        const payload = JSON.parse(opts.body);
        telegramMessages.push(payload);
        return new Response(JSON.stringify({ ok: true, result: { message_id: Math.floor(Math.random() * 1000) } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    try {
      const req = {
        method: 'POST',
        body: {
          update_id: 1001,
          message: {
            text: '🟢 অ্যাক্টিভ ইউজার',
            chat: { id: 12345 },
            message_id: 501
          }
        }
      };
      const res = createMockRes();
      await webhookHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.command, 'active');

      // Verify messages sent: 1 header + 1 individual card (only Tanvir Live because aa:bb:cc is offline)
      assert.equal(telegramMessages.length, 2);
      assert.ok(telegramMessages[0].text.includes('Active Wi-Fi Users'));
      assert.ok(telegramMessages[0].text.includes('মোট কানেক্টেড ইউজার:* 1 জন'));

      // Check the individual card
      assert.ok(telegramMessages[1].text.includes('Tanvir Live'));
      assert.ok(telegramMessages[1].text.includes('46:84:b7:da:39:73'));
      assert.equal(telegramMessages[1].reply_markup.inline_keyboard[0][0].text, '❌ সংযোগ বিচ্ছিন্ন করুন');
      assert.equal(telegramMessages[1].reply_markup.inline_keyboard[0][0].callback_data, 'deauth_46:84:b7:da:39:73');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('/api/webhook deauth callback deletes active user card from Telegram chat', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const fetchCalls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      fetchCalls.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
      if (String(url).includes('upstash.io')) {
        return new Response(JSON.stringify([{ result: 1 }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      const req = {
        method: 'POST',
        body: {
          callback_query: {
            id: 'cb_deauth_active_1',
            data: 'deauth_46:84:b7:da:39:73',
            message: {
              chat: { id: 12345 },
              message_id: 888,
              text: '👤 *ইউজার:* Tanvir\n🏷 *MAC অ্যাড্রেস:* `46:84:b7:da:39:73`\n_সংযোগ বিচ্ছিন্ন করতে নিচের বাটনে চাপ দিন:_'
            },
            from: { first_name: 'AdminUser' }
          }
        }
      };
      const res = createMockRes();
      await webhookHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.commandQueued, 'ndsctl deauth 46:84:b7:da:39:73');

      // Verify that deleteMessage was called for message_id 888
      const deleteCall = fetchCalls.find(c => c.url.includes('deleteMessage'));
      assert.ok(deleteCall, 'deleteMessage endpoint was invoked');
      assert.equal(deleteCall.body.chat_id, 12345);
      assert.equal(deleteCall.body.message_id, 888);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('/api/voucher OPTIONS returns 200 with status ok', async () => {
    const req = { method: 'OPTIONS' };
    const res = createMockRes();
    await voucherHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { status: 'ok' });
  });

  test('/api/voucher rejects missing Redis credentials with 500', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const req = { method: 'POST', body: {} };
    const res = createMockRes();
    await voucherHandler(req, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'Database configuration missing.');
  });

  test('/api/voucher GET rejects unauthorized requests when ADMIN_PASSWORD is set', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';
    process.env.ADMIN_PASSWORD = 'super_secret_admin';

    const req = { method: 'GET', headers: {} };
    const res = createMockRes();
    await voucherHandler(req, res);
    assert.equal(res.statusCode, 401);
  });

  test('/api/voucher POST rejects missing code or mac with 400', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const req = { method: 'POST', body: { code: 'PASS-1234' } };
    const res = createMockRes();
    await voucherHandler(req, res);
    assert.equal(res.statusCode, 400);
  });

  test('/api/voucher POST redeems voucher for captive portal guest', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

    const enc = (s) => Buffer.from(String(s)).toString('base64');
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const urlStr = String(url);
      const isPipeline = urlStr.includes('/pipeline');
      const bodyParsed = JSON.parse(opts?.body || '[]');

      if (isPipeline && Array.isArray(bodyParsed)) {
        const results = bodyParsed.map(cmd => {
          const op = cmd[0];
          if (op === 'hgetall') {
            return { result: [enc('code'), enc('PASS-7842'), enc('duration'), enc('60'), enc('redeemed'), enc('false')] };
          }
          return { result: 1 };
        });
        return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      const op = Array.isArray(bodyParsed) ? bodyParsed[0] : '';
      if (op === 'hgetall') {
        return new Response(JSON.stringify({ result: [enc('code'), enc('PASS-7842'), enc('duration'), enc('60'), enc('redeemed'), enc('false')] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({ result: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      const req = {
        method: 'POST',
        body: { code: 'PASS-7842', mac: '46:84:b7:da:39:73', name: 'Tanvir' }
      };
      const res = createMockRes();
      await voucherHandler(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.duration, 60);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
