/**
 * lib/router/commands-sys.js
 *
 * Archer C6 system, client, quota, cron, smart-home and raw diagnostic commands.
 * Kept strictly under 250 lines.
 */

import { MAC_REGEX } from '../telegram/parsers.js';
import { isDangerousRouterCommand } from './safety.js';
import { getSimulatedTerminalOutput } from './terminal-sim.js';
import { simState } from './status-sim.js';

export async function handleSystemAndClientCommands(cleanCmd, payload, req, redis) {
  const target = (payload.target || payload.mac || '').toLowerCase();
  const value = payload.value !== undefined ? payload.value : (payload.val !== undefined ? payload.val : payload.minutes);

  switch (cleanCmd) {
    case 'ping_test':
      return { routerCmd: 'ping_test' };

    case 'wifi_reload':
      return { routerCmd: 'wifi_reload' };

    case 'reboot':
      return { routerCmd: 'reboot' };

    case 'drop_caches':
      return { routerCmd: 'echo 3 > /proc/sys/vm/drop_caches' };

    case 'block_client': {
      if (!target || !MAC_REGEX.test(target)) return { error: 'Valid target MAC address required for block_client.', statusCode: 400 };
      const sc = simState.clients?.find(c => c.mac.toLowerCase() === target);
      if (sc) sc.blocked = true;
      const gc = globalThis.__localRouterStatus?.clients?.find(c => c.mac.toLowerCase() === target);
      if (gc) gc.blocked = true;
      return { routerCmd: `iptables -I FORWARD 1 -m mac --mac-source ${target} -j DROP` };
    }

    case 'unblock_client': {
      if (!target || !MAC_REGEX.test(target)) return { error: 'Valid target MAC address required for unblock_client.', statusCode: 400 };
      const sc = simState.clients?.find(c => c.mac.toLowerCase() === target);
      if (sc) sc.blocked = false;
      const gc = globalThis.__localRouterStatus?.clients?.find(c => c.mac.toLowerCase() === target);
      if (gc) gc.blocked = false;
      return { routerCmd: `iptables -D FORWARD -m mac --mac-source ${target} -j DROP` };
    }

    case 'nds_auth': {
      if (!target || !MAC_REGEX.test(target)) return { error: 'Valid target MAC address required for nds_auth.', statusCode: 400 };
      const sc = simState.clients?.find(c => c.mac.toLowerCase() === target);
      if (sc) sc.nds_authenticated = true;
      const gc = globalThis.__localRouterStatus?.clients?.find(c => c.mac.toLowerCase() === target);
      if (gc) gc.nds_authenticated = true;
      const duration = parseInt(value, 10);
      const safeDuration = !isNaN(duration) && duration >= 0 ? duration : 120;
      return { routerCmd: `ndsctl auth ${target} ${safeDuration}` };
    }

    case 'nds_deauth':
    case 'deauth': {
      if (!target || !MAC_REGEX.test(target)) return { error: 'Valid target MAC address required for nds_deauth.', statusCode: 400 };
      const sc = simState.clients?.find(c => c.mac.toLowerCase() === target);
      if (sc) sc.nds_authenticated = false;
      const gc = globalThis.__localRouterStatus?.clients?.find(c => c.mac.toLowerCase() === target);
      if (gc) gc.nds_authenticated = false;
      return { routerCmd: `ndsctl deauth ${target}` };
    }

    case 'kick_client':
    case 'disconnect_client': {
      if (!target || !MAC_REGEX.test(target)) return { error: 'Valid target MAC address required for disconnect_client.', statusCode: 400 };
      const simClient = simState.clients?.find(c => c.mac.toLowerCase() === target);
      if (simClient) simClient.connected_seconds = 0;
      return { routerCmd: `ndsctl deauth ${target} 2>/dev/null; for h in /var/run/hostapd-phy* /var/run/hostapd/wlan* /var/run/hostapd/phy*; do [ -e "$h" ] && hostapd_cli -p "$h" deauthenticate ${target} 2>/dev/null; done` };
    }

    case 'wol':
      if (!target || !MAC_REGEX.test(target)) return { error: 'Valid target MAC address required for wol.', statusCode: 400 };
      return { routerCmd: `etherwake -i br-lan ${target}` };

    case 'set_static_lease': {
      if (!target || !MAC_REGEX.test(target)) return { error: 'Valid target MAC address required for set_static_lease.', statusCode: 400 };
      const ip = value && typeof value === 'string' ? value.trim() : '';
      if (!/^192\.168\.\d+\.\d+$/.test(ip) && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
        return { error: 'Valid IP address required for set_static_lease.', statusCode: 400 };
      }
      return { routerCmd: `uci set dhcp.host_${target.toLowerCase().replace(/:/g, '')}=host && uci set dhcp.host_${target.toLowerCase().replace(/:/g, '')}.mac='${target.toLowerCase()}' && uci set dhcp.host_${target.toLowerCase().replace(/:/g, '')}.ip='${ip}' && uci commit dhcp` };
    }

    case 'del_static_lease':
      if (!target || !MAC_REGEX.test(target)) return { error: 'Valid target MAC address required for del_static_lease.', statusCode: 400 };
      return { routerCmd: `uci delete dhcp.host_${target.toLowerCase().replace(/:/g, '')} && uci commit dhcp` };

    case 'rename_client':
    case 'set_alias': {
      if (!target || !MAC_REGEX.test(target)) return { error: 'Valid target MAC address required for rename_client.', statusCode: 400 };
      const rawName = (payload.name !== undefined ? payload.name : (payload.alias !== undefined ? payload.alias : value)) || '';
      const cleanAlias = String(rawName).trim().slice(0, 64).replace(/['"\\]/g, '');
      const sc = simState.clients?.find(c => c.mac.toLowerCase() === target);
      if (sc) sc.custom_name = cleanAlias;
      const gc = globalThis.__localRouterStatus?.clients?.find(c => c.mac.toLowerCase() === target);
      if (gc) gc.custom_name = cleanAlias;
      if (redis) {
        try {
          if (cleanAlias) await redis.set(`device_alias:${target}`, cleanAlias);
          else await redis.del(`device_alias:${target}`);
        } catch {}
      }
      return { routerCmd: `touch /etc/archer_guard_clients.conf && sed -i '/^${target}|/d' /etc/archer_guard_clients.conf && echo '${target}|${cleanAlias}|0|0' >> /etc/archer_guard_clients.conf` };
    }

    case 'led_stealth': {
      const brightness = value === 'on' ? '1' : '0';
      return { routerCmd: `for _l in /sys/class/leds/*; do [ -d "$_l" ] && echo ${brightness} > "$_l/brightness" 2>/dev/null; done` };
    }

    case 'set_quota': {
      const quotaGb = parseInt(value, 10) || 50;
      const resetDay = parseInt(req.body?.reset_day || (typeof target === 'number' ? target : 1), 10) || 1;
      const warnPct = parseInt(req.body?.warning_percent || 80, 10) || 80;
      simState.quotaGb = quotaGb; simState.quotaResetDay = resetDay; simState.quotaWarnPct = warnPct;
      if (globalThis.__localRouterStatus?.analytics?.quota) {
        Object.assign(globalThis.__localRouterStatus.analytics.quota, { total_gb: quotaGb, reset_day: resetDay, warning_percent: warnPct });
      }
      globalThis.__localRouterStatusTimestamp = 0;
      if (redis) {
        try {
          const cached = await redis.get('router:latest_status');
          if (cached) {
            const p = typeof cached === 'string' ? JSON.parse(cached) : cached;
            if (p.analytics?.quota) {
              Object.assign(p.analytics.quota, { total_gb: quotaGb, reset_day: resetDay, warning_percent: warnPct });
              await redis.set('router:latest_status', JSON.stringify(p), { ex: 300 });
            }
          }
        } catch {}
      }
      return { routerCmd: `uci set archer_guard.quota=section && uci set archer_guard.quota.total_gb='${quotaGb}' && uci set archer_guard.quota.reset_day='${resetDay}' && uci set archer_guard.quota.warn_pct='${warnPct}' && uci commit archer_guard` };
    }

    case 'reset_quota': {
      simState.quotaUsedBytes = 0; simState.quotaRxBytes = 0; simState.quotaTxBytes = 0;
      if (globalThis.__localRouterStatus?.analytics?.quota) {
        Object.assign(globalThis.__localRouterStatus.analytics.quota, { used_bytes: 0, rx_bytes: 0, tx_bytes: 0 });
      }
      globalThis.__localRouterStatusTimestamp = 0;
      if (redis) {
        try {
          const cached = await redis.get('router:latest_status');
          if (cached) {
            const p = typeof cached === 'string' ? JSON.parse(cached) : cached;
            if (p.analytics?.quota) {
              Object.assign(p.analytics.quota, { used_bytes: 0, rx_bytes: 0, tx_bytes: 0 });
              await redis.set('router:latest_status', JSON.stringify(p), { ex: 300 });
            }
          }
        } catch {}
      }
      return { routerCmd: `wrtbwmon reset || rm -f /tmp/usage.db /tmp/wrtbwmon/usage.db` };
    }

    case 'set_client_quota': {
      if (!target || !MAC_REGEX.test(target)) return { error: 'Valid target MAC address required for set_client_quota.', statusCode: 400 };
      const capGb = parseFloat(value) || 10;
      return { routerCmd: `uci set archer_guard.quota_${target.toLowerCase().replace(/:/g, '')}='${capGb}' && uci commit archer_guard` };
    }

    case 'toggle_cron_task': {
      const task = target && /^[a-zA-Z0-9_-]+$/.test(target) ? target : 'midnight_reboot';
      const enabled = (value === 'on' || value === '1' || value === true);
      let cmd = '/etc/init.d/cron restart';
      if (task === 'midnight_reboot') {
        cmd = enabled ? `echo '0 4 * * * /sbin/reboot' >> /etc/crontabs/root && /etc/init.d/cron restart` : `sed -i '/\\/sbin\\/reboot/d' /etc/crontabs/root && /etc/init.d/cron restart`;
      } else if (task === 'wifi_sleep') {
        cmd = enabled ? `echo '0 1 * * * /sbin/wifi down' >> /etc/crontabs/root && echo '0 7 * * * /sbin/wifi up' >> /etc/crontabs/root && /etc/init.d/cron restart` : `sed -i '/wifi[[:space:]]\\+down/d' /etc/crontabs/root && sed -i '/wifi[[:space:]]\\+up/d' /etc/crontabs/root && /etc/init.d/cron restart`;
      } else if (task === 'nightly_flush') {
        cmd = enabled ? `echo '30 3 * * * sync && echo 3 > /proc/sys/vm/drop_caches' >> /etc/crontabs/root && /etc/init.d/cron restart` : `sed -i '/drop_caches/d' /etc/crontabs/root && /etc/init.d/cron restart`;
      }
      return { routerCmd: cmd };
    }

    case 'set_cron_schedule': {
      const expr = (target && typeof target === 'string') ? target.replace(/['"\\]/g, '') : '0 4 * * *';
      const cmd = (value && typeof value === 'string') ? value.replace(/['"\\]/g, '') : '/sbin/reboot';
      return { routerCmd: `echo '${expr} ${cmd}' >> /etc/crontabs/root && /etc/init.d/cron restart` };
    }

    case 'set_homeassistant_webhook': {
      const webhookUrl = (value && typeof value === 'string') ? value.replace(/['"\\]/g, '') : '';
      const enabled = req.body?.enabled !== false ? '1' : '0';
      return { routerCmd: `uci set archer_guard.ha=section && uci set archer_guard.ha.enabled='${enabled}' && uci set archer_guard.ha.webhook='${webhookUrl}' && uci commit archer_guard` };
    }

    case 'trigger_ha_webhook': {
      const webhookUrl = (req.body?.webhook_url && typeof req.body.webhook_url === 'string') ? req.body.webhook_url.replace(/['"\\]/g, '') : 'http://homeassistant.local:8123/api/webhook/archer_c6_presence';
      const mac = target && MAC_REGEX.test(target) ? target.toLowerCase() : '3c:22:fb:1a:2b:3c';
      const state = value === 'disconnected' ? 'disconnected' : 'connected';
      return { routerCmd: `curl -s -m 3 -X POST -H 'Content-Type: application/json' -d '{"device":"archer_c6","mac":"${mac}","state":"${state}"}' '${webhookUrl}'` };
    }

    case 'raw_cmd': {
      const rawCmd = (value && typeof value === 'string') ? value.trim() : (target && typeof target === 'string' ? target.trim() : 'uptime');
      if (isDangerousRouterCommand(rawCmd)) {
        return {
          error: 'SAFETY LOCK ACTIVATED: This command contains operations that could damage firmware or disrupt LAN access.',
          blocked: true,
          command: cleanCmd,
          statusCode: 403
        };
      }
      return { routerCmd: rawCmd, simulatedOutput: getSimulatedTerminalOutput(rawCmd) };
    }

    case 'set_dns_rebind': {
      const flag = (value === 'on' || value === '1' || value === true);
      simState.dnsRebindProtection = flag;
      return { routerCmd: `uci set dhcp.@dnsmasq[0].rebind_protection='${flag ? 1 : 0}' && uci commit dhcp && /etc/init.d/dnsmasq reload` };
    }

    case 'set_wan_lockdown': {
      const flag = (value === 'on' || value === '1' || value === true);
      simState.wanLockdown = flag;
      return { routerCmd: `uci set firewall.@defaults[0].input='${flag ? 'DROP' : 'ACCEPT'}' && uci commit firewall && /etc/init.d/firewall reload` };
    }

    case 'harden_security': {
      simState.pmfProtected = true;
      simState.dnsRebindProtection = true;
      simState.wanLockdown = true;
      return { routerCmd: `uci set dhcp.@dnsmasq[0].rebind_protection='1' && uci commit dhcp && /etc/init.d/dnsmasq reload; uci set wireless.default_radio0.ieee80211w='1'; uci set wireless.default_radio1.ieee80211w='1'; uci commit wireless && wifi reload` };
    }

    case 'opennds_toggle': {
      const action = (value === 'off' || value === '0' || value === false) ? 'stop' : 'start';
      return { routerCmd: `/etc/init.d/opennds ${action}` };
    }

    case 'get_diagnostics':
      return {
        routerCmd: 'ping -c 2 1.1.1.1 && free -m && df -h /overlay',
        simulatedOutput: 'Ping 1.1.1.1:\n2 packets transmitted, 2 received, 0% packet loss\n\nMemory:\n              total        used        free\nMem:            128          62          66\n\nOverlay Storage:\nFilesystem                Size      Used Available Use% Mounted on\n/dev/root                16.0M      4.2M     11.8M  26% /overlay'
      };

    case 'get_logs':
      return {
        routerCmd: 'logread -l 40',
        simulatedOutput: 'System logs retrieved from OpenWrt kernel.'
      };

    case 'backup_uci':
    case 'backup_config':
      return {
        routerCmd: `sysupgrade -b /tmp/backup-OpenWrt-c6.tar.gz || tar -czf /tmp/backup-OpenWrt-c6.tar.gz -C / etc/config etc/shadow`,
        simulatedOutput: 'Configuration backup generated successfully at /tmp/backup-OpenWrt-c6.tar.gz'
      };

    case 'oneclick_setup':
    case 'trigger_oneclick_install':
      return {
        routerCmd: 'sh /tmp/cyberwave-oneclick-installer.sh || true',
        simulatedOutput: 'Triggered CyberWave Unified One-Click Setup.'
      };

    case 'rollback_setup':
      return {
        routerCmd: 'sh /etc/cyberwave/backups/restore-pre-cyberwave.sh || true',
        simulatedOutput: 'Restored pre-installation router configuration.'
      };

    case 'uninstall_setup':
      return {
        routerCmd: 'sh /usr/bin/cyberwave-uninstall.sh || true',
        simulatedOutput: 'Uninstalled CyberWave services and cleaned configuration.'
      };

    default:
      return null;
  }
}
