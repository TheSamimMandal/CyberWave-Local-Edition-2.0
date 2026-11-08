#!/usr/bin/env node
/**
 * scripts/reset-admin-password.js
 *
 * Direct administrative CLI tool to reset or recover CyberWave Admin Password
 * on Google AI Studio container without requiring old password.
 *
 * Usage:
 *   node scripts/reset-admin-password.js <new_password>
 * or:
 *   npm run reset-password -- <new_password>
 */

import { resetAdminPassword, DEFAULT_INITIAL_PASSWORD } from '../lib/admin/auth.js';

const newPassword = process.argv[2]?.trim();

if (!newPassword) {
  console.log(`\nUsage: node scripts/reset-admin-password.js <new_password>\n`);
  console.log(`Example: node scripts/reset-admin-password.js MySecurePass2026\n`);
  console.log(`Or to reset to initial default: node scripts/reset-admin-password.js ${DEFAULT_INITIAL_PASSWORD}\n`);
  process.exit(1);
}

const result = resetAdminPassword(newPassword, false);

if (result.ok) {
  console.log(`\n======================================================`);
  console.log(`✅ [CyberWave] Admin password successfully reset!`);
  console.log(`🔑 New password is now active and saved to data/admin-auth.json`);
  console.log(`🌐 You can now log in to /admin using the new password.`);
  console.log(`======================================================\n`);
  process.exit(0);
} else {
  console.error(`❌ [CyberWave] Failed to reset admin password:`, result.error);
  process.exit(1);
}
