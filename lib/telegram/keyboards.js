/**
 * lib/telegram/keyboards.js
 *
 * Telegram inline and reply keyboard definitions and generators.
 * Kept strictly under 250 lines.
 */

/**
 * Persistent Telegram Reply Keyboard (pinned at the bottom of the chat).
 * High-priority action at top, followed by 2x2 grid layout with is_persistent: true.
 */
export const TELEGRAM_MENU_KEYBOARD = {
  keyboard: [
    [{ text: '➕ ম্যাক অথোরাইজ' }, { text: '🎟️ গেস্ট ভাউচার' }],
    [{ text: '🟢 অ্যাক্টিভ ইউজার' }, { text: '👥 পূর্ববর্তী ইউজার' }],
    [{ text: '⚡ স্পিড লিমিট' }, { text: '📊 নেটওয়ার্ক রিপোর্ট' }],
    [{ text: '📋 ইউজার ডিটেইলস' }, { text: '🧹 ক্লিন চ্যাট ও ডাটা' }],
    [{ text: '🔄 রাউটার রিবুট' }, { text: '❓ হেল্প গাইড' }]
  ],
  resize_keyboard: true,
  is_persistent: true
};

/**
 * Inline menu keyboard with callback triggers.
 */
export const TELEGRAM_INLINE_MENU = {
  inline_keyboard: [
    [
      { text: '➕ ম্যাক অথোরাইজ', callback_data: 'menu_auth' },
      { text: '🎟️ গেস্ট ভাউচার', callback_data: 'menu_voucher' }
    ],
    [
      { text: '🟢 অ্যাক্টিভ ইউজার', callback_data: 'menu_active' },
      { text: '👥 পূর্ববর্তী ইউজার', callback_data: 'menu_previous' }
    ],
    [
      { text: '⚡ স্পিড লিমিট', callback_data: 'menu_speed' },
      { text: '📊 নেটওয়ার্ক রিপোর্ট', callback_data: 'menu_report' }
    ],
    [
      { text: '📋 ইউজার ডিটেইলস', callback_data: 'menu_details' },
      { text: '🧹 ক্লিন চ্যাট ও ডাটা', callback_data: 'menu_clean' }
    ],
    [
      { text: '🔄 রাউটার রিবুট', callback_data: 'menu_reboot' },
      { text: '❓ হেল্প গাইড', callback_data: 'menu_help' }
    ]
  ]
};

/**
 * Builds inline keyboard buttons to authorize client with preset durations.
 *
 * @param {string} mac
 * @returns {Array<Array<object>>}
 */
export function buildDefaultAuthKeyboard(mac) {
  const cleanMac = (mac || '').toLowerCase().replace(/-/g, ':');
  return [
    [
      { text: '⏱ 10 Mins', callback_data: `auth:${cleanMac}:10` },
      { text: '⏱ 15 Mins', callback_data: `auth:${cleanMac}:15` },
      { text: '⏱ 20 Mins', callback_data: `auth:${cleanMac}:20` }
    ],
    [
      { text: '⏱ 30 Mins', callback_data: `auth:${cleanMac}:30` },
      { text: '⏱ 1 Hour', callback_data: `auth:${cleanMac}:60` }
    ],
    [
      { text: '♾ Unlimited', callback_data: `auth:${cleanMac}:0` },
      { text: '❌ Reject', callback_data: `deauth_${cleanMac}` }
    ]
  ];
}

/**
 * Builds inline keyboard for choosing unlimited sub-options:
 * 1. Session Unlimited (Re-login on next visit / disconnect)
 * 2. Permanent Trusted (Bypasses captive portal permanently)
 * 3. Back button (Restores standard duration keyboard)
 *
 * @param {string} mac
 * @returns {Array<Array<object>>}
 */
export function buildUnlimitedKeyboard(mac) {
  const cleanMac = (mac || '').toLowerCase().replace(/-/g, ':');
  return [
    [{ text: '🔄 এককালীন (পরের বার লগইন পেজ আসবে)', callback_data: `unlim_sess:${cleanMac}` }],
    [{ text: '🛡️ স্থায়ী বিশ্বস্ত (লগইন পেজ আর আসবে না)', callback_data: `unlim_perm:${cleanMac}` }],
    [{ text: '🔙 ফিরে যান', callback_data: `unlim_back:${cleanMac}` }]
  ];
}

/**
 * Builds a single-button inline keyboard to terminate/deauthenticate an active user.
 *
 * @param {string} mac
 * @returns {object}
 */
export function buildSingleUserDeauthKeyboard(mac) {
  const cleanMac = (mac || '').toLowerCase().replace(/-/g, ':');
  return {
    inline_keyboard: [
      [
        { text: '❌ সংযোগ বিচ্ছিন্ন করুন', callback_data: `deauth_${cleanMac}` },
        { text: '⚡ স্পিড লিমিট', callback_data: `speed_menu:${cleanMac}` }
      ],
      [
        { text: '🏷️ নাম পরিবর্তন', callback_data: `rename_prompt:${cleanMac}` }
      ]
    ]
  };
}

/**
 * Builds inline keyboard buttons to terminate/deauthenticate active users.
 *
 * @param {Array<object>} activeUsers
 * @returns {object|null}
 */
export function buildActiveUsersKeyboard(activeUsers = []) {
  if (!Array.isArray(activeUsers) || activeUsers.length === 0) {
    return null;
  }

  const buttons = activeUsers.slice(0, 10).map(u => {
    const rawName = (u.name || 'User').trim();
    const shortName = rawName.length > 15 ? rawName.slice(0, 14) + '…' : rawName;
    return [{
      text: `❌ সংযোগ বিচ্ছিন্ন: ${shortName}`,
      callback_data: `deauth_${u.mac}`
    }];
  });

  return { inline_keyboard: buttons };
}

/**
 * Builds preset duration buttons for creating guest vouchers.
 *
 * @returns {Array<Array<object>>}
 */
export function buildVoucherDurationKeyboard() {
  return [
    [
      { text: '⏱ ৩০ মিনিট', callback_data: 'gen_voucher:30' },
      { text: '⏱ ১ ঘণ্টা', callback_data: 'gen_voucher:60' }
    ],
    [
      { text: '⏱ ২ ঘণ্টা (ডিফল্ট)', callback_data: 'gen_voucher:120' },
      { text: '⏱ ৪ ঘণ্টা', callback_data: 'gen_voucher:240' }
    ],
    [
      { text: '♾ এককালীন আনলিমিটেড', callback_data: 'gen_voucher:0' }
    ],
    [
      { text: '🔙 ফিরে যান', callback_data: 'menu_back' }
    ]
  ];
}

/**
 * Builds preset bandwidth speed limit options for a device.
 *
 * @param {string} mac
 * @returns {Array<Array<object>>}
 */
export function buildSpeedLimitKeyboard(mac) {
  const cleanMac = (mac || '').toLowerCase().replace(/-/g, ':');
  return [
    [
      { text: '🚀 ১ Mbps', callback_data: `set_speed:${cleanMac}:1` },
      { text: '🚀 ২ Mbps', callback_data: `set_speed:${cleanMac}:2` }
    ],
    [
      { text: '🚀 ৫ Mbps', callback_data: `set_speed:${cleanMac}:5` },
      { text: '🚀 ১০ Mbps', callback_data: `set_speed:${cleanMac}:10` }
    ],
    [
      { text: '🔄 স্বাভাবিক / ফুল স্পিড', callback_data: `set_speed:${cleanMac}:0` }
    ],
    [
      { text: '🔙 ফিরে যান', callback_data: 'menu_back' }
    ]
  ];
}

/**
 * Builds an inline keyboard listing active users to choose for speed limiting.
 *
 * @param {Array<object>} activeUsers
 * @returns {object}
 */
export function buildSpeedUsersKeyboard(activeUsers = []) {
  const buttons = (activeUsers || []).slice(0, 8).map(u => {
    const rawName = (u.name || 'User').trim();
    const shortName = rawName.length > 14 ? rawName.slice(0, 13) + '…' : rawName;
    return [{
      text: `⚡ ${shortName} (${u.mac})`,
      callback_data: `speed_menu:${u.mac}`
    }];
  });
  buttons.push([{ text: '🔙 প্রধান মেনু', callback_data: 'menu_back' }]);
  return { inline_keyboard: buttons };
}

/**
 * Builds confirmation keyboard before queuing router reboot.
 *
 * @returns {Array<Array<object>>}
 */
export function buildRebootConfirmKeyboard() {
  return [
    [{ text: '🔄 হ্যাঁ, রিবুট করুন', callback_data: 'reboot_confirm' }],
    [{ text: '❌ বাতিল', callback_data: 'menu_back' }]
  ];
}
