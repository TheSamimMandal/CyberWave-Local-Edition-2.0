/**
 * lib/router/firewall-sim.js
 *
 * Simulated Firewall 4 / nftables telemetry and rules store for Archer C6 v3.
 * Kept strictly under 250 lines.
 */

export const simFirewallState = {
  engine: 'nftables v1.0.8 (fw4)',
  table: 'table inet fw4',
  status: 'enforcing',
  synFlood: true,
  dropInvalid: true,
  wanPing: false,
  flowOffload: true,
  flowOffloadHw: true,
  mssClamping: true,
  antiSpoofing: true,
  ipv6Firewall: true,
  stealthMode: true,
  guestIsolation: true,
  dmzEnabled: false,
  dmzIp: '192.168.1.150',
  conntrackCount: 342,
  conntrackMax: 16384,
  portForwards: [
    { id: 'pf_web', name: 'HTTP Web Server', proto: 'tcp', extPort: '8080', intIp: '192.168.1.101', intPort: '80', enabled: true },
    { id: 'pf_ssh', name: 'SSH Remote Admin', proto: 'tcp', extPort: '2222', intIp: '192.168.1.120', intPort: '22', enabled: false },
    { id: 'pf_wg', name: 'WireGuard VPN Tunnel', proto: 'udp', extPort: '51820', intIp: '192.168.1.1', intPort: '51820', enabled: true },
    { id: 'pf_plex', name: 'Plex Media Server', proto: 'tcp', extPort: '32400', intIp: '192.168.1.120', intPort: '32400', enabled: true },
    { id: 'pf_mc', name: 'Minecraft Game Server', proto: 'tcp+udp', extPort: '25565', intIp: '192.168.1.105', intPort: '25565', enabled: false }
  ],
  trafficRules: [
    { id: 'tr_ping', name: 'Allow Ping from LAN to Router', proto: 'icmp', src: 'lan', dest: 'router', target: 'ACCEPT', enabled: true },
    { id: 'tr_dns', name: 'Force Router DNS (Port 53 Intercept)', proto: 'udp', src: 'lan', dest: 'router', target: 'ACCEPT', enabled: true },
    { id: 'tr_doh', name: 'Block Plain HTTP DoH Bypass', proto: 'tcp', src: 'lan', dest: 'wan', target: 'REJECT', enabled: false },
    { id: 'tr_guest', name: 'Block Guest Access to Router Admin', proto: 'all', src: 'guest', dest: 'router', target: 'DROP', enabled: true }
  ]
};

export function getSimulatedFirewallStatus() {
  const jitter = Math.floor((Math.random() - 0.5) * 8);
  const currentConntrack = Math.max(120, Math.min(15000, simFirewallState.conntrackCount + jitter));

  return {
    engine: simFirewallState.engine,
    table: simFirewallState.table,
    status: simFirewallState.status,
    syn_flood: simFirewallState.synFlood,
    drop_invalid: simFirewallState.dropInvalid,
    wan_ping: simFirewallState.wanPing,
    flow_offload: simFirewallState.flowOffload,
    flow_offload_hw: simFirewallState.flowOffloadHw,
    mss_clamping: simFirewallState.mssClamping,
    anti_spoofing: simFirewallState.antiSpoofing,
    ipv6_firewall: simFirewallState.ipv6Firewall,
    stealth_mode: simFirewallState.stealthMode,
    guest_isolation: simFirewallState.guestIsolation,
    dmz_enabled: simFirewallState.dmzEnabled,
    dmz_ip: simFirewallState.dmzIp,
    conntrack_count: currentConntrack,
    conntrack_max: simFirewallState.conntrackMax,
    port_forwards: simFirewallState.portForwards.map(p => ({ ...p })),
    traffic_rules: simFirewallState.trafficRules.map(t => ({ ...t }))
  };
}
