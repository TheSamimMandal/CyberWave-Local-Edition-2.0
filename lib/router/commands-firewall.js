/**
 * lib/router/commands-firewall.js
 *
 * Archer C6 Firewall 4 (fw4 / nftables) commands, NAT rules & defense controls.
 * Kept strictly under 250 lines.
 */

import { simFirewallState } from './firewall-sim.js';

export async function handleFirewallCommands(cleanCmd, payload) {
  const value = payload.value !== undefined ? payload.value : (payload.val !== undefined ? payload.val : payload.enabled);
  const target = payload.target || payload.id || '';
  const isFlagTrue = (val) => val === 'on' || val === '1' || val === true || val === 1;

  switch (cleanCmd) {
    case 'set_syn_flood': {
      const flag = isFlagTrue(value);
      simFirewallState.synFlood = flag;
      return { routerCmd: `uci set firewall.@defaults[0].syn_flood='${flag ? 1 : 0}' && uci commit firewall && /etc/init.d/firewall reload` };
    }

    case 'set_drop_invalid': {
      const flag = isFlagTrue(value);
      simFirewallState.dropInvalid = flag;
      return { routerCmd: `uci set firewall.@defaults[0].drop_invalid='${flag ? 1 : 0}' && uci commit firewall && /etc/init.d/firewall reload` };
    }

    case 'set_wan_ping': {
      const flag = isFlagTrue(value);
      simFirewallState.wanPing = flag;
      return { routerCmd: `uci set firewall.@rule[1].target='${flag ? 'ACCEPT' : 'DROP'}' && uci commit firewall && /etc/init.d/firewall reload` };
    }

    case 'set_mss_clamping': {
      const flag = isFlagTrue(value);
      simFirewallState.mssClamping = flag;
      return { routerCmd: `uci set firewall.@zone[1].mtu_fix='${flag ? 1 : 0}' && uci commit firewall && /etc/init.d/firewall reload` };
    }

    case 'set_anti_spoofing': {
      const flag = isFlagTrue(value);
      simFirewallState.antiSpoofing = flag;
      return { routerCmd: `sysctl -w net.ipv4.conf.all.rp_filter=${flag ? 1 : 0}` };
    }

    case 'set_ipv6_firewall': {
      const flag = isFlagTrue(value);
      simFirewallState.ipv6Firewall = flag;
      return { routerCmd: `uci set firewall.@zone[1].auto_helper='${flag ? 0 : 1}' && uci commit firewall && /etc/init.d/firewall reload` };
    }

    case 'set_stealth_mode': {
      const flag = isFlagTrue(value);
      simFirewallState.stealthMode = flag;
      const cmd = flag
        ? `iptables -I INPUT 1 -p tcp --tcp-flags ALL NONE -j DROP 2>/dev/null || true`
        : `iptables -D INPUT -p tcp --tcp-flags ALL NONE -j DROP 2>/dev/null || true`;
      return { routerCmd: cmd };
    }

    case 'set_guest_isolation': {
      const flag = isFlagTrue(value);
      simFirewallState.guestIsolation = flag;
      const cmd = flag
        ? `iptables -I FORWARD 1 -i br-guest -o br-lan -j DROP 2>/dev/null || true`
        : `iptables -D FORWARD -i br-guest -o br-lan -j DROP 2>/dev/null || true`;
      return { routerCmd: cmd };
    }

    case 'set_flow_offload_hw': {
      const flag = isFlagTrue(value);
      simFirewallState.flowOffloadHw = flag;
      return { routerCmd: `uci set firewall.@defaults[0].flow_offloading_hw='${flag ? 1 : 0}' && uci commit firewall && /etc/init.d/firewall restart` };
    }

    case 'set_dmz': {
      const enabled = isFlagTrue(value !== undefined ? value : payload.enabled);
      const ip = (payload.ip || payload.dmz_ip || (typeof target === 'string' && target.includes('.') ? target : simFirewallState.dmzIp)).trim();
      simFirewallState.dmzEnabled = enabled;
      if (ip) simFirewallState.dmzIp = ip;
      const cmd = enabled
        ? `uci set firewall.dmz=redirect && uci set firewall.dmz.name='DMZ_Host' && uci set firewall.dmz.src='wan' && uci set firewall.dmz.dest='lan' && uci set firewall.dmz.dest_ip='${ip}' && uci set firewall.dmz.target='DNAT' && uci commit firewall && /etc/init.d/firewall reload`
        : `uci delete firewall.dmz 2>/dev/null && uci commit firewall && /etc/init.d/firewall reload || true`;
      return { routerCmd: cmd };
    }

    case 'add_port_forward': {
      const name = (payload.name || 'Custom_Forward').replace(/['"\\]/g, '').substring(0, 30);
      const proto = (payload.proto || 'tcp').toLowerCase();
      const extPort = String(payload.extPort || payload.ext_port || payload.src_dport || '8080').replace(/[^0-9:-]/g, '');
      const intIp = String(payload.intIp || payload.int_ip || payload.dest_ip || '192.168.1.100').trim();
      const intPort = String(payload.intPort || payload.int_port || payload.dest_port || extPort).replace(/[^0-9:-]/g, '');
      const ruleId = `pf_${Date.now().toString().slice(-6)}`;

      simFirewallState.portForwards.push({
        id: ruleId,
        name,
        proto,
        extPort,
        intIp,
        intPort,
        enabled: true
      });

      return {
        routerCmd: `uci set firewall.${ruleId}=redirect && uci set firewall.${ruleId}.name='${name}' && uci set firewall.${ruleId}.src='wan' && uci set firewall.${ruleId}.proto='${proto}' && uci set firewall.${ruleId}.src_dport='${extPort}' && uci set firewall.${ruleId}.dest='lan' && uci set firewall.${ruleId}.dest_ip='${intIp}' && uci set firewall.${ruleId}.dest_port='${intPort}' && uci set firewall.${ruleId}.target='DNAT' && uci commit firewall && /etc/init.d/firewall reload`
      };
    }

    case 'del_port_forward': {
      const id = target || payload.id;
      if (!id) return { error: 'Rule ID required to delete port forward.', statusCode: 400 };
      simFirewallState.portForwards = simFirewallState.portForwards.filter(p => p.id !== id);
      return { routerCmd: `uci delete firewall.${id} 2>/dev/null && uci commit firewall && /etc/init.d/firewall reload || true` };
    }

    case 'toggle_port_forward': {
      const id = target || payload.id;
      if (!id) return { error: 'Rule ID required to toggle port forward.', statusCode: 400 };
      const enabled = isFlagTrue(value);
      const rule = simFirewallState.portForwards.find(p => p.id === id);
      if (rule) rule.enabled = enabled;
      return { routerCmd: `uci set firewall.${id}.enabled='${enabled ? 1 : 0}' && uci commit firewall && /etc/init.d/firewall reload` };
    }

    case 'add_traffic_rule': {
      const name = (payload.name || 'Custom_Filter').replace(/['"\\]/g, '').substring(0, 30);
      const proto = (payload.proto || 'tcp').toLowerCase();
      const src = (payload.src || 'lan').toLowerCase();
      const dest = (payload.dest || 'wan').toLowerCase();
      const targetAction = (payload.targetAction || payload.target || 'DROP').toUpperCase();
      const ruleId = `tr_${Date.now().toString().slice(-6)}`;

      simFirewallState.trafficRules.push({
        id: ruleId,
        name,
        proto,
        src,
        dest,
        target: targetAction,
        enabled: true
      });

      return {
        routerCmd: `uci set firewall.${ruleId}=rule && uci set firewall.${ruleId}.name='${name}' && uci set firewall.${ruleId}.src='${src}' && uci set firewall.${ruleId}.dest='${dest}' && uci set firewall.${ruleId}.proto='${proto}' && uci set firewall.${ruleId}.target='${targetAction}' && uci commit firewall && /etc/init.d/firewall reload`
      };
    }

    case 'del_traffic_rule': {
      const id = target || payload.id;
      if (!id) return { error: 'Rule ID required to delete traffic rule.', statusCode: 400 };
      simFirewallState.trafficRules = simFirewallState.trafficRules.filter(t => t.id !== id);
      return { routerCmd: `uci delete firewall.${id} 2>/dev/null && uci commit firewall && /etc/init.d/firewall reload || true` };
    }

    case 'toggle_traffic_rule': {
      const id = target || payload.id;
      if (!id) return { error: 'Rule ID required to toggle traffic rule.', statusCode: 400 };
      const enabled = isFlagTrue(value);
      const rule = simFirewallState.trafficRules.find(t => t.id === id);
      if (rule) rule.enabled = enabled;
      return { routerCmd: `uci set firewall.${id}.enabled='${enabled ? 1 : 0}' && uci commit firewall && /etc/init.d/firewall reload` };
    }

    case 'flush_conntrack': {
      simFirewallState.conntrackCount = 24;
      return { routerCmd: `echo f > /proc/net/nf_conntrack 2>/dev/null || conntrack -F 2>/dev/null || true` };
    }

    case 'reload_firewall':
      return { routerCmd: '/etc/init.d/firewall reload' };

    case 'restart_firewall':
      return { routerCmd: '/etc/init.d/firewall restart' };

    case 'reset_firewall': {
      simFirewallState.synFlood = true;
      simFirewallState.dropInvalid = true;
      simFirewallState.wanPing = false;
      simFirewallState.flowOffload = true;
      simFirewallState.flowOffloadHw = true;
      simFirewallState.mssClamping = true;
      simFirewallState.antiSpoofing = true;
      simFirewallState.ipv6Firewall = true;
      simFirewallState.stealthMode = true;
      simFirewallState.guestIsolation = true;
      simFirewallState.dmzEnabled = false;
      return { routerCmd: 'cp /rom/etc/config/firewall /etc/config/firewall && /etc/init.d/firewall restart' };
    }

    default:
      return null;
  }
}
