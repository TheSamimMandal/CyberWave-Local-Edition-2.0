# 🎨 ArcherGuard C6 — Base Design System & UI/UX Architecture

> **Target Platform:** Android (Native Kotlin / Jetpack Compose)  
> **Target Hardware:** TP-Link Archer C6 v3 (MediaTek MT7621DAT, OpenWrt 21.02/22.03/23.05+)  
> **Design Language:** Cyber-Dark Glassmorphism & Neon Telemetry  
> **Primary Goal:** Sub-10ms ultra-responsive hardware router controller with deep telemetry and intuitive management.

---

## 1. Design Philosophy & Aesthetic Identity

ArcherGuard C6 is designed around the concept of a **High-Performance Cybernetic Command Deck**. Traditional router configuration interfaces (like LuCI or vendor web interfaces) are tabular, text-heavy, and difficult to operate on mobile devices. ArcherGuard transforms router management into an intuitive, visually stunning experience built on three pillars:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   ARCHERGUARD C6 DESIGN PILLARS                        │
├───────────────────┬──────────────────────────┬─────────────────────────┤
│   1. OLED DARK    │   2. FROSTED ACRYLIC     │   3. AT-A-GLANCE        │
│   Pure deep space │   Layered glass cards    │   60 FPS animations,    │
│   blacks (#0A0E17)│   with subtle neon glows │   radial dials & real-  │
│   for zero-glare  │   and tactile depth      │   time switch ports     │
└───────────────────┴──────────────────────────┴─────────────────────────┘
```

---

## 2. Color Palette & Neon Hierarchy

The color system is optimized for OLED screens, providing maximum contrast while minimizing battery drain during live telemetry monitoring.

### 2.1 Core Palette

| Token Name | Hex Code | Visual Swatch | Primary Role |
| :--- | :--- | :--- | :--- |
| `bgPrimary` | `#0A0E17` | ⬛ Deep Midnight | Screen canvas background |
| `bgSecondary` | `#111827` | ⬛ Space Navy | Bottom nav bar, modal sheets |
| `surfaceCard` | `#1A2234` | ⬛ Elevated Glass | Base container for widgets |
| `surfaceCardLight`| `#243048` | ⬛ Highlight Surface | Interactive buttons, inputs |
| `glassBorder` | `rgba(255, 255, 255, 0.08)` | ▫️ Subtle Rim | Acrylic card borders |
| `neonCyan` | `#00F2FE` | 🔷 Electric Cyan | Primary brand, download speeds, Wi-Fi 5G |
| `neonEmerald` | `#00E676` | 🟢 Emerald Green | Active ports, healthy CPU/RAM, upload |
| `neonAmber` | `#FFAB00` | 🟡 Warning Amber | Moderate load, 100M port speed, throttled |
| `neonCrimson` | `#FF1744` | 🔴 Alert Crimson | Dropped clients, critical load, blocked |
| `neonPurple` | `#7928CA` | 🟣 Cyber Purple | WireGuard VPN, captive portal, root tools |
| `textPrimary` | `#F8FAFC` | ⬜ Pure White | Headlines, vital values, active states |
| `textSecondary` | `#94A3B8` | ▫️ Slate Grey | Subtitles, labels, timestamps |
| `textMuted` | `#64748B` | ▫️ Dark Slate | Inactive icons, subtle captions |

### 2.2 Gradients & Glow Accents

```kotlin
// Core Gradient Tokens
val CyanGlowGradient = Brush.linearGradient(
  colors = listOf(Color(0xFF00F2FE), Color(0xFF4FACFE))
)

val EmeraldGlowGradient = Brush.linearGradient(
  colors = listOf(Color(0xFF00E676), Color(0xFF1DE9B6))
)

val CrimsonGlowGradient = Brush.linearGradient(
  colors = listOf(Color(0xFFFF1744), Color(0xFFFF5252))
)
```

---

## 3. Typography System

The typography pairs a modern geometric sans-serif for UI chrome with a high-readability monospaced font for networking metrics (MAC addresses, IP addresses, speeds, and terminal output).

```
Headline 1:   Plus Jakarta Sans • 22pt / Bold (700) • Tracking -0.5px
Title 2:      Plus Jakarta Sans • 16pt / SemiBold (600) • Tracking 0px
Body Text:    Plus Jakarta Sans • 13pt / Regular (400) • Line Height 1.4
Metric Value: JetBrains Mono   • 26pt / ExtraBold (800) • Monospace
Hardware IP:  JetBrains Mono   • 12pt / Medium (500) • Clean tabular
Terminal:     JetBrains Mono   • 11pt / Regular (400) • Line Height 1.35
```

---

## 4. Reusable Custom Component Architecture

All UI components adhere to a strict modular design pattern to ensure consistent spacing, border radius, and elevation across the entire app.

### 4.1 GlossyCard (`android_native/app/src/main/java/com/archerguard/openwrt/ui/components/GlossyCard.kt`)
A frosted acrylic container with dual-layer blur, subtle 1px border gradient, and optional glow shadow:
* **Border Radius:** `16.dp` or `20.dp`
* **Internal Padding:** `16.dp`
* **Border:** 1.dp border with `GlossyColors.GlassBorderLight.copy(alpha = 0.30f)`
* **Backdrop Styling:** Elevated card surface with subtle alpha blur

### 4.2 Animated Radial Speedometer (`android_native/app/src/main/java/com/archerguard/openwrt/ui/components/CircularGauge.kt`)
* **Framework:** Jetpack Compose `Canvas` with 60 FPS physics-based needle damping.
* **Dial Range:** 0 to 100+ Mbps dynamic logarithmic scaling.
* **Glow Layer:** Radial gradient path with blurred cyan/emerald neon arcs.
* **Center Display:** Instantaneous Download / Upload throughput formatted to Mbps/Kbps with peak speed indicators.

### 4.3 Physical RJ45 Ethernet Switch Visualizer (`android_native/app/src/main/java/com/archerguard/openwrt/ui/screens/dashboard/widgets/SwitchPortVisualizer.kt`)
A physical representation of the TP-Link Archer C6 v3's 5 Gigabit Ethernet ports (MediaTek DSA switch architecture):
* **Port Layout:** 1x WAN (Gold accent) + 4x LAN ports (Cyan accents).
* **Live LED Indicators:**
  * 🟢 **Active 1000 Mbps Gigabit:** Solid Emerald green with pulse animation.
  * 🟡 **Active 100 Mbps Fast Ethernet:** Solid Amber.
  * ⚫ **Disconnected / Link Down:** Dark Slate grey.
* **Interactivity:** Tapping any port reveals instantaneous packet counters, full/half duplex state, and software shutdown toggle.

### 4.4 Hardware Vital Gauge (`android_native/app/src/main/java/com/archerguard/openwrt/ui/components/HardwareVitalTile.kt`)
* **Radial Ring:** Visual percentage representation of 4-Thread CPU load, 128MB RAM consumption, and 16MB Flash storage.
* **Interactive Action:** Tap on RAM gauge triggers a one-tap kernel cache flush (`drop_caches`).

---

## 5. Navigation Shell & Information Hierarchy

The application employs a persistent 5-tab Bottom Navigation Shell paired with a contextual Top App Bar and dynamic pull-up sheets.

```
┌────────────────────────────────────────────────────────────────────────┐
│ [⬡ ARCHER GUARD]        🟢 6ms (Local OpenWrt)   [🔄 Sync] [⚙️ Config]  │ Top Bar
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   TAB 1: DASHBOARD       TAB 2: DEVICES        TAB 3: WIRELESS         │
│   • 60 FPS Speedometer   • Active Clients      • 2.4G & 5.0G Radios    │
│   • Hardware Vitals      • Bandwidth Drops     • TX Power Sliders      │
│   • 5-Port Switch        • Captive Portal Auth • Guest Wi-Fi Lab       │
│   • Quick Actions        • Wake-on-LAN         • 802.11w / Fast Roam   │
│                                                                        │
│   TAB 4: NETWORK                               TAB 5: ADVANCED         │
│   • WAN Status & PPPoE                         • Root Ash Shell        │
│   • CAKE SQM QoS Bufferbloat                   • ubus RPC Inspector    │
│   • MediaTek HW NAT Offload                    • Crontab Automation    │
│   • WireGuard VPN Tunnel                       • Syslog / dmesg        │
│                                                                        │
├────────────────────────────────────────────────────────────────────────┤
│  [⚡ Dashboard]  [👥 Devices]  [📶 Wireless]  [🌐 Network]  [🛠️ Advanced]│ Bottom Bar
└────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Hybrid Connection Engine Architecture

The mobile app implements a zero-friction dual connection pipeline:

```
                          ┌───────────────────────────┐
                          │   ArcherGuard Mobile App  │
                          └─────────────┬─────────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
                    │ Determines Network Route Automatically│
                    ▼                                       ▼
     [On Home Wi-Fi Network]                  [On Mobile Data / Remote]
  Direct Local HTTP (Sub-10ms)               Secure Serverless Cloud Bridge
http://192.168.1.1/cgi-bin/api               https://wifi-handler.vercel.app/api
           │                                                │
           ▼                                                ▼
  TP-Link Archer C6 v3                           Upstash Redis Command Queue
  uhttpd / POSIX /bin/sh                                    │
                                                            ▼
                                                   router/sync.sh Daemon
```

1. **Local Mode (Default on Wi-Fi):**
   * Connects directly to `http://192.168.1.1/cgi-bin/api`.
   * **Latency:** < 10ms.
   * **Payload Size:** < 1.2 KB per telemetry tick.
   * Zero external internet dependency.
2. **Cloud Fallback (Automatic outside home):**
   * Detects local timeout (> 800ms) and seamlessly switches to the Vercel + Upstash Redis bridge (`https://wifi-handler.vercel.app/api`).
   * Queues mutating actions in Redis list `pending_commands` which the router pulls every 5s via `router/sync.sh`.

---

## 7. Responsiveness & Screen Adaptation Rules

1. **Compact Phones (< 380dp width):**
   * Speedometer dial radius scales down from 140dp to 110dp.
   * Switch ports collapse to a scrollable row or 2-column layout.
2. **Standard Phones (380dp - 450dp width):**
   * Default layout. All 5 switch ports render in a single horizontal cluster.
3. **Tablets & Foldables (> 600dp width):**
   * Two-column split view: Left pane shows Dashboard Vitals & Speedometer; Right pane shows Devices & Quick Actions.

---

## 8. State Management & Lifecycle Guidelines

* **Polling Rate:**
  * Active screen: 2.5 seconds per telemetry cycle.
  * Speedometer running: 1.0 second high-frequency byte counter check.
  * App in background (`AppLifecycleState.paused`): Polling timer instantly stops to prevent phone battery drain and router CPU usage.
* **Error Resilience:**
  * Network disconnect displays a non-blocking floating status pill (`⚠️ Reconnecting...`) without freezing the user interface.
  * Mutating commands (e.g. Block MAC, Toggle Wi-Fi) update UI optimistically and roll back if confirmation is not received within 4 seconds.

---

## 9. Code Health, Modularity & DRY Architecture (Mandatory Core Rules)

Every single file and component in this repository (Kotlin, POSIX Shell, Node.js) must strictly follow two non-negotiable architectural mandates:

### 📏 Mandate 1: Strict 250-Line Limit (`MAX_FILE_LINES <= 250`)
1. **Hard Upper Bound:** No code file may exceed **250 total lines** of code.
2. **Decomposition Over Accumulation:** When a screen or service approaches 200 lines, it must be proactively decomposed into modular, cohesive single-responsibility files (sub-widgets, separate helpers, or domain models).
3. **Focused Modules:** Every file must have a single clear purpose:
   * Screens only handle layout assembly and high-level routing.
   * Specific composable widgets (gauges, buttons, cards) reside in dedicated modular files under `ui/components/` or feature-specific `widgets/` packages.
   * Data parsing, formatting, and networking reside exclusively in domain services/models.

### ♻️ Mandate 2: 100% DRY (Don't Repeat Yourself) Principle
1. **Single Source of Truth:** Never duplicate color definitions, dimensions, text styles, or parsing logic across files.
2. **Shared UI Atoms:** Common UI patterns (e.g. status badges, chip buttons, section headers, confirmation modals) must be extracted into reusable widgets.
3. **Unified Formatters & Helpers:** Unit formatting (Bytes to MB/GB, bps to Mbps/Kbps, seconds to human uptime, MAC address normalization) must be centralized in utility classes (`core/utils/`).
4. **Shell Script Modularity:** Shell scripts on OpenWrt must share common libraries (`lib/sys_metrics.sh`, `lib/net_metrics.sh`, `lib/actions.sh`) rather than repeating headers, authentication checks, or JSON formatting logic.

