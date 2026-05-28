# CIREN — Business Proposal
### Japan Market Entry Strategy
**Nakayama Iron Co., Ltd. — Internal Proposal**
**Audience: Sales Division · HR Division · President**

---

# SLIDE 1 — Cover

**CIREN**
*Plug-and-Play Industrial IoT Monitoring System*

Proposal for Japan Market Entry
Prepared by: Raihan Rafif
Date: May 2026

---

# SLIDE 2 — Executive Summary

**The Opportunity**
Japan's industrial IoT market is growing at approximately 9% CAGR and is currently dominated by expensive, complex systems that require weeks to install and dedicated IT staff to operate.
*Source: IMARC Group, "Japan Industrial Internet of Things Market," 2025.*

**What We Have**
CIREN is a ready-to-ship industrial IoT monitoring system developed in-house by Nakayama Iron. It plugs in, auto-detects sensors, and streams live data to a dashboard in minutes — no installation, no IT team.

**What We Are Proposing**
A three-phase Japan market entry:
- **Phase 1** (Year 1): Launch via distribution partners, ¥148,000 Starter Kit
- **Phase 2** (Year 1–2): Customer customization, build brand in key verticals
- **Phase 3** (Year 2–3): Co-development with strategic partners, OEM licensing

**Revenue Potential**
- Year 1 target: ¥4.4M hardware + ¥2.3M SaaS
- Year 3 target: ¥44M hardware + ¥23M SaaS

**What We Need**
Approval for sales headcount (2 roles), legal budget for IP filing, and authority to negotiate distributor agreements.

---

# SLIDE 3 — The Problem

### Japanese factories need real-time monitoring — but current solutions are too complex and too expensive.

**Pain points in the market today:**

| Problem | Current Reality |
|---------|----------------|
| Installation time | Weeks to months for typical industrial IoT setup |
| Cost barrier | Entry-level systems: ¥500,000–¥1,500,000+ |
| IT dependency | Requires dedicated system engineer to deploy and maintain |
| Connectivity risk | Most systems are WiFi-only — one network failure = blind spot |
| Vendor lock-in | Proprietary sensors, closed APIs, expensive upgrades |

*Installation time — Source: METI SME IoT Case Study Compendium, Kanto Bureau of Economy, Trade and Industry, 2022.*
*Cost range — Source: IoT Navi cost comparison survey; METI SME IoT case study compendium, 2023.*

**Target industries with urgent need:**
- Food & beverage manufacturing (temperature compliance — legally required)
- Metal processing & heavy industry (machine vibration, predictive maintenance)
- Pharmaceutical (humidity & environment logging)
- Outdoor facilities & remote sites (no stable WiFi)

---

# SLIDE 4 — The CIREN Solution

### One line: Plug in a sensor. See the data. No setup required.

**How it works:**
```
① Plug sensor node into controller
② Controller auto-detects sensor type
③ Data appears on cloud dashboard within seconds
④ Accessible from any browser or smartphone
```

**System architecture:**
```
Sensor Node → Sensor Controller → Main Module → Cloud → Dashboard
(×8 max)      (ESP32, local)      (ESP32-S3 +    (MQTT +  (Any browser)
                                   LTE-M modem)   MongoDB)
```

**Key hardware specs:**
- Main Module: ESP32-S3 + SIM7080G LTE-M modem + 2.4" status display
- Sensor Controller: ESP32, up to 8 sensor nodes per controller
- Sensor Nodes: XIAO SAMD21 microcontroller + any compatible sensor — the node design is open and sensor-agnostic
- Connectivity: WiFi primary + LTE-M automatic fallback

**Sensor node extensibility:**
CIREN is designed as an open IoT monitoring platform. Sensor nodes are interchangeable modules — any sensor that communicates over I2C, SPI, UART, or analog can be integrated into a new node. Currently available sensor nodes: Temp/Humidity (DHT20) and Vibration/IMU (MPU6050). Additional node types can be developed per customer or industry requirement without changes to the controller or main module.

---

# SLIDE 5 — Product Differentiators

### Why CIREN wins against the alternatives

| Feature | CIREN | Typical Competitor |
|---------|-------|--------------------|
| Setup time | **~15 minutes** | 4–12 weeks |
| Entry price | **¥148,000** | ¥500,000–¥2,000,000 |
| Connectivity | **WiFi + LTE-M dual** | WiFi only |
| Sensor swap | **Hot-swap, no restart** | Requires reconfiguration |
| Sensor types | **Open platform — any sensor type, custom nodes on request** | Fixed sensor per unit |
| Dashboard | **Real-time, any browser** | Often proprietary app |
| Customization | **Open platform: API + custom sensor nodes** | Closed system |

**One-line competitive message:**
> *"CIREN does in 15 minutes what others take 6 weeks and ¥1,000,000 to do."*

---

# SLIDE 6 — Market Opportunity

### Japan industrial IoT market is large and underserved at the entry level

**Market size:**
- Japan Industrial IoT market: ~¥1.1 trillion (2025), growing ~9% CAGR
  *Source: IMARC Group, "Japan Industrial Internet of Things Market," 2025.*
- SME manufacturing segment (our primary target): ~¥120B addressable *(internal estimate — no external source available for this sub-segment)*
- Current IoT adoption among Japanese SMEs (≤100 employees): **~9.5%** vs. 50% for large enterprises — most SMEs still use manual checks or dated data loggers
  *Source: MM Research Institute, IoT Adoption Survey, November 2019. (No comprehensive updated survey identified as of 2025; current penetration likely higher but remains well below large-enterprise levels.)*

**Target customer profile:**
- Japanese manufacturers with 50–500 employees
- Currently using manual rounds, simple data loggers, or no monitoring
- Budget range: ¥100,000–¥500,000 initial investment
- Key trigger events: equipment failure incident, new compliance requirement, DX initiative

**Number of target companies in Japan:**
- Food manufacturing: ~24,800 establishments
- Fabricated metal products: ~30,600 establishments
- General-purpose & production machinery: ~13,000 establishments
- Chemical/pharmaceutical: ~25,700 establishments
- **Total addressable: ~94,000 potential customers**

*Source: METI 経済構造実態調査 (Economic Structure Survey), 2023.*

---

# SLIDE 7 — Revenue Model

### Three revenue streams from every customer

```
① Hardware (one-time)
   Starter Kit: ¥148,000
   Add-on sensors: ¥12,000–¥14,000 each

② Cloud SaaS (recurring monthly)
   Basic:      ¥3,800/month
   Standard:   ¥12,800/month
   Enterprise: Quote on request

③ Connectivity (pass-through or bundled)
   Soracom Air plan-D D-300MB: ¥330/month (incl. 300MB)
   Margin opportunity if we resell SIM
```

*Source (connectivity pricing): Soracom official pricing, plan-D D-300MB bundle, 2025. Pay-as-you-go alternative: ¥15/day active status + ¥0.2/MB overage.*

**Customer lifetime value example (3 years):**
```
Hardware (Starter Kit + 2 extra sensors):  ¥172,000
SaaS Standard (36 months):                ¥460,800
Connectivity (36 months):                  ¥11,880  (Soracom D-300MB ¥330/month × 36)
Total LTV:                                ¥644,680
```

---

# SLIDE 8 — Pricing

### Hardware pricing — Suggested Retail Price (excl. tax)

| Product | Contents | Price |
|---------|----------|-------|
| **Starter Kit** | Main Module + Controller + 2 Sensor Nodes | **¥148,000** |
| Main Module | ESP32-S3 + LTE-M + TFT display | ¥68,000 |
| Sensor Controller | ESP32, up to 8 nodes | ¥28,000 |
| Sensor Node — Temp/Humidity | XIAO + DHT20 | ¥12,000 |
| Sensor Node — Vibration/IMU | XIAO + MPU6050 | ¥14,000 |
| Sensor Node — Custom | XIAO + customer-specified sensor (I2C/SPI/UART/analog) | Quote on request |

### SaaS pricing

| Plan | Coverage | Monthly |
|------|----------|---------|
| Basic | 1 device, 8 sensors, 90-day history | ¥3,800 |
| Standard | Up to 5 devices, unlimited sensors, 1-year history | ¥12,800 |
| Enterprise | Unlimited, dedicated server, SLA | Quote |

**Pricing rationale:** BOM cost is ¥15,000–22,000 per Starter Kit.
Retail applies 6–7× multiplier — standard for industrial IoT in Japan
(Omron, Yokogawa comparable: ¥100,000–¥500,000).

---

# SLIDE 9 — Distributor / Trade Pricing

### Channel economics

| Channel Tier | Price (% of retail) | Minimum |
|-------------|---------------------|---------|
| Primary distributor (商社) | 60% of retail | 10 units/year |
| Secondary reseller (SIer / dealer) | 72% of retail | No minimum |
| OEM / White-label | Quoted individually | 50 units minimum |

**SaaS revenue share:** Distributor receives 70% of monthly SaaS fee for accounts they manage.

**Distributor unit economics (Starter Kit):**
```
End customer pays:          ¥148,000
Distributor buys from us:   ¥88,800  (60%)
Distributor margin:         ¥59,200  (40%)
Our revenue per unit:       ¥88,800
```

**Launch incentive (Year 1 only):**
Every Starter Kit includes 3 months of Basic SaaS free → lowers barrier, builds subscription base.

---

# SLIDE 10 — Connectivity Strategy

### Built-in LTE-M: the feature that closes deals

**Dual-connection architecture:**
```
Priority 1 → WiFi (customer's existing network) — ¥0/month
Priority 2 → LTE-M auto-failover (SIM7080G built in) — ~¥500/month
```

**Why this matters to customers:**
> *"Even if your factory WiFi goes down at 3am, your monitoring doesn't."*

**Recommended partner: Soracom Air**
- Japan's leading IoT SIM platform (NTT Docomo + KDDI networks)
- LTE-M / Cat-M1 native — plug-and-play with CIREN hardware
- Cost: ¥330/month (D-300MB bundle, incl. 300MB data); pay-as-you-go ¥15/day active + ¥0.2/MB
- CIREN sensor data usage: well within 300MB/month even at full LTE-M

**Business opportunity:**
Register as Soracom reseller → earn margin on SIM sales alongside hardware.

---

# SLIDE 11 — Go-to-Market Strategy

### Three phases, each building on the last

#### Phase 1 — Distribution (Year 1)
```
Goal:      Establish market presence, prove demand
Channel:   2–3 primary distributors (商社 / SIer)
Our role:  Supply, tech support, firmware updates
Their role: Sales, customer support, local logistics
Investment from us: Minimal (product + marketing materials)
Target:    50 units sold, ¥5M hardware revenue
```

#### Phase 2 — Vertical Focus (Year 1–2)
```
Goal:      Build deep presence in 2 key verticals (food + metal)
Actions:   Case studies, trade show presence, custom sensor nodes
Revenue:   SaaS base growing, repeat orders, upsell add-on sensors
Target:    200 units sold, ¥30M hardware, ¥8M SaaS
```

#### Phase 3 — Co-development & OEM (Year 2–3)
```
Goal:      Strategic partnerships with machinery makers or system integrators
Actions:   Embed CIREN in partner products, white-label licensing
Revenue:   OEM licensing fees + royalties on SaaS
Target:    500+ units, ¥80M hardware, ¥20M SaaS
```

---

# SLIDE 12 — Target Partners for Phase 1

### Ideal distributor profile

| Criteria | Description |
|----------|-------------|
| Network | Existing relationships with Japanese manufacturers |
| Technical capability | Can explain basic IoT to customers |
| Focus | Industrial equipment, DX solutions, or factory automation |
| Size | Mid-size 商社 or SIer — large enough to reach, small enough to prioritize us |

**Types of companies to approach:**
- Industrial equipment trading companies (産業機器商社)
- System integrators specializing in factory automation (FAシステムインテグレーター)
- DX consulting firms working with manufacturers (DX推進コンサル)

---

# SLIDE 13 — Financial Projections

### Conservative scenario — 3-year outlook

| | Year 1 | Year 2 | Year 3 |
|--|--------|--------|--------|
| Units sold | 50 | 200 | 500 |
| Hardware revenue | ¥4.4M | ¥17.6M | ¥44M |
| SaaS revenue (recurring) | ¥2.3M | ¥9.2M | ¥23M |
| **Total revenue** | **¥6.7M** | **¥26.8M** | **¥67M** |
| COGS (hardware) | ¥1.1M | ¥4.4M | ¥11M |
| **Gross profit** | **¥5.6M** | **¥22.4M** | **¥56M** |

*Assumptions: 60% of retail as our revenue (via distributors). SaaS at ¥3,800/device/month average. 70% of hardware buyers convert to SaaS.*

> **Note on COGS:** The figures above reflect component (BOM) cost only (~¥22,000/unit). Actual fully-loaded COGS — including assembly labor, per-unit testing, packaging, and TELEC certification amortization — is estimated at ¥30,000–40,000/unit. Gross profit in production scale will be confirmed once manufacturing process is finalized.

**Break-even point:** ~30 Starter Kit sales (hardware-only basis, BOM cost)

---

# SLIDE 14 — Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Distributor signs but doesn't sell | Medium | High | Minimum order commitment in contract; 90-day review |
| Competitor copies design | Medium | Medium | File trademark + patent; keep firmware updates ahead of market |
| Japanese regulatory certification (TELEC) delays | Medium | High | Engage certification body early; partner-led process |
| Hardware supply chain disruption | Low | High | Maintain 3-month inventory buffer; dual-source key components |
| Customer support overload with small team | High | Medium | Tier-1 support via distributor; clear escalation path to us |
| LTE-M SIM provider issues | Low | Low | Soracom has backup carriers; any LTE-M SIM configurable via portal |
| Key developer leaves | Low | High | Document all systems; NVS/firmware documentation complete |

---

# APPENDIX A — Product Technical Specifications

| Component | Model | Specification |
|-----------|-------|--------------|
| Main Module MCU | ESP32-S3 | Dual-core 240MHz, WiFi + BT |
| Cellular Modem | SIM7080G | LTE-M (Cat-M1) / NB-IoT |
| Display | TFT ILI9341 2.4" | 320×240, status display |
| Controller MCU | ESP32 | Up to 8 sensor nodes |
| Sensor Node MCU | Seeeduino XIAO SAMD21 | Low-power, compact; sensor-agnostic design |
| Sensor Node — available | DHT20 (Temp/Humidity), MPU6050 (Vibration/IMU) | Currently in production; additional types on request |
| Sensor Node — expandable | I2C / SPI / UART / Analog | Any compatible sensor can be integrated without platform changes |
| Wireless (internal) | ESP-NOW | Controller ↔ Main Module |
| RTOS | FreeRTOS | Multi-task, dual-core |
| Backend | Node.js + MongoDB | Cloud-hosted |
| Frontend | React + Vite + Tailwind | Browser-based dashboard |

---

# APPENDIX B — Competitive Landscape

| | CIREN | Omron EJ1 | Yokogawa OpreX | Generic China IoT |
|--|-------|-----------|----------------|-------------------|
| Entry price | ¥148,000 | ¥500,000+ | ¥800,000+ | ¥30,000–80,000 |
| Setup time | 15 min | 2–6 weeks | 4–12 weeks | 1–3 days |
| LTE-M built-in | ✅ | ❌ | ❌ | △ (some models) |
| Hot-swap sensors | ✅ | ❌ | ❌ | ❌ |
| Open API | ✅ | △ | △ | △ |
| Japan support | ✅ | ✅ | ✅ | ❌ |
| Customizable | ✅ | ❌ | ❌ | △ |

---

# APPENDIX C — Brand Guidelines

```
Name:            CIREN (always all caps)
Japanese:        サイレン (sairen)
Primary color:   #00D4FF (cyan)
Background:      #050A14 (dark navy)
Accent:          #22C55E (green = active / online)

Tagline (EN):    Plug and Play. Monitor Instantly.
Tagline (JP):    センサーを挿すだけ。即時モニタリング。

Do not write:    "Ciren" / "ciren" / "C.I.R.E.N"
```

---

# APPENDIX D — Data Sources

| Claim | Source | Year |
|-------|--------|------|
| Industrial IoT setup time (weeks to months) | Kanto Bureau of Economy, Trade and Industry — SME IoT Case Study Compendium (中小ものづくり企業IoT等活用事例集) | 2022 |
| Entry-level industrial IoT system cost ¥500K–¥1.5M+ | IoT Navi cost comparison survey; METI SME IoT case studies | 2023 |
| Japan Industrial IoT market ~¥1.1 trillion, ~9% CAGR | IMARC Group — "Japan Industrial Internet of Things Market Report" | 2025 |
| IoT adoption rate: ~9.5% (SMEs ≤100 employees) vs. 50% (large enterprises) | MM Research Institute — IoT Adoption Survey | Nov 2019 |
| Factory/establishment counts by industry | METI — 経済構造実態調査 (Economic Structure Survey) | 2023 |
| Soracom Air plan-D pricing | Soracom official pricing & developer documentation (soracom.io) | 2025 |

**Notes:**
- SME addressable market figure (~¥120B) is an internal estimate derived from top-down calculation; no external research firm publishes this specific sub-segment figure.
- MM Research Institute IoT penetration data is from 2019; no comprehensive updated survey was identified as of 2025. Current penetration is likely higher but remains well below large-enterprise levels.
- All yen figures use an exchange rate of approximately ¥150/USD where conversion from USD-denominated reports was required.
