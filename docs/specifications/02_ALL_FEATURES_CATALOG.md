# 📋 OpenWrt & TP-Link Archer C6 v3 — Complete 70+ Features Master Catalog

> **Hardware Specification:** TP-Link Archer C6 v3  
> **SoC / CPU:** MediaTek MT7621DAT (Dual-Core, 4-Threads @ 880 MHz)  
> **Memory:** 128 MB DDR3 RAM  
> **Storage:** 16 MB SPI NOR Flash  
> **Wireless Radios:** MediaTek MT7603E (2.4 GHz 802.11b/g/n) + MT7613BEN (5.0 GHz 802.11a/n/ac)  
> **Switch Architecture:** MediaTek Gigabit DSA Switch (1x WAN + 4x LAN)  
> **Firmware:** OpenWrt (Kernel 5.15 / 6.1 / 6.6, BusyBox ash, uhttpd, procd)

---

## 📑 Feature Master Index (14 Categories • 76 Features)

| Category | Domain | Feature Count | Complexity |
| :---: | :--- | :---: | :---: |
| **01** | Hardware & Board-Level System Control | 8 Features | Core / Low-Level |
| **02** | Beginner / Daily Essential Functionality | 4 Features | Beginner |
| **03** | Intermediate Level Networking & Services | 8 Features | Intermediate |
| **04** | Advanced Acceleration, QoS & Radios | 8 Features | Advanced |
| **05** | Ultra-Advanced VLANs, VPNs & Routing | 8 Features | Ultra-Advanced |
| **06** | Expert, Kernel & Developer Telemetry | 8 Features | Expert |
| **07** | Bandwidth Quotas, Accounting & Analytics | 4 Features | Advanced |
| **08** | Next-Gen IPv6 Advanced Suite | 5 Features | Ultra-Advanced |
| **09** | Smart Home & IoT Integrations | 4 Features | Intermediate |
| **10** | Policy-Based Routing & Split-Tunneling | 3 Features | Advanced |
| **11** | Advanced Wireless Protocols & Mesh | 5 Features | Advanced |
| **12** | Cyber Security, Threat Defense & Stealth | 4 Features | Advanced |
| **13** | Local Network Infrastructure & Services | 4 Features | Intermediate |
| **14** | ISP Workarounds & CGNAT Bypasses | 3 Features | Expert |
| **TOTAL** | **Full Ecosystem Features** | **76 Features** | **Complete Master Suite** |

---

## 🛠️ Detailed Feature Specifications

### 📂 Category 1: Hardware & Board-Level System Control (8 Features)

1. **SoC / CPU & Multi-Threading Monitor (MT7621DAT):**
   * *Description:* 2 Cores / 4 Threads @ 880MHz real-time utilization graphs, 1m/5m/15m system load average (`/proc/loadavg`), and per-thread RPS/XPS packet steering affinity allocation.
   * *Mechanism:* Read `/proc/stat`, `/proc/loadavg`, and write to `/sys/class/net/*/queues/*/rps_cpus`.
2. **RAM & Memory Management (128MB DDR3):**
   * *Description:* Real-time tracking of Total, Used, Free, Buffers, and Cached memory. One-tap memory cache purge (`drop_caches`) and optional ZRAM compressed swap activation.
   * *Mechanism:* Read `/proc/meminfo`, execute `echo 3 > /proc/sys/vm/drop_caches`.
3. **Flash Storage & Filesystem Monitor (16MB SPI NOR):**
   * *Description:* Real-time free/used space gauge of root partition (`/overlay` JFFS2/OverlayFS) and temporary RAM-disk (`/tmp` tmpfs) to avoid flash exhaustion and router bricking.
   * *Mechanism:* `df -k /overlay` and `df -k /tmp`.
4. **Ethernet Gigabit Switch & Port Visualizer (MediaTek DSA):**
   * *Description:* Live interactive hardware rendering of the 5 RJ45 physical ports (WAN, LAN 1-4). Displays active link state, link speed (1000 Mbps green vs 100 Mbps amber vs down grey), duplex mode, and software port shutdown.
   * *Mechanism:* Read `/sys/class/net/{wan,lan1,lan2,lan3,lan4}/{operstate,speed,duplex}`.
5. **Physical Front-Panel LED Control:**
   * *Description:* Custom trigger configuration for Power, 2.4G, 5G, WAN, LAN, and WPS indicator LEDs. Features a 1-tap **Stealth Night Mode** that instantly shuts off all LEDs without affecting network operations.
   * *Mechanism:* Write brightness (0 or 1) and triggers to `/sys/class/leds/*`.
6. **Physical GPIO Button Event Mapping:**
   * *Description:* Programmable actions for the physical WPS and Wi-Fi hardware buttons (e.g. toggle Guest Wi-Fi, trigger WPS push-button connect, or soft reboot) while software-locking the Reset button to prevent accidental factory wipe.
   * *Mechanism:* Configure OpenWrt procd hotplug button handler `/etc/hotplug.d/button/`.
7. **Hardware Watchdog Guard:**
   * *Description:* Heartbeat daemon connected to the MT7621 hardware watchdog timer (`/dev/watchdog`) that triggers an automatic hardware reset if kernel freezes or locks up.
   * *Mechanism:* `procd` watchdog service configuration.
8. **Power & Reboot Management:**
   * *Description:* Software cold reboot, fast restart of network daemons without rebooting OS, and scheduled recurring midnight reboots.
   * *Mechanism:* `reboot` and `service network restart`.

---

### 📂 Category 2: Beginner / Daily Essential Functionality (4 Features)

9. **WAN Internet Connection Setup:**
   * *Description:* High-level configuration of ISP connection mode: PPPoE (credentials and uptime counter), DHCP Client (dynamic upstream IP from ONU/Modem), or Static IP.
   * *Mechanism:* `uci set network.wan.proto=... && uci commit network`.
10. **Basic Dual-Band Wi-Fi Configuration:**
    * *Description:* Rename 2.4 GHz and 5.0 GHz SSIDs, update WPA2-PSK/WPA3-SAE passphrases, and 1-tap master toggle to enable or disable individual wireless radios.
    * *Mechanism:* `uci set wireless.@wifi-iface[x].ssid=... && wifi reload`.
11. **Connected Devices List & Hardware Identity:**
    * *Description:* Comprehensive list of all active phones, laptops, and IoT devices with IP, MAC, hostname, connection type (Ethernet LAN / 2.4G Wi-Fi / 5G Wi-Fi), and signal RSSI.
    * *Mechanism:* Parse `/tmp/dhcp.leases` + `/proc/net/arp` + `iwinfo wlanX assoclist`.
12. **LAN Gateway & Subnet Configuration:**
    * *Description:* Change router IP address (`192.168.1.1` to any custom subnet), subnet mask, and DHCP address pool range (`192.168.1.100 - 192.168.1.249`).
    * *Mechanism:* `uci set network.lan.ipaddr=... && uci commit network`.

---

### 📂 Category 3: Intermediate Level Networking & Services (8 Features)

13. **Real-time Bandwidth & Traffic Flow Monitor:**
    * *Description:* High-frequency instantaneous download and upload throughput calculation in Mbps/Kbps displayed on the 60 FPS animated dial and sparkline charts.
    * *Mechanism:* Read byte counters from `/proc/net/dev` over 1-second delta intervals.
14. **Static DHCP Leases & IP Reservation:**
    * *Description:* Bind specific MAC addresses to fixed local IP addresses and hostnames to guarantee servers, NAS, and printers always receive the same IP.
    * *Mechanism:* `uci add dhcp host && uci set dhcp.@host[-1].mac=... && uci commit dhcp`.
15. **Isolated Guest Wi-Fi Network:**
    * *Description:* Dedicated secondary SSID (`Guest-WiFi`) on an isolated VLAN with private subnet and strict firewall isolation preventing guests from discovering or accessing LAN devices.
    * *Mechanism:* Create `br-guest` interface, separate `network.guest` zone, and firewall forward drops.
16. **Port Forwarding & DMZ:**
    * *Description:* Inbound NAT port forwarding (WAN external port to internal device IP:port) and 1-tap DMZ host configuration for gaming consoles.
    * *Mechanism:* `uci add firewall redirect && uci set firewall.@redirect[-1].target='DNAT'`.
17. **UPnP & NAT-PMP Engine:**
    * *Description:* Automatic port opening daemon for gaming consoles (PlayStation, Xbox) and BitTorrent clients with live visual list of currently opened temporary UPnP ports.
    * *Mechanism:* OpenWrt `miniupnpd` service and `upnpc -l`.
18. **Dynamic DNS (DDNS) Suite:**
    * *Description:* Automated updater syncing dynamic WAN public IP with Cloudflare, DuckDNS, or No-IP domains for remote access.
    * *Mechanism:* `ddns-scripts` daemon and configuration.
19. **Hardware MAC Filtering & Access Control:**
    * *Description:* Device whitelist (only allowed devices can connect) and blacklist (block rogue devices at the 802.11 association layer before they obtain an IP).
    * *Mechanism:* `macfilter='deny' / 'allow'` in OpenWrt `wireless` configuration.
20. **Wake-on-LAN (WoL) Magic Packet Dispatcher:**
    * *Description:* Send UDP broadcast magic packets to sleep/suspended PC workstations and servers on LAN to remotely power them on.
    * *Mechanism:* Execute `etherwake -i br-lan <MAC>`.

---

### 📂 Category 4: Advanced Acceleration, QoS & Radios (8 Features)

21. **MediaTek Hardware NAT Flow Offloading:**
    * *Description:* Enable MediaTek MT7621DAT dedicated silicon hardware acceleration (`flow_offloading_hw=1`) to achieve 940+ Mbps gigabit routing while dropping router CPU load to near 0%.
    * *Mechanism:* `uci set firewall.@defaults[0].flow_offloading='1'` and `flow_offloading_hw='1'`.
22. **CAKE SQM QoS & Bufferbloat Killer:**
    * *Description:* Smart Queue Management using the state-of-the-art CAKE / FQ_CoDel queuing discipline to eliminate ping spikes and bufferbloat during heavy torrenting or streaming.
    * *Mechanism:* `sqm` package with `cake` qdisc on WAN interface.
23. **Advanced Wi-Fi Radio Frequency & TX Power Tuning:**
    * *Description:* Manual channel selection (including DFS channels), channel width (20/40 MHz on 2.4G; 20/40/80 MHz on 5G), TX Power in dBm (up to 23-30 dBm depending on regulatory domain), and country code regulatory unlock.
    * *Mechanism:* `iw reg set BD` / `US` and `uci set wireless.radioX.txpower=...`.
24. **Captive Portal & User Authentication (openNDS):**
    * *Description:* Captive portal gateway that intercepts new Wi-Fi connections, presents a branded web portal, and dispatches approval notifications to Telegram and Admin console with custom session timeouts (30m, 1h, unlimited).
    * *Mechanism:* OpenWrt `openNDS` daemon, `ndsctl auth <MAC> <MINUTES>`, and Upstash Redis queue.
25. **DNS Privacy & Encryption (DNS-over-HTTPS / DoH):**
    * *Description:* Route all router and client DNS queries over TLS/HTTPS (Cloudflare 1.1.1.1 / Google 8.8.8.8) using `https-dns-proxy` to prevent ISP tracking and DNS snooping.
    * *Mechanism:* `https-dns-proxy` daemon bound to `127.0.0.1:5053` with `dnsmasq` upstream forwarding.
26. **Parental Controls & Bedtime Scheduling:**
    * *Description:* Time-based internet curfew rules per device or MAC address group that automatically cut internet access during study hours or bedtime.
    * *Mechanism:* `iptables` / `nftables` time match rules (`-m time --timestart ... --timestop ...`).
27. **WAN MAC Address Cloning / Spoofing:**
    * *Description:* Override the router's WAN MAC address to replicate a computer or modem MAC required by ISPs with hardware MAC binding.
    * *Mechanism:* `uci set network.wan.macaddr=... && uci commit network`.
28. **IPTV & IGMP Multicast Proxy:**
    * *Description:* Enable IGMP Snooping and `igmpproxy` to route ISP set-top box television video streams across LAN without flooding Wi-Fi airtime.
    * *Mechanism:* `igmpproxy` daemon and `igmp_snooping=1` on bridge `br-lan`.

---

### 📂 Category 5: Ultra-Advanced VLANs, VPNs & Routing (8 Features)

29. **DSA-based 802.1Q VLAN Trunking:**
    * *Description:* Create isolated virtual networks on physical switch ports (e.g., Port 1 = Main LAN, Port 2 = IoT VLAN 20, Port 3 = Camera VLAN 30, Port 4 = Guest).
    * *Mechanism:* OpenWrt DSA bridge VLAN filter in `/etc/config/network`.
30. **Multi-WAN Failover & Load Balancing (`mwan3`):**
    * *Description:* Combine primary broadband with a secondary mobile tethering or Wi-Fi uplink with automatic failover and weighted round-robin load distribution.
    * *Mechanism:* OpenWrt `mwan3` engine with ping health tracking.
31. **WireGuard VPN Client & Server Suite:**
    * *Description:* High-performance kernel-mode WireGuard tunnel providing military-grade encryption with minimal CPU overhead, connecting the entire home to a remote VPN.
    * *Mechanism:* OpenWrt `kmod-wireguard` and `wireguard-tools`.
32. **Firewall 4 (`nftables`) Deep Rules:**
    * *Description:* Custom packet inspection chains, geographic IP blocking (drop all inbound traffic from specific countries), and raw table mangling.
    * *Mechanism:* OpenWrt Firewall 4 configuration in `/etc/config/firewall` and `nft` CLI.
33. **TTL & Hop Limit Modulation (Tethering Bypass):**
    * *Description:* Mangle outgoing WAN packet TTL (Time-To-Live) to a fixed value (e.g. 64) to prevent mobile carrier tethering detection and hotspot data throttling.
    * *Mechanism:* `nft add rule inet fw4 mangle_postrouting ip ttl set 64`.
34. **Switch Port Mirroring & Packet Sniffing:**
    * *Description:* Duplicate all traffic passing through a specific switch port to another port for Wireshark analysis and packet inspection.
    * *Mechanism:* DSA switch port mirroring or `daemon tcpdump -i any`.
35. **802.11r / 802.11k / 802.11v Fast Transition & Roaming:**
    * *Description:* Seamless zero-drop client roaming between multiple APs using 802.11r Fast BSS Transition, 802.11k neighbor reports, and 802.11v BSS management.
    * *Mechanism:* `wpad-openssl` or `wpad-mbedtls` with `ieee80211r=1`, `ieee80211k=1`, `ieee80211v=1`.
36. **Automated Linux Crontab Engine:**
    * *Description:* Visual editor for router scheduled tasks (scheduled reboots, periodic cache clearance, backup uploads, and night Wi-Fi shutdown).
    * *Mechanism:* `/etc/crontabs/root`.

---

### 📂 Category 6: Expert, Kernel & Developer Telemetry (8 Features)

37. **Local Microbus RPC (`ubus` & `ucode` API):**
    * *Description:* Direct communication with OpenWrt's native IPC microbus (`ubus call network.interface dump`) providing zero-latency low-overhead queries.
    * *Mechanism:* Execute `ubus` commands over local ash socket.
38. **Kernel Parameter & sysctl Tuning:**
    * *Description:* Fine-tune Linux kernel networking parameters (enable TCP BBR congestion control, expand `net.netfilter.nf_conntrack_max`, adjust socket buffers).
    * *Mechanism:* Edit `/etc/sysctl.conf` and apply via `sysctl -p`.
39. **Hotplug Event Scripting Engine:**
    * *Description:* Trigger custom automated bash scripts whenever network interfaces connect/disconnect, WAN IP changes, or buttons are pressed.
    * *Mechanism:* Scripts inside `/etc/hotplug.d/iface/` and `/etc/hotplug.d/button/`.
40. **Wi-Fi Chipset Driver & PHY Register Debugger:**
    * *Description:* Query MediaTek driver internal PHY states, noise floors, antenna beamforming metrics, and frame retry statistics.
    * *Mechanism:* Execute `iw dev wlanX station dump` and `iwinfo wlanX info`.
41. **System Logging & Kernel Ring Buffer (`dmesg` / `logread`):**
    * *Description:* Live streaming view of router kernel logs (`dmesg`), authentication daemon events, and remote syslog export.
    * *Mechanism:* `logread -l 50` and `dmesg | tail -n 50`.
42. **Embedded Root Ash Web Terminal:**
    * *Description:* Interactive root shell terminal directly inside the mobile app to execute any OpenWrt CLI command with instant output rendering.
    * *Mechanism:* Authenticated execution endpoint in `router/archer_c6_helper.sh?action=control&cmd=raw_cmd`.
43. **Package Repository Manager (`opkg` / `apk`):**
    * *Description:* Search, install, update, and remove OpenWrt packages directly from the official software repository with flash storage verification.
    * *Mechanism:* `apk update && apk add <pkg>` on OpenWrt 25.12+; `opkg` only on older releases.
44. **Failsafe Mode & Recovery Guide:**
    * *Description:* System diagnostic status checker showing current firmware boot partition, failsafe status, and step-by-step TFTP / U-Boot recovery instructions.
    * *Mechanism:* Verify `/proc/cmdline` and MTD partition tables.

---

### 📂 Category 7: Bandwidth Quotas, Accounting & Analytics (4 Features)

45. **Historical Bandwidth Tracking (`wrtbwmon`):**
    * *Description:* Persistent day-by-day, week-by-week, and month-by-month accounting of download and upload consumption per connected device preserved across reboots.
    * *Mechanism:* `wrtbwmon` daemon writing sqlite/csv database to persistent flash or cloud backup.
46. **Device-based Data Caps & Quotas:**
    * *Description:* Set monthly data limits (e.g. 50 GB) per device with automatic notification, bandwidth throttling to 512 Kbps, or full disconnection once exceeded.
    * *Mechanism:* Automated daemon checking `wrtbwmon` totals and applying `tc` or `iptables` drop rules.
47. **Latency & Packet Loss Analytics:**
    * *Description:* Continuous background ping to upstream ISP gateway and public DNS with historical jitter, ping variation, and packet loss charts.
    * *Mechanism:* `collectd-mod-ping` and RRDTool database.
48. **NetFlow / IPFIX Flow Exporter:**
    * *Description:* Export raw L3/L4 traffic flows to an external collector (Elasticsearch, PRTG, or Splunk) for enterprise-grade network monitoring.
    * *Mechanism:* OpenWrt `fprobe` or `softflowd` service.

---

### 📂 Category 8: Next-Gen IPv6 Advanced Suite (5 Features)

49. **IPv6 Prefix Delegation (DHCPv6-PD):**
    * *Description:* Automatically request `/64` or `/56` IPv6 address prefixes from upstream ISP and sub-delegate them to internal LAN subnets.
    * *Mechanism:* `odhcp6c` client on WAN6 interface.
50. **SLAAC & DHCPv6 Server (`odhcpd`):**
    * *Description:* Manage router advertisement (RA) modes, SLAAC stateless autoconfiguration, and stateful DHCPv6 address leasing.
    * *Mechanism:* `/etc/config/dhcp` odhcpd section.
51. **IPv6 Privacy Extensions (RFC 4941):**
    * *Description:* Enforce random temporary IPv6 interface identifiers to prevent ISP and website tracking of client devices.
    * *Mechanism:* `sysctl -w net.ipv6.conf.all.use_tempaddr=2`.
52. **IPv6 Inbound Security & Pinholing:**
    * *Description:* Stateful firewall protection for direct public IPv6 addresses with custom pinhole openings for specific device ports without NAT translation.
    * *Mechanism:* OpenWrt firewall IPv6 rules in `/etc/config/firewall`.
53. **IPv6 Transition Tunnels (6in4 / 464XLAT):**
    * *Description:* Connect to Hurricane Electric Tunnelbroker or Cloudflare WARP to provide IPv6 access when upstream ISP only provides IPv4.
    * *Mechanism:* OpenWrt `6in4` tunnel package and interface.

---

### 📂 Category 9: Smart Home & IoT Integrations (4 Features)

54. **Home Assistant Presence Detection Integration:**
    * *Description:* Real-time webhook dispatches to Home Assistant when household members' smartphones connect or disconnect from home Wi-Fi.
    * *Mechanism:* OpenWrt `dnsmasq.d` lease script or `arpwatch` firing HTTP POST to Home Assistant.
55. **MQTT Broker & Telemetry Client:**
    * *Description:* Publish live router hardware vitals, client count, and WAN traffic counters to an MQTT broker for Node-RED or Home Assistant dashboards.
    * *Mechanism:* Lightweight POSIX ash MQTT publisher script.
56. **mDNS Reflection & Discovery (`avahi-daemon`):**
    * *Description:* Reflect Apple AirPlay, Google Cast, and Spotify Connect discovery packets between isolated IoT/Guest VLANs and the main LAN.
    * *Mechanism:* OpenWrt `avahi-nodbus-daemon` with reflector mode enabled.
57. **SSDP & UPnP Multicast Relay:**
    * *Description:* Relay DLNA, Sonos, and smart TV discovery broadcasts across subnets without bridging the security boundary.
    * *Mechanism:* OpenWrt `smcroute` or `igmpproxy`.

---

### 📂 Category 10: Policy-Based Routing & Split-Tunneling (3 Features)

58. **Policy-Based Routing (PBR / Split-Tunneling):**
    * *Description:* Route traffic from specific devices (e.g. Smart TV or PC) through the WireGuard VPN while routing smartphones through the normal ISP WAN connection.
    * *Mechanism:* OpenWrt `pbr` (policy-based routing) package with routing table marks.
59. **Domain-based Smart Routing:**
    * *Description:* Route specific domains (e.g. streaming services) via local ISP for full speed while routing sensitive domains via encrypted VPN.
    * *Mechanism:* `dnsmasq` ipset / nftset integration matching domain names to routing tables.
60. **Multi-Homing Route Metrics & Prioritization:**
    * *Description:* Dynamic metric assignment to multiple uplinks ensuring default route prioritization.
    * *Mechanism:* Kernel routing table metric rules.

---

### 📂 Category 11: Advanced Wireless Protocols & Mesh (5 Features)

61. **802.11s True Wireless Mesh Backhaul:**
    * *Description:* Configure raw 802.11s point-to-point wireless mesh links with open routing between Archer C6 and other OpenWrt APs.
    * *Mechanism:* `mode='mesh'` in OpenWrt `wireless` configuration.
62. **WDS (Wireless Distribution System) Transparent Bridge:**
    * *Description:* True Layer 2 transparent bridge preserving client MAC addresses across wireless repeater links.
    * *Mechanism:* `wds='1'` in OpenWrt `wireless` configuration.
63. **WMM / EDCA Multimedia QoS:**
    * *Description:* Prioritize Voice (VO) and Video (VI) Wi-Fi packets over Best Effort (BE) and Background (BK) packets on the wireless airtime.
    * *Mechanism:* `wmm='1'` with custom EDCA contention window tuning.
64. **Legacy 802.11b Rate Dropping:**
    * *Description:* Disable legacy slow data rates (1, 2, 5.5, 11 Mbps) to prevent ancient devices from occupying disproportionate radio airtime.
    * *Mechanism:* `basic_rate` and `supported_rates` configuration in `hostapd`.
65. **Probe Response Clamping & Cloaking:**
    * *Description:* Ignore broadcast probe requests to conserve radio airtime and reduce device tracking fingerprinting.
    * *Mechanism:* `hostapd` probe response filtering options.

---

### 📂 Category 12: Cyber Security, Threat Defense & Stealth (4 Features)

66. **Brute-Force Defense (`banIP` / `fail2ban`):**
    * *Description:* Automatically ban IP addresses that fail multiple SSH or LuCI login attempts and block known malicious IP lists from entering WAN.
    * *Mechanism:* OpenWrt `banip` package with ipset/nftset drops.
67. **Port Knocking Stealth Security:**
    * *Description:* Keep router SSH and administrative ports completely closed and invisible to port scanners until a specific sequence of encrypted knock packets is sent.
    * *Mechanism:* `knockd` daemon on WAN interface.
68. **DNS Rebinding Mitigation:**
    * *Description:* Block external domains from resolving to private IP ranges (`192.168.x.x`, `10.x.x.x`) to prevent malicious web scripts from accessing the router console.
    * *Mechanism:* `rebind_protection='1'` in `dnsmasq`.
69. **Martian & Bogon Packet Filtering:**
    * *Description:* Automatically discard packets with impossible or reserved source addresses entering through WAN.
    * *Mechanism:* `sysctl -w net.ipv4.conf.all.rp_filter=1`.

---

### 📂 Category 13: Local Network Infrastructure & Services (4 Features)

70. **Custom Local Domain Resolver:**
    * *Description:* Provide clean `.lan` or `.home` domain names for all local devices (e.g. `nas.lan`, `router.lan`, `printer.lan`) without editing hosts files.
    * *Mechanism:* `domain` and `local` definitions in `/etc/config/dhcp`.
71. **Local Stratum NTP Time Server:**
    * *Description:* Local Network Time Protocol server broadcasting accurate atomic time to all IoT devices, cameras, and PCs on LAN.
    * *Mechanism:* OpenWrt `sysntpd` in server mode.
72. **Split-Horizon Conditional DNS Forwarding:**
    * *Description:* Forward queries for specific private domains (e.g. `*.corp`, `*.work`) to a corporate VPN DNS while resolving public domains through primary DNS.
    * *Mechanism:* `server=/work.domain/10.0.0.1` in `dnsmasq.conf`.
73. **DNSSEC Cryptographic Chain Validation:**
    * *Description:* Cryptographically verify the integrity of DNS records to protect clients from DNS spoofing and cache poisoning.
    * *Mechanism:* `dnsmasq-full` with DNSSEC enabled.

---

### 📂 Category 14: ISP Workarounds & CGNAT Bypasses (3 Features)

74. **DHCP Option 60 & 61 (Vendor Class / Client ID):**
    * *Description:* Inject specialized vendor strings (e.g., Sky UK, Orange, Singtel) required by restrictive ISPs to establish a WAN connection.
    * *Mechanism:* `sendopts` in OpenWrt WAN network configuration.
75. **PPPoE LCP Keepalive Optimization:**
    * *Description:* Aggressive keepalive echo request interval tuning (e.g. every 5 seconds) to immediately detect ISP line drops and reconnect before streaming breaks.
    * *Mechanism:* `keepalive '5 3'` in `/etc/config/network`.
76. **CGNAT Hole-Punching & Tailscale / ZeroTier Mesh:**
    * *Description:* Establish direct encrypted peer-to-peer tunnels behind carrier-grade NAT (CGNAT) without needing a static public IP address or port forwarding.
    * *Mechanism:* OpenWrt `tailscale` or `zerotier` package.
