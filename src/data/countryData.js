/**
 * Country profiles for the solar design platform.
 * Each entry provides: tariff structure, soiling profile, lightning Ng,
 * currency, and grid parameters. All tariff rates are in local currency/kWh.
 * Soiling fractions are monthly (Jan–Dec).
 * Sources: PVGIS/JRC, IEA PVPS Task 13, IEC 62305-2 Annex A, utility tariff schedules.
 */

import { EGYPT_TARIFF_TIERS } from "../lib/financial.js";

// ── Soiling profile presets (monthly, Jan–Dec) ──────────────────────────────
// Khamsin/Gulf: spring dust storms Mar–May, otherwise low
const SOIL_KHAMSIN   = [0.02,0.02,0.09,0.11,0.08,0.02,0.02,0.02,0.02,0.03,0.02,0.02];
// Arabian Gulf: slightly lower peak, persistent fine dust
const SOIL_GULF      = [0.03,0.03,0.07,0.09,0.07,0.03,0.03,0.03,0.03,0.03,0.03,0.03];
// Mediterranean: dry summer dust, rain-washed winters
const SOIL_MEDITER   = [0.01,0.01,0.02,0.03,0.03,0.04,0.04,0.04,0.02,0.01,0.01,0.01];
// Temperate Europe: low and uniform — frequent rain washing
const SOIL_TEMPERATE = [0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01];
// South Asia: pre-monsoon dust Apr–Jun, wet Jul–Sep
const SOIL_SOUTHASIA = [0.02,0.03,0.04,0.06,0.07,0.04,0.02,0.02,0.02,0.03,0.02,0.02];
// Sub-Saharan: moderate year-round, harmattan in Nov–Feb (West Africa)
const SOIL_SUBSAHARA = [0.04,0.04,0.03,0.03,0.02,0.02,0.02,0.02,0.02,0.02,0.03,0.04];
// Southern Africa: dry June–Aug (Southern Hemisphere winter = dry)
const SOIL_SAFRICA   = [0.02,0.02,0.02,0.03,0.04,0.05,0.05,0.04,0.03,0.02,0.02,0.02];
// Tropical: very low — frequent rainfall washes panels year-round
const SOIL_TROPICAL  = [0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01];
// Pacific/Oceania: low, dry summers in southeast
const SOIL_OCEANIA   = [0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.01,0.01];

// ── Country profiles ─────────────────────────────────────────────────────────
export const COUNTRY_DATA = {

  // ── Middle East & North Africa ────────────────────────────────────────────

  eg: {
    name: "Egypt", flag: "🇪🇬",
    currency: "EGP", currencySymbol: "E£", usdRate: 55,
    tariffMode: "tiered",
    tariffNow: 1.95, tariffEsc: 18,
    tariffTiers: EGYPT_TARIFF_TIERS,
    soilProfile: SOIL_KHAMSIN,
    lightningNg: 2.0,
    netMeteringEnabled: false, netMeteringRate: 0.50,
    gridVoltage: 220, gridHz: 50,
  },

  sa: {
    name: "Saudi Arabia", flag: "🇸🇦",
    currency: "SAR", currencySymbol: "SR", usdRate: 3.75,
    tariffMode: "tiered",
    tariffNow: 0.18, tariffEsc: 5,
    tariffTiers: [
      { limit: 2000, rate: 0.18, label: "≤ 2,000 kWh/mo (SAR 0.18)" },
      { limit: Infinity, rate: 0.32, label: "> 2,000 kWh/mo (SAR 0.32)" },
    ],
    soilProfile: SOIL_GULF,
    lightningNg: 0.8,
    netMeteringEnabled: true, netMeteringRate: 0.16,
    gridVoltage: 220, gridHz: 60,
  },

  ae: {
    name: "United Arab Emirates", flag: "🇦🇪",
    currency: "AED", currencySymbol: "AED", usdRate: 3.67,
    tariffMode: "tiered",
    tariffNow: 0.23, tariffEsc: 4,
    tariffTiers: [
      { limit: 2000, rate: 0.23, label: "0–2,000 kWh (AED 0.23)" },
      { limit: 4000, rate: 0.28, label: "2,001–4,000 kWh (AED 0.28)" },
      { limit: 6000, rate: 0.32, label: "4,001–6,000 kWh (AED 0.32)" },
      { limit: Infinity, rate: 0.38, label: "> 6,000 kWh (AED 0.38)" },
    ],
    soilProfile: SOIL_GULF,
    lightningNg: 0.3,
    netMeteringEnabled: true, netMeteringRate: 0.20,
    gridVoltage: 220, gridHz: 50,
  },

  jo: {
    name: "Jordan", flag: "🇯🇴",
    currency: "JOD", currencySymbol: "JD", usdRate: 0.71,
    tariffMode: "tiered",
    tariffNow: 0.065, tariffEsc: 6,
    tariffTiers: [
      { limit: 160,       rate: 0.033, label: "0–160 kWh (fils 33)" },
      { limit: 300,       rate: 0.062, label: "161–300 kWh (fils 62)" },
      { limit: 500,       rate: 0.089, label: "301–500 kWh (fils 89)" },
      { limit: 600,       rate: 0.103, label: "501–600 kWh (fils 103)" },
      { limit: Infinity,  rate: 0.118, label: "> 600 kWh (fils 118)" },
    ],
    soilProfile: SOIL_KHAMSIN,
    lightningNg: 1.5,
    netMeteringEnabled: true, netMeteringRate: 0.06,
    gridVoltage: 230, gridHz: 50,
  },

  ma: {
    name: "Morocco", flag: "🇲🇦",
    currency: "MAD", currencySymbol: "DH", usdRate: 10.0,
    tariffMode: "tiered",
    tariffNow: 1.14, tariffEsc: 5,
    tariffTiers: [
      { limit: 100,      rate: 0.90,  label: "0–100 kWh (DH 0.90)" },
      { limit: 200,      rate: 1.04,  label: "101–200 kWh (DH 1.04)" },
      { limit: 500,      rate: 1.28,  label: "201–500 kWh (DH 1.28)" },
      { limit: Infinity, rate: 1.50,  label: "> 500 kWh (DH 1.50)" },
    ],
    soilProfile: [0.02,0.02,0.05,0.07,0.06,0.03,0.02,0.02,0.02,0.03,0.02,0.02],
    lightningNg: 1.5,
    netMeteringEnabled: true, netMeteringRate: 0.80,
    gridVoltage: 220, gridHz: 50,
  },

  tn: {
    name: "Tunisia", flag: "🇹🇳",
    currency: "TND", currencySymbol: "DT", usdRate: 3.15,
    tariffMode: "flat",
    tariffNow: 0.155, tariffEsc: 6,
    tariffTiers: null,
    soilProfile: SOIL_MEDITER,
    lightningNg: 1.5,
    netMeteringEnabled: false, netMeteringRate: 0.10,
    gridVoltage: 230, gridHz: 50,
  },

  om: {
    name: "Oman", flag: "🇴🇲",
    currency: "OMR", currencySymbol: "RO", usdRate: 0.385,
    tariffMode: "flat",
    tariffNow: 0.025, tariffEsc: 5,
    tariffTiers: null,
    soilProfile: SOIL_GULF,
    lightningNg: 0.5,
    netMeteringEnabled: true, netMeteringRate: 0.020,
    gridVoltage: 240, gridHz: 50,
  },

  kw: {
    name: "Kuwait", flag: "🇰🇼",
    currency: "KWD", currencySymbol: "KD", usdRate: 0.307,
    tariffMode: "flat",
    tariffNow: 0.002, tariffEsc: 3,
    tariffTiers: null,
    soilProfile: SOIL_GULF,
    lightningNg: 0.3,
    netMeteringEnabled: false, netMeteringRate: 0.002,
    gridVoltage: 240, gridHz: 50,
  },

  qa: {
    name: "Qatar", flag: "🇶🇦",
    currency: "QAR", currencySymbol: "QR", usdRate: 3.64,
    tariffMode: "flat",
    tariffNow: 0.028, tariffEsc: 3,
    tariffTiers: null,
    soilProfile: SOIL_GULF,
    lightningNg: 0.3,
    netMeteringEnabled: false, netMeteringRate: 0.025,
    gridVoltage: 240, gridHz: 50,
  },

  bh: {
    name: "Bahrain", flag: "🇧🇭",
    currency: "BHD", currencySymbol: "BD", usdRate: 0.376,
    tariffMode: "flat",
    tariffNow: 0.012, tariffEsc: 4,
    tariffTiers: null,
    soilProfile: SOIL_GULF,
    lightningNg: 0.3,
    netMeteringEnabled: false, netMeteringRate: 0.010,
    gridVoltage: 230, gridHz: 50,
  },

  // ── Africa ────────────────────────────────────────────────────────────────

  za: {
    name: "South Africa", flag: "🇿🇦",
    currency: "ZAR", currencySymbol: "R", usdRate: 18.5,
    tariffMode: "flat",
    tariffNow: 3.50, tariffEsc: 12,
    tariffTiers: null,
    soilProfile: SOIL_SAFRICA,
    lightningNg: 7.0,
    netMeteringEnabled: true, netMeteringRate: 1.20,
    gridVoltage: 230, gridHz: 50,
  },

  ke: {
    name: "Kenya", flag: "🇰🇪",
    currency: "KES", currencySymbol: "KSh", usdRate: 130,
    tariffMode: "tiered",
    tariffNow: 22.0, tariffEsc: 8,
    tariffTiers: [
      { limit: 50,       rate: 12.0,  label: "0–50 kWh (KSh 12)" },
      { limit: 1500,     rate: 22.0,  label: "51–1,500 kWh (KSh 22)" },
      { limit: Infinity, rate: 27.0,  label: "> 1,500 kWh (KSh 27)" },
    ],
    soilProfile: SOIL_SUBSAHARA,
    lightningNg: 8.0,
    netMeteringEnabled: false, netMeteringRate: 15.0,
    gridVoltage: 240, gridHz: 50,
  },

  ng: {
    name: "Nigeria", flag: "🇳🇬",
    currency: "NGN", currencySymbol: "₦", usdRate: 1580,
    tariffMode: "flat",
    tariffNow: 230, tariffEsc: 20,
    tariffTiers: null,
    soilProfile: SOIL_SUBSAHARA,
    lightningNg: 4.5,
    netMeteringEnabled: false, netMeteringRate: 150,
    gridVoltage: 240, gridHz: 50,
  },

  gh: {
    name: "Ghana", flag: "🇬🇭",
    currency: "GHS", currencySymbol: "GH₵", usdRate: 15.5,
    tariffMode: "flat",
    tariffNow: 0.85, tariffEsc: 15,
    tariffTiers: null,
    soilProfile: SOIL_SUBSAHARA,
    lightningNg: 5.0,
    netMeteringEnabled: false, netMeteringRate: 0.60,
    gridVoltage: 240, gridHz: 50,
  },

  // ── Europe ────────────────────────────────────────────────────────────────

  de: {
    name: "Germany", flag: "🇩🇪",
    currency: "EUR", currencySymbol: "€", usdRate: 0.92,
    tariffMode: "flat",
    tariffNow: 0.30, tariffEsc: 2,
    tariffTiers: null,
    soilProfile: SOIL_TEMPERATE,
    lightningNg: 2.0,
    netMeteringEnabled: true, netMeteringRate: 0.082,
    gridVoltage: 230, gridHz: 50,
  },

  gb: {
    name: "United Kingdom", flag: "🇬🇧",
    currency: "GBP", currencySymbol: "£", usdRate: 0.79,
    tariffMode: "flat",
    tariffNow: 0.28, tariffEsc: 3,
    tariffTiers: null,
    soilProfile: SOIL_TEMPERATE,
    lightningNg: 0.4,
    netMeteringEnabled: true, netMeteringRate: 0.15,
    gridVoltage: 230, gridHz: 50,
  },

  es: {
    name: "Spain", flag: "🇪🇸",
    currency: "EUR", currencySymbol: "€", usdRate: 0.92,
    tariffMode: "flat",
    tariffNow: 0.18, tariffEsc: 3,
    tariffTiers: null,
    soilProfile: SOIL_MEDITER,
    lightningNg: 2.5,
    netMeteringEnabled: true, netMeteringRate: 0.09,
    gridVoltage: 230, gridHz: 50,
  },

  it: {
    name: "Italy", flag: "🇮🇹",
    currency: "EUR", currencySymbol: "€", usdRate: 0.92,
    tariffMode: "flat",
    tariffNow: 0.28, tariffEsc: 3,
    tariffTiers: null,
    soilProfile: SOIL_MEDITER,
    lightningNg: 3.0,
    netMeteringEnabled: true, netMeteringRate: 0.10,
    gridVoltage: 230, gridHz: 50,
  },

  fr: {
    name: "France", flag: "🇫🇷",
    currency: "EUR", currencySymbol: "€", usdRate: 0.92,
    tariffMode: "flat",
    tariffNow: 0.22, tariffEsc: 2,
    tariffTiers: null,
    soilProfile: SOIL_TEMPERATE,
    lightningNg: 1.5,
    netMeteringEnabled: true, netMeteringRate: 0.10,
    gridVoltage: 230, gridHz: 50,
  },

  nl: {
    name: "Netherlands", flag: "🇳🇱",
    currency: "EUR", currencySymbol: "€", usdRate: 0.92,
    tariffMode: "flat",
    tariffNow: 0.28, tariffEsc: 2,
    tariffTiers: null,
    soilProfile: SOIL_TEMPERATE,
    lightningNg: 0.6,
    netMeteringEnabled: true, netMeteringRate: 0.09,
    gridVoltage: 230, gridHz: 50,
  },

  gr: {
    name: "Greece", flag: "🇬🇷",
    currency: "EUR", currencySymbol: "€", usdRate: 0.92,
    tariffMode: "flat",
    tariffNow: 0.20, tariffEsc: 3,
    tariffTiers: null,
    soilProfile: SOIL_MEDITER,
    lightningNg: 3.0,
    netMeteringEnabled: true, netMeteringRate: 0.08,
    gridVoltage: 230, gridHz: 50,
  },

  tr: {
    name: "Turkey", flag: "🇹🇷",
    currency: "TRY", currencySymbol: "₺", usdRate: 32.5,
    tariffMode: "flat",
    tariffNow: 4.50, tariffEsc: 40,
    tariffTiers: null,
    soilProfile: SOIL_MEDITER,
    lightningNg: 2.5,
    netMeteringEnabled: true, netMeteringRate: 3.0,
    gridVoltage: 230, gridHz: 50,
  },

  // ── Asia ─────────────────────────────────────────────────────────────────

  in: {
    name: "India", flag: "🇮🇳",
    currency: "INR", currencySymbol: "₹", usdRate: 83.5,
    tariffMode: "tiered",
    tariffNow: 6.50, tariffEsc: 5,
    tariffTiers: [
      { limit: 100,      rate: 3.50,  label: "0–100 kWh (₹ 3.50)" },
      { limit: 300,      rate: 5.50,  label: "101–300 kWh (₹ 5.50)" },
      { limit: Infinity, rate: 8.00,  label: "> 300 kWh (₹ 8.00)" },
    ],
    soilProfile: SOIL_SOUTHASIA,
    lightningNg: 5.0,
    netMeteringEnabled: true, netMeteringRate: 4.50,
    gridVoltage: 230, gridHz: 50,
  },

  pk: {
    name: "Pakistan", flag: "🇵🇰",
    currency: "PKR", currencySymbol: "Rs", usdRate: 278,
    tariffMode: "tiered",
    tariffNow: 35.0, tariffEsc: 20,
    tariffTiers: [
      { limit: 100,      rate: 18.0,  label: "0–100 kWh (Rs 18)" },
      { limit: 300,      rate: 31.0,  label: "101–300 kWh (Rs 31)" },
      { limit: 700,      rate: 38.0,  label: "301–700 kWh (Rs 38)" },
      { limit: Infinity, rate: 49.0,  label: "> 700 kWh (Rs 49)" },
    ],
    soilProfile: SOIL_SOUTHASIA,
    lightningNg: 4.0,
    netMeteringEnabled: true, netMeteringRate: 20.0,
    gridVoltage: 230, gridHz: 50,
  },

  bd: {
    name: "Bangladesh", flag: "🇧🇩",
    currency: "BDT", currencySymbol: "৳", usdRate: 110,
    tariffMode: "tiered",
    tariffNow: 10.5, tariffEsc: 8,
    tariffTiers: [
      { limit: 75,       rate: 6.0,   label: "0–75 kWh (৳ 6)" },
      { limit: 200,      rate: 9.50,  label: "76–200 kWh (৳ 9.50)" },
      { limit: 300,      rate: 11.00, label: "201–300 kWh (৳ 11)" },
      { limit: Infinity, rate: 13.00, label: "> 300 kWh (৳ 13)" },
    ],
    soilProfile: SOIL_TROPICAL,
    lightningNg: 8.0,
    netMeteringEnabled: false, netMeteringRate: 7.0,
    gridVoltage: 220, gridHz: 50,
  },

  jp: {
    name: "Japan", flag: "🇯🇵",
    currency: "JPY", currencySymbol: "¥", usdRate: 153,
    tariffMode: "tiered",
    tariffNow: 30.0, tariffEsc: 3,
    tariffTiers: [
      { limit: 120,      rate: 22.0,  label: "0–120 kWh (¥ 22)" },
      { limit: 300,      rate: 30.0,  label: "121–300 kWh (¥ 30)" },
      { limit: Infinity, rate: 36.0,  label: "> 300 kWh (¥ 36)" },
    ],
    soilProfile: [0.01,0.01,0.02,0.02,0.02,0.02,0.01,0.01,0.01,0.01,0.01,0.01],
    lightningNg: 3.0,
    netMeteringEnabled: true, netMeteringRate: 16.0,
    gridVoltage: 100, gridHz: 50,
  },

  cn: {
    name: "China", flag: "🇨🇳",
    currency: "CNY", currencySymbol: "¥", usdRate: 7.24,
    tariffMode: "tiered",
    tariffNow: 0.55, tariffEsc: 3,
    tariffTiers: [
      { limit: 2400,     rate: 0.50,  label: "0–2,400 kWh/yr (¥ 0.50)" },
      { limit: 4800,     rate: 0.55,  label: "2,401–4,800 kWh/yr (¥ 0.55)" },
      { limit: Infinity, rate: 0.80,  label: "> 4,800 kWh/yr (¥ 0.80)" },
    ],
    soilProfile: SOIL_SOUTHASIA,
    lightningNg: 4.0,
    netMeteringEnabled: true, netMeteringRate: 0.36,
    gridVoltage: 220, gridHz: 50,
  },

  // ── Australia / Pacific ──────────────────────────────────────────────────

  au: {
    name: "Australia", flag: "🇦🇺",
    currency: "AUD", currencySymbol: "A$", usdRate: 1.52,
    tariffMode: "flat",
    tariffNow: 0.30, tariffEsc: 3,
    tariffTiers: null,
    soilProfile: SOIL_OCEANIA,
    lightningNg: 1.0,
    netMeteringEnabled: true, netMeteringRate: 0.06,
    gridVoltage: 230, gridHz: 50,
  },

  nz: {
    name: "New Zealand", flag: "🇳🇿",
    currency: "NZD", currencySymbol: "NZ$", usdRate: 1.62,
    tariffMode: "flat",
    tariffNow: 0.28, tariffEsc: 3,
    tariffTiers: null,
    soilProfile: SOIL_OCEANIA,
    lightningNg: 0.6,
    netMeteringEnabled: true, netMeteringRate: 0.08,
    gridVoltage: 230, gridHz: 50,
  },

  // ── Americas ─────────────────────────────────────────────────────────────

  us: {
    name: "United States", flag: "🇺🇸",
    currency: "USD", currencySymbol: "$", usdRate: 1.0,
    tariffMode: "flat",
    tariffNow: 0.16, tariffEsc: 3,
    tariffTiers: null,
    soilProfile: SOIL_OCEANIA,
    lightningNg: 3.0,
    netMeteringEnabled: true, netMeteringRate: 0.10,
    gridVoltage: 120, gridHz: 60,
  },

  mx: {
    name: "Mexico", flag: "🇲🇽",
    currency: "MXN", currencySymbol: "MX$", usdRate: 17.5,
    tariffMode: "tiered",
    tariffNow: 1.20, tariffEsc: 7,
    tariffTiers: [
      { limit: 150,      rate: 0.80,  label: "0–150 kWh (MX$ 0.80)" },
      { limit: 300,      rate: 1.00,  label: "151–300 kWh (MX$ 1.00)" },
      { limit: Infinity, rate: 2.50,  label: "> 300 kWh (MX$ 2.50)" },
    ],
    soilProfile: [0.02,0.02,0.03,0.04,0.03,0.02,0.02,0.02,0.02,0.02,0.02,0.02],
    lightningNg: 3.5,
    netMeteringEnabled: true, netMeteringRate: 0.80,
    gridVoltage: 120, gridHz: 60,
  },

  br: {
    name: "Brazil", flag: "🇧🇷",
    currency: "BRL", currencySymbol: "R$", usdRate: 5.0,
    tariffMode: "flat",
    tariffNow: 0.75, tariffEsc: 6,
    tariffTiers: null,
    soilProfile: SOIL_TROPICAL,
    lightningNg: 10.0,
    netMeteringEnabled: true, netMeteringRate: 0.45,
    gridVoltage: 127, gridHz: 60,
  },

  co: {
    name: "Colombia", flag: "🇨🇴",
    currency: "COP", currencySymbol: "COP", usdRate: 4000,
    tariffMode: "flat",
    tariffNow: 750, tariffEsc: 8,
    tariffTiers: null,
    soilProfile: SOIL_TROPICAL,
    lightningNg: 8.0,
    netMeteringEnabled: true, netMeteringRate: 500,
    gridVoltage: 120, gridHz: 60,
  },

  cl: {
    name: "Chile", flag: "🇨🇱",
    currency: "CLP", currencySymbol: "CLP$", usdRate: 920,
    tariffMode: "flat",
    tariffNow: 130, tariffEsc: 5,
    tariffTiers: null,
    soilProfile: [0.01,0.01,0.02,0.02,0.03,0.04,0.04,0.03,0.02,0.01,0.01,0.01],
    lightningNg: 1.5,
    netMeteringEnabled: true, netMeteringRate: 80,
    gridVoltage: 220, gridHz: 50,
  },
};

/**
 * Returns the fields to apply to `inp` when a country is detected.
 * Only updates fields that have real country-specific values.
 * The user can override anything afterwards.
 */
export function applyCountryProfile(countryCode, existingInp) {
  const cc  = (countryCode || "").toLowerCase();
  const profile = COUNTRY_DATA[cc];
  if (!profile) return {};   // unknown country — don't overwrite anything
  return {
    countryCode:          cc,
    currency:             profile.currency,
    currencySymbol:       profile.currencySymbol,
    usdRate:              profile.usdRate,
    tariffMode:           profile.tariffMode,
    tariffNow:            profile.tariffNow,
    tariffEsc:            profile.tariffEsc,
    tariffTiers:          profile.tariffTiers,
    soilProfile:          [...profile.soilProfile],
    ng:                   profile.lightningNg,
    netMeteringEnabled:   profile.netMeteringEnabled,
    netMeteringRate:      profile.netMeteringRate,
  };
}
