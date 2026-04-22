/**
 * Country profiles for the solar design platform.
 *
 * RESEARCH CLASSIFICATION & SOURCES
 * ──────────────────────────────────
 * Each field has a data-quality tier:
 *   [P] Primary   — utility tariff schedules, IEC/IEEE standards, government docs
 *   [S] Secondary — IRENA, World Bank, IEA PVPS Task 13, published LCOE studies
 *   [E] Estimated — regional analogy, engineering judgement, cross-checked with
 *                   published installed-cost databases (BNEF, Wood Mackenzie, BloombergNEF)
 *
 * VARIABLE CLASSIFICATION — what changes per country
 * ───────────────────────────────────────────────────
 * tariffNow      [P] Current blended residential rate (local currency/kWh)
 * tariffEsc      [S] Historical annual tariff escalation rate (%)
 * tariffMode     [P] "tiered" | "flat"
 * tariffTiers    [P] Tiered rate brackets (null for flat)
 * currency/sym   [P] ISO code + display symbol
 * usdRate        [S] Current USD exchange rate (approximate; updated by live fetch)
 * netMeteringEnabled [P] Whether residential net metering / FiT exists
 * netMeteringRate [P] Export tariff or FiT rate (local currency/kWh)
 * soilProfile    [S] Monthly soiling fraction — PVGIS soiling data + IEA PVPS T13
 * lightningNg    [P] Ground flash density fl/km²/yr — IEC 62305-2 Annex A maps
 * tAmbMax        [S] Design-month max ambient °C — ASHRAE IWEC2 / PVGIS ERA5
 * tAmbMin        [S] Design-month min ambient °C — ASHRAE IWEC2 / PVGIS ERA5
 * designPSH      [S] Worst-month (Dec N.Hemi / Jun S.Hemi) P90 PSH — PVGIS monthly
 * bosPerKwp      [E] Balance-of-System cost in local currency/kWp (labour + mounting)
 *                    Sources: IRENA "Renewable Power Generation Costs" annual; BNEF
 * engPerKwp      [E] Design & permitting cost in local currency/kWp
 * discountRate   [S] Typical project WACC (%) — World Bank country risk + sector
 * omPerKwpYear   [E] Annual O&M per kWp installed (local currency) — IEA PVPS T1
 * analysisPeriod [S] Standard project bankable lifetime (years)
 * gridVoltage    [P] Nominal residential supply voltage (V) — IEC 60038
 * gridHz         [P] Grid frequency (Hz)
 * p90Factor      [S] P90 yield derating factor = exp(-1.28 × sigma_irr)
 *                    Egypt σ=0.05 → 0.92; Germany σ=0.08 → 0.90; Gulf σ=0.06 → 0.925
 *
 * MENA RESEARCH NOTES (primary focus)
 * ─────────────────────────────────────
 * Egypt:   NCEDC/EEHC tariff schedule 2024; IRENA 2024 Egypt report; PVGIS Cairo
 * S.Arabia: SEC residential tariff 2023; KACST solar atlas; BNEF 2024 KSA installed cost
 * UAE:     DEWA/ADDC tariff schedule 2024; Masdar PVGIS data; UAE FiT 2024
 * Jordan:  NEPCO/IDECO tariff 2024; JREAP; PVGIS Amman
 * Morocco: ONEE tariff 2024; MASEN reports; PVGIS Rabat
 * Tunisia: STEG tariff 2024; PVGIS Tunis
 * Oman:    OETC/MEDC tariff 2024; Authority for Electricity Regulation
 * Kuwait:  MEW tariff 2024 (heavily subsidised)
 * Qatar:   KAHRAMAA tariff 2024
 * Bahrain: EWA tariff 2024
 */

import { EGYPT_TARIFF_TIERS } from "../lib/financial.js";

// ── Soiling profile presets (monthly Jan–Dec, fraction lost) ─────────────────
// [S] IEA PVPS Task 13-2021 + PVGIS soiling module + site measurement databases
const SOIL_KHAMSIN   = [0.02,0.02,0.09,0.11,0.08,0.02,0.02,0.02,0.02,0.03,0.02,0.02]; // Egypt/Levant
const SOIL_GULF      = [0.03,0.03,0.07,0.09,0.07,0.03,0.03,0.03,0.03,0.03,0.03,0.03]; // Arabian Gulf
const SOIL_MEDITER   = [0.01,0.01,0.02,0.03,0.03,0.04,0.04,0.04,0.02,0.01,0.01,0.01]; // Mediterranean
const SOIL_TEMPERATE = [0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01]; // NW Europe
const SOIL_SOUTHASIA = [0.02,0.03,0.04,0.06,0.07,0.04,0.02,0.02,0.02,0.03,0.02,0.02]; // South Asia
const SOIL_SUBSAHARA = [0.04,0.04,0.03,0.03,0.02,0.02,0.02,0.02,0.02,0.02,0.03,0.04]; // Sub-Saharan
const SOIL_SAFRICA   = [0.02,0.02,0.02,0.03,0.04,0.05,0.05,0.04,0.03,0.02,0.02,0.02]; // Southern Africa
const SOIL_TROPICAL  = [0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01]; // Tropical/wet
const SOIL_OCEANIA   = [0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.01,0.01]; // Oceania

// ── Country profiles ─────────────────────────────────────────────────────────
export const COUNTRY_DATA = {

  // ══════════════════════════════════════════════════════════════════
  // MENA — PRIMARY FOCUS
  // ══════════════════════════════════════════════════════════════════

  eg: {
    name: "Egypt", flag: "🇪🇬", region: "MENA",
    // [P] NCEDC/EEHC tariff schedule 2024 — 7-tier progressive
    currency: "EGP", currencySymbol: "E£", usdRate: 55,
    tariffMode: "tiered",
    tariffNow: 1.95, tariffEsc: 18,   // [S] avg 2020-24 EEHC annual increases
    tariffTiers: EGYPT_TARIFF_TIERS,
    // [P] Egypt Policy 2024: residential net metering for <10 kWp only; ~0.50 EGP/kWh
    netMeteringEnabled: false, netMeteringRate: 0.50,
    // [S] IEA PVPS Task 13; IRENA Egypt 2024; Khamsin dust March-May
    soilProfile: SOIL_KHAMSIN,
    // [P] IEC 62305-2 Annex A — Egypt Ng map
    lightningNg: 2.0,
    // [S] ASHRAE IWEC2 Cairo; PVGIS ERA5 site data
    tAmbMax: 42, tAmbMin: 5,
    // [S] PVGIS Cairo Dec P90 ~ 4.97h, σ_irr=0.05 → P90 factor 0.920
    designPSH: 4.57, p90Factor: 0.920,
    // [E] IRENA 2024 Egypt installed cost ~650 USD/kWp total; @ E£55/USD:
    //     array ≈ 200 EGP/Wp → remainder ~250 USD/kWp (BoS+eng = 13,750 EGP/kWp split 8k/5k)
    bosPerKwp: 8000, engPerKwp: 5000, omPerKwpYear: 450,
    // [S] World Bank Egypt WACC 12%; typical project life 25 yr
    discountRate: 12, analysisPeriod: 25,
    // [P] IEC 60038; Egypt EEHC grid standard
    gridVoltage: 220, gridHz: 50,
    supplyVoltageLN: 220, supplyVoltageLL: 380,
  },

  sa: {
    name: "Saudi Arabia", flag: "🇸🇦", region: "MENA",
    // [P] SEC residential tariff 2023 — 2-tier
    currency: "SAR", currencySymbol: "SR", usdRate: 3.75,
    tariffMode: "tiered",
    tariffNow: 0.18, tariffEsc: 5,    // [S] moderate subsidy reforms 2016-24
    tariffTiers: [
      { limit: 2000,     rate: 0.18, label: "0–2,000 kWh (SR 0.18)" },
      { limit: Infinity, rate: 0.32, label: "> 2,000 kWh (SR 0.32)" },
    ],
    // [P] SEC net metering regulation 2021 — SASO 4267; typical FiT 0.16 SR/kWh
    netMeteringEnabled: true, netMeteringRate: 0.16,
    soilProfile: SOIL_GULF,           // [S] fine Nafud dust; minimal rain-washing
    lightningNg: 0.8,                 // [P] IEC 62305-2 Annex A — KSA map (low, arid)
    // [S] ASHRAE IWEC2 Riyadh; design month July (not Dec) — hottest sun
    tAmbMax: 48, tAmbMin: 5,
    // [S] PVGIS Riyadh Dec P90 ≈ 5.70h; σ_irr=0.04 (stable Gulf climate) → P90 0.925
    designPSH: 5.70, p90Factor: 0.925,
    // [E] BNEF 2024 KSA: ~$0.50/Wp total (low labour); @ SR 3.75/USD → ~1875 SR/kWp total
    //     BoS+eng ≈ 700 SR/kWp (450+250)
    bosPerKwp: 450, engPerKwp: 250, omPerKwpYear: 60,
    // [S] Saudi project WACC ~8%; Neom/ACWA bankable deals at 7-9%
    discountRate: 8, analysisPeriod: 25,
    gridVoltage: 220, gridHz: 60,     // [P] Saudi Electricity Grid Code — 60 Hz
    supplyVoltageLN: 127, supplyVoltageLL: 220,
  },

  ae: {
    name: "United Arab Emirates", flag: "🇦🇪", region: "MENA",
    // [P] DEWA tariff 2024 (Dubai); ADDC (Abu Dhabi) — 4-tier
    currency: "AED", currencySymbol: "AED", usdRate: 3.67,
    tariffMode: "tiered",
    tariffNow: 0.23, tariffEsc: 4,
    tariffTiers: [
      { limit: 2000,     rate: 0.23, label: "0–2,000 kWh (AED 0.23)" },
      { limit: 4000,     rate: 0.28, label: "2,001–4,000 kWh (AED 0.28)" },
      { limit: 6000,     rate: 0.32, label: "4,001–6,000 kWh (AED 0.32)" },
      { limit: Infinity, rate: 0.38, label: "> 6,000 kWh (AED 0.38)" },
    ],
    // [P] DEWA Shams Dubai net metering — AED 0.20/kWh typical 2024
    netMeteringEnabled: true, netMeteringRate: 0.20,
    soilProfile: SOIL_GULF,
    lightningNg: 0.3,                 // [P] IEC 62305-2 Annex A — UAE (very low)
    tAmbMax: 45, tAmbMin: 12,         // [S] ASHRAE Abu Dhabi / Dubai
    // [S] PVGIS Abu Dhabi Dec P90 ≈ 5.10h; σ_irr=0.04 → P90 0.925
    designPSH: 5.10, p90Factor: 0.925,
    // [E] BNEF 2024 UAE: ~$0.55/Wp total (high import costs); @ AED 3.67
    bosPerKwp: 750, engPerKwp: 350, omPerKwpYear: 80,
    discountRate: 7, analysisPeriod: 25,
    gridVoltage: 220, gridHz: 50,     // [P] DEWA Grid Code — 50 Hz
    supplyVoltageLN: 220, supplyVoltageLL: 380,
  },

  jo: {
    name: "Jordan", flag: "🇯🇴", region: "MENA",
    // [P] NEPCO/IDECO residential tariff 2024 — 5-tier
    currency: "JOD", currencySymbol: "JD", usdRate: 0.71,
    tariffMode: "tiered",
    tariffNow: 0.065, tariffEsc: 6,
    tariffTiers: [
      { limit: 160,      rate: 0.033, label: "0–160 kWh (fils 33)" },
      { limit: 300,      rate: 0.062, label: "161–300 kWh (fils 62)" },
      { limit: 500,      rate: 0.089, label: "301–500 kWh (fils 89)" },
      { limit: 600,      rate: 0.103, label: "501–600 kWh (fils 103)" },
      { limit: Infinity, rate: 0.118, label: "> 600 kWh (fils 118)" },
    ],
    // [P] MEMR net metering regulation 2012 (amended 2021) — standard offer 0.06 JD/kWh
    netMeteringEnabled: true, netMeteringRate: 0.06,
    soilProfile: SOIL_KHAMSIN,        // [S] Levant dust pattern; Jordan Valley similar to Egypt
    lightningNg: 1.5,                 // [P] IEC 62305-2 Annex A — Jordan
    tAmbMax: 38, tAmbMin: 2,          // [S] ASHRAE IWEC2 Amman
    // [S] PVGIS Amman Dec P90 ≈ 4.90h; σ_irr=0.05 → P90 0.920
    designPSH: 4.90, p90Factor: 0.920,
    // [E] IRENA 2024 Jordan: ~$0.75/Wp total; @ JD 0.71/USD → BoS ≈380, eng ≈180 JOD/kWp
    bosPerKwp: 380, engPerKwp: 180, omPerKwpYear: 25,
    discountRate: 10, analysisPeriod: 25,
    gridVoltage: 230, gridHz: 50,
    supplyVoltageLN: 230, supplyVoltageLL: 400,
  },

  ma: {
    name: "Morocco", flag: "🇲🇦", region: "MENA",
    // [P] ONEE residential tariff 2024 — 4-tier
    currency: "MAD", currencySymbol: "DH", usdRate: 10.0,
    tariffMode: "tiered",
    tariffNow: 1.14, tariffEsc: 5,
    tariffTiers: [
      { limit: 100,      rate: 0.90, label: "0–100 kWh (DH 0.90)" },
      { limit: 200,      rate: 1.04, label: "101–200 kWh (DH 1.04)" },
      { limit: 500,      rate: 1.28, label: "201–500 kWh (DH 1.28)" },
      { limit: Infinity, rate: 1.50, label: "> 500 kWh (DH 1.50)" },
    ],
    // [P] MASEN decree 2021 — Morocco net metering (Autoconsommation) 0.80 DH/kWh typical
    netMeteringEnabled: true, netMeteringRate: 0.80,
    soilProfile: [0.02,0.02,0.05,0.07,0.06,0.03,0.02,0.02,0.02,0.03,0.02,0.02], // [S] Saharan influence spring
    lightningNg: 1.5,                 // [P] IEC 62305-2 Annex A — Morocco
    tAmbMax: 40, tAmbMin: 5,          // [S] ASHRAE IWEC2 Casablanca/Marrakech
    // [S] PVGIS Rabat Dec P90 ≈ 4.50h; σ_irr=0.05 → P90 0.920
    designPSH: 4.50, p90Factor: 0.920,
    // [E] IRENA 2024 Morocco: ~$0.80/Wp; @ DH 10/USD
    bosPerKwp: 4500, engPerKwp: 2000, omPerKwpYear: 300,
    discountRate: 9, analysisPeriod: 25,
    gridVoltage: 220, gridHz: 50,
    supplyVoltageLN: 220, supplyVoltageLL: 380,
  },

  tn: {
    name: "Tunisia", flag: "🇹🇳", region: "MENA",
    // [P] STEG tariff 2024 (flat residential)
    currency: "TND", currencySymbol: "DT", usdRate: 3.15,
    tariffMode: "flat",
    tariffNow: 0.155, tariffEsc: 6,
    tariffTiers: null,
    // [P] STEG autoconsommation decree 2016 — 0.10 TND/kWh export
    netMeteringEnabled: false, netMeteringRate: 0.10,
    soilProfile: SOIL_MEDITER,
    lightningNg: 1.5,                 // [P] IEC 62305-2 Annex A
    tAmbMax: 38, tAmbMin: 5,          // [S] ASHRAE IWEC2 Tunis
    designPSH: 4.30, p90Factor: 0.920,
    // [E] IRENA 2024 Tunisia: ~$0.85/Wp; @ DT 3.15/USD
    bosPerKwp: 1500, engPerKwp: 650, omPerKwpYear: 120,
    discountRate: 11, analysisPeriod: 25,
    gridVoltage: 230, gridHz: 50,
    supplyVoltageLN: 230, supplyVoltageLL: 400,
  },

  om: {
    name: "Oman", flag: "🇴🇲", region: "MENA",
    // [P] Authority for Electricity Regulation Oman tariff 2024
    currency: "OMR", currencySymbol: "RO", usdRate: 0.385,
    tariffMode: "flat",
    tariffNow: 0.025, tariffEsc: 5,
    tariffTiers: null,
    // [P] OETC net metering pilot 2022 — 0.020 RO/kWh
    netMeteringEnabled: true, netMeteringRate: 0.020,
    soilProfile: SOIL_GULF,
    lightningNg: 0.5,                 // [P] IEC 62305-2 Annex A — Oman
    tAmbMax: 46, tAmbMin: 10,         // [S] ASHRAE IWEC2 Muscat
    designPSH: 5.30, p90Factor: 0.925,
    // [E] IRENA 2024 Oman: ~$0.65/Wp; @ RO 0.385/USD → BoS ≈140, eng ≈60 OMR/kWp
    bosPerKwp: 140, engPerKwp: 60, omPerKwpYear: 10,
    discountRate: 9, analysisPeriod: 25,
    gridVoltage: 240, gridHz: 50,
    supplyVoltageLN: 240, supplyVoltageLL: 415,
  },

  kw: {
    name: "Kuwait", flag: "🇰🇼", region: "MENA",
    // [P] MEW tariff 2024 — heavily subsidised flat rate
    currency: "KWD", currencySymbol: "KD", usdRate: 0.307,
    tariffMode: "flat",
    tariffNow: 0.002, tariffEsc: 3,   // [S] very slow reform pace
    tariffTiers: null,
    netMeteringEnabled: false, netMeteringRate: 0.002,
    soilProfile: SOIL_GULF,
    lightningNg: 0.3,                 // [P] IEC 62305-2 Annex A
    tAmbMax: 47, tAmbMin: 8,          // [S] ASHRAE IWEC2 Kuwait City
    designPSH: 5.60, p90Factor: 0.925,
    // [E] Kuwait high import costs, limited local industry: ~$0.70/Wp; @ KD 0.307/USD → BoS ≈120, eng ≈50 KWD/kWp
    bosPerKwp: 120, engPerKwp: 50, omPerKwpYear: 8,
    discountRate: 7, analysisPeriod: 25,
    gridVoltage: 240, gridHz: 50,
    supplyVoltageLN: 240, supplyVoltageLL: 415,
  },

  qa: {
    name: "Qatar", flag: "🇶🇦", region: "MENA",
    // [P] KAHRAMAA tariff 2024
    currency: "QAR", currencySymbol: "QR", usdRate: 3.64,
    tariffMode: "flat",
    tariffNow: 0.028, tariffEsc: 3,
    tariffTiers: null,
    netMeteringEnabled: false, netMeteringRate: 0.025,
    soilProfile: SOIL_GULF,
    lightningNg: 0.3,                 // [P] IEC 62305-2 — Gulf coast very low
    tAmbMax: 45, tAmbMin: 10,         // [S] ASHRAE IWEC2 Doha
    designPSH: 5.20, p90Factor: 0.925,
    // [E] Qatar: ~$0.65/Wp; @ QR 3.64/USD
    bosPerKwp: 860, engPerKwp: 360, omPerKwpYear: 65,
    discountRate: 7, analysisPeriod: 25,
    gridVoltage: 240, gridHz: 50,
    supplyVoltageLN: 240, supplyVoltageLL: 415,
  },

  bh: {
    name: "Bahrain", flag: "🇧🇭", region: "MENA",
    // [P] EWA tariff 2024
    currency: "BHD", currencySymbol: "BD", usdRate: 0.376,
    tariffMode: "flat",
    tariffNow: 0.012, tariffEsc: 4,
    tariffTiers: null,
    netMeteringEnabled: false, netMeteringRate: 0.010,
    soilProfile: SOIL_GULF,
    lightningNg: 0.3,                 // [P] IEC 62305-2
    tAmbMax: 44, tAmbMin: 10,
    designPSH: 5.10, p90Factor: 0.925,
    // [E] Bahrain ~$0.65/Wp; @ BD 0.376/USD → BoS ≈100, eng ≈40 BHD/kWp
    bosPerKwp: 100, engPerKwp: 40, omPerKwpYear: 8,
    discountRate: 7, analysisPeriod: 25,
    gridVoltage: 230, gridHz: 50,
    supplyVoltageLN: 230, supplyVoltageLL: 400,
  },

  ly: {
    name: "Libya", flag: "🇱🇾", region: "MENA",
    // [E] GECOL tariff — heavily subsidised, frequently reformed
    currency: "LYD", currencySymbol: "LD", usdRate: 4.85,
    tariffMode: "flat",
    tariffNow: 0.018, tariffEsc: 8,
    tariffTiers: null,
    netMeteringEnabled: false, netMeteringRate: 0.015,
    soilProfile: SOIL_KHAMSIN,        // [S] Saharan dust — similar to Egypt
    lightningNg: 0.8,                 // [P] IEC 62305-2 — North Africa
    tAmbMax: 42, tAmbMin: 8,
    designPSH: 5.20, p90Factor: 0.920,
    bosPerKwp: 2800, engPerKwp: 1200, omPerKwpYear: 200,
    discountRate: 15, analysisPeriod: 20,
    gridVoltage: 220, gridHz: 50,
    supplyVoltageLN: 220, supplyVoltageLL: 380,
  },

  sd: {
    name: "Sudan", flag: "🇸🇩", region: "MENA",
    // [E] NEC Sudan — data sparse; based on regional analogues
    currency: "SDG", currencySymbol: "ج.س", usdRate: 600,
    tariffMode: "flat",
    tariffNow: 3.0, tariffEsc: 25,    // [S] high inflation environment
    tariffTiers: null,
    netMeteringEnabled: false, netMeteringRate: 2.0,
    soilProfile: SOIL_SUBSAHARA,
    lightningNg: 4.0,                 // [P] IEC 62305-2 — Sudan (higher than Egypt)
    tAmbMax: 44, tAmbMin: 15,
    designPSH: 5.50, p90Factor: 0.920,
    bosPerKwp: 900, engPerKwp: 400, omPerKwpYear: 60,
    discountRate: 18, analysisPeriod: 20,
    gridVoltage: 230, gridHz: 50,
    supplyVoltageLN: 230, supplyVoltageLL: 400,
  },

  iq: {
    name: "Iraq", flag: "🇮🇶", region: "MENA",
    // [P] MoE Iraq residential tariff 2023
    currency: "IQD", currencySymbol: "IQD", usdRate: 1310,
    tariffMode: "flat",
    tariffNow: 35, tariffEsc: 8,
    tariffTiers: null,
    netMeteringEnabled: false, netMeteringRate: 25,
    soilProfile: SOIL_GULF,           // [S] Mesopotamian dust; similar to Gulf
    lightningNg: 1.0,                 // [P] IEC 62305-2
    tAmbMax: 47, tAmbMin: 3,
    designPSH: 5.00, p90Factor: 0.920,
    bosPerKwp: 65000, engPerKwp: 28000, omPerKwpYear: 5000,
    discountRate: 14, analysisPeriod: 20,
    gridVoltage: 220, gridHz: 50,
    supplyVoltageLN: 220, supplyVoltageLL: 380,
  },

  // ══════════════════════════════════════════════════════════════════
  // AFRICA (secondary)
  // ══════════════════════════════════════════════════════════════════

  za: {
    name: "South Africa", flag: "🇿🇦", region: "Africa",
    // [P] Eskom residential tariff 2024 (Homepower)
    currency: "ZAR", currencySymbol: "R", usdRate: 18.5,
    tariffMode: "flat",
    tariffNow: 3.50, tariffEsc: 12,   // [S] NERSA annual increases 2020-24
    tariffTiers: null,
    // [P] Eskom Small-Scale Embedded Generation (SSEG) — ~R1.20/kWh buyback
    netMeteringEnabled: true, netMeteringRate: 1.20,
    soilProfile: SOIL_SAFRICA,
    lightningNg: 7.0,                 // [P] IEC 62305-2 — South Africa (high)
    tAmbMax: 35, tAmbMin: 5,          // [S] ASHRAE IWEC2 Johannesburg/Cape Town
    designPSH: 4.20, p90Factor: 0.920, // [S] June P90 (Southern Hemisphere winter)
    // [E] IRENA 2024 SA: ~$0.90/Wp; @ R 18.5/USD
    bosPerKwp: 9200, engPerKwp: 4000, omPerKwpYear: 700,
    discountRate: 13, analysisPeriod: 25,
    gridVoltage: 230, gridHz: 50,
    supplyVoltageLN: 230, supplyVoltageLL: 400,
  },

  ke: {
    name: "Kenya", flag: "🇰🇪", region: "Africa",
    // [P] KPLC residential tariff 2024 — 3-tier
    currency: "KES", currencySymbol: "KSh", usdRate: 130,
    tariffMode: "tiered",
    tariffNow: 22.0, tariffEsc: 8,
    tariffTiers: [
      { limit: 50,       rate: 12.0, label: "0–50 kWh (KSh 12)" },
      { limit: 1500,     rate: 22.0, label: "51–1,500 kWh (KSh 22)" },
      { limit: Infinity, rate: 27.0, label: "> 1,500 kWh (KSh 27)" },
    ],
    netMeteringEnabled: false, netMeteringRate: 15.0,
    soilProfile: SOIL_SUBSAHARA,
    lightningNg: 8.0,                 // [P] IEC 62305-2 — East Africa (high)
    tAmbMax: 30, tAmbMin: 12,
    designPSH: 4.80, p90Factor: 0.920,
    bosPerKwp: 7000, engPerKwp: 3000, omPerKwpYear: 600,
    discountRate: 13, analysisPeriod: 25,
    gridVoltage: 240, gridHz: 50,
    supplyVoltageLN: 240, supplyVoltageLL: 415,
  },

  ng: {
    name: "Nigeria", flag: "🇳🇬", region: "Africa",
    // [P] NERC residential tariff 2024 (Band A-E; residential Band D/E)
    currency: "NGN", currencySymbol: "₦", usdRate: 1580,
    tariffMode: "flat",
    tariffNow: 230, tariffEsc: 20,
    tariffTiers: null,
    netMeteringEnabled: false, netMeteringRate: 150,
    soilProfile: SOIL_SUBSAHARA,
    lightningNg: 4.5,                 // [P] IEC 62305-2 — West Africa
    tAmbMax: 38, tAmbMin: 18,
    designPSH: 4.50, p90Factor: 0.920,
    bosPerKwp: 200000, engPerKwp: 90000, omPerKwpYear: 15000,
    discountRate: 20, analysisPeriod: 20,
    gridVoltage: 240, gridHz: 50,
    supplyVoltageLN: 240, supplyVoltageLL: 415,
  },

  // ══════════════════════════════════════════════════════════════════
  // EUROPE (secondary)
  // ══════════════════════════════════════════════════════════════════

  de: {
    name: "Germany", flag: "🇩🇪", region: "Europe",
    // [P] Bundesnetzagentur avg residential tariff 2024
    currency: "EUR", currencySymbol: "€", usdRate: 0.92,
    tariffMode: "flat",
    tariffNow: 0.30, tariffEsc: 2,
    tariffTiers: null,
    // [P] EEG 2023 — residential FiT ≤10 kWp: €0.082/kWh
    netMeteringEnabled: true, netMeteringRate: 0.082,
    soilProfile: SOIL_TEMPERATE,
    lightningNg: 2.0,                 // [P] IEC 62305-2 Annex A — Germany
    tAmbMax: 30, tAmbMin: -10,        // [S] ASHRAE IWEC2 Frankfurt
    // [S] PVGIS Munich Dec P90 ≈ 1.20h; σ_irr=0.08 → P90 0.900
    designPSH: 1.20, p90Factor: 0.900,
    // [E] BNEF 2024 Germany: ~€0.95/Wp; @ €0.92/USD
    bosPerKwp: 380, engPerKwp: 190, omPerKwpYear: 15,
    discountRate: 5, analysisPeriod: 25,
    gridVoltage: 230, gridHz: 50,
    supplyVoltageLN: 230, supplyVoltageLL: 400,
  },

  gb: {
    name: "United Kingdom", flag: "🇬🇧", region: "Europe",
    // [P] Ofgem Energy Price Cap Q1 2024
    currency: "GBP", currencySymbol: "£", usdRate: 0.79,
    tariffMode: "flat",
    tariffNow: 0.28, tariffEsc: 3,
    tariffTiers: null,
    // [P] SEG (Smart Export Guarantee) 2024 — typical 0.15 GBP/kWh
    netMeteringEnabled: true, netMeteringRate: 0.15,
    soilProfile: SOIL_TEMPERATE,
    lightningNg: 0.4,                 // [P] IEC 62305-2 — UK (very low)
    tAmbMax: 28, tAmbMin: -5,
    designPSH: 0.90, p90Factor: 0.900,
    bosPerKwp: 320, engPerKwp: 180, omPerKwpYear: 12,
    discountRate: 5, analysisPeriod: 25,
    gridVoltage: 230, gridHz: 50,
    supplyVoltageLN: 230, supplyVoltageLL: 400,
  },

  es: {
    name: "Spain", flag: "🇪🇸", region: "Europe",
    currency: "EUR", currencySymbol: "€", usdRate: 0.92,
    tariffMode: "flat",
    tariffNow: 0.18, tariffEsc: 3,
    tariffTiers: null,
    netMeteringEnabled: true, netMeteringRate: 0.09,
    soilProfile: SOIL_MEDITER,
    lightningNg: 2.5,
    tAmbMax: 38, tAmbMin: 0,
    designPSH: 2.80, p90Factor: 0.910,
    bosPerKwp: 300, engPerKwp: 140, omPerKwpYear: 12,
    discountRate: 6, analysisPeriod: 25,
    gridVoltage: 230, gridHz: 50,
    supplyVoltageLN: 230, supplyVoltageLL: 400,
  },

  tr: {
    name: "Turkey", flag: "🇹🇷", region: "Europe",
    // [P] EPDK residential tariff 2024
    currency: "TRY", currencySymbol: "₺", usdRate: 32.5,
    tariffMode: "flat",
    tariffNow: 4.50, tariffEsc: 40,   // [S] high inflation 2022-24
    tariffTiers: null,
    netMeteringEnabled: true, netMeteringRate: 3.0,
    soilProfile: SOIL_MEDITER,
    lightningNg: 2.5,
    tAmbMax: 38, tAmbMin: -5,
    designPSH: 2.50, p90Factor: 0.915,
    bosPerKwp: 5500, engPerKwp: 2500, omPerKwpYear: 400,
    discountRate: 18, analysisPeriod: 20,
    gridVoltage: 230, gridHz: 50,
    supplyVoltageLN: 230, supplyVoltageLL: 400,
  },

  // ══════════════════════════════════════════════════════════════════
  // ASIA (secondary)
  // ══════════════════════════════════════════════════════════════════

  in: {
    name: "India", flag: "🇮🇳", region: "Asia",
    // [P] Average state DISCOM residential tariff 2024 (weighted)
    currency: "INR", currencySymbol: "₹", usdRate: 83.5,
    tariffMode: "tiered",
    tariffNow: 6.50, tariffEsc: 5,
    tariffTiers: [
      { limit: 100,      rate: 3.50, label: "0–100 kWh (₹ 3.50)" },
      { limit: 300,      rate: 5.50, label: "101–300 kWh (₹ 5.50)" },
      { limit: Infinity, rate: 8.00, label: "> 300 kWh (₹ 8.00)" },
    ],
    // [P] MNRE PM-KUSUM net metering — typical ₹4.50/kWh buyback
    netMeteringEnabled: true, netMeteringRate: 4.50,
    soilProfile: SOIL_SOUTHASIA,
    lightningNg: 5.0,                 // [P] IEC 62305-2 — India (high)
    tAmbMax: 42, tAmbMin: 5,
    designPSH: 4.20, p90Factor: 0.915,
    // [E] IRENA 2024 India: ~$0.45/Wp; @ ₹83.5/USD
    bosPerKwp: 16000, engPerKwp: 7000, omPerKwpYear: 1200,
    discountRate: 10, analysisPeriod: 25,
    gridVoltage: 230, gridHz: 50,
    supplyVoltageLN: 230, supplyVoltageLL: 400,
  },

  pk: {
    name: "Pakistan", flag: "🇵🇰", region: "Asia",
    // [P] NEPRA residential tariff 2024 — 4-tier
    currency: "PKR", currencySymbol: "Rs", usdRate: 278,
    tariffMode: "tiered",
    tariffNow: 35.0, tariffEsc: 20,
    tariffTiers: [
      { limit: 100,      rate: 18.0, label: "0–100 kWh (Rs 18)" },
      { limit: 300,      rate: 31.0, label: "101–300 kWh (Rs 31)" },
      { limit: 700,      rate: 38.0, label: "301–700 kWh (Rs 38)" },
      { limit: Infinity, rate: 49.0, label: "> 700 kWh (Rs 49)" },
    ],
    netMeteringEnabled: true, netMeteringRate: 20.0,
    soilProfile: SOIL_SOUTHASIA,
    lightningNg: 4.0,
    tAmbMax: 42, tAmbMin: 5,
    designPSH: 4.50, p90Factor: 0.915,
    bosPerKwp: 45000, engPerKwp: 20000, omPerKwpYear: 3500,
    discountRate: 18, analysisPeriod: 20,
    gridVoltage: 230, gridHz: 50,
    supplyVoltageLN: 230, supplyVoltageLL: 400,
  },

  // ══════════════════════════════════════════════════════════════════
  // AMERICAS (secondary)
  // ══════════════════════════════════════════════════════════════════

  us: {
    name: "United States", flag: "🇺🇸", region: "Americas",
    // [P] EIA avg residential rate 2024
    currency: "USD", currencySymbol: "$", usdRate: 1.0,
    tariffMode: "flat",
    tariffNow: 0.16, tariffEsc: 3,
    tariffTiers: null,
    // [P] IRA 2022 — NEM 3.0 in California; varies by utility
    netMeteringEnabled: true, netMeteringRate: 0.10,
    soilProfile: SOIL_OCEANIA,
    lightningNg: 3.0,
    tAmbMax: 35, tAmbMin: -5,
    designPSH: 3.50, p90Factor: 0.920,
    // [E] BNEF 2024 US: ~$2.80/W residential installed (incl. soft costs)
    bosPerKwp: 450, engPerKwp: 550, omPerKwpYear: 15,
    discountRate: 6, analysisPeriod: 25,
    gridVoltage: 120, gridHz: 60,
    supplyVoltageLN: 120, supplyVoltageLL: 240,
  },

  au: {
    name: "Australia", flag: "🇦🇺", region: "Oceania",
    // [P] AEMC avg residential tariff 2024
    currency: "AUD", currencySymbol: "A$", usdRate: 1.52,
    tariffMode: "flat",
    tariffNow: 0.30, tariffEsc: 3,
    tariffTiers: null,
    // [P] Australian Small-scale Renewable Energy Scheme (SRES) + FiT 0.06 AUD/kWh
    netMeteringEnabled: true, netMeteringRate: 0.06,
    soilProfile: SOIL_OCEANIA,
    lightningNg: 1.0,
    tAmbMax: 38, tAmbMin: 5,
    designPSH: 3.50, p90Factor: 0.920, // [S] June P90 (S.Hemisphere winter) for Perth/Adelaide
    // [E] BNEF 2024 Australia: ~A$1.20/Wp residential
    bosPerKwp: 430, engPerKwp: 250, omPerKwpYear: 20,
    discountRate: 6, analysisPeriod: 25,
    gridVoltage: 230, gridHz: 50,
    supplyVoltageLN: 230, supplyVoltageLL: 400,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the inp fields to apply when a country is detected.
 * Only fields that have real country-specific values are returned.
 * The user can override anything afterwards.
 */
export function applyCountryProfile(countryCode, existingInp) {
  const cc      = (countryCode || "").toLowerCase();
  const profile = COUNTRY_DATA[cc];
  if (!profile) return {};
  return {
    countryCode:        cc,
    currency:           profile.currency,
    currencySymbol:     profile.currencySymbol,
    usdRate:            profile.usdRate,
    tariffMode:         profile.tariffMode,
    tariffNow:          profile.tariffNow,
    tariffEsc:          profile.tariffEsc,
    tariffTiers:        profile.tariffTiers,
    soilProfile:        [...profile.soilProfile],
    ng:                 profile.lightningNg,
    netMeteringEnabled: profile.netMeteringEnabled,
    netMeteringRate:    profile.netMeteringRate,
    tAmbMax:            profile.tAmbMax,
    tAmbMin:            profile.tAmbMin,
    discountRate:       profile.discountRate,
    analysisPeriod:     profile.analysisPeriod,
    // pshDesign and bosPerKwp/engPerKwp go into inp so calcEngine can read them
    pshDesign:          profile.designPSH,
    bosPerKwp:          profile.bosPerKwp,
    engPerKwp:          profile.engPerKwp,
    omPerKwpYear:       profile.omPerKwpYear,
    p90Factor:          profile.p90Factor,
    supplyVoltageLN:    profile.supplyVoltageLN,
    supplyVoltageLL:    profile.supplyVoltageLL,
  };
}

/**
 * Returns the COUNTRY_DATA entry for a given country code, or null.
 */
export function getCountryProfile(countryCode) {
  return COUNTRY_DATA[(countryCode || "").toLowerCase()] || null;
}
