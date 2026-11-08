/**
 * lib/router/terminal-sim.js
 *
 * Realistic simulated OpenWrt terminal diagnostic command outputs.
 * Kept strictly under 250 lines.
 */

/**
 * Returns realistic simulated OpenWrt terminal output for diagnostic commands.
 *
 * @param {string} rawCmd
 * @returns {string}
 */
export function getSimulatedTerminalOutput(rawCmd) {
  const cmd = (rawCmd || '').trim();
  if (!cmd || cmd === 'uptime') {
    return ' 21:05:00 up 14 days,  6:42,  load average: 0.12, 0.08, 0.05';
  }
  if (/^ping\b/i.test(cmd)) {
    const host = cmd.split(/\s+/).find(p => !p.startsWith('-') && p !== 'ping') || '8.8.8.8';
    return [
      `PING ${host} (${host}): 56 data bytes`,
      `64 bytes from ${host}: seq=0 ttl=118 time=14.281 ms`,
      `64 bytes from ${host}: seq=1 ttl=118 time=13.914 ms`,
      `64 bytes from ${host}: seq=2 ttl=118 time=14.052 ms`,
      `64 bytes from ${host}: seq=3 ttl=118 time=14.120 ms`,
      ``,
      `--- ${host} ping statistics ---`,
      `4 packets transmitted, 4 packets received, 0% packet loss`,
      `round-trip min/avg/max = 13.914/14.091/14.281 ms`
    ].join('\n');
  }
  if (/^traceroute\b/i.test(cmd)) {
    const host = cmd.split(/\s+/).find(p => !p.startsWith('-') && p !== 'traceroute') || '1.1.1.1';
    return [
      `traceroute to ${host} (${host}), 8 hops max, 38 byte packets`,
      ` 1  203.0.113.1 (203.0.113.1)  1.821 ms  1.614 ms  1.745 ms`,
      ` 2  172.16.200.1 (172.16.200.1)  4.230 ms  4.112 ms  4.055 ms`,
      ` 3  198.51.100.25 (198.51.100.25)  7.891 ms  7.940 ms  8.012 ms`,
      ` 4  ${host} (${host})  11.450 ms  11.380 ms  11.412 ms`
    ].join('\n');
  }
  if (/^iwinfo\b/i.test(cmd)) {
    const is5g = cmd.includes('wlan1') || cmd.includes('5');
    if (is5g) {
      return [
        `wlan1     ESSID: "Archer_C6_5G"`,
        `          Access Point: B4:B0:24:D1:42:02`,
        `          Mode: Master  Channel: 149 (5.745 GHz)`,
        `          Tx-Power: 23 dBm  Link Quality: 70/70`,
        `          Signal: -38 dBm  Noise: -95 dBm`,
        `          Bit Rate: 866.7 MBit/s`,
        `          Encryption: WPA2 - PSK (CCMP) / WPA3-SAE`,
        `          Type: nl80211  HW Mode: 802.11an/ac`,
        `          Hardware: MediaTek MT7613BEN 2x2 MU-MIMO`
      ].join('\n');
    }
    return [
      `wlan0     ESSID: "Archer_C6_2.4G"`,
      `          Access Point: B4:B0:24:D1:42:01`,
      `          Mode: Master  Channel: 6 (2.437 GHz)`,
      `          Tx-Power: 23 dBm  Link Quality: 70/70`,
      `          Signal: -42 dBm  Noise: -95 dBm`,
      `          Bit Rate: 300.0 MBit/s`,
      `          Encryption: WPA2 - PSK (CCMP)`,
      `          Type: nl80211  HW Mode: 802.11bgn`,
      `          Hardware: MediaTek MT7603E 2x2:2`
    ].join('\n');
  }
  if (/^logread\b/i.test(cmd)) {
    return [
      `daemon.info hostapd: wlan1: STA 3c:22:fb:1a:2b:3c IEEE 802.11: authenticated`,
      `daemon.info hostapd: wlan1: STA 3c:22:fb:1a:2b:3c IEEE 802.11: associated (aid 1)`,
      `daemon.info hostapd: wlan1: STA 3c:22:fb:1a:2b:3c WPA: pairwise key handshake completed`,
      `daemon.info dnsmasq-dhcp[1420]: DHCPACK(br-lan) 192.168.1.101 3c:22:fb:1a:2b:3c Sabbir-MacBook-Pro`,
      `daemon.info opennds[2105]: Authenticated client 3c:22:fb:1a:2b:3c for 60m session`,
      `daemon.notice netifd: Network device 'wan' link is up`,
      `daemon.info hostapd: wlan0: STA a4:c3:f0:88:99:11 IEEE 802.11: associated (aid 2)`,
      `daemon.info dnsmasq-dhcp[1420]: DHCPACK(br-lan) 192.168.1.105 a4:c3:f0:88:99:11 Galaxy-S23-Ultra`
    ].join('\n');
  }
  if (/^dmesg\b/i.test(cmd)) {
    return [
      `[    0.000000] Linux version 5.15.150 (openwrt@buildhost) (mips-openwrt-linux-musl-gcc) #0 SMP`,
      `[    0.000000] SoC: MediaTek MT7621DAT ver:1 eco:3 (Dual-Core 4-Thread @ 880MHz)`,
      `[    1.240100] mt7603e 0000:01:00.0: MediaTek MT7603E 802.11bgn 2x2 MIMO initialized`,
      `[    1.650200] mt7615e 0000:02:00.0: MediaTek MT7613BEN 802.11an/ac 2x2 MU-MIMO initialized`,
      `[    2.120300] mtk_soc_eth 1e100000.ethernet: PPE hardware flow offloading enabled (flow_offloading_hw=1)`,
      `[    3.400500] 8021q: 802.1Q VLAN Support v1.8`,
      `[   12.450100] br-lan: port 1(lan1) entered forwarding state`,
      `[   14.890200] opennds: captive portal listening on br-lan:2050`
    ].join('\n');
  }
  if (/cat\s+\/proc\/cpuinfo/i.test(cmd) || /cpuinfo/i.test(cmd)) {
    return [
      `system type\t\t: MediaTek MT7621 ver:1 eco:3`,
      `machine\t\t\t: TP-Link Archer C6 v3`,
      `processor\t\t: 0`,
      `cpu model\t\t: MIPS 1004Kc V2.15`,
      `BogoMIPS\t\t: 586.13`,
      `wait instruction\t: yes`,
      `microsecond timers\t: yes`,
      `tlb_entries\t\t: 32`,
      `extra interrupt vector\t: yes`,
      `hardware watchpoint\t: yes, count: 4, address/irw mask: [0x0ffc, 0x0ffc, 0x0ffb, 0x0ffb]`,
      `isa\t\t\t: mips32r2`,
      `ASEs implemented\t: mips16 dsp mt`
    ].join('\n');
  }
  if (/^free\b/i.test(cmd)) {
    return [
      `              total        used        free      shared  buff/cache   available`,
      `Mem:         124960       54280       48190         412       22490       62100`,
      `Swap:             0           0           0`
    ].join('\n');
  }
  if (/^df\b/i.test(cmd)) {
    return [
      `Filesystem                Size      Used Available Use% Mounted on`,
      `/dev/root                 3.8M      3.8M         0 100% /rom`,
      `tmpfs                    61.0M    612.0K     60.4M   1% /tmp`,
      `/dev/mtdblock6           10.5M      4.1M      6.4M  39% /overlay`,
      `overlayfs:/overlay       10.5M      4.1M      6.4M  39% /`
    ].join('\n');
  }
  return `[OpenWrt 23.05] root@Archer-C6:~# ${cmd}\nCommand executed successfully. (exit status 0)`;
}
