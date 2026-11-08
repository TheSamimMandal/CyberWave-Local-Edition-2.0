/**
 * lib/router/bridge.js
 *
 * Secure Outbound Router Bridge & Remote Management Service for TP-Link Archer C6 v3.2.
 * Manages cryptographic pairing, telemetry ingestion, command dispatching,
 * execution confirmation, and audit logging.
 * Kept strictly under 250 lines (modular architecture).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeCompare } from '../../api/poll.js';
import { isDangerousRouterCommand } from './safety.js';
import { getSimulatedStatus } from './status-sim.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');
const CONFIG_FILE = path.join(ROOT_DIR, 'data/router-bridge.json');

// In-memory fallback stores when Redis is not configured
let inMemoryProfile = null;
const inMemoryCommandQueue = [];
const inMemoryCommandResults = new Map();
const inMemoryAuditLogs = [];
let inMemoryInstallProgress = {
  stage: 0,
  totalStages: 10,
  stageName: 'Idle',
  percent: 0,
  status: 'idle',
  log: 'Ready for one-click setup',
  timestamp: new Date().toISOString()
};

/**
 * Loads or initializes the router registration profile.
 * Supports maskSecrets option to never leak raw pairing secrets to UI callers.
 */
export async function getRouterProfile(redis, { maskSecrets = false } = {}) {
  let profile = null;

  if (redis) {
    try {
      const stored = await redis.get('router:profile');
      if (stored) {
        profile = typeof stored === 'string' ? JSON.parse(stored) : stored;
      }
    } catch (e) {
      console.warn('[Router Bridge] Redis profile read error:', e.message);
    }
  }

  if (!profile && !inMemoryProfile && fs.existsSync(CONFIG_FILE)) {
    try {
      inMemoryProfile = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {}
  }

  if (!profile) {
    if (!inMemoryProfile) {
      // Generate initial secure profile for Archer C6 v3.2
      inMemoryProfile = {
        registered: false,
        routerId: 'cw-c6-' + crypto.randomBytes(4).toString('hex'),
        routerName: 'Archer C6 Gateway',
        model: 'TP-Link Archer C6 v3.2',
        openwrtVersion: 'OpenWrt 25.12.6 (MediaTek MT7621)',
        pairingToken: '',
        pairedAt: new Date().toISOString(),
        lastSeen: null,
        lastSeenEpoch: 0,
        status: 'unpaired',
        isOnline: false,
        hardware: {
          architecture: 'MediaTek MT7621AT dual-core MIPS 880MHz',
          ramMb: 128,
          flashMb: 16,
          dualBand: true,
          radio2g: 'MediaTek MT7603E 802.11bgn',
          radio5g: 'MediaTek MT7613BEN / MT7615E 802.11ac',
          ethernetPorts: '1x WAN Gigabit + 4x LAN Gigabit'
        }
      };
      saveProfileToDisk(inMemoryProfile);
      if (redis) {
        try {
          await redis.set('router:profile', JSON.stringify(inMemoryProfile));
          await redis.del('router:token');
        } catch (e) {
          console.warn('[Router Bridge] Initial profile persistence failed:', e.message);
        }
      }
    }
    profile = inMemoryProfile;
  }

  updateOnlineStatus(profile);

  if (maskSecrets) {
    return {
      ...profile,
      pairingToken: profile.pairingToken ? `${profile.pairingToken.slice(0, 8)}••••••••` : ''
    };
  }

  return profile;
}

function updateOnlineStatus(profile) {
  if (!profile) return;
  if (!profile.registered) {
    profile.isOnline = false;
    profile.status = 'unpaired';
    profile.secondsSinceSeen = null;
    return;
  }
  const now = Date.now();
  const lastSeenEpoch = profile.lastSeenEpoch || (profile.lastSeen ? new Date(profile.lastSeen).getTime() : 0);
  if (!lastSeenEpoch) {
    profile.isOnline = false;
    profile.status = profile.registered ? 'registered' : 'unpaired';
    profile.secondsSinceSeen = null;
    return;
  }
  const diffSec = Math.round((now - lastSeenEpoch) / 1000);
  // Router sends heartbeat every 5s-30s. Allow 90s active window to absorb wireless driver reloads gracefully
  profile.isOnline = diffSec <= 90;
  profile.status = profile.isOnline ? 'online' : (diffSec <= 180 ? 'reloading' : 'offline');
  profile.secondsSinceSeen = Math.max(0, diffSec);
}

function saveProfileToDisk(profile) {
  try {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(profile, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Router Bridge] Could not save router-bridge.json:', err.message);
  }
}

/**
 * Registers or re-pairs the router with new credentials
 */
export async function registerRouter(payload, redis) {
  const routerName = (payload?.routerName || 'TP-Link Archer C6 v3.2').trim().slice(0, 64);
  const routerId = (payload?.routerId || inMemoryProfile?.routerId || 'cw-c6-5510ec67').trim();
  const pairingToken = (payload?.pairingToken || crypto.randomBytes(24).toString('hex')).trim();
  const routerSecret = (payload?.routerSecret || crypto.randomBytes(32).toString('hex')).trim();

  const profile = {
    registered: true,
    routerId,
    routerName,
    model: 'TP-Link Archer C6 v3.2',
    openwrtVersion: payload?.openwrtVersion || 'OpenWrt 25.12.6',
    pairingToken,
    routerSecret,
    pairedAt: new Date().toISOString(),
    lastSeen: null,
    lastSeenEpoch: 0,
    status: 'registered',
    isOnline: false,
    hardware: {
      architecture: 'MediaTek MT7621AT dual-core MIPS 880MHz',
      ramMb: 128,
      flashMb: 16,
      dualBand: true,
      radio2g: 'MediaTek MT7603E 802.11bgn',
      radio5g: 'MediaTek MT7613BEN / MT7615E 802.11ac',
      ethernetPorts: '1x WAN Gigabit + 4x LAN Gigabit'
    }
  };

  if (redis) {
    try {
      await redis.set('router:profile', JSON.stringify(profile));
      await redis.set('router:token', pairingToken);
      await redis.set('router:secret', routerSecret);
    } catch (e) {
      console.warn('[Router Bridge] Redis profile write error:', e.message);
    }
  }

  inMemoryProfile = profile;
  saveProfileToDisk(profile);

  inMemoryInstallProgress = {
    stage: 0,
    totalStages: 10,
    stageName: 'Pairing Ready',
    percent: 0,
    status: 'idle',
    log: 'Router pairing token ready. Run one-click setup on Archer C6.',
    error: '',
    timestamp: new Date().toISOString()
  };

  addAuditLog({
    action: 'ROUTER_PAIRED',
    details: `Router ${routerName} (${routerId}) paired successfully`,
    status: 'success'
  });

  return { ok: true, profile };
}

/**
 * Handles agent registration/pairing handshake with pairing token
 */
export async function pairAgentWithToken(body, req, redis) {
  const incomingToken = body?.pairingToken ||
                        req.headers?.['x-pairing-token'] ||
                        req.headers?.['x-router-secret'] ||
                        '';
  const incomingRouterId = (body?.routerId || req.headers?.['x-router-id'] || '').trim();

  const profile = await getRouterProfile(redis, { maskSecrets: false });

  if (!incomingToken) {
    return { ok: false, error: 'Missing pairing token.', statusCode: 400 };
  }

  // Validate pairing token against stored profile or environment
  const isValid = (profile?.pairingToken && timingSafeCompare(incomingToken, profile.pairingToken)) ||
                  (process.env.ARCHER_C6_SECRET && timingSafeCompare(incomingToken, process.env.ARCHER_C6_SECRET)) ||
                  (process.env.ROUTER_SECRET_KEY && timingSafeCompare(incomingToken, process.env.ROUTER_SECRET_KEY));

  if (!isValid) {
    return { ok: false, error: 'Invalid or expired pairing token.', statusCode: 401 };
  }

  // Ensure router has a dedicated routerSecret
  if (!profile.routerSecret) {
    profile.routerSecret = crypto.randomBytes(32).toString('hex');
  }

  if (incomingRouterId) {
    profile.routerId = incomingRouterId;
  }
  profile.registered = true;
  profile.status = 'registered';
  profile.pairedAt = new Date().toISOString();
  if (body?.model) profile.model = body.model;
  if (body?.openwrtVersion) profile.openwrtVersion = body.openwrtVersion;

  if (redis) {
    try {
      await redis.set('router:profile', JSON.stringify(profile));
      await redis.set('router:secret', profile.routerSecret);
    } catch {}
  }
  inMemoryProfile = profile;
  saveProfileToDisk(profile);

  addAuditLog({
    action: 'AGENT_HANDSHAKE_PAIRED',
    details: `Router Agent [${profile.routerId}] paired successfully via pairing token`,
    status: 'success'
  });

  return {
    ok: true,
    statusCode: 200,
    routerId: profile.routerId,
    routerSecret: profile.routerSecret,
    pollInterval: 10,
    burstInterval: 3,
    serverTime: Date.now()
  };
}

/**
 * Unpairs router and revokes token
 */
export async function unpairRouter(redis) {
  if (inMemoryProfile) {
    inMemoryProfile.registered = false;
    inMemoryProfile.status = 'unpaired';
    inMemoryProfile.isOnline = false;
    inMemoryProfile.pairingToken = '';
    inMemoryProfile.routerSecret = '';
    inMemoryProfile.lastSeen = null;
    inMemoryProfile.lastSeenEpoch = 0;
    saveProfileToDisk(inMemoryProfile);
    if (redis) {
      try {
        await redis.set('router:profile', JSON.stringify(inMemoryProfile));
        await redis.del('router:token');
        await redis.del('router:secret');
        await redis.del('router:install_progress');
      } catch {}
    }
  }
  inMemoryInstallProgress = {
    stage: 0,
    totalStages: 10,
    stageName: 'Idle',
    percent: 0,
    status: 'idle',
    log: 'Router unpaired. Ready to pair new Archer C6.',
    error: '',
    timestamp: new Date().toISOString()
  };
  addAuditLog({ action: 'ROUTER_UNPAIRED', details: 'Router pairing revoked by administrator', status: 'warning' });
  return { ok: true, message: 'Router unpaired successfully.' };
}

/**
 * Verifies outbound request from OpenWrt agent
 */
export function verifyRouterCredentials(req, expectedSecret, expectedToken) {
  const customSecret = req.headers?.['x-router-secret'] ||
                       req.headers?.['x-archer-c6-secret'] ||
                       req.headers?.['x-pairing-token'] ||
                       req.headers?.['authorization']?.replace(/^Bearer\s+/i, '') ||
                       '';
  if (!customSecret) return false;
  if (expectedSecret && timingSafeCompare(customSecret, expectedSecret)) return true;
  if (expectedToken && timingSafeCompare(customSecret, expectedToken)) return true;
  return false;
}

/**
 * Dequeues pending commands for the OpenWrt router agent
 */
export async function dequeuePendingCommands(redis, limit = 5) {
  const pendingCommands = [];
  if (redis) {
    try {
      let cmd = await redis.lpop('pending_commands');
      while (cmd && pendingCommands.length < limit) {
        pendingCommands.push(typeof cmd === 'string' ? JSON.parse(cmd) : cmd);
        cmd = await redis.lpop('pending_commands');
      }
    } catch {}
  } else {
    while (inMemoryCommandQueue.length > 0 && pendingCommands.length < limit) {
      pendingCommands.push(inMemoryCommandQueue.shift());
    }
  }
  return pendingCommands;
}

/**
 * Handles incoming heartbeat & telemetry from OpenWrt router agent
 */
export async function handleRouterHeartbeat(body, req, redis) {
  const profile = await getRouterProfile(redis);
  const isValid = verifyRouterCredentials(req, profile?.routerSecret, profile?.pairingToken);

  if (!profile?.registered || !isValid) {
    return { ok: false, error: 'Unauthorized: Invalid router credentials', statusCode: 401 };
  }

  // Bind or check Router ID
  if (body?.routerId && profile.routerId && body.routerId !== profile.routerId) {
    if (!profile.lastSeen || profile.status === 'registered') {
      profile.routerId = body.routerId;
    } else {
      return { ok: false, error: 'Router ID does not match the paired device.', statusCode: 403 };
    }
  }

  const now = Date.now();
  profile.lastSeen = new Date().toISOString();
  profile.lastSeenEpoch = now;
  profile.status = 'online';
  profile.isOnline = true;

  if (body?.system?.model) profile.model = body.system.model;
  if (body?.system?.openwrtVersion) profile.openwrtVersion = body.system.openwrtVersion;

  // Merge full router status into memory and Redis
  const telemetry = {
    ...getSimulatedStatus(),
    ...(body.status || body),
    last_update: new Date().toISOString(),
    source: 'archer_c6_agent'
  };

  globalThis.__localRouterStatus = telemetry;
  globalThis.__localRouterStatusTimestamp = now;

  if (redis) {
    try {
      await redis.set('router:profile', JSON.stringify(profile));
      await redis.set('router:latest_status', JSON.stringify(telemetry), { ex: 300 });
    } catch {}
  } else {
    saveProfileToDisk(profile);
  }

  // Dequeue pending commands for this router
  const pendingCommands = await dequeuePendingCommands(redis, 5);

  return {
    ok: true,
    serverTime: now,
    commands: pendingCommands,
    routerSecret: profile.routerSecret || profile.pairingToken || ''
  };
}

/**
 * Records execution result confirmed by OpenWrt agent
 */
export async function recordCommandResult(body, redis) {
  const { commandId, command, status, output, executedAt } = body;
  if (!commandId) return { ok: false, error: 'Missing commandId' };

  const resultRecord = {
    commandId,
    command,
    status: status || 'success',
    output: output || '',
    executedAt: executedAt || new Date().toISOString(),
    confirmedAt: new Date().toISOString()
  };

  inMemoryCommandResults.set(commandId, resultRecord);

  if (redis) {
    try {
      await redis.set(`cmd_result:${commandId}`, JSON.stringify(resultRecord), { ex: 3600 });
    } catch {}
  }

  addAuditLog({
    action: 'COMMAND_CONFIRMED',
    commandId,
    command: String(command).slice(0, 80),
    status: status === 'failed' ? 'failed' : 'success',
    details: output ? String(output).slice(0, 120) : 'Operation confirmed by Archer C6 kernel'
  });

  return { ok: true, confirmed: true };
}

/**
 * Queues an authenticated administrative command for the router
 */
export async function enqueueCommandForRouter(commandPayload, redis) {
  const commandId = 'cmd-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
  const cleanCmd = (commandPayload.routerCmd || commandPayload.command || '').trim();

  if (isDangerousRouterCommand(cleanCmd)) {
    return { ok: false, error: 'SAFETY ALERT: Command contains dangerous firmware/storage operations.', blocked: true };
  }

  const nowEpoch = Math.floor(Date.now() / 1000);
  const expiresEpoch = commandPayload.expiresEpoch || (nowEpoch + 300); // 5 minutes TTL
  const expiresIso = commandPayload.expiresAt || new Date((expiresEpoch) * 1000).toISOString();

  let resolvedValue = commandPayload.value;
  if ((resolvedValue === null || resolvedValue === undefined || resolvedValue === '') && commandPayload.extra && typeof commandPayload.extra === 'object') {
    resolvedValue = JSON.stringify(commandPayload.extra);
  }

  const queuedItem = {
    commandId,
    action: commandPayload.action || cleanCmd,
    command: commandPayload.action || cleanCmd,
    target: commandPayload.target == null ? '' : String(commandPayload.target),
    value: resolvedValue == null ? '' : (typeof resolvedValue === 'string' ? resolvedValue : JSON.stringify(resolvedValue)),
    extra: commandPayload.extra || null,
    expiresAt: expiresIso,
    expiresEpoch,
    enqueuedAt: new Date().toISOString()
  };

  const initialStatus = {
    commandId,
    command: cleanCmd,
    status: 'queued',
    enqueuedAt: queuedItem.enqueuedAt
  };

  inMemoryCommandResults.set(commandId, initialStatus);

  if (redis) {
    try {
      await redis.rpush('pending_commands', JSON.stringify(queuedItem));
      await redis.set(`cmd_result:${commandId}`, JSON.stringify(initialStatus), { ex: 3600 });
    } catch (e) {
      console.warn('[Router Bridge] Could not push to Redis queue:', e.message);
    }
  } else {
    inMemoryCommandQueue.push(queuedItem);
  }

  addAuditLog({
    action: 'COMMAND_QUEUED',
    commandId,
    command: cleanCmd.slice(0, 80),
    status: 'pending',
    details: 'Dispatched to Archer C6 queue'
  });

  return {
    ok: true,
    commandId,
    command: cleanCmd,
    message: 'Command securely queued for Archer C6 execution.'
  };
}

/**
 * Fetches command confirmation status
 */
export async function getCommandStatus(commandId, redis) {
  if (redis) {
    try {
      const stored = await redis.get(`cmd_result:${commandId}`);
      if (stored) return typeof stored === 'string' ? JSON.parse(stored) : stored;
    } catch {}
  }
  return inMemoryCommandResults.get(commandId) || { commandId, status: 'unknown' };
}

export function addAuditLog(entry) {
  const logItem = {
    id: 'log-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString(),
    ...entry
  };
  inMemoryAuditLogs.unshift(logItem);
  if (inMemoryAuditLogs.length > 50) inMemoryAuditLogs.pop();
}

export function getAuditLogs() {
  return inMemoryAuditLogs.slice(0, 30);
}

/**
 * Generates autonomous OpenWrt installer script for Archer C6 v3.2
 */
export function generateInstallScript(serverOrigin, profile) {
  const origin = serverOrigin || process.env.CYBERWAVE_PUBLIC_URL || 'https://cyberwave.ai.studio';
  const token = profile?.pairingToken || '';
  const routerId = profile?.routerId || '';
  if (!profile?.registered || !token || !routerId) {
    throw new Error('Router must be paired before generating an installer.');
  }

  return `#!/bin/sh
# CyberWave Unified One-Click Bootstrap for TP-Link Archer C6 V3.2 / OpenWrt 25.12.6
set -eu
SERVER_URL='${origin}'
ROUTER_ID='${routerId}'
PAIRING_TOKEN='${token}'
TMP='/tmp/cyberwave-oneclick-installer.sh'
command -v uclient-fetch >/dev/null 2>&1 || { echo 'uclient-fetch is required'; exit 1; }
# Primary: unified one-click installer; fallback: legacy router/install-agent.sh
uclient-fetch -q --timeout=30 -O "$TMP" "${origin}/router/cyberwave-oneclick-installer.sh" || uclient-fetch -q --timeout=30 -O "$TMP" "${origin}/router/install-agent.sh"
[ -s "$TMP" ] || { echo 'Installer download is empty'; exit 1; }
sh -n "$TMP" || { echo 'Installer syntax check failed'; exit 1; }
exec /bin/sh "$TMP" "$SERVER_URL" "$ROUTER_ID" "$PAIRING_TOKEN"
`;
}

/**
 * Records installation progress reported by the one-click installer on the router
 */
export async function recordInstallProgress(body, redis) {
  const { stage, totalStages, stageName, percent, status, log, error } = body || {};
  const progressRecord = {
    stage: Number(stage) || 0,
    totalStages: Number(totalStages) || 10,
    stageName: stageName || 'Installing',
    percent: Number(percent) || 0,
    status: status || 'in_progress',
    log: log || '',
    error: error || '',
    timestamp: new Date().toISOString()
  };

  inMemoryInstallProgress = progressRecord;

  if (redis) {
    try {
      await redis.set('router:install_progress', JSON.stringify(progressRecord), { ex: 3600 });
    } catch {}
  }

  addAuditLog({
    action: 'INSTALL_PROGRESS',
    status: status === 'failed' ? 'failed' : 'info',
    details: `[Stage ${stage}/${totalStages}] ${stageName} (${percent}%) - ${log || error || ''}`
  });

  return { ok: true, progress: progressRecord };
}

/**
 * Retrieves the latest recorded installation progress
 */
export async function getInstallProgress(redis) {
  if (redis) {
    try {
      const stored = await redis.get('router:install_progress');
      if (stored) return typeof stored === 'string' ? JSON.parse(stored) : stored;
    } catch {}
  }
  return inMemoryInstallProgress;
}

