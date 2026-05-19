# CIREN — Business Proposal (Japan Market)
**Prepared by: Nakayama Iron Co., Ltd.**
**For: Japanese distributors, trading companies, and co-development partner candidates**

---

## ② Pricing

### Pricing Philosophy
- Hardware: **one-time purchase** (initial investment)
- Cloud monitoring: **monthly subscription** (recurring revenue)
- Cellular connectivity: **pay-as-you-go** via Soracom (passed to customer, or bundled)
- Tiered **trade pricing** for distributors and resellers

---

### Hardware — Suggested Retail Price (excl. tax)

| Model | Contents | Suggested Retail Price |
|-------|----------|----------------------|
| **Starter Kit** | Main Module × 1 + Sensor Controller × 1 + Sensor Node × 2 | ¥148,000 |
| Main Module (standalone) | ESP32-S3 + LTE-M modem + TFT Display | ¥68,000 |
| Sensor Controller | ESP32, connects up to 8 sensor nodes | ¥28,000 |
| Sensor Node — Temp/Humidity | XIAO SAMD21 + DHT20 | ¥12,000 |
| Sensor Node — IMU/Vibration | XIAO SAMD21 + MPU6050 | ¥14,000 |

> **Pricing rationale:** Hardware BOM is approximately ¥15,000–22,000 per starter kit.
> Retail price applies a **6–7× multiplier**, standard for industrial IoT in Japan
> (comparable: Omron, Yokogawa IoT edge devices at ¥100,000–500,000).

---

### Cloud Subscription — Monthly Fee (excl. tax)

| Plan | Coverage | Monthly Fee |
|------|----------|-------------|
| **Basic** | 1 device, up to 8 sensors, 90-day data retention | ¥3,800 |
| **Standard** | Up to 5 devices, unlimited sensors, 1-year retention | ¥12,800 |
| **Enterprise** | Unlimited devices, dedicated server, SLA guarantee | Quote on request |

> **Recommendation:** Bundle 3 months of Basic free with every Starter Kit purchase.
> This lowers the barrier to entry and converts hardware buyers into subscription customers.

---

### Trade / Distributor Pricing

| Tier | Trade Price | Notes |
|------|------------|-------|
| Primary distributor (trading company / 商社) | **60% of retail** | Minimum annual order: 10 units |
| Secondary reseller (SIer / dealer) | **72% of retail** | Via distributor or direct |
| OEM / White-label | Quoted individually | Minimum 50 units; logo + branding customizable |

> **SaaS revenue share:** Distributor receives **70%** of monthly subscription fee
> for accounts they introduce and manage.

**Example economics for a trading company (Starter Kit sale):**
```
Retail price (end customer pays):  ¥148,000
Trading company buys from us at:    ¥88,800  (60%)
Trading company margin:             ¥59,200  (40%) — from this they cover their sales cost
Our revenue per unit:               ¥88,800
```

---

---

## ② (b) Internet Connectivity

### How CIREN Connects to the Internet

CIREN uses a **dual-connection architecture** — WiFi as primary, LTE-M cellular as automatic fallback.
This is a key differentiator: the device stays online even when factory WiFi is unstable or unavailable.

```
Priority 1 — WiFi (customer's existing network)
  Cost: ¥0/month — uses what is already there
  Speed: 10–100 Mbps, suitable for high-frequency data

Priority 2 — LTE-M / Cat-M1 (automatic failover)
  Activates automatically when WiFi drops
  Cost: ~¥500–1,500/month per device (SIM data fee)
  Speed: 300–400 kbps, more than enough for CIREN sensor data
  Hardware: SIM7080G modem built into every Main Module
```

---

### Recommended SIM Provider: Soracom

For Japan deployments, we recommend **Soracom Air** as the standard SIM solution.

**Why Soracom:**
- Japan's leading IoT SIM platform — trusted by thousands of industrial deployments
- Runs on NTT Docomo (plan-D) and KDDI (plan-K) networks — nationwide coverage
- Supports LTE-M (Cat-M1) natively — directly compatible with CIREN's SIM7080G modem
- Simple pricing, no contracts, activate/deactivate per SIM from a web dashboard
- CIREN can be listed as **"Soracom Ready"** — adds credibility with Japanese customers

**Soracom Air plan-D pricing (as of 2025):**

| Item | Cost |
|------|------|
| SIM card (one-time) | ¥300 |
| Monthly base fee (per SIM) | ¥55 |
| Data — first 10 MB | ¥0.2 /MB |
| Data — 10 MB to 100 MB | ¥0.15 /MB |
| Data — over 100 MB | ¥0.1 /MB |

**Estimated CIREN data usage:**

| Scenario | Data/month | Soracom cost/month |
|----------|-----------|-------------------|
| WiFi primary, LTE-M rarely triggers | ~5 MB | ~¥1 |
| Mixed use (WiFi unreliable) | ~50 MB | ~¥8 |
| LTE-M only, no WiFi | ~200–500 MB | ~¥30–55 |

> CIREN's sensor data is extremely small (each MQTT message is ~200 bytes).
> Even at 100% LTE-M operation, monthly data cost is well under ¥100 per device.
> This is negligible compared to hardware and SaaS pricing.

---

### Connectivity Options for Customers

| Scenario | Setup | Monthly cost |
|----------|-------|-------------|
| **Factory with stable WiFi** | Use WiFi only, SIM as emergency backup | ¥55 (SIM base fee only) |
| **Factory with unreliable WiFi** | Dual-mode: WiFi + LTE-M auto-failover | ¥55 + ~¥100–500 data |
| **Outdoor / remote site** | LTE-M primary, no WiFi dependency | ¥55 + ~¥500–1,500 data |
| **Customer provides own SIM** | Any LTE-M SIM configurable via portal | Depends on provider |

---

### Connectivity in the Pricing Model

**Option A — Customer manages SIM themselves (default)**
- CIREN hardware includes the SIM7080G modem (hardware cost already in price)
- Customer purchases Soracom SIM separately and registers their own account
- We provide APN settings: `soracom.io / sora / sora`
- Simplest for us; customer controls their own connectivity costs

**Option B — Bundle SIM with hardware (recommended for distributors)**
- Include a pre-activated Soracom SIM in the Starter Kit box
- First 3 months of Basic plan included (absorb ~¥165 SIM cost)
- Distributor registers as a Soracom reseller → earns margin on SIM too
- Higher perceived value, zero friction for the end customer

**Option C — Enterprise: managed connectivity**
- For large deployments (10+ devices), negotiate a group rate with Soracom
- We can manage SIM provisioning centrally → pass cost to customer as a line item
- Adds a third recurring revenue stream alongside hardware + SaaS

---

### Connectivity as a Differentiator vs. Competitors

Most entry-level industrial IoT systems are **WiFi-only**.
CIREN's built-in LTE-M fallback means:

> *"Even if your factory WiFi goes down at 3am, your monitoring doesn't."*

This is particularly compelling for:
- Food processing, pharmaceuticals — 24/7 monitoring legally required
- Outdoor equipment, construction sites — no reliable WiFi
- Multi-site management — some sites may have poor network infrastructure

---

## ③ Co-Development Model

### Core Stance
Nakayama Iron owns the technology. We are open to partnership, but we set the terms.
Start conversations at **Phase 1 only** — do not volunteer Phase 2 or 3 upfront.
Let the partner ask for deeper collaboration; that's a sign of genuine interest.

---

### Phased Approach

#### Phase 1 — Sales Partnership *(offer this first)*
```
Duration:  3–6 months (pilot period)
Our role:  Supply product, technical support, firmware updates
Their role: Sell and promote CIREN in Japan
Investment: Zero from partner (distribution agreement only)
Revenue:   They earn the trade margin + SaaS revenue share
Goal:      Prove demand, collect feedback, build trust
```

#### Phase 2 — Customization *(only if they ask)*
```
Duration:  6–12 months
Scope:     Japanese UI, industry-specific alerts, PLC integration, etc.
Cost:      We charge for development time (rate: TBD per engineer/month)
           OR: partner funds development in exchange for priority delivery
IP:        Joint ownership of specific improvements made in this phase
           Core CIREN platform remains 100% Nakayama Iron
```

#### Phase 3 — Joint Product *(future only, high commitment required)*
```
Duration:  12+ months
Scope:     New product built on CIREN platform for a specific vertical
           (e.g., embedded in a specific machine they manufacture)
Commitment required from partner:
           - Minimum guaranteed purchase volume
           - Dedicated engineering resource from their side
           - Shared development cost (ratio: negotiate case by case)
IP:        Core platform = Nakayama Iron. New product = negotiate.
```

---

### Role Division

| Area | Nakayama Iron | Japanese Partner |
|------|--------------|-----------------|
| Hardware design & manufacturing | ◎ | △ (local production at scale: negotiate) |
| Firmware development | ◎ | — |
| Cloud / backend | ◎ | — |
| Japanese localization | ○ | ◎ |
| Japan sales & marketing | — | ◎ |
| Tier-1 customer support | — | ◎ |
| Tier-2 technical support | ◎ | — |
| Japanese regulatory certification (Radio Law / TELEC) | ○ support | ◎ partner-led |

---

### Must-Have Clauses in Any Agreement
- **NDA first** — sign before sharing any technical detail
- Minimum order commitment (protects us from a partner who signs but never sells)
- Non-compete: partner cannot develop a competing product during the agreement
- Termination: 90-day notice, inventory purchase obligation on termination
- Governing law: Japanese law (easier to enforce in Japan)

---

## ④ Intellectual Property

### Honest Assessment of Current Situation

Right now, the CIREN IP almost certainly belongs to **you personally** as the developer —
not to Nakayama Iron Co., Ltd. This is the single most important thing to fix
before any business discussion with a Japanese partner. A Japanese company will do
due diligence and if the IP isn't cleanly owned by the company, the deal will fall through.

**What needs to happen:**
> Raihan Rafif (developer) formally assigns all IP rights to Nakayama Iron Co., Ltd.
> via an **IP Assignment Agreement**. This is a standard 1–2 page document.
> In exchange, Nakayama Iron should compensate fairly (salary, equity, or royalty — negotiable).

---

### IP Inventory

| Asset | Owner (after assignment) | Protection |
|-------|--------------------------|-----------|
| CIREN firmware (ESP32, SAMD21) | Nakayama Iron Co., Ltd. | Copyright (automatic) |
| CIREN Frame Protocol | Nakayama Iron Co., Ltd. | Copyright + consider patent |
| Cloud backend & API | Nakayama Iron Co., Ltd. | Copyright (automatic) |
| Dashboard frontend | Nakayama Iron Co., Ltd. | Copyright (automatic) |
| Hardware schematics & PCB | Nakayama Iron Co., Ltd. | Copyright + consider design registration |

---

### Protection Priority

```
Do immediately:
  1. IP Assignment Agreement (developer → Nakayama Iron)
  2. NDA template ready for partner meetings
  3. Trademark filing in Japan (→ see ⑤)

Do within 3 months:
  4. Patent search for CIREN Frame Protocol
     (plug-and-play auto-detection of sensor type on hot-swap)
     If novel → file provisional patent before any public demo

Do later:
  5. Design registration (enclosure, once industrial design is finalized)
  6. Trademark in Indonesia (protect home market too)
```

---

### IP Rules for Co-Development

| Scenario | Rule |
|----------|------|
| Core CIREN platform | Always 100% Nakayama Iron — non-negotiable |
| Customizations funded by partner | Partner gets a license to use the result; Nakayama Iron retains ownership |
| Jointly funded improvements | Joint ownership; neither party can license to third parties without consent |
| Partner's own additions (e.g., their machine integration code) | Partner owns; grants us a license to include in CIREN |

---

## ⑤ Trademark

### Recommendation: File Now, Not Later

Cost: ~¥24,000 total (¥12,000 × 2 classes)
Time to register: 12–18 months
Risk if you wait: another company registers "CIREN" first → you lose the name in Japan

**File these two classes:**
- **Class 9** — electronic measurement instruments, IoT devices, sensors
- **Class 42** — SaaS, cloud computing services, software as a service

---

### How to File (Step by Step)

```
Step 1 — Prior art search (free, 30 minutes)
  Go to: https://www.j-platpat.inpit.go.jp/
  Search: "CIREN" in trademark database
  If no conflicts found → proceed

Step 2 — Create J-PlatPat account
  Applicant name: 中山アイアン株式会社 (Nakayama Iron Co., Ltd.)
  Address: [company registered address]

Step 3 — File online
  Mark type: Word mark — CIREN
  Classes: 9 and 42
  Filing fee: ¥12,000 × 2 = ¥24,000 (pay by credit card online)

Step 4 — Wait for examination (~12–18 months)
  JPO may send an office action (refusal reason) — respond within 40 days if so
  On approval: pay registration fee (~¥32,900 per class for 10 years)

Total cost to register: ~¥24,000 (filing) + ~¥65,800 (registration) = ~¥90,000
```

> **File before the exhibition.** Once CIREN is publicly shown, novelty-based
> IP arguments weaken. The trademark itself is fine post-exhibition, but any
> patent filings for the technology must happen first.

---

## ⑥ Product Name

### Recommendation: Keep CIREN

**Why it works in Japan:**
- Pronounced "サイレン (sairen)" — identical to the Japanese word for "siren/alarm"
- This is a feature, not a bug: it immediately communicates *monitoring, alerts, early warning*
- Japanese plant managers and engineers will instantly understand the concept
- Unique in the industrial IoT space — no well-known competitor uses this name

**Why not to change it:**
- Changing the name means starting brand recognition from zero
- CIREN is already visible online (demo site, GitHub) — changing creates confusion
- Japanese companies respect foreign product names; "CIREN" sounds credible

---

### Product Name System (for future product lines)

| Product | Name | Role |
|---------|------|------|
| Current system | **CIREN** | Core brand — keep for all communication |
| Future enterprise tier | **CIREN Pro** | Upsell when needed |
| Future embedded / OEM | **CIREN Core** | White-label/OEM variant for partners |

---

### Brand Guidelines

```
Official spelling:   CIREN  (always all caps)
Japanese reading:    サイレン
Primary color:       #00D4FF  (cyan)
Background:          #050A14  (dark navy)
Accent (online):     #22C55E  (green = active/online)

Tagline (English):   Plug and Play. Monitor Instantly.
Tagline (Japanese):  センサーを挿すだけ。即時モニタリング。

Do not write:        "Ciren" / "ciren" / "C.I.R.E.N"
```

---

## Priority Action List

| Priority | Action | When |
|----------|--------|------|
| ★★★ | Sign IP Assignment Agreement (Raihan → Nakayama Iron) | This week |
| ★★★ | Search CIREN on J-PlatPat, then file trademark (Class 9 + 42) | Before exhibition |
| ★★★ | Prepare NDA template to hand to any interested partner at the exhibition | Before exhibition |
| ★★ | Finalize BOM costs → lock in price sheet | Within 1 month |
| ★★ | Have a lawyer review distributor agreement template | Within 1 month |
| ★ | Patent search for CIREN Frame Protocol | Within 3 months |
| ★ | Identify 3–5 target trading company candidates for Phase 1 | Within 3 months |
