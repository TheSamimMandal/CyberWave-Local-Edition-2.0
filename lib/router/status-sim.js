/**
 * lib/router/status-sim.js
 *
 * Simulated Archer C6 v3 hardware telemetry and status generator.
 * Kept strictly under 250 lines.
 */

import { getSimulatedFirewallStatus } from './firewall-sim.js';

export const simState = {
  lastTs: Date.now(),
  rxBytes: 254109000,
  txBytes: 48920100,
  currentDlMbps: 54.2,
  currentUlMbps: 16.8,
  sampleCount: 0,
  uptimeStart: Date.now() - (345620 * 1000),
  quotaGb: 50,
  quotaResetDay: 1,
  quotaWarnPct: 80,
  quotaUsedBytes: 34200000000,
  quotaRxBytes: 28900000000,
  quotaTxBytes: 5300000000,
  customDns: null,
  pmfProtected: true,
  dnsRebindProtection: true,
  wanLockdown: true,
  clients: [
    { mac: '3c:22:fb:1a:2b:3c', ip: '192.168.1.101', hostname: "Sabbir's MacBook Pro", nds_authenticated: true, blocked: false, signal_dbm: -42, connection_type: '5GHz', ssid_name: 'Archer_C6_5G', vendor: 'Apple', rx_bytes: 125400000, tx_bytes: 43200000, connected_seconds: 14250, is_static: false },
    { mac: 'a4:c3:f0:88:99:11', ip: '192.168.1.105', hostname: 'Galaxy S23 Ultra', nds_authenticated: true, blocked: false, signal_dbm: -50, connection_type: '5GHz', ssid_name: 'Archer_C6_5G', vendor: 'Samsung', rx_bytes: 78500000, tx_bytes: 12300000, connected_seconds: 7820, is_static: false },
    { mac: '70:ee:50:41:22:90', ip: '192.168.1.110', hostname: 'Sony Smart TV 4K', nds_authenticated: true, blocked: false, signal_dbm: -62, connection_type: '2.4GHz', ssid_name: 'Archer_C6_2.4G', vendor: 'Sony', rx_bytes: 450100000, tx_bytes: 5200000, connected_seconds: 28900, is_static: false },
    { mac: 'b8:27:eb:d1:82:19', ip: '192.168.1.120', hostname: 'HomeAssistant Pi', nds_authenticated: true, blocked: false, signal_dbm: 0, connection_type: 'LAN', ssid_name: 'Ethernet LAN', vendor: 'Raspberry Pi', rx_bytes: 34100000, tx_bytes: 28900000, connected_seconds: 345620, is_static: true, is_isolated: false },
    { mac: '3c:5a:37:99:88:77', ip: '192.168.1.135', hostname: 'Guest Pixel 8', nds_authenticated: false, blocked: false, signal_dbm: -68, connection_type: 'Guest', ssid_name: 'ArcherC6_Guest', vendor: 'Google', rx_bytes: 1200000, tx_bytes: 450000, connected_seconds: 1850, is_static: false, is_isolated: true }
  ],
  ssids: [
    { id: 'default_radio0', ssid: 'CyberWave_2.4G', band: '2.4GHz', radio: 'radio0', ifname: 'wlan0', enabled: true, encryption: 'WPA2-PSK/WPA3-SAE', channel: 6, connected_clients: 1, is_guest: false },
    { id: 'default_radio1', ssid: 'CyberWave_5G', band: '5GHz', radio: 'radio1', ifname: 'wlan1', enabled: true, encryption: 'WPA2-PSK/WPA3-SAE', channel: 149, connected_clients: 2, is_guest: false },
    { id: 'guest_2g', ssid: 'CyberWave_Guest_2.4G', band: '2.4GHz', radio: 'radio0', ifname: 'wlan0-1', enabled: true, encryption: 'Open / Captive', channel: 6, connected_clients: 1, is_guest: true, isolated: true },
    { id: 'guest_5g', ssid: 'CyberWave_Guest_5G', band: '5GHz', radio: 'radio1', ifname: 'wlan1-1', enabled: true, encryption: 'Open / Captive', channel: 149, connected_clients: 0, is_guest: true, isolated: true }
  ]
};

export function getSimulatedStatus() {
  const nowMs = Date.now();
  const now = Math.floor(nowMs / 1000);
  const deltaSec = Math.max(0.1, (nowMs - simState.lastTs) / 1000);
  simState.lastTs = nowMs;
  simState.sampleCount++;

  const t = simState.sampleCount * 0.25;
  const dlWave = Math.sin(t) * 18 + Math.cos(t * 0.4) * 8;
  const jitterDl = (Math.random() - 0.5) * 6;
  simState.currentDlMbps = Math.max(8.5, Math.min(94.8, 52.0 + dlWave + jitterDl));

  const ulWave = Math.sin(t * 0.7) * 4 + Math.cos(t * 0.2) * 2;
  const jitterUl = (Math.random() - 0.5) * 2;
  simState.currentUlMbps = Math.max(3.2, Math.min(22.5, 14.5 + ulWave + jitterUl));

  if (deltaSec > 0 && deltaSec < 30) {
    simState.rxBytes += Math.round((simState.currentDlMbps * 1000000 / 8) * deltaSec);
    simState.txBytes += Math.round((simState.currentUlMbps * 1000000 / 8) * deltaSec);
  }

  const cpuBase = 12 + (simState.currentDlMbps / 95) * 14 + (Math.random() * 4);
  const cpuPercent = Math.round(Math.max(6, Math.min(88, cpuBase)));
  const t1 = Math.round(Math.min(100, Math.max(2, cpuPercent * 1.15)));
  const t2 = Math.round(Math.min(100, Math.max(2, cpuPercent * 0.85)));
  const t3 = Math.round(Math.min(100, Math.max(2, cpuPercent * 1.05)));
  const t4 = Math.round(Math.min(100, Math.max(2, cpuPercent * 0.75)));

  const totalRamKb = 131072;
  const ramJitter = Math.round(Math.sin(t * 0.3) * 1200);
  const usedRamKb = 54280 + ramJitter;
  const buffersKb = 8900;
  const cachedKb = 27672 + Math.round(Math.cos(t * 0.2) * 400);
  const freeRamKb = totalRamKb - usedRamKb - buffersKb - cachedKb;
  const availableRamKb = freeRamKb + buffersKb + cachedKb;

  const totalStorageKb = 16384;
  const usedStorageKb = 10240;
  const availStorageKb = 6144;
  const uptimeSec = Math.floor((nowMs - simState.uptimeStart) / 1000);

  return {
    cpu: {
      cores: 2,
      threads: 4,
      model: 'MediaTek MT7621DAT @ 880MHz',
      architecture: 'MIPS 1004Kc V2.15',
      frequency_mhz: 880,
      bogomips: 586.13,
      usage_percent: cpuPercent,
      threads_usage: [t1, t2, t3, t4],
      temperature_c: Math.round(43 + (cpuPercent / 100) * 6),
      load_avg: `${(cpuPercent / 100 * 0.8).toFixed(2)}, ${(0.15 + (cpuPercent / 100 * 0.2)).toFixed(2)}, 0.10`,
      uptime_seconds: uptimeSec
    },
    memory: {
      total_kb: totalRamKb,
      used_kb: usedRamKb,
      free_kb: freeRamKb,
      buffers_kb: buffersKb,
      cached_kb: cachedKb,
      available_kb: availableRamKb,
      type: 'DDR3 1200MHz',
      usage_percent: Math.round((usedRamKb / totalRamKb) * 100)
    },
    storage: {
      total_kb: totalStorageKb,
      used_kb: usedStorageKb,
      available_kb: availStorageKb,
      device: '16MB SPI NOR Flash',
      usage_percent: Math.round((usedStorageKb / totalStorageKb) * 100),
      partitions: {
        rom: { name: 'System RootFS (/rom)', mount: '/rom', filesystem: 'squashfs', total_kb: 3891, used_kb: 3891, available_kb: 0, use_percent: 100, read_only: true, label: 'OpenWrt 23.05 Core System (Compressed)' },
        overlay: { name: 'User Overlay (/overlay)', mount: '/overlay', filesystem: 'jffs2', total_kb: 10752, used_kb: 4198, available_kb: 6554, use_percent: 39, read_only: false, label: 'User Config & Installed OPKG Packages' },
        tmp: { name: 'Volatile RAM Disk (/tmp)', mount: '/tmp', filesystem: 'tmpfs', total_kb: 62480, used_kb: 612, available_kb: 61868, use_percent: 1.0, read_only: false, label: 'Runtime Buffers, Sockets & DHCP Leases' }
      }
    },
    ports: {
      wan: { name: 'wan', link: 'up', speed_mbps: 1000 },
      lan1: { name: 'lan1', link: 'up', speed_mbps: 1000 },
      lan2: { name: 'lan2', link: 'up', speed_mbps: 100 },
      lan3: { name: 'lan3', link: 'down', speed_mbps: 0 },
      lan4: { name: 'lan4', link: 'down', speed_mbps: 0 }
    },
    wireless: {
      radio_2g: {
        ifname: 'wlan0', band: '2.4GHz', chipset: 'MT7603E 802.11b/g/n', enabled: true,
        ssid: 'Archer_C6_2.4G', channel: 6, channel_width: 20, htmode: 'HT20', txpower_dbm: 20,
        encryption: 'WPA2-PSK/WPA3-SAE', connected_clients: 2
      },
      radio_5g: {
        ifname: 'wlan1', band: '5GHz', chipset: 'MT7613BEN 802.11a/n/ac', enabled: true,
        ssid: 'Archer_C6_5G', channel: 149, channel_width: 80, htmode: 'VHT80', txpower_dbm: 23,
        encryption: 'WPA2-PSK/WPA3-SAE', connected_clients: 2
      },
      guest: {
        enabled: simState.ssids.find(s => s.id === 'guest')?.enabled ?? false,
        ssid: simState.ssids.find(s => s.id === 'guest')?.ssid ?? 'ArcherC6_Guest',
        channel: 6,
        txpower_dbm: 18,
        isolated: true,
        connected_clients: 1
      },
      advanced: { fast_roaming: true, pmf_protected: simState.pmfProtected !== false, wmm_qos: true, drop_legacy_rates: true },
      ssids: simState.ssids.map(s => {
        const matchingClients = simState.clients.filter(c => c.ssid_name && c.ssid_name.toLowerCase() === s.ssid.toLowerCase());
        const rx = matchingClients.reduce((sum, c) => sum + (c.rx_bytes || 0), 0);
        const tx = matchingClients.reduce((sum, c) => sum + (c.tx_bytes || 0), 0);
        const is5g = s.band && s.band.includes('5');
        return {
          ...s,
          connected_clients: matchingClients.length,
          rx_bytes: rx,
          tx_bytes: tx,
          txpower_dbm: is5g ? 23 : 20
        };
      })
    },
    traffic: {
      interface: 'wan',
      rx_bytes: simState.rxBytes,
      tx_bytes: simState.txBytes,
      current_download_mbps: parseFloat(simState.currentDlMbps.toFixed(1)),
      current_upload_mbps: parseFloat(simState.currentUlMbps.toFixed(1)),
      wan_ip: '203.0.113.84',
      gateway: '203.0.113.1',
      dns: '1.1.1.1, 8.8.8.8',
      ping_ms: Math.round(12 + Math.random() * 4),
      jitter_ms: parseFloat((0.8 + Math.random() * 0.9).toFixed(1)),
      packet_loss: 0,
      timestamp: now
    },
    clients: simState.clients.map(c => {
      // Simulate real-time dynamic traffic progression for active clients
      if (!c.blocked && deltaSec > 0 && deltaSec < 30) {
        c.rx_bytes += Math.round((Math.random() * 85000 + 15000) * deltaSec);
        c.tx_bytes += Math.round((Math.random() * 35000 + 5000) * deltaSec);
        c.connected_seconds = (c.connected_seconds || 100) + Math.round(deltaSec);
      }
      return { ...c };
    }),
    leds: { stealth_mode: false },
    network: {
      hw_offload: { enabled: true, flow_offloading_hw: true },
      sqm: { enabled: true, qdisc: 'cake', download_kbit: 95000, upload_kbit: 20000, interface: 'wan' },
      wireguard: { enabled: false, interface: 'wg0', endpoint: 'sg-vpn.cyberguard.net:51820', status: 'standby', latest_handshake: 'Never', transfer_rx: 14205000, transfer_tx: 3200100 },
      multi_wan: { enabled: false, mode: 'failover', wan1: 'online', wan2: 'standby' },
      doh: { enabled: true, provider: 'Cloudflare (1.1.1.1)' },
      dns_rebind_protection: simState.dnsRebindProtection !== false,
      wan_lockdown: simState.wanLockdown !== false,
      wan_details: {
        gateway: '203.0.113.1',
        dns: simState.customDns || '1.1.1.1, 8.8.8.8',
        mtu: 1492,
        protocol: 'PPPoE (Fiber Optic ONU)',
        latency_ms: 8.5,
        jitter_ms: 0.9
      }
    },
    firewall: getSimulatedFirewallStatus(),
    analytics: {
      quota: {
        total_gb: simState.quotaGb,
        used_bytes: simState.quotaUsedBytes,
        rx_bytes: simState.quotaRxBytes,
        tx_bytes: simState.quotaTxBytes,
        reset_day: simState.quotaResetDay,
        warning_percent: simState.quotaWarnPct,
        wrtbwmon_active: true
      },
      wrtbwmon_clients: [
        { mac: '3c:22:fb:1a:2b:3c', ip: '192.168.1.101', hostname: "Sabbir's MacBook Pro", in_bytes: 14200000000, out_bytes: 3100000000, total_bytes: 17300000000, first_seen: '2026-10-01 00:00', last_seen: 'Just now' },
        { mac: '70:ee:50:41:22:90', ip: '192.168.1.110', hostname: 'Sony Smart TV 4K', in_bytes: 9800000000, out_bytes: 450000000, total_bytes: 10250000000, first_seen: '2026-10-01 02:15', last_seen: '5m ago' },
        { mac: 'a4:c3:f0:88:99:11', ip: '192.168.1.105', hostname: 'Galaxy S23 Ultra', in_bytes: 3900000000, out_bytes: 1200000000, total_bytes: 5100000000, first_seen: '2026-10-02 08:30', last_seen: '1m ago' },
        { mac: 'b8:27:eb:d1:82:19', ip: '192.168.1.120', hostname: 'HomeAssistant Pi', in_bytes: 750000000, out_bytes: 480000000, total_bytes: 1230000000, first_seen: '2026-10-01 00:00', last_seen: 'Active' },
        { mac: '3c:5a:37:99:88:77', ip: '192.168.1.135', hostname: 'Guest Pixel 8', in_bytes: 250000000, out_bytes: 70000000, total_bytes: 320000000, first_seen: '2026-10-10 14:00', last_seen: '3h ago' }
      ]
    },
    crontab: {
      midnight_reboot: { enabled: true, schedule_time: '04:00', cron: '0 4 * * * /sbin/reboot' },
      wifi_sleep: { enabled: true, time_range: '01:00-07:00', cron_off: '0 1 * * * wifi down', cron_on: '0 7 * * * wifi up' },
      nightly_cache_flush: { enabled: true, schedule_time: '03:30', cron: '30 3 * * * sync && echo 3 > /proc/sys/vm/drop_caches' },
      wrtbwmon_backup: { enabled: true, cron: '0 0 * * * wrtbwmon backup' }
    },
    smart_home: {
      home_assistant: {
        enabled: true,
        webhook_url: 'http://homeassistant.local:8123/api/webhook/archer_c6_presence',
        tracked_macs: '3c:22:fb:1a:2b:3c,a4:c3:f0:88:99:11'
      },
      mqtt: { enabled: false, broker: '192.168.1.120:1883', topic: 'homeassistant/sensor/archer_c6' }
    },
    opennds: {
      installed: true,
      running: true,
      version: '10.3.1',
      gatewayInterface: 'br-guest',
      logicalInterface: 'guest',
      gatewayIp: '192.168.10.1',
      gatewayPort: 2050,
      gatewayName: 'CyberWave Hotspot',
      fasSecurityLevel: 0,
      fasUrl: 'http://cyberwave-976224355259.asia-southeast1.run.app:443/',
      authorizedClients: 0
    },
    guest_wifi: {
      active: true,
      bridge: 'br-guest',
      interface: 'guest',
      ssid2g: 'CyberWave_Guest_2.4G',
      ssid5g: 'CyberWave_Guest_5G',
      gatewayIp: '192.168.10.1',
      subnet: '192.168.10.0/24'
    },
    timestamp: now,
    source: 'cloud_bridge'
  };
}
