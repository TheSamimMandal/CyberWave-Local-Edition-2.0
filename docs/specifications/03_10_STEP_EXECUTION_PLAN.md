# 🚀 ArcherGuard C6 — 10-Step Implementation & Execution Plan

> **Scope:** Full-cycle development of the ArcherGuard C6 Android application and OpenWrt router firmware engine.  
> **Target Devices:** Android Smartphone & TP-Link Archer C6 v3 (OpenWrt 21.02/22.03/23.05+).  
> **Development Language:** Native Kotlin / Jetpack Compose (Android App) + POSIX /bin/sh (Router Helper) + WireGuard VPN & Node.js (Captive Portal / Telegram).

---

## 🗺️ Master Execution Roadmap

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      10-PHASE IMPLEMENTATION LIFECYCLE                 │
 ├────────────────────────────────┬───────────────────────────────────────┤
 │ Phase 01: Firmware Engine API  │ Phase 06: Dual-Band Wireless Lab      │
 │ Phase 02: WireGuard VPN Remote │ Phase 07: Acceleration & CAKE SQM QoS │
 │ Phase 03: Native Architecture  │ Phase 08: Root Terminal & Diagnostics │
 │ Phase 04: Dashboard & Telemetry│ Phase 09: Analytics, Quotas & Crontab │
 │ Phase 05: Devices & Captive    │ Phase 10: APK Build & Acceptance Test │
 └────────────────────────────────┴───────────────────────────────────────┘
```

---

## 📋 Phase-by-Phase Execution Details

### 🔹 Phase 01: Router Firmware API & Zero-Overhead Engine
* **Goal:** Implement and stabilize a pure POSIX `/bin/sh` JSON API helper on the Archer C6 v3 router that runs under BusyBox ash with near-zero RAM and CPU consumption.
* **Key Tasks:**
  1. Optimize `router/archer_c6_helper.sh` (size < 18 KB, execution latency < 8ms).
  2. Implement sub-millisecond hardware parsers for `/proc/stat`, `/proc/meminfo`, `/proc/net/dev`, and `/sys/class/net/*`.
  3. Wire uhttpd cgi-bin routing at `/www/cgi-bin/api`.
  4. Implement authentication verification with `X-Router-Secret` header and query string token fallback.
  5. Add atomic action handlers for `reboot`, `wifi_toggle`, `led_stealth`, `block_client`, `unblock_client`, `nds_auth`, `drop_caches`, `wol`, `set_txpower`, and `raw_cmd`.
* **Deliverable Artifact:** Tested `/www/cgi-bin/api` returning valid JSON metrics on OpenWrt.

---

### 🔹 Phase 02: WireGuard VPN Secure Remote Access Architecture (Zero-Cloud End-to-End Tunnel) [COMPLETE ✅]
* **Goal:** Completely eliminate 3rd-party cloud dependencies (Vercel serverless / Upstash Redis queue) and provide direct, military-grade encrypted (ChaCha20-Poly1305) remote control over an OpenWrt WireGuard VPN tunnel.
* **Key Tasks:**
  1. Author automated OpenWrt router setup script [`router/setup_wireguard.sh`](file:///Users/sabbir/Dev/wifi_handler/router/setup_wireguard.sh) to configure interface `wg0` (`10.14.0.1/24`), generate keypairs, setup firewall forwarding, and print terminal QR code via `qrencode`.
  2. Implement direct WireGuard Gateway routing in Android Native client (`http://10.14.0.1/cgi-bin/api`) with automatic fallback between Local Wi-Fi (`192.168.1.1`) and WireGuard VPN tunnel.
  3. Remove cloud polling daemon overhead from `router/sync.sh` (zero background cloud HTTP polling, sub-25ms command response time).
  4. Build WireGuard VPN Connection Diagnostic Deck, Gateway Settings, and interactive "Client Tunnel Profile (.conf)" modal with 1-tap clipboard copy in the Android mobile application.
* **Deliverable Artifact:** Direct peer-to-peer WireGuard VPN remote control pipeline with zero cloud middlemen.



---

### 🔹 Phase 03: Native Android Architecture & Modern Glossy Design System Setup
* **Goal:** Initialize the clean, modular native Kotlin Android project architecture with theme tokens, fonts, and responsive Jetpack Compose layout foundations.
* **Key Tasks:**
  1. Configure Gradle build system (`build.gradle.kts`) with required AndroidX, Jetpack Compose, Material 3, and Serialization dependencies.
  2. Implement `ui/theme/GlossyColors.kt` with OLED `#0A0E17`, electric cyan `#00F2FE`, and emerald `#00E676`.
  3. Implement `ui/theme/GlossyTheme.kt` with customized dark MaterialTheme and transparent system bars.
  4. Build reusable `ui/components/GlossyCard.kt` supporting frosted acrylic glass blur and neon border styling.
  5. Implement `MainActivity.kt` with a 5-tab persistent bottom navigation shell and settings bottom sheet.
* **Deliverable Artifact:** Running native Android app shell with glossy dark theme and tab navigation.

---

### 🔹 Phase 04: Dashboard & Live Hardware Telemetry System
* **Goal:** Deliver the primary telemetry dashboard featuring real-time speedometer, hardware vitals, and physical Ethernet switch visualizer.
* **Key Tasks:**
  1. Build `ui/components/CircularGauge.kt` and `SpeedTracker.kt` with 60 FPS needle physics, radial gradients, and Mbps/Kbps formatting.
  2. Build switch port visualizer components rendering the 5 physical RJ45 ports (WAN + LAN 1-4) with interactive LEDs (1000M green, 100M amber, Down grey).
  3. Build vital gauges for CPU 4-thread load, 128MB RAM with 1-tap `drop_caches` button, and 16MB Flash storage.
  4. Build `ui/components/TrafficSparkline.kt` displaying live network throughput trends.
  5. Wire `ui/screens/dashboard/DashboardScreen.kt` to poll `RouterApiService` every 2.5 seconds.
* **Deliverable Artifact:** Fully functional, animated telemetry dashboard screen.

---

### 🔹 Phase 05: Client Devices & Captive Portal Management
* **Goal:** Enable live client monitoring, one-tap instant firewall MAC blocking, and openNDS captive portal authentication.
* **Key Tasks:**
  1. Implement client aggregator in `router/archer_c6_helper.sh` combining DHCP leases, ARP table, openNDS auth state, and iptables drops.
  2. Build `ui/screens/devices/DevicesScreen.kt` with client cards displaying hostname, IP, MAC, connection status, and vendor.
  3. Implement 1-Tap Instant Firewall MAC Killswitch (`block_client` / `unblock_client`) that inserts `-m mac --mac-source <MAC> -j DROP`.
  4. Implement 1-Tap Captive Portal authorization (`ndsctl auth <MAC> <MINUTES>`) with 30m, 1h, and unlimited session choices.
  5. Implement Wake-on-LAN (WoL) button triggering `etherwake -i br-lan <MAC>`.
* **Deliverable Artifact:** Working Devices screen with live client control and captive portal sync.

---

### 🔹 Phase 06: Dual-Band Wireless Lab (2.4 GHz & 5.0 GHz)
* **Goal:** Deliver fine-grained control over both physical wireless chipsets (MediaTek MT7603E and MT7613BEN).
* **Key Tasks:**
  1. Build `ui/screens/wireless/WirelessScreen.kt` with dedicated cards for 2.4 GHz and 5.0 GHz radios.
  2. Implement interactive TX Power sliders allowing users to set output power from 10 dBm to 23-30 dBm.
  3. Implement Wi-Fi master enable/disable toggles invoking `wifi_toggle`.
  4. Add channel and channel-width selector (20/40 MHz on 2.4G; 20/40/80 MHz on 5G).
  5. Add Isolated Guest Wi-Fi section with separate toggle and client counter.
* **Deliverable Artifact:** Interactive Wireless management screen with live radio adjustments.

---

### 🔹 Phase 07: Network Acceleration, CAKE SQM QoS & Traffic Routing
* **Goal:** Expose enterprise-grade network performance toggles and traffic routing controls.
* **Key Tasks:**
  1. Build `ui/screens/network/NetworkScreen.kt` showing WAN IP, gateway, DNS servers, and connection uptime.
  2. Implement 1-Tap MediaTek Hardware NAT Offloading switch (`flow_offloading_hw=1`).
  3. Implement CAKE / FQ_CoDel SQM QoS toggle to eliminate gaming bufferbloat.
  4. Add WireGuard VPN tunnel status and 1-tap connect/disconnect toggle.
  5. Add Multi-WAN status display and DNS-over-HTTPS (DoH) privacy indicator.
* **Deliverable Artifact:** Network acceleration and QoS control center screen.

---

### 🔹 Phase 08: Embedded Root Ash Web Terminal & Developer Diagnostics
* **Goal:** Embed an interactive root console inside the app for direct OpenWrt command execution.
* **Key Tasks:**
  1. Implement `raw_cmd` execution backend in `router/archer_c6_helper.sh` with output sanitation and execution timeouts.
  2. Build `ui/screens/tools/ToolsScreen.kt` featuring an OLED dark terminal window with JetBrains Mono font.
  3. Add quick-diagnostic action chips: `ping 8.8.8.8`, `traceroute`, `iwinfo`, `logread -l 30`, `dmesg | tail -n 25`, `cat /proc/cpuinfo`.
  4. Add router hardware specifications display (Flash, RAM, CPU model, OpenWrt release).
* **Deliverable Artifact:** In-app root web terminal with command history and quick-action chips.

---

### 🔹 Phase 09: Bandwidth Quota Analytics, Crontab Automation & Smart Home
* **Goal:** Add long-term accounting, scheduled cron automations, and home ecosystem triggers.
* **Key Tasks:**
  1. Add persistent bandwidth accounting tracker card (`wrtbwmon` parsing).
  2. Implement quota limit configuration with notification triggers.
  3. Build a visual Cron Task scheduler for scheduled midnight reboots and nocturnal Wi-Fi sleep schedules.
  4. Implement Home Assistant presence detection webhook triggers on device connect.
* **Deliverable Artifact:** Analytics, automation, and smart home configuration views.

---

### 🔹 Phase 10: Production Hardening, APK Compilation & Acceptance Testing [COMPLETE ✅]
* **Goal:** Optimize performance, test all error boundaries, compile the release APK, and verify on physical hardware.
* **Key Tasks:**
  1. Audit network timeouts, exception handling, and offline fallback states in `ApiService`.
  2. Scaffolding complete Android build toolchain (`AndroidManifest.xml`, `network_security_config.xml`, and Gradle).
  3. Verify router CPU usage remains under 2% during continuous 2.5-second polling (< 250 lines POSIX ash).
  4. Run comprehensive test suites across Node, OpenWrt shell, and Android unit tests (100% pass rate).
  5. Provide one-command deployment (`router/deploy.sh`) and APK build command (`cd android_native && ./gradlew assembleRelease`).
* **Deliverable Artifact:** Production release APK toolchain, hardened router firmware helper, and complete system documentation.
