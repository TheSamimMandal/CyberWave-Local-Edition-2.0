/**
 * /api/router.js
 *
 * Cloud Bridge & Secure Remote Router Management API for ArcherGuard C6 (OpenWrt).
 * Bridges online admin panel with outbound TP-Link Archer C6 v3.2 agent.
 * Supports dual persistence: local persistent storage in data/router-bridge.json
 * and Upstash Redis when configured.
 * Kept strictly under 250 lines (DRY modular design).
 */

import { Redis } from '@upstash/redis';
import crypto from 'node:crypto';
import { checkRouterAuth, isDangerousRouterCommand } from '../lib/router/safety.js';
import { checkAdminAuth } from '../lib/admin/auth.js';
import { getSimulatedStatus } from '../lib/router/status-sim.js';
import { getSimulatedTerminalOutput } from '../lib/router/terminal-sim.js';
import { buildRouterCommand } from '../lib/router/commands.js';
import {
  getRouterProfile,
  registerRouter,
  pairAgentWithToken,
  unpairRouter,
  handleRouterHeartbeat,
  verifyRouterCredentials,
  recordCommandResult,
  enqueueCommandForRouter,
  dequeuePendingCommands,
  getCommandStatus,
  getAuditLogs,
  generateInstallScript,
  recordInstallProgress,
  getInstallProgress
} from '../lib/router/bridge.js';

export { checkRouterAuth, isDangerousRouterCommand, getSimulatedStatus, getSimulatedTerminalOutput };

let lastLocalCheckFailed = 0;
const localInstallTickets = new Map();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Router-ID, X-Router-Secret, X-Admin-Password, X-Admin-Secret, Authorization');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ status: 'ok' });
  }

  const routerSecret = process.env.ARCHER_C6_SECRET || process.env.ROUTER_SECRET_KEY || process.env.ADMIN_PASSWORD;
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  let redis = null;
  if (redisUrl && redisToken) {
    try {
      redis = new Redis({ url: redisUrl, token: redisToken });
    } catch (e) {
      console.warn('[Router API] Redis initialization warning:', e.message);
    }
  }

  const url = new URL(req.url, 'http://localhost');
  const queryAction = url.searchParams.get('action') || '';

  try {
    // 1. GET: Fetch router status, registration profile, logs, or installation script
    if (req.method === 'GET') {
      if (queryAction === 'profile') {
        const isAuthed = checkAdminAuth(req) || (routerSecret && checkRouterAuth(req, routerSecret));
        if (!isAuthed) {
          return res.status(401).json({ error: 'Unauthorized: Admin authentication required.' });
        }
        const profile = await getRouterProfile(redis, { maskSecrets: true });
        let latestStatus = null;
        if (redis) {
          try {
            latestStatus = await redis.get('router:latest_status');
            if (typeof latestStatus === 'string') latestStatus = JSON.parse(latestStatus);
          } catch {}
        }
        if (!latestStatus && globalThis.__localRouterStatus) {
          latestStatus = globalThis.__localRouterStatus;
        }
        return res.status(200).json({ ok: true, profile, status: latestStatus });
      }

      if (queryAction === 'logs') {
        if (!checkAdminAuth(req)) {
          return res.status(401).json({ error: 'Unauthorized: Admin authentication required.' });
        }
        return res.status(200).json({ ok: true, logs: getAuditLogs() });
      }

      if (queryAction === 'command_status') {
        const isAuthed = checkAdminAuth(req) || (routerSecret && checkRouterAuth(req, routerSecret));
        if (!isAuthed) {
          return res.status(401).json({ error: 'Unauthorized: Admin authentication required.' });
        }
        const cmdId = url.searchParams.get('id') || '';
        const status = await getCommandStatus(cmdId, redis);
        return res.status(200).json({ ok: true, status });
      }

      // Router Agent: Outbound Command Polling
      if (queryAction === 'poll' || queryAction === 'bridge_poll') {
        const profile = await getRouterProfile(redis);
        const isValid = verifyRouterCredentials(req, profile?.routerSecret, profile?.pairingToken) || (routerSecret && checkRouterAuth(req, routerSecret));
        if (!isValid) {
          return res.status(401).json({ error: 'Unauthorized: Invalid router credentials.' });
        }
        const commands = await dequeuePendingCommands(redis, 5);
        return res.status(200).json({ ok: true, commands, serverTime: Date.now() });
      }

      if (queryAction === 'create_install_ticket') {
        if (!checkAdminAuth(req)) {
          return res.status(401).json({ error: 'Admin authentication required.' });
        }
        let profile = await getRouterProfile(redis, { maskSecrets: false });
        if (!profile?.registered || !profile?.pairingToken) {
          const autoReg = await registerRouter({ routerName: 'TP-Link Archer C6 v3.2', routerId: 'cw-c6-5510ec67' }, redis);
          profile = autoReg.profile;
        }
        const ticket = crypto.randomBytes(24).toString('hex');
        localInstallTickets.set(ticket, { routerId: profile.routerId, expires: Date.now() + 300000 });
        if (redis) {
          try {
            await redis.set(`router:install_ticket:${ticket}`, JSON.stringify({ routerId: profile.routerId }), { ex: 300 });
          } catch (e) {
            console.warn('[Router Bridge] Redis ticket save warning:', e.message);
          }
        }
        return res.status(200).json({ ok: true, ticket, expiresIn: 300 });
      }

      if (queryAction === 'install_progress' || queryAction === 'get_install_progress') {
        const isAuthed = checkAdminAuth(req) || (routerSecret && checkRouterAuth(req, routerSecret));
        if (!isAuthed) {
          return res.status(401).json({ error: 'Unauthorized: Admin authentication required.' });
        }
        const progress = await getInstallProgress(redis);
        return res.status(200).json({ ok: true, progress });
      }

      if (queryAction === 'install_script' || queryAction === 'oneclick_script') {
        let rawProfile = await getRouterProfile(redis, { maskSecrets: false });
        const ticket = url.searchParams.get('ticket') || '';
        let validTicket = false;
        if (ticket) {
          const local = localInstallTickets.get(ticket);
          if (local && local.expires > Date.now()) {
            validTicket = true;
            localInstallTickets.delete(ticket);
          } else if (redis) {
            const ticketKey = `router:install_ticket:${ticket}`;
            try {
              const storedTicket = await redis.get(ticketKey);
              const ticketData = typeof storedTicket === 'string' ? JSON.parse(storedTicket) : storedTicket;
              if (ticketData?.routerId) {
                validTicket = true;
                await redis.del(ticketKey);
              }
            } catch {}
          }
        }
        const isAuthed = validTicket || checkAdminAuth(req);
        if (!isAuthed) {
          return res.status(401).json({ error: 'Installer ticket expired or invalid. Create a new installer command in CyberWave Admin.' });
        }
        if (!rawProfile?.registered || !rawProfile?.pairingToken) {
          const autoReg = await registerRouter({ routerName: 'TP-Link Archer C6 v3.2', routerId: 'cw-c6-5510ec67' }, redis);
          rawProfile = autoReg.profile;
        }
        const reqProto = req.headers?.['x-forwarded-proto'] || (req.headers?.host?.includes('localhost') ? 'http' : 'https');
        const reqHost = req.headers?.host || 'localhost:3000';
        const origin = process.env.APP_URL || `${reqProto}://${reqHost}`;
        const script = generateInstallScript(origin, rawProfile);
        res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        if (typeof res.send === 'function') return res.send(script);
        res.end(script);
        return;
      }

    const incomingRouterSecret = req.headers?.['x-router-secret'] || req.headers?.['x-archer-c6-secret'];
    if (incomingRouterSecret && routerSecret && !checkRouterAuth(req, routerSecret)) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing x-router-secret.' });
    }

    if (redis) {
      try {
        const cachedStatus = await redis.get('router:latest_status');
        if (cachedStatus) {
          const parsed = typeof cachedStatus === 'string' ? JSON.parse(cachedStatus) : cachedStatus;
          return res.status(200).json(parsed);
        }
      } catch (e) {
        console.warn('[Router API] Redis status read notice:', e.message);
      }
    }

    if (globalThis.__localRouterStatus && (Date.now() - (globalThis.__localRouterStatusTimestamp || 0)) < 15000) {
      return res.status(200).json(globalThis.__localRouterStatus);
    }

    if (process.env.ROUTER_SIM_ONLY !== 'true' && process.env.NODE_ENV !== 'test' && (Date.now() - lastLocalCheckFailed > 10000)) {
      try {
        const liveRes = await fetch('http://192.168.1.1/cgi-bin/api?action=status', { signal: AbortSignal.timeout(1500) });
        if (liveRes.ok) {
          const liveData = await liveRes.json();
          liveData.source = 'local_router';
          globalThis.__localRouterStatus = liveData;
          globalThis.__localRouterStatusTimestamp = Date.now();
          return res.status(200).json(liveData);
        }
      } catch {
        lastLocalCheckFailed = Date.now();
      }
    }

    if (globalThis.__localRouterStatus) {
      return res.status(200).json(globalThis.__localRouterStatus);
    }

    return res.status(200).json(getSimulatedStatus());
  }

  // 2. POST: Telemetry reporting, bridge heartbeat, commands, or pairing
  if (req.method === 'POST') {
    const payload = req.body || {};
    const action = payload.action || queryAction;

    // Agent: Dedicated Pairing Handshake with Pairing Token
    if (action === 'pair' || action === 'agent_register' || action === 'register_agent') {
      const pairResult = await pairAgentWithToken(payload, req, redis);
      return res.status(pairResult.statusCode || (pairResult.ok ? 200 : 400)).json(pairResult);
    }

    // Outbound Bridge Heartbeat from OpenWrt Agent
    if (action === 'bridge_heartbeat') {
      const hbResult = await handleRouterHeartbeat(payload, req, redis);
      return res.status(hbResult.statusCode || (hbResult.ok ? 200 : 400)).json(hbResult);
    }

    // Outbound Command Poll from OpenWrt Agent
    if (action === 'poll' || action === 'bridge_poll') {
      const profile = await getRouterProfile(redis);
      const isValid = verifyRouterCredentials(req, profile?.routerSecret, profile?.pairingToken) || (routerSecret && checkRouterAuth(req, routerSecret));
      if (!isValid) {
        return res.status(401).json({ error: 'Unauthorized: Invalid router credentials.' });
      }
      const commands = await dequeuePendingCommands(redis, 5);
      return res.status(200).json({ ok: true, commands, serverTime: Date.now() });
    }

    // Outbound Command Result Confirmation from OpenWrt Agent
    if (action === 'bridge_report_result') {
      const profile = await getRouterProfile(redis);
      if (!profile?.registered || !verifyRouterCredentials(req, profile.routerSecret, profile.pairingToken)) {
        return res.status(401).json({ error: 'Unauthorized: invalid router credentials.' });
      }
      if (payload.routerId && profile.routerId && payload.routerId !== profile.routerId) {
        return res.status(403).json({ error: 'Router ID does not match the paired device.' });
      }
      const resultAck = await recordCommandResult(payload, redis);
      return res.status(resultAck.ok ? 200 : 400).json(resultAck);
    }

    // Admin: Pair or Register Router
    if (action === 'register_router' || action === 'pair_router') {
      if (!checkAdminAuth(req)) {
        return res.status(401).json({ error: 'Unauthorized: Admin authentication required.' });
      }
      const regResult = await registerRouter(payload, redis);
      return res.status(200).json(regResult);
    }

    // Admin: Unpair Router
    if (action === 'unpair_router') {
      if (!checkAdminAuth(req)) {
        return res.status(401).json({ error: 'Unauthorized: Admin authentication required.' });
      }
      const unpairResult = await unpairRouter(redis);
      return res.status(200).json(unpairResult);
    }

    // Ingest Installation Progress from Router One-Click Installer
    if (action === 'install_progress') {
      const profile = await getRouterProfile(redis);
      const incomingToken = payload.pairingToken || req.headers?.['x-router-secret'] || req.headers?.['x-pairing-token'];
      if (profile?.registered && profile?.pairingToken && incomingToken) {
        if (!verifyRouterCredentials(req, profile.routerSecret, profile.pairingToken) && incomingToken !== profile.pairingToken) {
          return res.status(401).json({ error: 'Unauthorized router pairing credentials.' });
        }
      }
      const rec = await recordInstallProgress(payload, redis);
      return res.status(200).json(rec);
    }

    // Admin: Trigger Complete One-Click Installation Workflow
    if (action === 'trigger_oneclick_install') {
      if (!checkAdminAuth(req)) {
        return res.status(401).json({ error: 'Unauthorized: Admin authentication required.' });
      }
      let profile = await getRouterProfile(redis, { maskSecrets: false });
      if (!profile?.registered || !profile?.pairingToken) {
        const autoReg = await registerRouter({ routerName: 'TP-Link Archer C6 v3.2', routerId: 'cw-c6-5510ec67' }, redis);
        profile = autoReg.profile;
      }

      // Generate single-line SSH command
      const ticket = crypto.randomBytes(24).toString('hex');
      localInstallTickets.set(ticket, { routerId: profile.routerId, expires: Date.now() + 300000 });
      if (redis) {
        try {
          await redis.set(`router:install_ticket:${ticket}`, JSON.stringify({ routerId: profile.routerId }), { ex: 300 });
        } catch (e) {
          console.warn('[Router Bridge] Redis ticket save warning:', e.message);
        }
      }

      const reqProto = req.headers?.['x-forwarded-proto'] || (req.headers?.host?.includes('localhost') ? 'http' : 'https');
      const reqHost = req.headers?.host || 'localhost:3000';
      const serverOrigin = process.env.APP_URL || `${reqProto}://${reqHost}`;
      const sshCommand = `uclient-fetch -q --timeout=30 -O - "${serverOrigin}/api/router?action=oneclick_script&ticket=${ticket}" | sh`;

      // If router is already connected via bridge, enqueue oneclick_setup command
      let queued = null;
      if (profile.isOnline) {
        queued = await enqueueCommandForRouter({
          action: 'oneclick_setup',
          command: 'oneclick_setup',
          target: 'all',
          value: JSON.stringify({ serverUrl: serverOrigin, routerId: profile.routerId })
        }, redis);
      }

      // Initialize install progress
      await recordInstallProgress({
        stage: 1,
        totalStages: 10,
        stageName: 'Pre-installation checks',
        percent: 10,
        status: 'in_progress',
        log: 'One-click setup triggered from Admin Dashboard.'
      }, redis);

      return res.status(200).json({
        ok: true,
        message: 'Complete CyberWave setup triggered.',
        isOnline: profile.isOnline,
        queued: !!queued?.ok,
        sshCommand,
        ticket,
        expiresIn: 300
      });
    }

    // Admin: Trigger Rollback using Saved Backup
    if (action === 'trigger_rollback') {
      if (!checkAdminAuth(req)) {
        return res.status(401).json({ error: 'Unauthorized: Admin authentication required.' });
      }
      const queued = await enqueueCommandForRouter({
        action: 'rollback_setup',
        command: 'rollback_setup',
        target: 'all',
        value: ''
      }, redis);
      return res.status(200).json({
        ok: true,
        message: 'Rollback command dispatched to router.',
        queued: !!queued?.ok
      });
    }

    // Admin: Trigger Clean Uninstallation
    if (action === 'trigger_uninstall') {
      if (!checkAdminAuth(req)) {
        return res.status(401).json({ error: 'Unauthorized: Admin authentication required.' });
      }
      const queued = await enqueueCommandForRouter({
        action: 'uninstall_setup',
        command: 'uninstall_setup',
        target: 'all',
        value: ''
      }, redis);
      return res.status(200).json({
        ok: true,
        message: 'Uninstall command dispatched to router.',
        queued: !!queued?.ok
      });
    }

    // Admin or Router Auth Verification for general commands
    if (!checkAdminAuth(req) && (!routerSecret || !checkRouterAuth(req, routerSecret))) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing authentication secret.' });
    }

    if (action === 'report_status') {
      if (!payload.status || typeof payload.status !== 'object') {
        return res.status(400).json({ error: 'Field "status" must be an object.' });
      }
      if (redis) {
        try {
          await redis.set('router:latest_status', JSON.stringify(payload.status), { ex: 300 });
        } catch {}
      }
      globalThis.__localRouterStatus = payload.status;
      return res.status(200).json({ status: 'ok', message: 'Metrics cached.' });
    }

    // Parse and validate administrative command
    const commandResult = await buildRouterCommand(payload, req, redis);
    if (commandResult.error) {
      const errResp = { error: commandResult.error };
      if (commandResult.blocked) errResp.blocked = true;
      if (commandResult.command) errResp.command = commandResult.command;
      return res.status(commandResult.statusCode || 400).json(errResp);
    }

    const { routerCmd, simulatedOutput, cleanCmd } = commandResult;

    // Queue structured parameters safely
    let cmdValue = payload.value;
    if ((cmdValue === null || cmdValue === undefined || cmdValue === '') && payload.extra && typeof payload.extra === 'object') {
      cmdValue = JSON.stringify(payload.extra);
    }

    const queueResult = await enqueueCommandForRouter({
      action: cleanCmd,
      command: cleanCmd,
      target: payload.target,
      value: cmdValue,
      extra: payload.extra,
      expiresAt: new Date(Date.now() + 300000).toISOString()
    }, redis);

    if (!queueResult.ok) {
      return res.status(queueResult.blocked ? 403 : 400).json({ error: queueResult.error || 'Could not queue router command.' });
    }

    if (Array.isArray(globalThis.__localDevQueue)) {
      globalThis.__localDevQueue.push({
        command: cleanCmd,
        target: payload.target,
        value: payload.value,
        routerCmd: routerCmd || cleanCmd
      });
    }

    const responsePayload = {
      success: true,
      commandId: queueResult.commandId,
      command: cleanCmd,
      routerCmd: routerCmd || cleanCmd,
      message: `Command "${cleanCmd}" enqueued for Archer C6 execution.`
    };
    if (simulatedOutput !== null && simulatedOutput !== undefined) {
      responsePayload.output = simulatedOutput;
    }

    return res.status(200).json(responsePayload);
  }

    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ error: `Method ${req.method} Not Allowed. Use GET or POST.` });
  } catch (err) {
    console.error('[Router API Exception]', err);
    return res.status(500).json({ error: err.message || 'Router operation failed.' });
  }
}
