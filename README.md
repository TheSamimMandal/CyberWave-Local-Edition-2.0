# CyberWave — Router Management System & OpenWrt Automatic Secure Bridge

**Cloud Platform:** Google AI Studio (`http://localhost:3000` & Published App URL)  
**Router Target:** TP-Link Archer C6 US V3.2 (`tplink,archer-c6-v3`)  
**Firmware Target:** OpenWrt `25.12.6` · `ramips/mt7621` · MIPS architecture · APK/opkg package manager  
**Branding & Design:** **DESIGN BY SAMIM MANDAL**

CyberWave হলো TP-Link Archer C6 V3.2 রাউটার এবং OpenWrt 25.12.6 ফার্মওয়্যারের জন্য একটি সম্পূর্ণ লাইটওয়েট রাউটার ম্যানেজমেন্ট ড্যাশবোর্ড, ক্লাউড ব্রিজ এবং ওয়াই-ফাই ক্যাপটিভ পোর্টাল সিস্টেম। এটি সরাসরি Google AI Studio-এর নিজস্ব হোস্টিং ও পাবলিশিং আর্কিটেকচারে চলে।

---

## 1. প্রজেক্টের প্রধান ফিচার ও আর্কিটেকচার

CyberWave Google AI Studio তে সরাসরি Express/Node.js সার্ভার (`dev-server.js`) দিয়ে চলে এবং স্থানীয় ফাইল সিস্টেম পারসিস্টেন্স (`data/admin-auth.json`, `data/router-bridge.json`, `data/vouchers.json`) ও ঐচ্ছিক Upstash Redis উভয় পরিবেশ সমর্থন করে।

- **Real-Time Router Telemetry:** CPU load, RAM usage, 16MB Flash overlay storage, WAN/LAN rx/tx bytes ও লাইভ আপলোড/ডাউনলোড স্পিড।
- **Dual-Band Main Wi-Fi:** 2.4 GHz ও 5 GHz রেডিও চ্যানেল, ট্রান্সমিট পাওয়ার ও সিকিউরিটি কনফিগারেশন।
- **Dual-Band Guest Wi-Fi:** সম্পূর্ণ আলাদা ও আইসোলেটেড 2.4 GHz ও 5 GHz গেস্ট নেটওয়ার্ক (192.168.9.1/24), ক্লায়েন্ট লিমিট কন্ট্রোল এবং মেইন ল্যান সম্পূর্ণ সুরক্ষিত।
- **Connected Clients & Access Control:** প্রতিটি কানেক্টেড ক্লায়েন্টের আইপি, ম্যাক, সিগন্যাল (dBm), ব্যান্ড (2.4G/5G) এবং লাইভ Kick ও Block/Unblock সুবিধা।
- **openNDS Captive Portal Engine:** openNDS সার্ভিস টগল, এফএএস (FAS) অথেন্টিকেশন, ক্লাউড Walled Garden ডোমেইন লিস্ট এবং অটোমেটিক রিডাইরেক্ট।
- **Guest Voucher Management:** 1-ডিভাইস এনফোর্সড ম্যাক বাইন্ডিং, ফার্স্ট কানেকশন টাইমার, কাস্টম প্রিফিক্স সহ ভাউচার তৈরি ও CSV/JSON এক্সপোর্ট।
- **System Diagnostics & Kernel Logs:** রিমোট `dmesg`, `logread`, `ping_test` এবং ড্রপ ক্যাশ (Free RAM) অপারেশন।
- **10-Step Automatic Installer:** Archer C6 V3.2 এর জন্য অপ্টিমাইজড, যাতে ইনস্টলেশনের আগে সম্পূর্ণ UCI ব্যাকআপ `/etc/cyberwave/backups/`-এ সংরক্ষিত হয়।
- **Non-Destructive Safe Rollback:** ওয়ান-ক্লিক আনইনস্টলার যা রাউটার ফ্যাক্টরি রিসেট না করেই পূর্ববর্তী অবস্থায় ফিরিয়ে দেয়।

### Cloud Bridge-এর নিরাপদ যোগাযোগ

```text
CyberWave Admin (Google AI Studio)
          |
          | Admin-authenticated pairing / one-time installer ticket
          v
CyberWave Router API  <---->  data/router-bridge.json & Upstash Redis
          ^
          |
          | Outbound HTTPS heartbeat + command result (X-Router-Secret)
          |
Archer C6 V3.2 — CyberWave Agent (/usr/bin/cyberwave-agent.sh)
          |
          +-- ubus / UCI / DHCP lease / openNDS status
```

> **নিরাপত্তা:** রাউটার থেকে পাবলিক ইন্টারনেটে কোনো ইনবাউন্ড পোর্ট (SSH, LuCI বা HTTP) খুলতে হয় না। Agent সম্পূর্ণ আউটবাউন্ড HTTPS পোলিং ও হার্টবিট ব্যবহার করে।

---

## 2. সমর্থিত Router ও প্রয়োজনীয় শর্ত

| বিষয় | প্রয়োজনীয় মান |
|---|---|
| Router | TP-Link Archer C6 V3.2 (US) |
| Board name | `tplink,archer-c6-v3` |
| OpenWrt | `25.12.6` |
| Target | `ramips/mt7621` |
| Flash | 16 MB SPI-NOR |
| RAM | 128 MB DDR3 |
| Package manager | `apk` (অথবা `opkg`) |
| HTTPS client | `uclient-fetch` (অথবা `curl`) |
| Services | `rpcd`, `uhttpd`, `firewall`, `opennds` |
| Free overlay | কমপক্ষে 256 KB |
| Cloud URL | Google AI Studio Dev বা Published Subdomain |

### Archer C6-এ টার্মিনালে যাচাই

রাউটারে SSH করে চালান:

```sh
cat /etc/openwrt_release
cat /tmp/sysinfo/board_name
apk --version 2>/dev/null || opkg --version
command -v uclient-fetch
df -h /overlay
```

---

## 3. Google AI Studio Architecture & Publishing

### 3.1 হোস্টিং মডেল
CyberWave সরাসরি Google AI Studio-এর ডেভেলপমেন্ট এবং শেয়ার্ড/পাবলিশড সাবডোমেইনে চলে। কোনো বাহ্যিক থার্ড-পার্টি প্ল্যাটফর্মের (যেমন Vercel) প্রয়োজন নেই।

- **Entry Point:** `dev-server.js` (Node.js ESM)
- **Static Assets:** `public/` ফোল্ডার (`index.html`, `admin.html`)
- **API Routes:** `api/` ফোল্ডার (`/api/router`, `/api/admin`, `/api/voucher`, `/api/login`)
- **Local Persistence:** `data/` ফোল্ডার (`admin-auth.json`, `router-bridge.json`, `vouchers.json`)
- **Build / Verification:** `npm run build` ও `npm test`

### 3.2 Environment Variables

প্রজেক্টের `.env` বা Google AI Studio সেটিংস:

| Variable | প্রয়োজন | ব্যবহার |
|---|---|---|
| `ADMIN_PASSWORD` | আবশ্যক | Admin Dashboard login ও ব্যাকএন্ড সিকিউরিটি |
| `ARCHER_C6_SECRET` | ঐচ্ছিক | Shared router bridge authentication |
| `UPSTASH_REDIS_REST_URL` | ঐচ্ছিক | ক্লাউড রেপ্লিকা ডাটাবেজ (না থাকলে লোকাল ফাইলস্টোর ব্যবহার হয়) |
| `UPSTASH_REDIS_REST_TOKEN` | ঐচ্ছিক | ক্লাউড রেপ্লিকা টোকেন |
| `TELEGRAM_BOT_TOKEN` | ঐচ্ছিক | টেলিগ্রাম অ্যাডমিন নোটিফিকেশন বট |
| `TELEGRAM_CHAT_ID` | ঐচ্ছিক | অ্যাডমিন চ্যাট আইডি |

---

## 4. Router Pairing ও Authentication Flow

CyberWave-এ দ্বি-স্তরবিশিষ্ট ক্রিপ্টোগ্রাফিক পেয়ারিং চুক্তি বাস্তবায়িত হয়েছে:

1. **Pairing Initiation:**
   অ্যাডমিন ড্যাশবোর্ড থেকে রাউটার পেয়ারিং জেনারেট করা হয়। ব্যাকএন্ডে একটি ক্রিপ্টোগ্রাফিক `pairingToken` এবং অনন্য `routerSecret` সংরক্ষিত হয়।
2. **One-Click Installer Dispatch:**
   ড্যাশবোর্ড থেকে "Copy SSH Command" চাপলে একটি এককালীন ৫-মিনিট মেয়াদি টিকিটের মাধ্যমে রাউটারে ইনস্টলার চালু হয়।
3. **Agent Handshake:**
   ইনস্টলার `/etc/cyberwave/agent.conf`-এ `PAIRING_TOKEN` এবং `SECRET_KEY` সংরক্ষণ করে।
   এজেন্ট প্রথমবার চালুর সময় `/api/router?action=pair` এন্ডপয়েন্টে হ্যান্ডশেক পাঠায়।
4. **Secret Issuance & Storage:**
   ব্যাকএন্ড টোকেন যাচাই করে রাউটারকে অথেনটিকেটেড `routerSecret` প্রদান করে।
   এজেন্ট সেই সিক্রেট নিরাপদে `/etc/cyberwave/agent.conf` ফাইলে (0600 পারমিশন) সংরক্ষণ করে।
5. **Continuous Outbound Heartbeat:**
   পরবর্তী প্রতিটি হার্টবিটে এজেন্ট `X-Router-ID` এবং `X-Router-Secret` হেডার পাঠায়।
   ব্যাকএন্ড তা ভেরিফাই করে কমান্ড কিউ এক্সিকিউশন ও লাইভ টেলিমেট্রি রিটার্ন করে।
   ড্যাশবোর্ডে রিয়েল-টাইমে **PAIRED & ONLINE** স্ট্যাটাস দৃশ্যমান হয়।

---

## 5. Archer C6 V3.2-এ ওয়ান-ক্লিক ইনস্টলেশন

### ধাপ ১: ড্যাশবোর্ড থেকে কমান্ড সংগ্রহ
1. `https://<your-subdomain>.run.app/admin.html` খুলুন।
2. অ্যাডমিন পাসওয়ার্ড দিয়ে লগইন করুন।
3. **Remote OpenWrt Router Bridge** সেকশনে যান।
4. **Copy SSH 1-Line Installer** বাটনে ক্লিক করুন।

### ধাপ ২: রাউটারে কমান্ড রান করা
রাউটারে SSH টার্মিনাল খুলে কমান্ডটি পেস্ট করে এন্টার দিন:

```sh
uclient-fetch -q --timeout=30 -O - "https://<your-subdomain>.run.app/api/router?action=oneclick_script&ticket=<ticket>" | sh
```

### ধাপ ৩: ১০-ধাপের স্বয়ংক্রিয় প্রসেস
ইনস্টলার ধাপে ধাপে সম্পন্ন করবে:
1. `Pre-installation checks` (MT7621 আর্কিটেকচার, ওপেনডাব্লিউআরটি ২৫.১২.৬, ফ্রি ফ্ল্যাশ ও র‍্যাম যাচাই)
2. `Configuration backup` (বিদ্যমান `/etc/config` ব্যাকআপ `/etc/cyberwave/backups/`-এ সেভ করা)
3. `Dependency installation` (প্রয়োজনীয় প্যাকেজ যাচাই)
4. `Bundle extraction & validation` (SHA-256 চেকসাম ভ্যালিডেশন)
5. `CyberWave Agent installation` (`/usr/bin/cyberwave-agent.sh` ও procd init সার্ভিস)
6. `Guest Wi-Fi integration` (2.4G ও 5G গেস্ট রেডিও এবং 192.168.9.1/24 আইসোলেশন)
7. `Firewall isolation` (গেস্ট ট্রাফিক শুধু WAN-এ ফরোয়ার্ড, মূল LAN ট্রাফিক ব্লকড)
8. `openNDS Captive Portal` (গেস্ট ইন্টারফেসে পোর্টাল বাইন্ড ও ক্লাউড Walled Garden কনফিগারেশন)
9. `Cloud Bridge pairing` (সার্ভিস স্টার্ট ও হার্টবিট সক্রিয়করণ)
10. `Final health checks` (কানেকশন ভেরিফিকেশন ও ড্যাশবোর্ডে ১০০% কমপ্লিট প্রদর্শন)

---

## 6. Captive Portal ও 1-ডিভাইস ভাউচার সিস্টেম

1. **Client Connect:** গেস্ট ইউজার `CyberWave_Guest_2.4G` বা `CyberWave_Guest_5G` ওয়াই-ফাইতে যুক্ত হলে openNDS স্বয়ংক্রিয়ভাবে ক্লাউড ল্যান্ডিং পেজে রিডাইরেক্ট করে।
2. **Voucher Only Login:** ইউজার তার ভাউচার কোড (যেমন: `PASS-XXXX`) ইনপুট করে।
3. **1-Device Enforcement:** ভাউচার সক্রিয় হওয়ার সাথে সাথে ক্লায়েন্টের MAC ঠিকানার সাথে স্থায়ীভাবে লক হয়ে যায়। অন্য কোনো ডিভাইস একই কোড ব্যবহার করতে পারবে না।
4. **First Connection Timer:** ভাউচারটি প্রথমবার সফলভাবে ব্যবহারের মুহূর্ত থেকে সময় গণনা শুরু হয়।
5. **Instant Gateway Authorization:** ভাউচার সক্রিয় হলে রাউটার সরাসরি `ndsctl auth <MAC> <minutes>` এক্সিকিউট করে ক্লায়েন্টকে ইন্টারনেট এক্সেস প্রদান করে।

---

## 7. Troubleshooting & Recovery

### ৭.১ রাউটারে হার্টবিট যাচাই
রাউটারে SSH করে লগ দেখুন:

```sh
logread -e "cyberwave"
tail -n 50 /var/log/cyberwave-agent.log
```

ম্যানুয়ালি এজেন্ট টেস্ট রান করতে:

```sh
/usr/bin/cyberwave-agent.sh
```

### ৭.২ জরুরি রোলব্যাক (Restore Previous Settings)
ইনস্টলেশনের আগের কনফিগারেশন রিস্টোর করতে:

```sh
sh /etc/cyberwave/backups/restore-pre-cyberwave.sh
```

### ৭.৩ সম্পূর্ণ আনইনস্টল
CyberWave সম্পূর্ণ অপসারণ করতে:

```sh
/usr/bin/cyberwave-uninstall.sh
```

---

## 8. সিকিউরিটি এবং কোড ভেরিফিকেশন

- **Unit & Integration Tests:** ১৮টি টেস্ট স্যুট ও ১৭৭টি টেস্ট পাসড (`npm test`)।
- **Syntax Check:** POSIX Ash এবং Node.js ESM সিনট্যাক্স ভ্যালিডেটেড (`npm run build`, `npm run lint`)।
- **Zero Inbound Router Ports:** রাউটারের কোনো অ্যাডমিন বা সার্ভিস পোর্ট ইন্টারনেটে উন্মুক্ত নয়।
- **Cryptographic Salts:** অ্যাডমিন পাসওয়ার্ড Scrypt অ্যালগরিদম ও পার-ইনস্টলেশন সল্ট দিয়ে এনক্রিপ্ট করা।
