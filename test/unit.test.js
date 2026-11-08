import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { escapeMarkdown, normalizeMac } from '../api/request.js';
import { parseCallbackData, parseCustomAuthMessage, normalizeDigits, parseDurationString } from '../api/webhook.js';
import { parseCallbackData as parseCallbackDataTelegram } from '../api/telegram.js';
import { timingSafeCompare } from '../api/poll.js';
import { checkAdminAuth } from '../api/admin.js';
import { parseFasToken } from '../lib/opennds.js';
import {
  formatDateTime,
  isUserActive,
  isUserTerminated,
  formatUserDetailsCard,
  formatUserDetailsList,
  formatActiveUsersList,
  formatPreviousUsersList,
  formatDashboardMessage,
  buildActiveUsersKeyboard,
  buildSingleUserDeauthKeyboard,
  buildDefaultAuthKeyboard,
  buildUnlimitedKeyboard,
  formatSingleActiveUserCard,
  formatDisconnectCard,
  buildSpeedLimitKeyboard,
  buildSpeedUsersKeyboard,
  buildRebootConfirmKeyboard,
  TELEGRAM_MENU_KEYBOARD,
  TELEGRAM_INLINE_MENU,
  trackChatMessage,
  deleteTelegramMessages,
  deleteTelegramMessage,
  clearChatHistory
} from '../lib/bot-menu.js';
import { normalizeCommandText } from '../api/webhook.js';
import {
  saveDeviceAlias,
  getDeviceAlias,
  parseRenameCommand,
  formatAliasSuccessMessage
} from '../lib/telegram/alias.js';
import {
  generateVoucherCode,
  createVoucher,
  redeemVoucher,
  listActiveVouchers,
  formatVoucherCreatedCard,
  formatVoucherRedeemedNotice
} from '../lib/voucher.js';
import { handleExtendedCommand } from '../lib/telegram/extended-commands.js';
import { formatRouterActionNotice, sendRouterConfirmationNotice } from '../lib/telegram/router-confirm.js';
import { processMenuCommand } from '../lib/telegram/commands.js';
import { handleTelegramCallback } from '../lib/telegram/callback-handler.js';
import { handleTelegramMessage } from '../lib/telegram/message-handler.js';
import { getSystemSettings, saveSystemSettings, getPublicPortalConfig } from '../lib/admin/settings.js';
import {
  registerRouter,
  unpairRouter,
  verifyRouterCredentials,
  handleRouterHeartbeat,
  recordCommandResult,
  enqueueCommandForRouter,
  getCommandStatus,
  getRouterProfile,
  generateInstallScript,
  addAuditLog,
  getAuditLogs
} from '../lib/router/bridge.js';

describe('api/request.js Helpers', () => {
  test('escapeMarkdown escapes Markdown special characters', () => {
    assert.equal(escapeMarkdown('Alice *Bob* _Charlie_ `test` [link]'), 'Alice \\*Bob\\* \\_Charlie\\_ \\`test\\` \\[link\\]');
    assert.equal(escapeMarkdown(''), '');
    assert.equal(escapeMarkdown('John Doe'), 'John Doe');
  });

  test('normalizeMac formats MAC address properly', () => {
    assert.equal(normalizeMac('AA:BB:CC:DD:EE:FF'), 'aa:bb:cc:dd:ee:ff');
    assert.equal(normalizeMac('aa-bb-cc-dd-ee-ff'), 'aa:bb:cc:dd:ee:ff');
    assert.equal(normalizeMac('  00:11:22:33:44:55  '), '00:11:22:33:44:55');
  });
});

describe('api/webhook.js Callback Parsing', () => {
  test('parses auth with 30 minutes duration correctly', () => {
    const result = parseCallbackData('auth:00:11:22:33:44:55:30');
    assert.deepEqual(result, {
      action: 'auth',
      mac: '00:11:22:33:44:55',
      duration: 30
    });
  });

  test('parses auth with 60 minutes (1 hour) duration correctly', () => {
    const result = parseCallbackData('auth:00:11:22:33:44:55:60');
    assert.deepEqual(result, {
      action: 'auth',
      mac: '00:11:22:33:44:55',
      duration: 60
    });
  });

  test('parses auth with unlimited (0) duration', () => {
    const result = parseCallbackData('auth:aa:bb:cc:dd:ee:ff:0');
    assert.deepEqual(result, {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 0
    });
  });

  test('parses auth with 3 hours (180)', () => {
    const result = parseCallbackData('auth:AA:BB:CC:DD:EE:FF:180');
    assert.deepEqual(result, {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 180
    });
  });

  test('parses auth with underscore separator auth_<mac>_<duration>', () => {
    const result = parseCallbackData('auth_00:11:22:33:44:55_60');
    assert.deepEqual(result, {
      action: 'auth',
      mac: '00:11:22:33:44:55',
      duration: 60
    });
  });

  test('parses deauth_<mac> terminate button callback correctly', () => {
    const result = parseCallbackData('deauth_00:11:22:33:44:55');
    assert.deepEqual(result, {
      action: 'deauth',
      mac: '00:11:22:33:44:55',
      duration: null
    });
  });

  test('parses deauth:<mac> correctly', () => {
    const result = parseCallbackData('deauth:00:11:22:33:44:55');
    assert.deepEqual(result, {
      action: 'deauth',
      mac: '00:11:22:33:44:55',
      duration: null
    });
  });

  test('rejects invalid or malformed callback data', () => {
    assert.equal(parseCallbackData(''), null);
    assert.equal(parseCallbackData(null), null);
    assert.equal(parseCallbackData('unknown:00:11:22:33:44:55'), null);
    assert.equal(parseCallbackData('auth:invalid-mac:60'), null);
    assert.equal(parseCallbackData('auth:00:11:22:33:44:55:notanumber'), null);
    assert.equal(parseCallbackData('auth:00:11:22:33:44:55:-10'), null);
    assert.equal(parseCallbackData('deauth:invalid-mac'), null);
    assert.equal(parseCallbackData('deauth_invalid-mac'), null);
  });

  test('parses menu callback triggers correctly', () => {
    assert.deepEqual(parseCallbackData('menu_dashboard'), { action: 'menu', command: 'dashboard' });
    assert.deepEqual(parseCallbackData('menu_active'), { action: 'menu', command: 'active' });
    assert.deepEqual(parseCallbackData('menu_previous'), { action: 'menu', command: 'previous' });
    assert.deepEqual(parseCallbackData('menu_history'), { action: 'menu', command: 'previous' });
    assert.deepEqual(parseCallbackData('menu_details'), { action: 'menu', command: 'details' });
    assert.deepEqual(parseCallbackData('menu_users'), { action: 'menu', command: 'details' });
    assert.deepEqual(parseCallbackData('menu_clean'), { action: 'menu', command: 'clean' });
    assert.deepEqual(parseCallbackData('menu_auth'), { action: 'menu', command: 'auth' });
    assert.deepEqual(parseCallbackData('menu_voucher'), { action: 'menu', command: 'voucher' });
    assert.deepEqual(parseCallbackData('menu_speed'), { action: 'menu', command: 'speed' });
    assert.deepEqual(parseCallbackData('speed_menu:aa:bb:cc:dd:ee:ff'), { action: 'speed_menu', mac: 'aa:bb:cc:dd:ee:ff' });
    assert.deepEqual(parseCallbackData('set_speed:aa:bb:cc:dd:ee:ff:5'), { action: 'set_speed', mac: 'aa:bb:cc:dd:ee:ff', mbps: 5 });
    assert.deepEqual(parseCallbackData('gen_voucher:60'), { action: 'gen_voucher', duration: 60 });
    assert.deepEqual(parseCallbackData('gen_voucher:0'), { action: 'gen_voucher', duration: 0 });
    assert.deepEqual(parseCallbackData('menu_reboot'), { action: 'menu', command: 'reboot' });
    assert.deepEqual(parseCallbackData('menu_help'), { action: 'menu', command: 'help' });
    assert.deepEqual(parseCallbackData('menu_rename'), { action: 'menu', command: 'rename' });
    assert.deepEqual(parseCallbackData('rename_prompt:aa:bb:cc:dd:ee:ff'), { action: 'rename_prompt', mac: 'aa:bb:cc:dd:ee:ff' });
    assert.deepEqual(parseCallbackData('reboot_confirm'), { action: 'reboot_confirm' });
  });

  test('parses unlim_sess, unlim_perm, and unlim_back callbacks correctly', () => {
    assert.deepEqual(parseCallbackData('unlim_sess:00:11:22:33:44:55'), {
      action: 'unlim_sess',
      mac: '00:11:22:33:44:55',
      duration: 0,
      mode: 'session'
    });
    assert.deepEqual(parseCallbackData('unlim_perm:00:11:22:33:44:55'), {
      action: 'unlim_perm',
      mac: '00:11:22:33:44:55',
      duration: 0,
      mode: 'permanent'
    });
    assert.deepEqual(parseCallbackData('unlim_back:00:11:22:33:44:55'), {
      action: 'unlim_back',
      mac: '00:11:22:33:44:55',
      duration: null
    });
  });

  test('api/telegram.js correctly aliases parseCallbackData', () => {
    assert.equal(parseCallbackDataTelegram, parseCallbackData);
  });
});

describe('api/webhook.js Custom Duration & Message Parsing', () => {
  const sampleCard = `📶 *New Wi-Fi Access Request*
━━━━━━━━━━━━━━━━━━━━
👤 *User:* Sabbir
🏷 *MAC:* \`aa:bb:cc:dd:ee:ff\`
🌐 *IP:* \`192.168.2.100\`
⏰ *Timestamp:* Oct 14, 2026, 7:00:00 PM (BST)
━━━━━━━━━━━━━━━━━━━━
Select duration below or reply with custom minutes (e.g. 15):`;

  test('normalizes Bengali digits correctly', () => {
    assert.equal(normalizeDigits('১৫ মিনিট'), '15 মিনিট');
    assert.equal(normalizeDigits('০১২৩৪৫৬৭৮৯'), '0123456789');
  });

  test('parses direct commands with MAC and duration', () => {
    assert.deepEqual(parseCustomAuthMessage('/auth aa:bb:cc:dd:ee:ff 45'), {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 45
    });
    assert.deepEqual(parseCustomAuthMessage('/approve AA:BB:CC:DD:EE:FF 120'), {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 120
    });
    assert.deepEqual(parseCustomAuthMessage('/auth aa:bb:cc:dd:ee:ff'), {
      action: 'prompt_duration',
      mac: 'aa:bb:cc:dd:ee:ff'
    });
    assert.deepEqual(parseCustomAuthMessage('aa:bb:cc:dd:ee:ff'), {
      action: 'prompt_duration',
      mac: 'aa:bb:cc:dd:ee:ff'
    });
    assert.deepEqual(parseCustomAuthMessage('mac: AA-BB-CC-DD-EE-FF'), {
      action: 'prompt_duration',
      mac: 'aa:bb:cc:dd:ee:ff'
    });
    assert.deepEqual(parseCustomAuthMessage('/deauth aa:bb:cc:dd:ee:ff'), {
      action: 'deauth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: null
    });
  });

  test('parses parseDurationString across all English and Bengali variations', () => {
    assert.equal(parseDurationString('১ মিনিট'), 1);
    assert.equal(parseDurationString('১মিনিট'), 1);
    assert.equal(parseDurationString('১ মিনিট।'), 1);
    assert.equal(parseDurationString('১ মিনিট.'), 1);
    assert.equal(parseDurationString('১ মিনিট সময়'), 1);
    assert.equal(parseDurationString('১ মিনিট সময়'), 1);
    assert.equal(parseDurationString('১ মিনিটের জন্য'), 1);
    assert.equal(parseDurationString('১ মিনিট এক্সেস'), 1);
    assert.equal(parseDurationString('১মিঃ'), 1);
    assert.equal(parseDurationString('১ মি.'), 1);
    assert.equal(parseDurationString('১'), 1);
    assert.equal(parseDurationString('1'), 1);
    assert.equal(parseDurationString('1m'), 1);
    assert.equal(parseDurationString('1 min'), 1);
    assert.equal(parseDurationString('1 minute'), 1);
    assert.equal(parseDurationString('15'), 15);
    assert.equal(parseDurationString('15m'), 15);
    assert.equal(parseDurationString('15 mins'), 15);
    assert.equal(parseDurationString('15 মিনিট'), 15);
    assert.equal(parseDurationString('1h'), 60);
    assert.equal(parseDurationString('2 hrs'), 120);
    assert.equal(parseDurationString('1.5h'), 90);
    assert.equal(parseDurationString('১ ঘন্টা'), 60);
    assert.equal(parseDurationString('২ ঘণ্টা'), 120);
    assert.equal(parseDurationString('0'), 0);
    assert.equal(parseDurationString('unlimited'), 0);
    assert.equal(parseDurationString('আনলিমিটেড'), 0);
    assert.equal(parseDurationString('reject'), -1);
    assert.equal(parseDurationString('বাতিল'), -1);
    assert.equal(parseDurationString('random text'), null);
  });

  test('parses reply-to-card with custom minutes and suffixes', () => {
    // 1 minute cases
    assert.deepEqual(parseCustomAuthMessage('১ মিনিট', sampleCard), {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 1
    });
    assert.deepEqual(parseCustomAuthMessage('১মিনিট', sampleCard), {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 1
    });
    assert.deepEqual(parseCustomAuthMessage('১ মিনিট।', sampleCard), {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 1
    });

    // Plain numbers and suffixes
    assert.deepEqual(parseCustomAuthMessage('15', sampleCard), {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 15
    });
    assert.deepEqual(parseCustomAuthMessage('10m', sampleCard), {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 10
    });
    assert.deepEqual(parseCustomAuthMessage('20 mins', sampleCard), {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 20
    });
    assert.deepEqual(parseCustomAuthMessage('/auth 25', sampleCard), {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 25
    });
    assert.deepEqual(parseCustomAuthMessage('১৫ মিনিট', sampleCard), {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 15
    });
  });

  test('parses reply-to-card with hours', () => {
    assert.deepEqual(parseCustomAuthMessage('1h', sampleCard), {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 60
    });
    assert.deepEqual(parseCustomAuthMessage('2 hrs', sampleCard), {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 120
    });
    assert.deepEqual(parseCustomAuthMessage('1.5h', sampleCard), {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 90
    });
    assert.deepEqual(parseCustomAuthMessage('১ ঘন্টা', sampleCard), {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 60
    });
  });

  test('parses reply-to-card with unlimited or rejection', () => {
    assert.deepEqual(parseCustomAuthMessage('unlimited', sampleCard), {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 0
    });
    assert.deepEqual(parseCustomAuthMessage('0', sampleCard), {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 0
    });
    assert.deepEqual(parseCustomAuthMessage('আনলিমিটেড', sampleCard), {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 0
    });
    assert.deepEqual(parseCustomAuthMessage('reject', sampleCard), {
      action: 'deauth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: null
    });
    assert.deepEqual(parseCustomAuthMessage('বাতিল', sampleCard), {
      action: 'deauth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: null
    });
  });

  test('parses reply-to-card with permanent or session keywords', () => {
    assert.deepEqual(parseCustomAuthMessage('স্থায়ী', sampleCard), {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 0,
      mode: 'permanent'
    });
    assert.deepEqual(parseCustomAuthMessage('স্থায়ী', sampleCard), {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 0,
      mode: 'permanent'
    });
    assert.deepEqual(parseCustomAuthMessage('permanent', sampleCard), {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 0,
      mode: 'permanent'
    });
    assert.deepEqual(parseCustomAuthMessage('এককালীন', sampleCard), {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 0,
      mode: 'session'
    });
    assert.deepEqual(parseCustomAuthMessage('session', sampleCard), {
      action: 'auth',
      mac: 'aa:bb:cc:dd:ee:ff',
      duration: 0,
      mode: 'session'
    });
  });

  test('handles duration messages without reply or without MAC in reply', () => {
    // When reply has no MAC or when reply is omitted, mac is null (for auto-resolution in handler)
    assert.deepEqual(parseCustomAuthMessage('15', 'No MAC address in this message'), {
      action: 'auth',
      mac: null,
      duration: 15
    });
    assert.deepEqual(parseCustomAuthMessage('১ মিনিট', null), {
      action: 'auth',
      mac: null,
      duration: 1
    });
    assert.deepEqual(parseCustomAuthMessage('reject', null), {
      action: 'deauth',
      mac: null,
      duration: null
    });
  });

  test('returns null when text is not a duration or command', () => {
    assert.equal(parseCustomAuthMessage('hello world', sampleCard), null);
    assert.equal(parseCustomAuthMessage('', sampleCard), null);
    assert.equal(parseCustomAuthMessage(null, sampleCard), null);
  });
});

describe('api/poll.js Security Helpers', () => {
  test('timingSafeCompare correctly compares equal and unequal strings', () => {
    assert.equal(timingSafeCompare('secret-key-123', 'secret-key-123'), true);
    assert.equal(timingSafeCompare('secret-key-123', 'secret-key-456'), false);
    assert.equal(timingSafeCompare('secret-key-123', 'short'), false);
    assert.equal(timingSafeCompare('', 'secret'), false);
    assert.equal(timingSafeCompare(null, 'secret'), false);
  });
});

describe('api/admin.js Security & Authentication', () => {
  test('checkAdminAuth authenticates Bearer token correctly', () => {
    const req = { headers: { authorization: 'Bearer my-secret-pass' } };
    assert.equal(checkAdminAuth(req, 'my-secret-pass'), true);
    assert.equal(checkAdminAuth(req, 'wrong-pass'), false);
  });

  test('checkAdminAuth authenticates x-admin-password header', () => {
    const req = { headers: { 'x-admin-password': 'custom-header-secret' } };
    assert.equal(checkAdminAuth(req, 'custom-header-secret'), true);
    assert.equal(checkAdminAuth(req, 'wrong-secret'), false);
  });

  test('checkAdminAuth authenticates query parameter', () => {
    const req = { url: '/api/admin?password=query-secret-123', headers: {} };
    assert.equal(checkAdminAuth(req, 'query-secret-123'), true);
    assert.equal(checkAdminAuth(req, 'another-secret'), false);
  });

  test('checkAdminAuth rejects missing or empty credentials', () => {
    assert.equal(checkAdminAuth({ headers: {} }, 'my-pass'), false);
    assert.equal(checkAdminAuth({ headers: { authorization: '' } }, 'my-pass'), false);
    assert.equal(checkAdminAuth(null, 'my-pass'), false);
    assert.equal(checkAdminAuth({ headers: {} }, ''), false);
  });
});

describe('lib/opennds.js FAS Token Parsing', () => {
  test('parses standard base64 FAS token with MAC, IP, and gateway correctly', () => {
    const rawPayload = 'clientmac=b6:30:f7:f7:11:60, clientip=192.168.2.223, gatewayaddress=192.168.2.1:2050, gatewayname=openNDS-Home';
    const base64Token = Buffer.from(rawPayload).toString('base64');

    const result = parseFasToken(base64Token);
    assert.equal(result.clientMac, 'b6:30:f7:f7:11:60');
    assert.equal(result.clientIp, '192.168.2.223');
    assert.equal(result.gatewayAddress, '192.168.2.1');
  });

  test('normalizes uppercase MAC and hyphenated MAC to lowercase colon format', () => {
    const rawPayload = 'clientmac=AA-BB-CC-DD-EE-FF, clientip=10.0.0.15';
    const base64Token = Buffer.from(rawPayload).toString('base64');

    const result = parseFasToken(base64Token);
    assert.equal(result.clientMac, 'aa:bb:cc:dd:ee:ff');
    assert.equal(result.clientIp, '10.0.0.15');
    assert.equal(result.gatewayAddress, null);
  });

  test('decodes URL-encoded base64 FAS token properly', () => {
    const rawPayload = 'clientmac=00:11:22:33:44:55, clientip=192.168.1.50, gatewayaddress=192.168.1.1';
    const base64Token = Buffer.from(rawPayload).toString('base64');
    const urlEncoded = encodeURIComponent(base64Token);

    const result = parseFasToken(urlEncoded);
    assert.equal(result.clientMac, '00:11:22:33:44:55');
    assert.equal(result.clientIp, '192.168.1.50');
    assert.equal(result.gatewayAddress, '192.168.1.1');
  });

  test('safely handles empty, invalid, or non-base64 input', () => {
    assert.deepEqual(parseFasToken(''), { clientMac: null, clientIp: null, gatewayAddress: null });
    assert.deepEqual(parseFasToken(null), { clientMac: null, clientIp: null, gatewayAddress: null });
    assert.deepEqual(parseFasToken(undefined), { clientMac: null, clientIp: null, gatewayAddress: null });
    assert.deepEqual(parseFasToken('not_valid_base64_data_!!!'), { clientMac: null, clientIp: null, gatewayAddress: null });
  });
});

describe('lib/bot-menu.js Helpers & Formatters', () => {
  test('formatDateTime formats valid date in Asia/Dhaka BST and handles missing/invalid gracefully', () => {
    const fixed = '2026-10-13T12:30:00.000Z';
    const result = formatDateTime(fixed);
    assert.equal(result.date, '13 Oct 2026');
    assert.match(result.time, /06:30:00 PM BST/);

    // Can also format in explicit timezone if requested
    const utcResult = formatDateTime(fixed, 'UTC');
    assert.match(utcResult.time, /12:30:00/);

    const empty = formatDateTime(null);
    assert.equal(empty.date, 'N/A');
    assert.equal(empty.time, 'N/A');

    const invalid = formatDateTime('invalid-date-string');
    assert.equal(invalid.date, 'N/A');
    assert.equal(invalid.time, 'N/A');
  });

  test('isUserActive identifies active, unlimited, and expired users', () => {
    // Unlimited active
    assert.equal(isUserActive({ status: 'authorized', duration: 0 }), true);
    assert.equal(isUserActive({ status: 'AUTHENTICATED', duration: 0 }), true);

    // Active within duration (5 mins ago, 60m duration)
    const recentIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    assert.equal(isUserActive({ status: 'authorized', duration: 60, reviewedAt: recentIso }), true);

    // Expired (120 mins ago, 60m duration)
    const expiredIso = new Date(Date.now() - 120 * 60 * 1000).toISOString();
    assert.equal(isUserActive({ status: 'authorized', duration: 60, reviewedAt: expiredIso }), false);

    // Terminated or pending
    assert.equal(isUserActive({ status: 'terminated' }), false);
    assert.equal(isUserActive({ status: 'pending' }), false);
  });

  test('isUserTerminated detects terminated and rejected statuses', () => {
    assert.equal(isUserTerminated({ status: 'terminated' }), true);
    assert.equal(isUserTerminated({ status: 'rejected' }), true);
    assert.equal(isUserTerminated({ status: 'authorized' }), false);
    assert.equal(isUserTerminated({ status: 'pending' }), false);
  });

  test('formatUserDetailsCard outputs specific layout requested by user', () => {
    const user = {
      name: 'সাকিব আল হাসান',
      mac: '4a:8b:9c:1d:2e:3f',
      ip: '192.168.1.105',
      requestedAt: '2026-10-13T10:00:00.000Z'
    };

    const card = formatUserDetailsCard(user);

    // User specification:
    // 1. নাম (Name)
    // 2. ডেট (Date)
    // 3. ম্যাক অ্যাড্রেস (MAC address)
    // 4. আইপি অ্যাড্রেস (IP address)
    // 5. টাইমস্ট্যাম্প (Timestamp)
    assert.match(card, /👤 \*নাম:\* সাকিব আল হাসান/);
    assert.match(card, /📅 \*তারিখ:\* 13 Oct 2026/);
    assert.match(card, /🏷 \*ম্যাক অ্যাড্রেস:\* `4a:8b:9c:1d:2e:3f`/);
    assert.match(card, /🌐 \*আইপি অ্যাড্রেস:\* `192\.168\.1\.105`/);
    assert.match(card, /⏰ \*টাইমস্ট্যাম্প:\*/);
  });

  test('formatDashboardMessage strictly omits terminated users and displays active only', () => {
    const activeUsers = [
      { name: 'রহিম', mac: 'aa:bb:cc:dd:ee:ff', duration: 60 },
      { name: 'করিম', mac: '11:22:33:44:55:66', duration: 0 }
    ];

    const dashboard = formatDashboardMessage(activeUsers, 2);

    assert.match(dashboard, /সক্রিয় নেটওয়ার্ক ইউজার/);
    assert.match(dashboard, /মোট কানেক্টেড ইউজার:\* 2 জন/);
    assert.match(dashboard, /পেন্ডিং কিউ:\* 2 টি/);
    assert.match(dashboard, /রহিম/);
    assert.match(dashboard, /করিম/);
  });

  test('buildActiveUsersKeyboard generates inline disconnect buttons for each active user', () => {
    const activeUsers = [
      { name: 'Sabbir', mac: 'aa:bb:cc:dd:ee:01' },
      { name: 'LongNamePersonExtremelyLong', mac: 'aa:bb:cc:dd:ee:02' }
    ];

    const markup = buildActiveUsersKeyboard(activeUsers);
    assert.ok(markup && markup.inline_keyboard);
    assert.equal(markup.inline_keyboard.length, 2);
    assert.match(markup.inline_keyboard[0][0].text, /❌ সংযোগ বিচ্ছিন্ন: Sabbir/);
    assert.equal(markup.inline_keyboard[0][0].callback_data, 'deauth_aa:bb:cc:dd:ee:01');
    assert.equal(markup.inline_keyboard[1][0].callback_data, 'deauth_aa:bb:cc:dd:ee:02');

    assert.equal(buildActiveUsersKeyboard([]), null);
    assert.equal(buildActiveUsersKeyboard(null), null);
  });

  test('TELEGRAM_MENU_KEYBOARD includes direct MAC auth option, guest voucher and persistent settings', () => {
    assert.equal(TELEGRAM_MENU_KEYBOARD.is_persistent, true);
    assert.equal(TELEGRAM_MENU_KEYBOARD.resize_keyboard, true);
    assert.equal(TELEGRAM_MENU_KEYBOARD.keyboard.length, 5);
    assert.equal(TELEGRAM_MENU_KEYBOARD.keyboard[0].length, 2);
    assert.equal(TELEGRAM_MENU_KEYBOARD.keyboard[1].length, 2);
    assert.equal(TELEGRAM_MENU_KEYBOARD.keyboard[2].length, 2);
    assert.equal(TELEGRAM_MENU_KEYBOARD.keyboard[3].length, 2);
    assert.equal(TELEGRAM_MENU_KEYBOARD.keyboard[4].length, 2);
    // Verifies MAC authorize, guest voucher, reboot and help buttons are present
    const allButtons = TELEGRAM_MENU_KEYBOARD.keyboard.flat().map(b => b.text);
    assert.ok(allButtons.includes('➕ ম্যাক অথোরাইজ'));
    assert.ok(allButtons.includes('🎟️ গেস্ট ভাউচার'));
    assert.ok(allButtons.includes('⚡ স্পিড লিমিট'));
    assert.ok(allButtons.includes('📊 নেটওয়ার্ক রিপোর্ট'));
    assert.ok(!allButtons.some(b => b.includes('ড্যাশবোর্ড')));
    assert.ok(allButtons.includes('🟢 অ্যাক্টিভ ইউজার'));
    assert.ok(allButtons.includes('🧹 ক্লিন চ্যাট ও ডাটা'));
    assert.ok(allButtons.includes('🔄 রাউটার রিবুট'));
    assert.ok(allButtons.includes('❓ হেল্প গাইড'));

    assert.equal(TELEGRAM_INLINE_MENU.inline_keyboard.length, 5);
    assert.equal(TELEGRAM_INLINE_MENU.inline_keyboard[4][0].callback_data, 'menu_reboot');
    assert.equal(TELEGRAM_INLINE_MENU.inline_keyboard[4][1].callback_data, 'menu_help');
  });

  test('formatActiveUsersList formats count and details for active users', () => {
    const activeUsers = [
      { name: 'তানভীর', mac: 'bb:cc:dd:ee:ff:00', duration: 30, ip: '192.168.1.55' }
    ];
    const list = formatActiveUsersList(activeUsers);
    assert.match(list, /মোট কানেক্টেড ইউজার:\* 1 জন/);
    assert.match(list, /তানভীর/);
    assert.match(list, /30m/);

    const emptyList = formatActiveUsersList([]);
    assert.match(emptyList, /বর্তমানে কোনো ইউজার অ্যাক্টিভ বা কানেক্টেড নেই/);
  });

  test('formatPreviousUsersList formats previous session list', () => {
    const previous = [
      { name: 'আলিফ', mac: 'cc:dd:ee:ff:00:11', status: 'terminated' }
    ];
    const list = formatPreviousUsersList(previous);
    assert.match(list, /মোট পূর্ববর্তী ইউজার:\* 1 জন/);
    assert.match(list, /আলিফ/);
    assert.match(list, /Terminated/);

    const empty = formatPreviousUsersList([]);
    assert.match(empty, /কোনো পূর্ববর্তী ইউজারের হিস্ট্রি পাওয়া যায়নি/);
  });

  test('normalizeCommandText maps English and Bengali command strings', () => {
    assert.equal(normalizeCommandText('/start'), 'menu');
    assert.equal(normalizeCommandText('menu'), 'menu');
    assert.equal(normalizeCommandText('মেনু'), 'menu');
    assert.equal(normalizeCommandText('/dashboard'), 'active');
    assert.equal(normalizeCommandText('📊 ড্যাশবোর্ড'), 'active');
    assert.equal(normalizeCommandText('/active'), 'active');
    assert.equal(normalizeCommandText('🟢 অ্যাক্টিভ ইউজার'), 'active');
    assert.equal(normalizeCommandText('/previous'), 'previous');
    assert.equal(normalizeCommandText('👥 প্রিভিয়াস ইউজার'), 'previous');
    assert.equal(normalizeCommandText('👥 পূর্ববর্তী ইউজার'), 'previous');
    assert.equal(normalizeCommandText('/history'), 'previous');
    assert.equal(normalizeCommandText('/details'), 'details');
    assert.equal(normalizeCommandText('📋 ইউজার ডিটেইলস'), 'details');
    assert.equal(normalizeCommandText('/clean'), 'clean');
    assert.equal(normalizeCommandText('🧹 ক্লিন চ্যাট ও ডাটা'), 'clean');
    assert.equal(normalizeCommandText('🧹 ক্লিন ড্যাশবোর্ড'), 'clean');
    assert.equal(normalizeCommandText('/auth'), 'auth');
    assert.equal(normalizeCommandText('➕ ম্যাক অথোরাইজ'), 'auth');
    assert.equal(normalizeCommandText('ম্যাক অথোরাইজ'), 'auth');
    assert.equal(normalizeCommandText('/voucher'), 'voucher');
    assert.equal(normalizeCommandText('🎟️ গেস্ট ভাউচার'), 'voucher');
    assert.equal(normalizeCommandText('ভাউচার'), 'voucher');
    assert.equal(normalizeCommandText('/limit'), 'speed');
    assert.equal(normalizeCommandText('⚡ স্পিড লিমিট'), 'speed');
    assert.equal(normalizeCommandText('স্পিড লিমিট'), 'speed');
    assert.equal(normalizeCommandText('/report'), 'report');
    assert.equal(normalizeCommandText('রিপোর্ট'), 'report');
    assert.equal(normalizeCommandText('/reboot'), 'reboot');
    assert.equal(normalizeCommandText('🔄 রাউটার রিবুট'), 'reboot');
    assert.equal(normalizeCommandText('রাউটার রিবুট'), 'reboot');
    assert.equal(normalizeCommandText('/help'), 'help');
    assert.equal(normalizeCommandText('❓ হেল্প গাইড'), 'help');
    assert.equal(normalizeCommandText('হেল্প গাইড'), 'help');
    assert.equal(normalizeCommandText('/rename'), 'rename');
    assert.equal(normalizeCommandText('🏷️ ডিভাইস রিনেম'), 'rename');
    assert.equal(normalizeCommandText('something-else'), null);
  });

  test('deleteTelegramMessages handles empty or invalid input safely', async () => {
    assert.equal(await deleteTelegramMessages(null, 123, [1, 2]), 0);
    assert.equal(await deleteTelegramMessages('token', null, [1, 2]), 0);
    assert.equal(await deleteTelegramMessages('token', 123, []), 0);
    assert.equal(await deleteTelegramMessages('token', 123, [-5, 'bad']), 0);
  });

  test('deleteTelegramMessages executes bulk deleteMessages and fallback deleteMessage', async () => {
    const fetchCalls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      fetchCalls.push({ url: String(url), opts });
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      const count = await deleteTelegramMessages('bot-token', 12345, [101, 102, 103]);
      assert.equal(count, 3);
      assert.ok(fetchCalls.some(c => c.url.includes('deleteMessages')));
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('clearChatHistory collects tracked IDs and range sweep to delete messages', async () => {
    const fetchCalls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      fetchCalls.push({ url: String(url), opts });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const mockRedis = {
      lrange: async () => ['10', '20'],
      del: async () => 1
    };

    try {
      const deleted = await clearChatHistory(mockRedis, 'bot-token', 12345, 50);
      assert.ok(deleted > 0);
      assert.ok(fetchCalls.length > 0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('formatDisconnectCard formats detailed card with name, mac, times, duration, and Bengali reason', () => {
    const user = {
      name: 'Rahim Uddin',
      mac: '46:84:b7:da:39:73',
      ip: '192.168.2.155',
      requestedAt: '2026-10-14T12:00:00.000Z'
    };
    const disconnectInfo = {
      mac: '46:84:b7:da:39:73',
      reason: 'timeout_deauth',
      session_start: '2026-10-14T12:00:00.000Z',
      session_end: '2026-10-14T12:30:00.000Z',
      ip: '192.168.2.155'
    };

    const card = formatDisconnectCard(user, disconnectInfo);
    assert.ok(card.includes('🔴 *Wi-Fi Device Disconnected*'));
    assert.ok(card.includes('Rahim Uddin'));
    assert.ok(card.includes('46:84:b7:da:39:73'));
    assert.ok(card.includes('192.168.2.155'));
    assert.ok(card.includes('30 মিনিট'));
    assert.ok(card.includes('⏱ মেয়াদ শেষ (Session Timeout)'));
  });

  test('formatDisconnectCard formats hours and idle timeout reason safely', () => {
    const user = null;
    const disconnectInfo = {
      mac: 'AA:BB:CC:DD:EE:FF',
      reason: 'idle_deauth',
      session_start: '2026-10-14T10:00:00.000Z',
      session_end: '2026-10-14T11:15:00.000Z'
    };

    const card = formatDisconnectCard(user, disconnectInfo);
    assert.ok(card.includes('Guest User'));
    assert.ok(card.includes('aa:bb:cc:dd:ee:ff'));
    assert.ok(card.includes('1 ঘণ্টা 15 মিনিট'));
    assert.ok(card.includes('💤 নিষ্ক্রিয়তা (Idle Timeout)'));
  });

  test('buildUnlimitedKeyboard and buildDefaultAuthKeyboard return valid inline keyboard arrays', () => {
    const unlimKb = buildUnlimitedKeyboard('AA:BB:CC:DD:EE:FF');
    assert.equal(unlimKb.length, 3);
    assert.equal(unlimKb[0][0].callback_data, 'unlim_sess:aa:bb:cc:dd:ee:ff');
    assert.equal(unlimKb[1][0].callback_data, 'unlim_perm:aa:bb:cc:dd:ee:ff');
    assert.equal(unlimKb[2][0].callback_data, 'unlim_back:aa:bb:cc:dd:ee:ff');

    const defaultKb = buildDefaultAuthKeyboard('AA:BB:CC:DD:EE:FF');
    assert.equal(defaultKb.length, 3);
    assert.equal(defaultKb[0][0].callback_data, 'auth:aa:bb:cc:dd:ee:ff:10');
    assert.equal(defaultKb[2][0].callback_data, 'auth:aa:bb:cc:dd:ee:ff:0');
    assert.equal(defaultKb[2][1].callback_data, 'deauth_aa:bb:cc:dd:ee:ff');
  });

  test('buildUnlimitedKeyboard strictly contains NO Chinese characters (永久) and uses 🛡️', () => {
    const kb = buildUnlimitedKeyboard('00:11:22:33:44:55');
    const permButton = kb.find(row => row[0].callback_data.startsWith('unlim_perm:'))[0];
    assert.ok(permButton.text.includes('🛡️'));
    assert.ok(!permButton.text.includes('永久'));
  });

  test('formatSingleActiveUserCard formats detailed card for an individual active user', () => {
    const user = {
      name: 'Tanvir Hossain',
      mac: '46:84:b7:da:39:73',
      ip: '192.168.2.229',
      duration: 30,
      reviewedAt: '2026-10-14T12:00:00.000Z'
    };

    const card = formatSingleActiveUserCard(user);
    assert.ok(card.includes('👤 *ইউজার:* Tanvir Hossain'));
    assert.ok(card.includes('46:84:b7:da:39:73'));
    assert.ok(card.includes('192.168.2.229'));
    assert.ok(card.includes('⏳ 30 মিনিট'));
    assert.ok(card.includes('_সংযোগ বিচ্ছিন্ন করতে নিচের বাটনে চাপ দিন:_'));
    assert.ok(!card.includes('永久'));

    // Permanent user
    const permUser = {
      name: 'Permanent User',
      mac: '06:31:5b:7a:aa:e7',
      ip: '192.168.2.147',
      duration: 0,
      mode: 'permanent'
    };
    const permCard = formatSingleActiveUserCard(permUser);
    assert.ok(permCard.includes('🛡️ স্থায়ী বিশ্বস্ত (Permanent)'));
    assert.ok(!permCard.includes('永久'));

    // Empty user
    assert.equal(formatSingleActiveUserCard(null), '');
  });

  test('buildSingleUserDeauthKeyboard generates disconnect and speed limit buttons for target user', () => {
    const kb = buildSingleUserDeauthKeyboard('46:84:b7:da:39:73');
    assert.ok(kb && kb.inline_keyboard);
    assert.equal(kb.inline_keyboard.length, 2);
    assert.equal(kb.inline_keyboard[0].length, 2);
    assert.equal(kb.inline_keyboard[0][0].text, '❌ সংযোগ বিচ্ছিন্ন করুন');
    assert.equal(kb.inline_keyboard[0][0].callback_data, 'deauth_46:84:b7:da:39:73');
    assert.equal(kb.inline_keyboard[0][1].text, '⚡ স্পিড লিমিট');
    assert.equal(kb.inline_keyboard[0][1].callback_data, 'speed_menu:46:84:b7:da:39:73');
    assert.equal(kb.inline_keyboard[1].length, 1);
    assert.equal(kb.inline_keyboard[1][0].text, '🏷️ নাম পরিবর্তন');
    assert.equal(kb.inline_keyboard[1][0].callback_data, 'rename_prompt:46:84:b7:da:39:73');
  });

  test('buildRebootConfirmKeyboard returns valid confirm and cancel buttons', () => {
    const kb = buildRebootConfirmKeyboard();
    assert.ok(Array.isArray(kb));
    assert.equal(kb.length, 2);
    assert.equal(kb[0][0].callback_data, 'reboot_confirm');
    assert.equal(kb[1][0].callback_data, 'menu_back');
  });

  test('buildSpeedLimitKeyboard generates preset speed options and full speed option', () => {
    const kb = buildSpeedLimitKeyboard('46:84:b7:da:39:73');
    assert.ok(Array.isArray(kb));
    assert.equal(kb.length, 4);
    assert.equal(kb[0][0].callback_data, 'set_speed:46:84:b7:da:39:73:1');
    assert.equal(kb[0][1].callback_data, 'set_speed:46:84:b7:da:39:73:2');
    assert.equal(kb[1][0].callback_data, 'set_speed:46:84:b7:da:39:73:5');
    assert.equal(kb[1][1].callback_data, 'set_speed:46:84:b7:da:39:73:10');
    assert.equal(kb[2][0].callback_data, 'set_speed:46:84:b7:da:39:73:0');
    assert.equal(kb[3][0].callback_data, 'menu_back');
  });

  test('buildSpeedUsersKeyboard generates selectable user buttons for speed limits', () => {
    const activeUsers = [
      { name: 'Sabbir Phone', mac: '46:84:b7:da:39:73' },
      { name: 'Laptop', mac: '06:31:5b:7a:aa:e7' }
    ];
    const kb = buildSpeedUsersKeyboard(activeUsers);
    assert.ok(kb && kb.inline_keyboard);
    assert.equal(kb.inline_keyboard.length, 3);
    assert.equal(kb.inline_keyboard[0][0].callback_data, 'speed_menu:46:84:b7:da:39:73');
    assert.equal(kb.inline_keyboard[1][0].callback_data, 'speed_menu:06:31:5b:7a:aa:e7');
    assert.equal(kb.inline_keyboard[2][0].callback_data, 'menu_back');
  });

  test('deleteTelegramMessage safely deletes message and handles errors', async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = null;
    let requestPayload = null;

    globalThis.fetch = async (url, opts) => {
      requestedUrl = String(url);
      requestPayload = JSON.parse(opts.body);
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      const res = await deleteTelegramMessage('test-token', 12345, 999);
      assert.equal(res, true);
      assert.ok(requestedUrl.includes('deleteMessage'));
      assert.equal(requestPayload.chat_id, 12345);
      assert.equal(requestPayload.message_id, 999);

      // Handles null inputs safely
      assert.equal(await deleteTelegramMessage(null, 123, 456), false);
      assert.equal(await deleteTelegramMessage('token', null, 456), false);
      assert.equal(await deleteTelegramMessage('token', 123, null), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('lib/telegram/alias.js Device Nickname & Alias Management', () => {
  function createMockRedis() {
    const store = new Map();
    const hashes = new Map();
    return {
      async get(key) { return store.has(key) ? store.get(key) : null; },
      async set(key, val) { store.set(key, val); return 'OK'; },
      async hgetall(key) { return hashes.get(key) || {}; },
      async hset(key, obj) {
        const cur = hashes.get(key) || {};
        hashes.set(key, { ...cur, ...obj });
        return 1;
      }
    };
  }

  test('saveDeviceAlias saves alias to Redis and updates existing request record', async () => {
    const redis = createMockRedis();
    await redis.hset('request:aa:bb:cc:dd:ee:ff', { status: 'authorized', name: 'Old Name' });

    const success = await saveDeviceAlias(redis, 'AA:BB:CC:DD:EE:FF', 'Tanvir (iPhone 14)');
    assert.equal(success, true);

    const saved = await getDeviceAlias(redis, 'aa:bb:cc:dd:ee:ff');
    assert.equal(saved, 'Tanvir (iPhone 14)');

    const updatedHash = await redis.hgetall('request:aa:bb:cc:dd:ee:ff');
    assert.equal(updatedHash.name, 'Tanvir (iPhone 14)');
  });

  test('saveDeviceAlias safely rejects null inputs and invalid MAC addresses', async () => {
    const redis = createMockRedis();
    assert.equal(await saveDeviceAlias(null, 'aa:bb:cc:dd:ee:ff', 'Test'), false);
    assert.equal(await saveDeviceAlias(redis, null, 'Test'), false);
    assert.equal(await saveDeviceAlias(redis, 'invalid-mac', 'Test'), false);
    assert.equal(await saveDeviceAlias(redis, 'aa:bb:cc:dd:ee:ff', ''), false);
    assert.equal(await getDeviceAlias(redis, 'invalid-mac'), null);
  });

  test('parseRenameCommand parses direct commands in English and Bengali', () => {
    const res1 = parseRenameCommand('/rename 46:84:b7:da:39:73 Rahim Laptop');
    assert.deepEqual(res1, { mac: '46:84:b7:da:39:73', alias: 'Rahim Laptop' });

    const res2 = parseRenameCommand('/alias 46-84-B7-DA-39-73 Smart TV');
    assert.deepEqual(res2, { mac: '46:84:b7:da:39:73', alias: 'Smart TV' });

    const res3 = parseRenameCommand('নাম 46:84:b7:da:39:73 তানভীর ভাই');
    assert.deepEqual(res3, { mac: '46:84:b7:da:39:73', alias: 'তানভীর ভাই' });
  });

  test('parseRenameCommand parses reply-to card messages', () => {
    const replyText = '👤 *User:* Guest User\n🏷 *MAC:* `46:84:b7:da:39:73`\n⏰ *Timestamp:* 10:30 AM';
    const res = parseRenameCommand('নাম: শফিক ভাই', replyText);
    assert.deepEqual(res, { mac: '46:84:b7:da:39:73', alias: 'শফিক ভাই' });

    const res2 = parseRenameCommand('/name Android TV', replyText);
    assert.deepEqual(res2, { mac: '46:84:b7:da:39:73', alias: 'Android TV' });

    assert.equal(parseRenameCommand('হ্যালো', replyText), null);
    assert.equal(parseRenameCommand('/rename 123', null), null);
  });

  test('formatAliasSuccessMessage formats confirmation message', () => {
    const msg = formatAliasSuccessMessage('46:84:b7:da:39:73', 'তানভীর ভাই');
    assert.ok(msg.includes('46:84:b7:da:39:73'));
    assert.ok(msg.includes('তানভীর ভাই'));
  });
});

describe('lib/voucher.js Guest Voucher & Passcode Management', () => {
  function createMockRedis() {
    const hashes = new Map();
    const sets = new Map();
    const lists = new Map();
    return {
      async hset(key, obj) {
        const cur = hashes.get(key) || {};
        hashes.set(key, { ...cur, ...obj });
        return 1;
      },
      async hgetall(key) { return hashes.get(key) || {}; },
      async expire() { return 1; },
      async sadd(key, ...members) {
        const s = sets.get(key) || new Set();
        members.forEach(m => s.add(m));
        sets.set(key, s);
        return members.length;
      },
      async srem(key, ...members) {
        const s = sets.get(key) || new Set();
        members.forEach(m => s.delete(m));
        return 1;
      },
      async smembers(key) {
        const s = sets.get(key) || new Set();
        return Array.from(s);
      },
      async rpush(key, ...vals) {
        const l = lists.get(key) || [];
        l.push(...vals);
        lists.set(key, l);
        return l.length;
      },
      _hashes: hashes,
      _lists: lists
    };
  }

  test('generateVoucherCode returns formatted voucher code with custom prefix', () => {
    const code1 = generateVoucherCode('PASS');
    assert.match(code1, /^PASS-[2-9A-Z]{4}$/);

    const code2 = generateVoucherCode('GUEST');
    assert.match(code2, /^GUEST-[2-9A-Z]{4}$/);
  });

  test('createVoucher stores voucher in Redis and adds to active_vouchers set', async () => {
    const redis = createMockRedis();
    const v = await createVoucher(redis, 60, 'AdminUser', 'Guest of honor');

    assert.ok(v.code);
    assert.equal(v.duration, 60);
    assert.equal(v.createdBy, 'AdminUser');
    assert.equal(v.redeemed, 'false');

    const stored = await redis.hgetall(`voucher:${v.code}`);
    assert.equal(stored.code, v.code);

    const activeList = await listActiveVouchers(redis);
    assert.equal(activeList.length, 1);
    assert.equal(activeList[0].code, v.code);
  });

  test('redeemVoucher successfully redeems voucher and enqueues router auth command', async () => {
    const redis = createMockRedis();
    const v = await createVoucher(redis, 90, 'Admin');

    const res = await redeemVoucher(redis, v.code, '46:84:b7:da:39:73', '192.168.1.150', 'Kamal');
    assert.equal(res.ok, true);
    assert.equal(res.duration, 90);
    assert.equal(res.mac, '46:84:b7:da:39:73');
    assert.equal(res.commandQueued, 'ndsctl auth 46:84:b7:da:39:73 90');

    // Verify command was pushed to pending_commands
    const cmds = redis._lists.get('pending_commands');
    assert.ok(cmds && cmds.includes('ndsctl auth 46:84:b7:da:39:73 90'));

    // Verify voucher marked redeemed
    const after = await redis.hgetall(`voucher:${v.code}`);
    assert.equal(after.redeemed, 'true');
    assert.equal(after.redeemedByMac, '46:84:b7:da:39:73');

    // Double redemption attempt should fail
    const res2 = await redeemVoucher(redis, v.code, '00:11:22:33:44:55');
    assert.equal(res2.ok, false);
    assert.ok(res2.error.includes('ইতিমধ্যে ব্যবহার করা হয়েছে'));
  });

  test('redeemVoucher rejects invalid code and invalid MAC', async () => {
    const redis = createMockRedis();
    const res1 = await redeemVoucher(redis, 'NON-EXIST', '46:84:b7:da:39:73');
    assert.equal(res1.ok, false);

    const res2 = await redeemVoucher(redis, 'SOME-CODE', 'invalid-mac');
    assert.equal(res2.ok, false);
  });

  test('formatVoucherCreatedCard and formatVoucherRedeemedNotice format cards accurately', () => {
    const card = formatVoucherCreatedCard({ code: 'PASS-9821', duration: 120 });
    assert.ok(card.includes('PASS-9821'));
    assert.ok(card.includes('120 মিনিট'));

    const cardUnlim = formatVoucherCreatedCard({ code: 'PASS-0000', duration: 0 });
    assert.ok(cardUnlim.includes('আনলিমিটেড'));

    const notice = formatVoucherRedeemedNotice('PASS-9821', '46:84:b7:da:39:73', 120, 'Kamal');
    assert.ok(notice.includes('Kamal'));
    assert.ok(notice.includes('46:84:b7:da:39:73'));
    assert.ok(notice.includes('PASS-9821'));
  });
});

describe('lib/telegram/extended-commands.js Extended Commands Dispatcher', () => {
  function createMockRedis() {
    const store = new Map();
    const hashes = new Map();
    const lists = new Map();
    const sets = new Map();
    return {
      async get(key) { return store.has(key) ? store.get(key) : null; },
      async set(key, val) { store.set(key, val); return 'OK'; },
      async del(key) { store.delete(key); return 1; },
      async hset(key, obj) {
        const cur = hashes.get(key) || {};
        hashes.set(key, { ...cur, ...obj });
        return 1;
      },
      async hgetall(key) { return hashes.get(key) || {}; },
      async expire() { return 1; },
      async sadd(key, ...m) {
        const s = sets.get(key) || new Set();
        m.forEach(x => s.add(x));
        sets.set(key, s);
        return m.length;
      },
      async srem(key, ...m) {
        const s = sets.get(key) || new Set();
        m.forEach(x => s.delete(x));
        return 1;
      },
      async smembers(key) {
        const s = sets.get(key) || new Set();
        return Array.from(s);
      },
      async rpush(key, ...vals) {
        const l = lists.get(key) || [];
        l.push(...vals);
        lists.set(key, l);
        return l.length;
      },
      async lrange(key) { return lists.get(key) || []; },
      _store: store,
      _lists: lists
    };
  }

  test('handles /rename command and stores alias', async () => {
    const redis = createMockRedis();
    const msg = { text: '/rename 46:84:b7:da:39:73 MyLaptop' };
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result: { message_id: 101 } }));

    try {
      const res = await handleExtendedCommand(msg, redis, 'mock-token', 12345);
      assert.equal(res.handled, true);
      assert.equal(res.data.alias, 'MyLaptop');

      const saved = await redis.get('device_alias:46:84:b7:da:39:73');
      assert.equal(saved, 'MyLaptop');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('handles /voucher command and returns created voucher', async () => {
    const redis = createMockRedis();
    const msg = { text: '/voucher 180', from: { first_name: 'SuperAdmin' } };
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result: { message_id: 102 } }));

    try {
      const res = await handleExtendedCommand(msg, redis, 'mock-token', 12345);
      assert.equal(res.handled, true);
      assert.equal(res.data.action, 'voucher_created');
      assert.equal(res.data.voucher.duration, 180);
      assert.equal(res.data.voucher.createdBy, 'SuperAdmin');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('handles /limit command and queues bandwidth restriction on router', async () => {
    const redis = createMockRedis();
    const msg = { text: '/limit 46:84:b7:da:39:73 5' };
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result: { message_id: 103 } }));

    try {
      const res = await handleExtendedCommand(msg, redis, 'mock-token', 12345);
      assert.equal(res.handled, true);
      assert.equal(res.data.action, 'client_limit_set');
      assert.equal(res.data.mbps, 5);

      const queuedCmds = redis._lists.get('pending_commands');
      assert.ok(queuedCmds.some(c => c.includes("uci set archer_guard.limit_4684b7da3973.mbps='5'")));
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('handles /report command and generates network summary card', async () => {
    const redis = createMockRedis();
    await redis.set('router:latest_status', JSON.stringify({
      traffic: { current_download_mbps: '24.5', current_upload_mbps: '8.2' },
      cpu: { usage_percent: '14', temperature_c: '46', uptime_seconds: 90000 }
    }));

    const msg = { text: '/report' };
    let sentText = '';
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const body = opts?.body ? JSON.parse(opts.body) : {};
      sentText = body.text || '';
      return new Response(JSON.stringify({ ok: true, result: { message_id: 104 } }));
    };

    try {
      const res = await handleExtendedCommand(msg, redis, 'mock-token', 12345);
      assert.equal(res.handled, true);
      assert.equal(res.data.action, 'report_generated');
      assert.ok(sentText.includes('24.5 Mbps'));
      assert.ok(sentText.includes('46°C'));
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('returns handled: false for non-extended commands', async () => {
    const redis = createMockRedis();
    const res = await handleExtendedCommand({ text: 'Hello bot' }, redis, 'token', 123);
    assert.equal(res.handled, false);
  });
});

describe('lib/telegram/router-confirm.js Router Execution Notices', () => {
  function createMockRedis() {
    const store = new Map();
    const hashes = new Map();
    return {
      async get(key) { return store.has(key) ? store.get(key) : null; },
      async set(key, val) { store.set(key, val); return 'OK'; },
      async del(key) { store.delete(key); return 1; },
      async hset(key, obj) {
        const cur = hashes.get(key) || {};
        hashes.set(key, { ...cur, ...obj });
        return 1;
      },
      async hgetall(key) { return hashes.get(key) || {}; }
    };
  }

  test('formatRouterActionNotice formats auth, deauth, trust, and untrust cards', () => {
    const authCard = formatRouterActionNotice({
      command: 'ndsctl auth 00:11:22:33:44:55 45',
      mac: '00:11:22:33:44:55',
      user: { name: 'Sabbir' }
    });
    assert.ok(authCard.includes('ওয়াইফাই এক্সেস সক্রিয়'));
    assert.ok(authCard.includes('Sabbir'));
    assert.ok(authCard.includes('45 মিনিট'));

    const deauthCard = formatRouterActionNotice({
      command: 'ndsctl deauth 00:11:22:33:44:55',
      mac: '00:11:22:33:44:55',
      user: { name: 'Sabbir' }
    });
    assert.ok(deauthCard.includes('সংযোগ বিচ্ছিন্ন'));
    assert.ok(deauthCard.includes('00:11:22:33:44:55'));

    const trustCard = formatRouterActionNotice({
      command: 'ndsctl trust 00:11:22:33:44:55',
      mac: '00:11:22:33:44:55'
    });
    assert.ok(trustCard.includes('স্থায়ী বিশ্বস্ত অনুমোদন'));

    const untrustCard = formatRouterActionNotice({
      command: 'ndsctl untrust 00:11:22:33:44:55',
      mac: '00:11:22:33:44:55'
    });
    assert.ok(untrustCard.includes('স্থায়ী বিশ্বস্ত তালিকা থেকে অপসারিত'));
  });

  test('formatRouterActionNotice formats speed limit and reboot notices', () => {
    const limitCard = formatRouterActionNotice({
      command: "uci set archer_guard.limit_112233445566.mbps='10'",
      mac: '11:22:33:44:55:66'
    });
    assert.ok(limitCard.includes('ব্যান্ডউইথ স্পিড লিমিট কার্যকর'));
    assert.ok(limitCard.includes('10 Mbps'));

    const removeLimitCard = formatRouterActionNotice({
      command: "uci delete archer_guard.limit_112233445566",
      mac: '11:22:33:44:55:66'
    });
    assert.ok(removeLimitCard.includes('ব্যান্ডউইথ লিমিট অপসারিত'));

    const rebootCard = formatRouterActionNotice({ command: 'reboot' });
    assert.ok(rebootCard.includes('রাউটার রিবুট'));
  });

  test('sendRouterConfirmationNotice sends message and respects deduplication', async () => {
    const fetchCalls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      fetchCalls.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 888 } }));
    };

    const redis = createMockRedis();

    try {
      const first = await sendRouterConfirmationNotice({
        redis,
        botToken: 'token',
        chatId: 1234,
        payload: { command: 'reboot', status: 'success' }
      });
      assert.equal(first.ok, true);
      assert.equal(first.notified, true);
      assert.equal(fetchCalls.length, 1);

      // Duplicate within 8 seconds
      const second = await sendRouterConfirmationNotice({
        redis,
        botToken: 'token',
        chatId: 1234,
        payload: { command: 'reboot', status: 'success' }
      });
      assert.equal(second.ok, true);
      assert.equal(second.deduplicated, true);
      assert.equal(fetchCalls.length, 1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe('Telegram Bot Interactive Menu & Action Integrations', () => {
  function createMockRedis() {
    const store = new Map();
    const lists = new Map();
    const hashes = new Map();
    return {
      async get(key) { return store.has(key) ? store.get(key) : null; },
      async set(key, val) { store.set(key, val); return 'OK'; },
      async del(key) { store.delete(key); return 1; },
      async rpush(key, ...vals) {
        const l = lists.get(key) || [];
        l.push(...vals);
        lists.set(key, l);
        return l.length;
      },
      async lrange(key) { return lists.get(key) || []; },
      async hset(key, obj) {
        const cur = hashes.get(key) || {};
        hashes.set(key, { ...cur, ...obj });
        return 1;
      },
      async hgetall(key) { return hashes.get(key) || {}; }
    };
  }

  test('processMenuCommand handles reboot, help, and rename commands', async () => {
    const redis = createMockRedis();
    const rebootRes = await processMenuCommand('reboot', redis);
    assert.ok(rebootRes.text.includes('রাউটার রিস্টার্ট / রিবুট'));
    assert.ok(rebootRes.replyMarkup.inline_keyboard);
    assert.equal(rebootRes.ackText, '🔄 রিবুট নিশ্চিতকরণ');

    const helpRes = await processMenuCommand('help', redis);
    assert.ok(helpRes.text.includes('ক্যাপটিভ পোর্টাল ও বট সহায়িকা'));
    assert.ok(helpRes.text.includes('রাউটার রিবুট'));
    assert.equal(helpRes.replyMarkup, null); // Strictly no redundant 10-button menu
    assert.equal(helpRes.ackText, '📖 হেল্প গাইড');

    const prevRes = await processMenuCommand('previous', redis);
    assert.equal(prevRes.replyMarkup, null); // Strictly no redundant 10-button menu

    const reportRes = await processMenuCommand('report', redis);
    assert.equal(reportRes.replyMarkup.inline_keyboard[0][0].callback_data, 'menu_report'); // Single refresh button

    const detailsRes = await processMenuCommand('details', redis);
    assert.equal(detailsRes.replyMarkup, null); // No cluttered deauth list or menu when 0 active

    const renameRes = await processMenuCommand('rename', redis);
    assert.ok(renameRes.text.includes('ডিভাইসের নাম পরিবর্তন'));
    assert.equal(renameRes.replyMarkup.inline_keyboard[0][0].callback_data, 'menu_active');
    assert.equal(renameRes.ackText, '🏷️ ডিভাইস রিনেম');
  });

  test('handleTelegramCallback handles rename_prompt and reboot_confirm', async () => {
    const redis = createMockRedis();
    const origFetch = globalThis.fetch;
    const fetchCalls = [];
    globalThis.fetch = async (url, opts) => {
      fetchCalls.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 201 } }));
    };

    try {
      // 1. rename_prompt
      const renameCb = {
        id: 'cb-1',
        data: 'rename_prompt:46:84:b7:da:39:73',
        message: { message_id: 301, chat: { id: 12345 } },
        from: { first_name: 'Admin' }
      };
      const renameRes = await handleTelegramCallback(renameCb, redis, 'mock-token', 12345);
      assert.equal(renameRes.status, 200);
      assert.equal(renameRes.data.action, 'rename_prompt_set');
      assert.equal(await redis.get('last_rename_mac:12345'), '46:84:b7:da:39:73');

      // 2. reboot_confirm
      const rebootCb = {
        id: 'cb-2',
        data: 'reboot_confirm',
        message: { message_id: 302, chat: { id: 12345 } },
        from: { first_name: 'Admin' }
      };
      const rebootRes = await handleTelegramCallback(rebootCb, redis, 'mock-token', 12345);
      assert.equal(rebootRes.status, 200);
      assert.equal(rebootRes.data.action, 'router_reboot_queued');
      const queue = await redis.lrange('pending_commands');
      assert.ok(queue.includes('reboot'));
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('handleTelegramMessage handles interactive rename input flow', async () => {
    const redis = createMockRedis();
    await redis.set('last_rename_mac:12345', '46:84:b7:da:39:73');

    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result: { message_id: 401 } }));

    try {
      const msg = {
        message_id: 501,
        chat: { id: 12345 },
        text: 'সাদাত ল্যাপটপ',
        from: { first_name: 'Admin' }
      };
      const res = await handleTelegramMessage(msg, redis, 'mock-token', 12345);
      assert.equal(res.status, 200);
      assert.equal(res.data.action, 'renamed');
      assert.equal(res.data.alias, 'সাদাত ল্যাপটপ');
      assert.equal(await redis.get('device_alias:46:84:b7:da:39:73'), 'সাদাত ল্যাপটপ');
      assert.equal(await redis.get('last_rename_mac:12345'), null);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe('lib/admin/settings.js Settings Persistence & Public Config', () => {
  test('saveSystemSettings saves PhonePe, Paytm, and GPay UPI IDs and updates public config', async () => {
    const payload = {
      phonepe_upi: 'samim@ybl',
      paytm_upi: 'samim@paytm',
      gpay_upi: 'samim@okaxis',
      portalTitle: 'CyberWave High Speed',
      gatewayName: 'CyberWave 5G Zone',
      supportPhone: '+91 9999988888',
      welcomeNotice: 'Welcome to CyberWave Ultra WiFi'
    };

    const res = await saveSystemSettings(payload, null);
    assert.equal(res.ok, true);

    const cfg = await getPublicPortalConfig(null);
    assert.equal(cfg.portalTitle, 'CyberWave High Speed');
    assert.equal(cfg.gatewayName, 'CyberWave 5G Zone');
    assert.equal(cfg.supportPhone, '+91 9999988888');
    assert.equal(cfg.welcomeNotice, 'Welcome to CyberWave Ultra WiFi');
    assert.equal(cfg.phonepe_upi, 'samim@ybl');
    assert.equal(cfg.paytm_upi, 'samim@paytm');
    assert.equal(cfg.gpay_upi, 'samim@okaxis');
    assert.equal(cfg.payments.phonepe.to, 'samim@ybl');
    assert.equal(cfg.payments.paytm.to, 'samim@paytm');
    assert.equal(cfg.payments.gpay.to, 'samim@okaxis');
  });

  test('getSystemSettings returns merged settings with masked secrets', async () => {
    const settings = await getSystemSettings(null);
    assert.ok(settings.payments);
    assert.ok(settings.payments.phonepe_upi);
    assert.ok(settings.payments.paytm_upi);
    assert.ok(settings.payments.gpay_upi);
    assert.equal(settings.portalTitle, 'CyberWave High Speed');
  });
});

describe('lib/router/bridge.js Secure Remote OpenWrt Router Bridge', () => {
  test('registerRouter initializes profile and creates pairing token', async () => {
    const res = await registerRouter({
      routerName: 'Test Archer C6',
      openwrtVersion: '23.05.4'
    }, null);

    assert.ok(res.ok);
    const profile = res.profile;
    assert.match(profile.routerId, /^cw-c6-/);
    assert.equal(profile.model, 'TP-Link Archer C6 v3.2');
    assert.ok(profile.pairingToken);
    assert.equal(profile.registered, true);
  });

  test('verifyRouterCredentials checks authorization headers', () => {
    const validToken = 'test-token-12345';
    assert.equal(verifyRouterCredentials({ headers: { 'x-router-secret': validToken } }, validToken), true);
    assert.equal(verifyRouterCredentials({ headers: { 'x-router-secret': 'wrong' } }, validToken), false);
    assert.equal(verifyRouterCredentials({ headers: {} }, validToken), false);
  });

  test('handleRouterHeartbeat updates router state and returns queued commands', async () => {
    const reg = await registerRouter({ routerName: 'Heartbeat Router' }, null);
    const token = reg.profile.pairingToken;

    // Queue a command first
    const queued = await enqueueCommandForRouter({
      command: 'ping_test',
      target: '1.1.1.1'
    }, null);
    assert.ok(queued.ok);
    assert.ok(queued.commandId);

    // Send heartbeat
    const req = { headers: { 'x-router-secret': token } };
    const hb = await handleRouterHeartbeat({
      routerId: reg.profile.routerId,
      system: { model: 'TP-Link Archer C6 v3.2', openwrtVersion: '23.05.4' },
      status: {
        uptime: '2h 15m',
        cpu_load: '0.12, 0.08, 0.05',
        ram_usage: '42 MB / 128 MB'
      }
    }, req, null);

    assert.equal(hb.ok, true);
    assert.ok(Array.isArray(hb.commands));
    assert.ok(hb.commands.some(c => c.commandId === queued.commandId || c.id === queued.commandId));

    // Profile should now reflect online state
    const profile = await getRouterProfile(null);
    assert.equal(profile.status, 'online');
  });

  test('recordCommandResult confirms router command execution and updates audit log', async () => {
    const resultRes = await recordCommandResult({
      commandId: 101,
      command: 'ping_test',
      status: 'confirmed',
      output: '4 packets transmitted, 4 received, 0% packet loss'
    }, null);

    assert.equal(resultRes.ok, true);
    const statusRecord = await getCommandStatus(101, null);
    assert.equal(statusRecord.status, 'confirmed');
    assert.match(statusRecord.output, /0% packet loss/);

    const logs = getAuditLogs();
    assert.ok(logs.some(l => l.action === 'COMMAND_CONFIRMED' && l.commandId === 101));
  });

  test('generateInstallScript generates valid POSIX Ash shell script with pairing params', async () => {
    const reg = await registerRouter({ routerName: 'Archer C6 Install Test' }, null);
    const script = generateInstallScript('https://cyberwave.ai.studio', reg.profile);

    assert.match(script, /^#!\/bin\/sh/);
    assert.match(script, /ROUTER_ID='/);
    assert.match(script, /TP-Link Archer C6/);
    assert.match(script, /router\/install-agent\.sh/);
    assert.match(script, /PAIRING_TOKEN='/);
    assert.match(script, /https:\/\/cyberwave\.ai\.studio/);
  });

  test('unpairRouter revokes router pairing', async () => {
    const unpairRes = await unpairRouter(null);
    assert.equal(unpairRes.ok, true);
    const profile = await getRouterProfile(null);
    assert.equal(profile.registered, false);
    assert.equal(profile.status, 'unpaired');
  });
});






