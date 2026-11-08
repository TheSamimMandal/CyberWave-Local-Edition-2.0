# 🎯 ArcherGuard C6 — Final Expected Result, Vision & Deliverables

> **Product Name:** ArcherGuard C6  
> **Final Form Factor:** Native Android Application (.APK) + OpenWrt Firmware Helper Engine  
> **Core Promise:** Transform the TP-Link Archer C6 v3 running OpenWrt into a cybernetic command center with sub-10ms response times and enterprise-grade network controls.

---

## 👁️ Visual & Experience Walkthrough of the Final Application

When the user opens **ArcherGuard C6** on their Android phone, they are greeted by an ultra-fast, smooth, zero-latency dark interface designed to feel like an advanced hardware telemetry deck.

```
┌────────────────────────────────────────────────────────────────────────┐
│ [⬡ ARCHER GUARD]        🟢 4ms (Local OpenWrt)   [🔄 Sync] [⚙️ Config]  │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │  ⚡ REAL-TIME THROUGHPUT (WAN)                                  │   │
│   │                                                                │   │
│   │                     ╭───────────╮                              │   │
│   │                   ╭─╯   48.5    ╰─╮   Mbps                     │   │
│   │                  │     DOWNLOAD    │                           │   │
│   │                  │  ▲ 12.4 Mbps UP │                           │   │
│   │                   ╰─╮           ╭─╯                            │   │
│   │                     ╰───────────╯                              │   │
│   │           [ ∿∿∿ Live 60 FPS Traffic Area Graph ∿∿∿ ]           │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │  🔌 GIGABIT ETHERNET SWITCH (MT7621 DSA)                       │   │
│   │   [WAN: 1000M 🟢] [LAN1: 1000M 🟢] [LAN2: 100M 🟡] [L3:⚫] [L4:⚫]   │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│   ┌──────────────────────┐  ┌──────────────────────┐  ┌────────────┐   │
│   │ CPU LOAD (4-Threads) │  │ RAM (128 MB DDR3)    │  │ FLASH (16M)│   │
│   │       14% 🟢         │  │ 52 MB Free [Flush 🧹]│  │ 6.4 MB Free│   │
│   └──────────────────────┘  └──────────────────────┘  └────────────┘   │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │  ⚡ QUICK ACTIONS                                               │   │
│   │  [🌙 Stealth LEDs: OFF]  [🔄 Soft Reboot]  [⚡ MediaTek HW NAT] │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
├────────────────────────────────────────────────────────────────────────┤
│  [⚡ Dashboard]  [👥 Devices]  [📶 Wireless]  [🌐 Network]  [🛠️ Advanced]│
└────────────────────────────────────────────────────────────────────────┘
```

---

## 📱 Detailed Final Screen Deliverables

### Screen 1: Dashboard (`DashboardScreen`)
* **Live Speedometer:** 60 FPS radial dial rendered via Jetpack Compose `Canvas` displaying instantaneous download and upload throughput with peak indicators.
* **Physical RJ45 Switch Visualizer:** Accurate 5-port Gigabit Ethernet switch representation with glowing green (1000M), amber (100M), and dark (down) link state LEDs.
* **Hardware Vitals Ring Gauges:**
  * CPU: 2 Cores / 4 Threads MT7621DAT load percentage with 1m/5m/15m breakdown.
  * RAM: 128 MB DDR3 usage with an interactive **"Flush Cache"** button executing `drop_caches`.
  * Flash: 16 MB SPI NOR overlay space indicator preventing storage exhaustion.
* **Quick Control Grid:** 1-tap toggles for Stealth LED Night Mode, Cold Reboot, and Wi-Fi master killswitch.

---

### Screen 2: Devices & Captive Portal Controller (`DevicesScreen`)
* **Real-time Client Cards:** Every connected device displayed with hostname, IP, MAC address, connection type (Ethernet, 2.4G, 5G), and Wi-Fi RSSI signal strength bar.
* **1-Tap Instant Firewall Killswitch:** Red **"DROP"** button instantly blocks client traffic at the firewall layer using `iptables -I FORWARD -m mac --mac-source <MAC> -j DROP`.
* **openNDS Captive Portal Authorization:** Dedicated authorization chip allowing administrators to grant 30-minute, 1-hour, or unlimited internet access directly from the app.
* **Wake-on-LAN (WoL):** One-tap button sending UDP magic packets to wake up sleeping desktop PCs on the LAN.

---

### Screen 3: Dual-Band Wireless Lab (`WirelessScreen`)
* **2.4 GHz Radio (MediaTek MT7603E):** Live channel, frequency, encryption, active connected clients, and an interactive **TX Power Slider (dBm)** to adjust signal propagation.
* **5.0 GHz Radio (MediaTek MT7613BEN):** 802.11ac high-speed radio controls, DFS channel allocation, 80 MHz channel width toggle, and independent TX Power tuning.
* **Isolated Guest Wi-Fi Lab:** Dedicated guest network switch allowing instantaneous activation of guest access with isolated VLAN subnetting.
* **Roaming & Quality:** Toggles for 802.11r Fast Transition, 802.11w Protected Management Frames (PMF), and WMM Multimedia airtime prioritization.

---

### Screen 4: Network, Routing & Acceleration (`NetworkScreen`)
* **WAN Uplink Status:** Live WAN IP address, ISP gateway, DNS servers, and connection uptime duration.
* **MediaTek Hardware NAT Flow Offloading:** 1-tap switch activating `flow_offloading_hw=1` to unleash full 940+ Mbps gigabit wire-speed routing with negligible CPU utilization.
* **CAKE SQM QoS Bufferbloat Killer:** Toggle CAKE / FQ_CoDel queuing to eliminate ping spikes and jitter during competitive online gaming.
* **WireGuard VPN Tunnel:** Live status indicator showing handshake status and data transferred through the encrypted tunnel.
* **DNS Privacy Suite:** DNS-over-HTTPS (DoH) status with Cloudflare 1.1.1.1 or Google 8.8.8.8 encrypted upstream resolvers.

---

### Screen 5: Diagnostic Web Terminal & Low-Level Shell (`AdvancedScreen`)
* **Root Ash Shell Terminal:** Fully functional, authenticated terminal console running BusyBox ash directly on the OpenWrt router.
* **Instant Diagnostic Quick-Action Chips:**
  * `ping 8.8.8.8 -c 4`: Instant upstream gateway latency check.
  * `traceroute 1.1.1.1`: Hop-by-hop packet route diagnostics.
  * `iwinfo`: Wireless signal and noise floor audit.
  * `logread -l 25`: Recent OpenWrt system event logs.
  * `dmesg | tail -n 25`: Kernel ring buffer diagnostic.
  * `cat /proc/cpuinfo`: Hardware identification verification.
* **System Identity Card:** Complete hardware specs (MediaTek MT7621DAT, RAM, Flash, Linux Kernel version, OpenWrt build release).

---

## ⚡ Performance & Quality Benchmarks (Acceptance Criteria)

The final application must satisfy strict non-functional performance benchmarks:

| Benchmark Metric | Target Value | Verification Method |
| :--- | :--- | :--- |
| **Local Network Latency** | **< 10 ms** | Direct HTTP connection to `http://192.168.1.1/cgi-bin/api` |
| **WireGuard Remote Latency**| **< 30 ms** | Direct ChaCha20-Poly1305 peer tunnel to `http://10.14.0.1/cgi-bin/api` |
| **UI Frame Rate** | **Steady 60 FPS** | Android Studio Profiler / Compose JankStats (no jank) |
| **Mobile App RAM Footprint** | **< 35 MB** | Android Studio Profiler memory inspection |
| **Router Helper Memory** | **< 300 KB** | Pure POSIX ash shell execution, zero daemon bloat |
| **Router CPU Overhead** | **< 2%** | Continuously polling every 2.5 seconds |
| **APK Binary Size** | **< 22 MB** | Release build via Gradle (R8 / ProGuard minified) |
| **Cold Startup Time** | **< 600 ms** | Time to first interactive telemetry screen |

---

## 📦 Final Release Deliverables & Artifacts

1. **Production Android APK (`android_native/app/build/outputs/apk/release/app-release.apk`):**
   * Pre-compiled, signed Android release binary ready for side-loading or internal distribution.
2. **Router Firmware Helper Script (`router/archer_c6_helper.sh`):**
   * Zero-bloat (~14 KB) POSIX ash executable to be installed at `/www/cgi-bin/api` on the router.
3. **WireGuard VPN Remote Gateway:**
   * Direct ChaCha20-Poly1305 encrypted peer-to-peer remote access without any 3rd party cloud dependencies.
4. **Standalone Web Controller (`public/router/index.html`):**
   * Single-file 22 KB web application providing identical functionality via any desktop or laptop browser.
5. **Project Documentation Suite:**
   * `01_BASE_DESIGN_SYSTEM.md`: UI/UX design tokens and architecture rules.
   * `02_ALL_FEATURES_CATALOG.md`: 76-feature master technical catalog.
   * `03_10_STEP_EXECUTION_PLAN.md`: 10-phase development and deployment lifecycle.
   * `04_PROGRESS_TRACKER.md`: Live task completion and sprint matrix.
   * `05_EXPECTED_FINAL_RESULT.md`: Final vision, quality benchmarks, and acceptance criteria.

---

## ✅ Definition of Done (DoD) Checklist

- [x] All 5 markdown specification documents created, synchronized, and verified in the workspace root.
- [x] Router helper script tested on OpenWrt and verified to output valid JSON within 10ms (< 250 lines per module).
- [x] Native Kotlin Android app compiles cleanly and passes all unit tests.
- [x] 60 FPS animated speedometer and 5-port RJ45 switch visualizer render smoothly.
- [x] Client killswitch (`block_client` / `unblock_client`) verified against OpenWrt firewall.
- [x] Seamless connection failover between Local Wi-Fi and WireGuard VPN tunnel when remote.
- [x] Production Android build scaffold configured (`AndroidManifest.xml`, `network_security_config.xml`, and Gradle).

