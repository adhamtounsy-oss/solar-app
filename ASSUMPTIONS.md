# Solar App — Assumptions Register

**Last updated:** 2026-04-22  
**Purpose:** Single source of truth for every hardcoded constant, default value, and model simplification in the app. Update this file whenever an assumption changes, is made user-editable, or is replaced by a lookup.

Each entry lists: current value · file:line · source/standard · sensitivity (H/M/L) · status.

**Status codes**
- `FIXED` — correct physical constant; no reason to change
- `DEFAULT` — reasonable default already exposed as a user input
- `ASSUMED` — hardcoded; should eventually be user-editable or fetched
- `ESTIMATED` — engineering estimate; acceptable for now but worth flagging in outputs
- `TODO` — known gap; missing from the cost model

---

## 1. Load Model

| # | Assumption | Value | File : Line | Standard / Source | Sensitivity | Status |
|---|---|---|---|---|---|---|
| L1 | LED lighting power density | **8 W/m²** | `lib/profile.js:10`, `engine/calcEngine.js:24` | Egyptian EEC 2016 / IEA LED guide | M — older buildings 12–15 W/m² | `ASSUMED` |
| L2 | AC unit kW = tonnage × 3.517 / COP | **3.517 kW/ton** | `lib/profile.js:8`, `engine/calcEngine.js:23` | 1 RT = 3.517 kW — exact conversion | FIXED | `FIXED` |
| L3 | Default AC COP | **3.0** | `config/nav.js:DEF.acCOP` | Typical split-unit inverter; user-editable | M | `DEFAULT` |
| L4 | Load time-window fractions (morning/midday/evening) | **[0.3, 0.8, 0.6] AC etc.** | `config/nav.js:DEF.prof_*` | Engineering estimate; user-editable array | H for SCR | `DEFAULT` |

---

## 2. Panel Thermal & Electrical Model

| # | Assumption | Value | File : Line | Standard / Source | Sensitivity | Status |
|---|---|---|---|---|---|---|
| P1 | NOCT → cell temperature formula coefficient | **0.8** | `engine/calcEngine.js:88` | IEC 60904-5 §C.2 (800 W/m² base) | M — fixed irradiance base | `FIXED` |
| P2 | betaVmp estimate when absent from datasheet | **betaVoc × 1.20** | `engine/calcEngine.js:103` | IEC 60891 typical ratio | L | `ESTIMATED` |
| P3 | N-type panel detection threshold (gammaPmax) | **≤ −0.31 %/°C** | `engine/calcEngine.js:581` | HJT/TOPCon typical −0.25 to −0.30 | L | `ESTIMATED` |
| P4 | Default panel degradation rate | **0.65 %/yr** | `config/nav.js:DEF.panelDeg` | IEA-PVPS T13 median; user-editable | H (25-yr) | `DEFAULT` |

---

## 3. System Loss Model (`computeEtaSys`)

| # | Assumption | Value | File : Line | Standard / Source | Sensitivity | Status |
|---|---|---|---|---|---|---|
| S1 | DC wiring ohmic losses | **2% (η = 0.98)** | `lib/profile.js:69` | IEC 62548 §8.3 range 1–2% | M | `ASSUMED` |
| S2 | Module mismatch losses | **2% (η = 0.98)** | `lib/profile.js:70` | IEC 62548 §8.4 range 1–3% | M — 0% with MLPE | `ASSUMED` |
| S3 | LID/LETID embedded in system eta | **1% (η = 0.99)** | `lib/profile.js:71` | Conservative for PERC/TOPCon; HJT ~0.3% | L | `ASSUMED` |
| S4 | System availability / downtime | **1% (η = 0.99)** | `lib/profile.js:72` | IEA-PVPS T1 2022 typical residential | M | `ASSUMED` |
| S5 | IAM (incidence angle modifier) ASHRAE b0 | **0.05** | `engine/calcEngine.js:466` | ASHRAE 93-2003; AR-coated glass = 0.02–0.03 | L | `ASSUMED` |
| S6 | Bifacial rear irradiance model (view factor) | **(1 + cos(tilt)) / 2** | `engine/calcEngine.js:446` | IEC TS 60904-1-2 simplified | L | `FIXED` |
| S7 | Default albedo | **0.20** | `config/nav.js:DEF.albedo` | Concrete/gravel typical; user-editable | L (unless bifacial) | `DEFAULT` |
| S8 | Default bifacial factor | **0.70** | `config/nav.js:DEF.bifacialFactor` | Typical bifacial rear/front efficiency ratio; user-editable | L | `DEFAULT` |

---

## 4. Degradation Model

| # | Assumption | Value | File : Line | Standard / Source | Sensitivity | Status |
|---|---|---|---|---|---|---|
| D1 | Bi-linear degradation early multiplier | **1.3× for first 3 years** | `engine/calcEngine.js:8–9` | IEA-PVPS T13-2021 | M | `ESTIMATED` |
| D2 | Year-1 LID loss — PERC panels | **2.0%** | `engine/calcEngine.js:583` | IEC 61215 test data range 1–3% | L (year 1 only) | `ESTIMATED` |
| D3 | Year-1 LID loss — N-type (TOPCon/HJT) | **0.5%** | `engine/calcEngine.js:583` | Manufacturer specs; HJT typically 0.3% | L | `ESTIMATED` |

---

## 5. Irradiance & Climate

| # | Assumption | Value | File : Line | Standard / Source | Sensitivity | Status |
|---|---|---|---|---|---|---|
| I1 | Cairo TMY fallback table | **12-month table** | `constants/index.js:7` | PVGIS ERA5 Cairo (2005–2020 avg) | H — only active without PVGIS fetch | `FIXED` |
| I2 | Cairo baseline elevation for lapse rate | **74 m ASL** | `engine/calcEngine.js:197` | PVGIS metadata for Cairo lat/lon | FIXED for Egypt | `FIXED` |
| I3 | ISA temperature lapse rate (fallback path only) | **−6.5 °C / 1000 m** | `engine/calcEngine.js:198` | ICAO Standard Atmosphere | FIXED physical | `FIXED` |
| I4 | Default P90 yield factor | **0.920** | `constants/index.js:P90_FACTOR`, `config/nav.js:DEF.p90Factor` | PVGIS inter-annual σ≈5% for Egypt; country-specific via countryData | H | `DEFAULT` |
| I5 | Design PSH (array sizing basis) | **4.57 h/day** | `constants/index.js:DESIGN_PSH` | Dec P90 PSH Cairo from PVGIS | H for sizing | `DEFAULT` |
| I6 | Soiling profile — Egypt (Khamsin) | **Monthly array** | `constants/index.js:CAIRO_SOILING` | Field data; country-specific via countryData | M | `DEFAULT` |
| I7 | Shading: diffuse light recovery factor | **80%** | `engine/calcEngine.js:522` | Standard PVsyst value for isotropic sky | L | `ASSUMED` |
| I8 | Horizon shading: diffuse recovery factor | **85%** | `engine/calcEngine.js:559` | Conservative; depends on sky model | L | `ASSUMED` |
| I9 | Inter-row shading design point | **Dec 21, 9:00 solar time** | `engine/calcEngine.js:115` | Worst-case winter morning — industry standard | L | `FIXED` |

---

## 6. Wiring & Protection

| # | Assumption | Value | File : Line | Standard / Source | Sensitivity | Status |
|---|---|---|---|---|---|---|
| W1 | Copper resistivity at 20°C | **0.0172 Ω·mm²/m** | `engine/calcEngine.js:373` | IEC 60228 | FIXED physical | `FIXED` |
| W2 | Copper temp coefficient α | **0.00393 /°C** | `engine/calcEngine.js:372` | IEC 60228 | FIXED physical | `FIXED` |
| W3 | DC cable operating temperature | **70°C** (PV1-F XLPE) | `engine/calcEngine.js:374` | PV1-F cable standard operating max | M for VD | `ASSUMED` |
| W4 | AC cable operating temperature | **60°C** | `engine/calcEngine.js:375` | IEC 60364-5-52 conduit/tray install | M for VD | `ASSUMED` |
| W5 | DC voltage drop limit | **1.5%** | `engine/calcEngine.js:400,405` | IEC 60364-7-712 §712.52 | L (sizing headroom) | `FIXED` |
| W6 | AC voltage drop limit | **2.0%** | `engine/calcEngine.js:413` | IEC 60364-5-52 / Egyptian NTRA | L | `FIXED` |
| W7 | String fuse / design current factor | **1.56 × Isc** | `engine/calcEngine.js:398,415` | IEC 62548 §8.2 (1.25² = 1.5625) | L | `FIXED` |
| W8 | Cable ampacity table (XLPE, 40°C, DC) | **[18,24,32,41,57,76,101,125,151] A** | `engine/calcEngine.js:384` | IEC 60364-5-52 Table B.52.1 | M | `FIXED` |
| W9 | MDB busbar diversity / demand factor | **0.80** | `engine/calcEngine.js:417` | Egyptian NTRA NEC 2018 §220.12 | M | `ASSUMED` |

---

## 7. Lightning Protection (SPD)

| # | Assumption | Value | File : Line | Standard / Source | Sensitivity | Status |
|---|---|---|---|---|---|---|
| SP1 | Location coefficient Cd | **1.0 (isolated)** | `App.jsx:67` | IEC 62305-2 Table 3; `0.5` if beside taller buildings | H — never adjusted per site | `ASSUMED` |
| SP2 | Panel footprint for collection area | **2.0 m²/panel** | `App.jsx:69` | Approximation; actual dimL×dimW available | L | `ASSUMED` |
| SP3 | IEC 62305-2 Ae formula rolling factor | **6 × side × tan(30°)** | `App.jsx:71–73` | IEC 62305-2 eq. A.1 — correct formula | FIXED | `FIXED` |
| SP4 | Acceptable strike frequency Nc | **1 / analysisPeriod** | `App.jsx:75` | Conservative IEC 62305-1 §E.2 | L | `FIXED` |
| SP5 | Default ground flash density Ng | **Country-specific** | `data/countryData.js` | IEC 62305-2 Annex A regional maps | H | `DEFAULT` |

---

## 8. Financial Model

| # | Assumption | Value | File : Line | Standard / Source | Sensitivity | Status |
|---|---|---|---|---|---|---|
| F1 | Component cost normalisation base | **55 EGP/USD** | `engine/calcEngine.js:422` | Egypt market rate when fixtures were priced; applied as divisor before usdRate multiplication | M — should move to costUSD on component fixtures | `ASSUMED` |
| F2 | Default O&M cost | **3,000 EGP/yr** | `config/nav.js:DEF.omPerYear` | IEA-PVPS T1 Egypt benchmark; user-editable | M | `DEFAULT` |
| F3 | Default O&M escalation | **3%/yr** | `config/nav.js:DEF.omEsc` | CPI-linked estimate; user-editable | L | `DEFAULT` |
| F4 | Default tariff escalation (Egypt) | **18%/yr** | `config/nav.js:DEF.tariffEsc` | Egypt EEHC historic avg 2016–2024; country-specific | H | `DEFAULT` |
| F5 | Default discount rate | **12%** | `config/nav.js:DEF.discountRate` | WACC estimate for Egypt residential; country-specific | H | `DEFAULT` |
| F6 | Battery replacement year | **Year 12** | `config/nav.js:DEF.batReplaceYear` | Typical 80% SOH threshold at ~3,000 cycles; user-editable | M | `DEFAULT` |
| F7 | USD exchange rate | **Country-specific** | `data/countryData.js` | Static; updated manually — no live API | M | `ASSUMED` |
| **F8** | **Grid connection fee** | **NOT MODELLED** | — | Egypt EEHC: ~5,000–20,000 EGP per system | H | `TODO` |
| **F9** | **Import duty on equipment** | **NOT MODELLED** | — | Egypt: panels 2%; varies by country | M | `TODO` |
| **F10** | **Permitting / inspection fees** | **NOT MODELLED** | — | 2–5% of system cost in many markets | M | `TODO` |
| **F11** | **Financing costs (loan vs equity)** | **100% equity assumed** | — | Leveraged IRR diverges significantly | H | `TODO` |
| **F12** | **Insurance** | **NOT MODELLED** | — | ~0.5–1% of system cost/yr in bankable models | L | `TODO` |

---

## 9. Country-Specific Data (`data/countryData.js`)

All per-country values carry a research classification tag in the source file:
- **[P] Primary** — official utility tariff documents, IEC Annex A maps
- **[S] Secondary** — IRENA, PVGIS, ASHRAE IWEC2, World Bank, IEA PVPS
- **[E] Estimated** — BNEF, Wood Mackenzie, regional analogues

| Field | Primary countries (MENA) | Other countries | Status |
|---|---|---|---|
| `tariffTiers` / `tariffNow` | [P] for EG, SA, AE, JO, MA, OM, KW, QA, BH | [S]/[E] for rest | Updates needed annually |
| `tariffEsc` | [S] historical averages | [E] estimates | Volatile in high-inflation markets |
| `soilProfile` | [S] for MENA; field-calibrated for EG | [S]/[E] for rest | Good enough |
| `lightningNg` | [P] IEC 62305-2 Annex A for all | [P] | Reliable |
| `designPSH` | [S] PVGIS Dec P90 for MENA | [S] | Reliable |
| `p90Factor` | [S] derived from σ_irr per region | [S] | Reliable |
| `bosPerKwp` / `engPerKwp` | [E] BNEF / IRENA estimates | [E] | Needs field validation |
| `omPerKwpYear` | [E] IEA-PVPS T1 benchmarks | [E] | Needs field validation |
| `usdRate` | Static snapshot | Static snapshot | **No live API — update manually** |
| `tAmbMax` / `tAmbMin` | [S] ASHRAE IWEC2 | [S] | Reliable |

---

## 10. Variables That Could Be Fetched (Not Yet Wired)

| Variable | Potential API | Priority | Notes |
|---|---|---|---|
| Live USD exchange rate | fixer.io, Open Exchange Rates (free tier) | M | Would fix F7 for all non-EGP currencies |
| Site ground flash density Ng | NASA GHRC LIS/OTD 0.5° grid (public) | M | Would replace country-average with site-specific |
| Hourly irradiance + temperature | PVGIS — **already wired** ✓ | — | — |
| Elevation | Open-Elevation — **already wired** ✓ | — | — |
| Country / address | Nominatim — **already wired** ✓ | — | — |
| Panel/inverter market price | PVInsights, BNEF (paid) | L | No free API available |
| Tariff updates | No public API for MENA utilities | — | Manual update only |

---

## Changelog

| Date | Change | Assumption affected |
|---|---|---|
| 2026-04-22 | File created; initial audit from codebase | All |
| 2026-04-22 | Fixed Jordan/Oman/Kuwait/Bahrain bosPerKwp unit error (was /Wp, now /kWp) | F1 area |
| 2026-04-22 | Component costs normalised through USD in calcEngine (÷55 × usdRate) | F1 |
| 2026-04-22 | p90Factor made country-specific (was hardcoded 0.92 Egypt constant) | I4 |
| 2026-04-22 | bosPerKwp / engPerKwp wired into calcEngine (were hardcoded 8000/5000 EGP) | F1 area |
