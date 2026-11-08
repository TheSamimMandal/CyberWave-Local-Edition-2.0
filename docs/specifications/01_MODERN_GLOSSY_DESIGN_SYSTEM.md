# 💎 ArcherGuard — Modern Glossy Design System & Architecture

> **Target Platform:** Android (Native Kotlin / Jetpack Compose)  
> **Target Hardware:** TP-Link Archer C6 v3 (MediaTek MT7621DAT, OpenWrt 21.02/22.03/23.05+)  
> **Network Mode:** 100% Direct Local Connection (LAN / Wi-Fi, No Cloud/Internet Dependency)  
> **Design Language:** Modern Glossy Glassmorphism & Frosted Acrylic (Non-Sci-Fi, Sleek, Executive)  

---

## 1. Aesthetic Identity: Modern Glossy vs Sci-Fi

| Dimension | ❌ Sci-Fi / Cyberpunk (Discarded) | ✅ Modern Glossy (Adopted) |
| :--- | :--- | :--- |
| **Visual Tone** | Neon arcade, laser green/cyan, hacker terminal | Sleek, executive, Apple/macOS frosted acrylic, premium glass |
| **Background** | Pure black `#000000` with harsh grids | Deep obsidian slate `#0B0F17` to `#121824` with subtle radial gradient |
| **Surfaces** | Hard-edged flat cards with neon borders | Multi-layer frosted glass (`sigma: 16`), subtle 1px specular light sheen |
| **Typography** | Monospaced green terminal text everywhere | Clean sans-serif hierarchy, refined tabular numbers for metrics |
| **Accents** | Glaring neon cyan & hot magenta | Rich Royal Azure (`#2563EB` / `#3B82F6`), Emerald Mint (`#10B981`) |

---

## 2. Color Palette & Token Hierarchy

```
Canvas:
  Primary Background:     #0B0F17 (Deep Obsidian Slate)
  Secondary Background:   #111726 (Midnight Navy)
  Card Surface Glass:     rgba(255, 255, 255, 0.05) to rgba(255, 255, 255, 0.08)
  Specular Rim Light:     rgba(255, 255, 255, 0.15) (top-left) to rgba(255, 255, 255, 0.03) (bottom-right)

Accent Hierarchy:
  Primary Brand:          #3B82F6 (Royal Azure Blue)
  Secondary / Active:     #60A5FA (Soft Sky Blue)
  Success / Connected:    #10B981 (Emerald Mint)
  Warning / Moderate:     #F59E0B (Warm Amber)
  Danger / Blocked:       #EF4444 (Coral Rose)

Typography:
  Headline / Value:       #F8FAFC (Polar White, 700/600 weight)
  Subhead / Label:        #94A3B8 (Cool Slate, 500 weight)
  Muted / Caption:        #64748B (Dark Slate, 400 weight)
```

---

## 3. Core Component Library

1. **`GlossyCard`**:
   - Backdrop filter with dual-axis Gaussian blur (`sigmaX: 16.0`, `sigmaY: 16.0`).
   - Gradient border simulating optical glass reflection (1px width, top-left highlight).
   - Soft outer elevation shadow (`rgba(0, 0, 0, 0.35)`, blur 18).
   - Rounded corners (`radius: 20.0`).

2. **`GlossyBadge`**:
   - Pill-shaped status indicator (`🟢 4ms • Connected (Local Wi-Fi)`).
   - Dynamic ping latency color grading (Green < 15ms, Amber < 50ms, Red > 50ms).

3. **`GlossyButton`**:
   - Subtle top-to-bottom glossy gradient sheen.
   - Haptic touch feedback.
   - Loading indicator for async actions.

4. **`CircularGauge`**:
   - Modern circular indicator for CPU, RAM, and Storage with smooth sweep gradients.
   - Frosted inner core displaying percentage and frequency/memory size.

---

## 4. Local-Only Network Engine

```
┌────────────────────────────────────────────────────────┐
│             Android Device (ArcherGuard App)           │
│           Local Wi-Fi Connection (No Internet)         │
└──────────────────────────┬─────────────────────────────┘
                           │ Direct HTTP GET/POST
                           │ Default: http://192.168.1.1/cgi-bin/api
                           ▼
┌────────────────────────────────────────────────────────┐
│           OpenWrt Router (TP-Link Archer C6 v3)        │
│       uhttpd Gateway & Modular Shell Backend           │
│                                                        │
│  • /cgi-bin/api?action=status   --> Full JSON Status   │
│  • /cgi-bin/api?action=control  --> Protected Actions  │
└────────────────────────────────────────────────────────┘
```
