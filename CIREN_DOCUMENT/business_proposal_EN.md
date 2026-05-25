# CIREN — Business Proposal
### Japan Market Entry Strategy
**Nakayama Iron Co., Ltd. — Internal Proposal**
**Audience: Sales Division · HR Division · President**

---

# SLIDE 1 — Cover

**CIREN**
*Plug-and-Play Industrial IoT Monitoring System*

Proposal for Japan Market Entry
Prepared by: [Your Name / Department]
Date: May 2026

---

# SLIDE 2 — Executive Summary

**The Opportunity**
Japan's industrial IoT market is growing at 15% CAGR and is currently dominated by expensive, complex systems that require weeks to install and dedicated IT staff to operate.

**What We Have**
CIREN is a ready-to-ship industrial IoT monitoring system developed in-house by Nakayama Iron. It plugs in, auto-detects sensors, and streams live data to a dashboard in minutes — no installation, no IT team.

**What We Are Proposing**
A three-phase Japan market entry:
- **Phase 1** (Year 1): Launch via distribution partners, ¥148,000 Starter Kit
- **Phase 2** (Year 1–2): Customer customization, build brand in key verticals
- **Phase 3** (Year 2–3): Co-development with strategic partners, OEM licensing

**Revenue Potential**
- Year 1 target: ¥15M hardware + ¥2M SaaS
- Year 3 target: ¥80M hardware + ¥20M SaaS

**What We Need**
Approval for sales headcount (2 roles), legal budget for IP filing, and authority to negotiate distributor agreements.

---

# SLIDE 3 — The Problem

### Japanese factories need real-time monitoring — but current solutions are too complex and too expensive.

**Pain points in the market today:**

| Problem | Current Reality |
|---------|----------------|
| Installation time | 4–12 weeks for typical industrial IoT setup |
| Cost barrier | Entry-level systems: ¥500,000–¥2,000,000+ |
| IT dependency | Requires dedicated system engineer to deploy and maintain |
| Connectivity risk | Most systems are WiFi-only — one network failure = blind spot |
| Vendor lock-in | Proprietary sensors, closed APIs, expensive upgrades |

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
- Sensor Controller: ESP32, up to 8 sensor nodes
- Sensor Nodes: XIAO SAMD21 microcontroller + sensor (temp/humidity, vibration, voltage)
- Connectivity: WiFi primary + LTE-M automatic fallback

---

# SLIDE 5 — Product Differentiators

### Why CIREN wins against the alternatives

| Feature | CIREN | Typical Competitor |
|---------|-------|--------------------|
| Setup time | **~15 minutes** | 4–12 weeks |
| Entry price | **¥148,000** | ¥500,000–¥2,000,000 |
| Connectivity | **WiFi + LTE-M dual** | WiFi only |
| Sensor swap | **Hot-swap, no restart** | Requires reconfiguration |
| Sensor types | **Mix freely per port** | Fixed sensor per unit |
| Dashboard | **Real-time, any browser** | Often proprietary app |
| Customization | **API + open firmware** | Closed system |

**One-line competitive message:**
> *"CIREN does in 15 minutes what others take 6 weeks and ¥1,000,000 to do."*

---

# SLIDE 6 — Market Opportunity

### Japan industrial IoT market is large and underserved at the entry level

**Market size:**
- Japan Industrial IoT market: ~¥850B (2025), growing 15% CAGR
- SME manufacturing segment (our primary target): ~¥120B addressable
- Current penetration of affordable IoT monitoring: **less than 12%** — most SMEs still use manual checks or dated data loggers

**Target customer profile:**
- Japanese manufacturers with 50–500 employees
- Currently using manual rounds, simple data loggers, or no monitoring
- Budget range: ¥100,000–¥500,000 initial investment
- Key trigger events: equipment failure incident, new compliance requirement, DX initiative

**Number of target companies in Japan:**
- Food manufacturing: ~28,000 factories
- Metal/machinery: ~45,000 factories
- Chemical/pharmaceutical: ~6,000 factories
- **Total addressable: ~79,000 potential customers**

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
   Soracom LTE-M SIM: ¥55 base + ~¥500/month data
   Margin opportunity if we resell SIM
```

**Customer lifetime value example (3 years):**
```
Hardware (Starter Kit + 2 extra sensors):  ¥172,000
SaaS Standard (36 months):                ¥460,800
Connectivity (36 months):                  ¥21,600
Total LTV:                                ¥654,400
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
- Japan's #1 IoT SIM platform (NTT Docomo + KDDI networks)
- LTE-M / Cat-M1 native — plug-and-play with CIREN hardware
- Cost: ¥55/month base + ¥0.1–0.2/MB data
- CIREN sensor data usage: well under ¥100/month even at full LTE-M

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

**Outreach plan:**
- Exhibition at [exhibition name] → identify 5–10 interested parties
- Follow up within 2 weeks with formal proposal + demo unit loan offer
- NDA → pilot agreement → distributor contract

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

**Break-even point:** ~30 Starter Kit sales (hardware-only basis)

---

# SLIDE 14 — Team & Resources Required
### For HR Division

**Current state:** CIREN is developed and maintained by the in-house engineering team.
No dedicated sales or market development resources exist for Japan.

**Roles needed for Japan market entry:**

| Role | Type | Priority | Responsibilities |
|------|------|----------|-----------------|
| **Japan Sales Manager** | Full-time hire | ★★★ Immediate | Partner development, distributor relations, trade shows, proposals |
| **Technical Sales Support** | Full-time hire | ★★★ Immediate | Customer demos, technical Q&A, onboarding support, Japanese documentation |
| **Marketing / Content** | Part-time or contract | ★★ Year 1 | Catalogue, case studies, website localization, trade show materials |
| **Legal / IP Coordinator** | External counsel | ★★ Immediate | Trademark filing, distributor contracts, NDA templates |

**Hiring profile — Japan Sales Manager:**
- Experience in industrial equipment or IoT sales in Japan
- Existing network with 商社 or SIer in manufacturing sector
- Business-level Japanese (native preferred) + working English
- Can operate independently in the field

**Hiring profile — Technical Sales Support:**
- Background in electronics, IoT, or embedded systems
- Comfortable doing live product demos
- Japanese native or near-native
- Experience with technical customer support

**Timeline:** Both roles should be filled before the first distributor agreement is signed.

---

# SLIDE 15 — IP & Legal Strategy

### Protecting our technology and brand

**Current IP status:**
All CIREN technology — firmware, protocol, backend, dashboard, hardware design —
was developed internally at Nakayama Iron and is owned by the company.
No external IP encumbrances.

**IP assets:**

| Asset | Protection Type | Status |
|-------|----------------|--------|
| CIREN firmware (all platforms) | Copyright | Active |
| CIREN Frame Protocol | Copyright + patent candidate | Pending review |
| Cloud backend & API | Copyright | Active |
| Dashboard (React frontend) | Copyright | Active |
| Hardware schematics & PCB | Copyright + design registration candidate | Pending |

**Key actions required:**

```
Immediate:
  ① Trademark filing — Japan (Class 9 + 42): ~¥24,000 filing fee
  ② NDA template for partner discussions
  ③ Distributor agreement template (lawyer review)

Within 3 months:
  ④ Patent search — CIREN Frame Protocol
     (plug-and-play sensor auto-detection mechanism)

Within 6 months:
  ⑤ Design registration — hardware enclosure
  ⑥ Trademark filing — Indonesia (protect home market)
```

**Budget request for legal:** Approx. ¥500,000–¥800,000 Year 1
(trademark + patent search + contract templates + lawyer review)

---

# SLIDE 16 — Trademark

### File CIREN in Japan — before competitors do

**Brand name:** CIREN (サイレン)
**Why the name works in Japan:** Pronounced "sairen" — identical to the Japanese word for siren/alarm. Instantly communicates monitoring and early warning to Japanese engineers.

**Filing plan:**
- **Class 9** — electronic measurement instruments, IoT hardware, sensors
- **Class 42** — SaaS, cloud computing services
- **Cost:** ¥24,000 filing + ~¥65,800 registration = ~¥90,000 total
- **Timeline:** 12–18 months to registration

**Risk of not filing:**
Any third party can register "CIREN" in Japan. Once registered by someone else, we cannot use the name commercially in Japan without licensing it back — or rebranding entirely.

**Recommendation:** File immediately. The exhibition has already publicly introduced the name.

---

# SLIDE 17 — Risk Analysis

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

# SLIDE 18 — Next Steps & Ask

### What we need from each audience

**From Sales Division:**
- Identify and rank 5 distributor candidates from existing contacts
- Attend exhibition and qualify leads
- Define target verticals for Year 1 focus

**From HR Division:**
- Open requisitions for Japan Sales Manager and Technical Sales Support
- Define compensation bands competitive with Japan market
- Target: both roles filled within 90 days

**From President:**
- Approval to proceed with Japan market entry under this proposal
- Authorization to sign distributor agreements (up to Phase 1 terms)
- Budget approval:
  - Legal / IP: ¥800,000
  - Marketing materials: ¥300,000
  - Demo units (3 units for loan program): ¥444,000
  - **Total Year 1 budget request: ¥1,544,000**

---

# SLIDE 19 — Summary

| Item | Decision Needed |
|------|----------------|
| Market entry approval | ✅ Proceed with Japan market — Phase 1 |
| Sales headcount | ✅ Hire Japan Sales Manager + Technical Support |
| Legal budget | ✅ ¥800,000 for trademark, patent, contracts |
| First distributor target | ⏳ Sales to identify top 3 candidates |
| Trademark filing | ⏳ File immediately (CIREN, Class 9 + 42) |
| Phase 2 decision | ⏳ Review after Year 1 results |

---

# APPENDIX A — Product Technical Specifications

| Component | Model | Specification |
|-----------|-------|--------------|
| Main Module MCU | ESP32-S3 | Dual-core 240MHz, WiFi + BT |
| Cellular Modem | SIM7080G | LTE-M (Cat-M1) / NB-IoT |
| Display | TFT ILI9341 2.4" | 320×240, status display |
| Controller MCU | ESP32 | Up to 8 sensor nodes |
| Sensor Node MCU | Seeeduino XIAO SAMD21 | Low-power, compact |
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
