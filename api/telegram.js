/**
 * /api/telegram.js
 *
 * Telegram Webhook receiver endpoint alias.
 * Re-exports the webhookHandler and parseCallbackData from ./webhook.js
 * so that Telegram webhooks configured to either /api/webhook or /api/telegram
 * function identically.
 */

export { default, parseCallbackData } from './webhook.js';
