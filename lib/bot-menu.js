/**
 * lib/bot-menu.js
 *
 * Central export hub for Telegram Bot menu helpers, formatters, and cleaners.
 * Re-exports modularized components from lib/telegram/ for 100% backward compatibility.
 * Kept strictly under 250 lines.
 */

export {
  APP_TIMEZONE,
  formatDateTime,
  isUserActive,
  isUserTerminated,
  formatUserDetailsCard,
  formatUserDetailsList,
  formatSingleActiveUserCard,
  formatActiveUsersList,
  formatPreviousUsersList,
  formatDashboardMessage,
  formatDisconnectCard
} from './telegram/cards.js';

export {
  TELEGRAM_MENU_KEYBOARD,
  TELEGRAM_INLINE_MENU,
  buildDefaultAuthKeyboard,
  buildUnlimitedKeyboard,
  buildSingleUserDeauthKeyboard,
  buildActiveUsersKeyboard,
  buildVoucherDurationKeyboard,
  buildSpeedLimitKeyboard,
  buildSpeedUsersKeyboard,
  buildRebootConfirmKeyboard
} from './telegram/keyboards.js';

export {
  fetchUserRecords,
  cleanTerminatedRecords,
  registerBotCommands,
  trackChatMessage,
  deleteTelegramMessages,
  deleteTelegramMessage,
  clearChatHistory
} from './telegram/chat-cleaner.js';

export {
  MAC_REGEX,
  normalizeDigits,
  parseDurationString,
  parseCustomAuthMessage,
  normalizeCommandText,
  parseCallbackData
} from './telegram/parsers.js';
