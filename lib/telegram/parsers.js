/**
 * lib/telegram/parsers.js
 *
 * Callback query, duration, command text, and custom message parsers.
 * Kept strictly under 250 lines.
 */

export const MAC_REGEX = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

export function parseCallbackData(data) {
  if (!data || typeof data !== 'string') return null;
  const trimmed = data.trim();

  // 1. Unlimited & Permanent sub-actions (including lifetime / permanent / session)
  if (
    trimmed.startsWith('unlim_sess:') || trimmed.startsWith('unlim_sess_') ||
    trimmed.startsWith('sess:') || trimmed.startsWith('sess_') ||
    trimmed.startsWith('session:') || trimmed.startsWith('session_')
  ) {
    const raw = trimmed.replace(/^(unlim_sess|sess|session)[:_]/i, '').trim();
    const mac = raw.toLowerCase().replace(/-/g, ':');
    return MAC_REGEX.test(mac) ? { action: 'unlim_sess', mac, duration: 0, mode: 'session' } : null;
  }
  if (
    trimmed.startsWith('unlim_perm:') || trimmed.startsWith('unlim_perm_') ||
    trimmed.startsWith('perm:') || trimmed.startsWith('perm_') ||
    trimmed.startsWith('permanent:') || trimmed.startsWith('permanent_') ||
    trimmed.startsWith('lifetime:') || trimmed.startsWith('lifetime_')
  ) {
    const raw = trimmed.replace(/^(unlim_perm|perm|permanent|lifetime)[:_]/i, '').trim();
    const mac = raw.toLowerCase().replace(/-/g, ':');
    return MAC_REGEX.test(mac) ? { action: 'unlim_perm', mac, duration: 0, mode: 'permanent' } : null;
  }
  if (trimmed.startsWith('unlim_back:') || trimmed.startsWith('unlim_back_')) {
    const mac = trimmed.slice(11).trim().toLowerCase().replace(/-/g, ':');
    return MAC_REGEX.test(mac) ? { action: 'unlim_back', mac, duration: null } : null;
  }

  // 2. Deauth / Terminate / Reject action
  if (
    trimmed.startsWith('deauth_') || trimmed.startsWith('deauth:') ||
    trimmed.startsWith('reject_') || trimmed.startsWith('reject:') ||
    trimmed.startsWith('kick_') || trimmed.startsWith('kick:') ||
    trimmed.startsWith('terminate_') || trimmed.startsWith('terminate:')
  ) {
    const raw = trimmed.replace(/^(deauth|reject|kick|terminate)[_:]/i, '').trim();
    const mac = raw.toLowerCase().replace(/-/g, ':');
    return MAC_REGEX.test(mac) ? { action: 'deauth', mac, duration: null } : null;
  }

  // 3. Auth / Accept / Approve action
  if (
    trimmed.startsWith('auth:') || trimmed.startsWith('auth_') ||
    trimmed.startsWith('accept:') || trimmed.startsWith('accept_') ||
    trimmed.startsWith('approve:') || trimmed.startsWith('approve_') ||
    trimmed.startsWith('allow:') || trimmed.startsWith('allow_')
  ) {
    const rest = trimmed.replace(/^(auth|accept|approve|allow)[:_]/i, '').trim();
    const lastSep = Math.max(rest.lastIndexOf(':'), rest.lastIndexOf('_'));
    if (lastSep !== -1) {
      const rawMac = rest.slice(0, lastSep).trim();
      const durationStr = rest.slice(lastSep + 1).trim();
      const mac = rawMac.toLowerCase().replace(/-/g, ':');
      const duration = parseInt(durationStr, 10);
      if (!isNaN(duration) && duration >= 0 && MAC_REGEX.test(mac)) {
        return { action: 'auth', mac, duration };
      }
    }
    const bareMac = rest.toLowerCase().replace(/-/g, ':');
    if (MAC_REGEX.test(bareMac)) {
      return { action: 'auth', mac: bareMac, duration: 60 };
    }
    return null;
  }

  // 4. Menu action
  if (trimmed.startsWith('menu_') || trimmed.startsWith('menu:')) {
    const rawCmd = trimmed.slice(5).trim().toLowerCase();
    const normalizedCmd = rawCmd === 'history' ? 'previous' : (rawCmd === 'users' ? 'details' : rawCmd);
    if (['dashboard', 'active', 'previous', 'details', 'clean', 'auth', 'voucher', 'report', 'speed', 'back', 'reboot', 'help', 'rename'].includes(normalizedCmd)) {
      return { action: 'menu', command: normalizedCmd };
    }
    return null;
  }

  // 5. Generate Voucher action
  if (trimmed.startsWith('gen_voucher:') || trimmed.startsWith('gen_voucher_')) {
    const duration = parseInt(trimmed.slice(12).trim(), 10);
    return { action: 'gen_voucher', duration: isNaN(duration) ? 120 : duration };
  }

  // 6. Speed Menu action (speed_menu:<mac>)
  if (trimmed.startsWith('speed_menu:') || trimmed.startsWith('speed_menu_')) {
    const mac = trimmed.slice(11).trim().toLowerCase().replace(/-/g, ':');
    return MAC_REGEX.test(mac) ? { action: 'speed_menu', mac } : null;
  }

  // 7. Set Speed Limit action (set_speed:<mac>:<mbps>)
  if (trimmed.startsWith('set_speed:') || trimmed.startsWith('set_speed_')) {
    const rest = trimmed.slice(10).trim();
    const lastSep = Math.max(rest.lastIndexOf(':'), rest.lastIndexOf('_'));
    if (lastSep === -1) return null;
    const mac = rest.slice(0, lastSep).trim().toLowerCase().replace(/-/g, ':');
    const mbps = parseInt(rest.slice(lastSep + 1).trim(), 10);
    return (!isNaN(mbps) && mbps >= 0 && MAC_REGEX.test(mac)) ? { action: 'set_speed', mac, mbps } : null;
  }

  // 8. Device Rename Prompt & Reboot Confirm
  if (trimmed.startsWith('rename_prompt:') || trimmed.startsWith('rename_prompt_')) {
    const mac = trimmed.slice(14).trim().toLowerCase().replace(/-/g, ':');
    return MAC_REGEX.test(mac) ? { action: 'rename_prompt', mac } : null;
  }
  if (trimmed === 'reboot_confirm') return { action: 'reboot_confirm' };

  return null;
}

export function normalizeDigits(str) {
  if (!str) return '';
  const bnDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return str.replace(/[০-৯]/g, d => bnDigits.indexOf(d).toString());
}

export function parseDurationString(text) {
  if (!text || typeof text !== 'string') return null;
  const raw = normalizeDigits(text.trim());
  const cleaned = raw
    .replace(/[।!?~:;\-_ঃ,]+/g, ' ')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return null;

  if (/^(?:unlimited|unlimit|0|স্থায়ী|আনলিমিটেড|ইনফিনিটি|♾)$/i.test(cleaned) || /^\/unlimited$/i.test(cleaned)) {
    return 0;
  }

  if (/^(?:reject|cancel|deauth|kick|no|বাতিল|না|❌)$/i.test(cleaned) || /^\/(?:reject|deauth|cancel)$/i.test(cleaned)) {
    return -1;
  }

  const hourMatch = cleaned.match(/^(?:\/auth\s+)?(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours|ঘণ্টা|ঘন্টা|ঘন্টার|ঘণ্টার)(?:\s*(?:সময়|সময়|এক্সেস|access|এর\s*জন্য|জন্য|দাও|দেন))?$/i);
  if (hourMatch) {
    const hours = parseFloat(hourMatch[1]);
    if (!isNaN(hours) && hours > 0) {
      return Math.round(hours * 60);
    }
  }

  const minMatch = cleaned.match(/^(?:\/auth\s+)?(\d+)(?:\s*(?:m|min|mins|minute|minutes|মিনিট|মিনিটের|মি))?(?:\s*(?:সময়|সময়|এক্সেস|access|দাও|দেন|এর\s*জন্য|জন্য))?$/i);
  if (minMatch) {
    const duration = parseInt(minMatch[1], 10);
    if (!isNaN(duration) && duration >= 0) {
      return duration;
    }
  }

  return null;
}

export function parseCustomAuthMessage(text, replyToText = null) {
  if (!text || typeof text !== 'string') return null;
  const rawTrimmed = text.trim();
  const trimmed = normalizeDigits(rawTrimmed);

  // 1. Direct command: /auth <mac> [duration] or /deauth <mac>
  const directAuth = trimmed.match(/^\/(?:auth|approve)\s+((?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2})(?:\s+(\d+))?/i);
  if (directAuth) {
    const mac = directAuth[1].toLowerCase().replace(/-/g, ':');
    if (directAuth[2] !== undefined) {
      const duration = parseInt(directAuth[2], 10);
      return { action: 'auth', mac, duration };
    }
    return { action: 'prompt_duration', mac };
  }

  const directDeauth = trimmed.match(/^\/(?:deauth|reject|kick)\s+((?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2})/i);
  if (directDeauth) {
    const mac = directDeauth[1].toLowerCase().replace(/-/g, ':');
    return { action: 'deauth', mac, duration: null };
  }

  // 1.1 Direct Bare MAC address: e.g. "46:84:b7:da:39:73" or "mac: AA-BB-CC-DD-EE-FF"
  const bareMacMatch = trimmed.match(/^(?:mac\s*[:=-]?\s*)?((?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2})$/i);
  if (bareMacMatch) {
    const mac = bareMacMatch[1].toLowerCase().replace(/-/g, ':');
    return { action: 'prompt_duration', mac };
  }

  let mac = null;
  if (replyToText && typeof replyToText === 'string') {
    const macMatch = replyToText.match(/([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}/);
    if (macMatch) {
      mac = macMatch[0].toLowerCase().replace(/-/g, ':');
    }
  }

  const isPermanent = /^(?:permanent|trust|trusted|স্থায়ী|স্থায়ী|বিশ্বস্ত|লগইন ছাড়া|লগইন ছাড়া)$/i.test(trimmed) || /^\/(?:trust|permanent)$/i.test(trimmed);
  const isSession = /^(?:session|এককালীন|একবার)$/i.test(trimmed) || /^\/session$/i.test(trimmed);

  if (isPermanent) return { action: 'auth', mac, duration: 0, mode: 'permanent' };
  if (isSession) return { action: 'auth', mac, duration: 0, mode: 'session' };

  const durationValue = parseDurationString(text);
  if (durationValue === null) return null;
  if (durationValue === -1) return { action: 'deauth', mac, duration: null };

  return { action: 'auth', mac, duration: durationValue };
}

export function normalizeCommandText(text) {
  if (!text || typeof text !== 'string') return null;
  const raw = text.trim().toLowerCase();
  const normalized = raw.startsWith('/') ? raw.slice(1).trim() : raw;

  if (['start', 'menu', 'মেনু'].includes(normalized)) return 'menu';

  if (
    ['auth', 'approve', 'authorize', 'ম্যাক অথোরাইজ', 'অথোরাইজ ম্যাক', '➕ ম্যাক অথোরাইজ', '➕ অথোরাইজ ম্যাক', 'ম্যাক'].includes(normalized) ||
    raw.includes('ম্যাক অথোরাইজ') ||
    raw.includes('অথোরাইজ ম্যাক')
  ) {
    return 'auth';
  }

  if (['clean', 'ক্লিন', '🧹 ক্লিন চ্যাট ও ডাটা', '🧹 ক্লিন ড্যাশবোর্ড'].includes(normalized) || raw.includes('ক্লিন')) return 'clean';
  if (['dashboard', 'ড্যাশবোর্ড', '📊 ড্যাশবোর্ড', 'active', 'অ্যাক্টিভ', '🟢 অ্যাক্টিভ ইউজার'].includes(normalized) || raw.includes('অ্যাক্টিভ') || raw.includes('ড্যাশবোর্ড')) return 'active';
  if (['previous', 'history', 'হিস্ট্রি', 'প্রিভিয়াস', 'পূর্ববর্তী', '👥 পূর্ববর্তী ইউজার'].includes(normalized) || raw.includes('পূর্ববর্তী') || raw.includes('প্রিভিয়াস') || raw.includes('হিস্ট্রি')) return 'previous';
  if (['details', 'users', 'ডিটেইলস', 'বিস্তারিত', '📋 ইউজার ডিটেইলস'].includes(normalized) || raw.includes('ডিটেইলস') || raw.includes('বিস্তারিত')) return 'details';
  if (['voucher', 'ভাউচার', 'পাসকোড', '🎟️ গেস্ট ভাউচার', 'গেস্ট ভাউচার'].includes(normalized) || raw.includes('ভাউচার')) return 'voucher';
  if (['report', 'রিপোর্ট', 'সামারি', 'stats', '📊 নেটওয়ার্ক রিপোর্ট', 'নেটওয়ার্ক রিপোর্ট'].includes(normalized) || raw.includes('রিপোর্ট')) return 'report';
  if (['speed', 'limit', 'throttle', 'স্পিড', 'লিমিট', 'স্পিড লিমিট', '⚡ স্পিড লিমিট'].includes(normalized) || raw.includes('স্পিড') || raw.includes('লিমিট')) return 'speed';
  if (['reboot', 'রিবুট', 'রিস্টার্ট', 'restart', '🔄 রাউটার রিবুট', 'রাউটার রিবুট'].includes(normalized) || raw.includes('রিবুট') || raw.includes('রিস্টার্ট')) return 'reboot';
  if (['help', 'হেল্প', 'গাইড', 'সাহায্য', '❓ হেল্প গাইড', 'হেল্প গাইড'].includes(normalized) || raw.includes('হেল্প') || raw.includes('গাইড')) return 'help';
  if (['rename', 'রিনেম', 'নাম', 'নাম পরিবর্তন', '🏷️ ডিভাইস রিনেম', 'ডিভাইস রিনেম'].includes(normalized) || raw.includes('রিনেম')) return 'rename';

  return null;
}
