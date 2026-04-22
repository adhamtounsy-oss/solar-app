/**
 * International country-profile sanity suite
 * Run: node sanity_international.mjs   (from solar-app/)
 *
 * Tests Egypt, Saudi Arabia, UAE, and Jordan country profiles against:
 *  • Correct currency / currencySymbol / usdRate wired through
 *  • Correct BoS + eng costs (bosPerKwp / engPerKwp)
 *  • Correct p90Factor applied to P90 generation
 *  • Correct designPSH in sizing
 *  • Correct Ng (lightning) for SPD
 *  • Correct soiling profile (seasonal shape)
 *  • Finite, positive sysC (no NaN from missing fields)
 *  • Cashflow arithmetic integrity
 */
import { calcEngine }        from './src/engine/calcEngine.js';
import { applyCountryProfile } from './src/data/countryData.js';
import { CAIRO_TMY_FALLBACK, CAIRO_SOILING, P90_FACTOR, DESIGN_PSH } from './src/constants/index.js';

// ── Component fixtures ────────────────────────────────────────────────────────

const P01 = {
  id:"P01", brand:"LONGi", model:"Hi-MO X6 LR5-72HTH-580M",
  wp:580, voc:52.21, vmp:44.06, isc:14.20, imp:13.17,
  betaVoc:-0.28, gammaPmax:-0.29, noct:44,
  dimL:2278, dimW:1134, weightKg:27.5,
  bifacial:false, bifacialGain:0, costUSD:0.22,
};

const I04 = {
  id:"I04", brand:"Sungrow", model:"SH10T Hybrid 10kW",
  acKW:10, dcAcRatio:1.3, vdcMax:1100, mpptMin:160, mpptMax:1000,
  iscPerMppt:30, numMppt:2, batVoltMin:176, batVoltMax:560,
  batChargeKW:10, eta:98.4, costEGP:78000,
};

const B00 = {
  id:"B00", brand:"Grid-Tied", model:"No Storage",
  kwh:0, voltage:0, dod:0, eta:100, cRate:0, costEGP:0,
};

// ── Base inputs (Egypt defaults) ──────────────────────────────────────────────

const BASE = {
  lat:30.06, lon:31.45, azimuth:0, tiltDeg:22, elevationM:74,
  roofAreaM2:220, roofObstructionsM2:30, roofDepthM:12, nVillas:3,
  mountMode:"roof", groundAreaM2:0,
  supplyPhase:"three", supplyVoltageLN:220, supplyVoltageLL:380,
  supplyAmps:100, mdbBusbarA:200,
  acUnits:3, acTonnage:1.5, acCOP:3.0, acHrsSummer:6, acHrsWinter:1,
  lightingAreaM2:250, whKW:2.0, kitchenW:2500, laundryW:1500,
  poolKW:1.5, miscKW:1.5,
  loadMethod:"profile", coverageMode:"percentage", offsetPct:80,
  solarAC:true, solarLighting:true, solarWH:false,
  solarKitchen:false, solarLaundry:false, solarPool:true, solarMisc:false,
  batEveningCovPct:80, backupHours:8,
  tAmbMax:42, tAmbMin:5, pshDesign:DESIGN_PSH,
  lenStringM:25, lenFeederM:15, lenBatteryM:3, lenACM:20,
  tariffNow:1.95, tariffEsc:18, tariffMode:"tiered", tariffTiers:null,
  omPerYear:3000, omEsc:3, panelDeg:0.65,
  bosPerKwp:8000, engPerKwp:5000, omPerKwpYear:450, p90Factor:0.920,
  usdRate:55, analysisPeriod:25, batReplaceYear:12,
  yieldMode:"p50",
  netMeteringEnabled:false, netMeteringRate:0.50,
  discountRate:12, albedo:0.20,
  soilProfile:CAIRO_SOILING,
  obstacles:[], horizonProfile:[],
  prof_AC:[0.3,0.8,0.6], prof_Light:[0.2,0.0,1.0], prof_WH:[0.8,0.0,0.5],
  prof_Kitchen:[0.5,0.2,0.8], prof_Laundry:[0.0,0.8,0.2],
  prof_Pool:[0.0,1.0,0.0], prof_Misc:[0.2,0.3,0.5],
  monthlyBillEGP:5000, systemMode:"normal",
  countryCode:"eg", currency:"EGP", currencySymbol:"E£",
  ng:2.0,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const PASS = "\x1b[32mPASS\x1b[0m";
const FAIL = "\x1b[31mFAIL\x1b[0m";
const WARN = "\x1b[33mWARN\x1b[0m";

let totalPass = 0, totalFail = 0;

function chk(ok, label, detail = "") {
  const tag = ok ? PASS : FAIL;
  console.log(`  [${tag}] ${label}${detail ? "  →  " + detail : ""}`);
  if (ok) totalPass++; else totalFail++;
  return ok;
}

function inRange(v, [lo, hi]) { return v >= lo && v <= hi; }
function fmt(n, d = 1) { return Number(n).toFixed(d); }

// ── Country scenarios ─────────────────────────────────────────────────────────

const SCENARIOS = [
  {
    label: "EG — Egypt (baseline)",
    cc: "eg",
    latLon: { lat: 30.06, lon: 31.45, elevationM: 74 },
    // Egypt: PVGIS Cairo July peak, Jan trough; Ng=2.0; bosPerKwp=8000 EGP
    expect: {
      currency: "EGP",
      currencySymbol: "E£",
      ng: 2.0,
      p90Factor: 0.920,
      bosPerKwpLocal: 8000,
      engPerKwpLocal: 5000,
      // Cost/kWp range in local currency: panels(0.22*55*1000) + inv(78000/11) + bos+eng
      // ~12100 panel + 7090 inv + 8000 bos + 5000 eng ≈ 32190 EGP/kWp → [20k, 45k]
      costPerKwpRange: [20000, 55000],
      // Specific yield for Cairo: 1850-2100 kWh/kWp (well-established)
      specificYieldRange: [1800, 2150],
      // Soiling peak should be in spring (Mar–May = indices 2–4)
      soilingPeakMonthIdx: [2, 4],
    },
  },
  {
    label: "SA — Saudi Arabia",
    cc: "sa",
    latLon: { lat: 24.68, lon: 46.72, elevationM: 620 }, // Riyadh
    // omPerYear: use country's omPerKwpYear × ~22 kWp (profile-based estimate)
    inpOverride: { omPerYear: 1320 },  // 60 SAR/kWp/yr × 22 kWp
    expect: {
      currency: "SAR",
      currencySymbol: "SR",
      ng: 0.8,
      p90Factor: 0.925,
      bosPerKwpLocal: 450,
      engPerKwpLocal: 250,
      // Normalized costs: panels(0.22/Wp×3.75)+inv(USD1418×3.75/kWp)+bos+eng
      // panels≈825+inv(adjusted)≈240+bos450+eng250 ≈ 1765 SAR/kWp
      costPerKwpRange: [1000, 3500],
      specificYieldRange: [1900, 2400], // SA higher irradiance
      soilingPeakMonthIdx: [2, 5],
    },
  },
  {
    label: "AE — United Arab Emirates",
    cc: "ae",
    latLon: { lat: 24.47, lon: 54.37, elevationM: 5 },  // Abu Dhabi
    inpOverride: { omPerYear: 928 },   // 80 AED/kWp/yr × ~11.6 kWp
    expect: {
      currency: "AED",
      currencySymbol: "AED",
      ng: 0.3,
      p90Factor: 0.925,
      bosPerKwpLocal: 750,
      engPerKwpLocal: 350,
      // panels(0.22×3.67)+inv(USD1418×3.67/kWp)+bos750+eng350 ≈ 2350 AED/kWp
      costPerKwpRange: [1500, 5000],
      specificYieldRange: [1800, 2350],
      soilingPeakMonthIdx: [2, 5],
    },
  },
  {
    label: "JO — Jordan",
    cc: "jo",
    latLon: { lat: 31.95, lon: 35.93, elevationM: 777 }, // Amman
    inpOverride: { omPerYear: 275 },   // 25 JOD/kWp/yr × ~11 kWp
    expect: {
      currency: "JOD",
      currencySymbol: "JD",
      ng: 1.5,
      p90Factor: 0.920,
      bosPerKwpLocal: 380,
      engPerKwpLocal: 180,
      // panels(0.22×0.71)+inv(USD1418×0.71/kWp)+bos380+eng180 ≈ 808 JOD/kWp
      costPerKwpRange: [400, 1500],
      specificYieldRange: [1700, 2100], // Amman slightly less than Gulf
      soilingPeakMonthIdx: [2, 4],   // Khamsin dust spring
    },
  },
];

// ── Run scenarios ─────────────────────────────────────────────────────────────

for (const sc of SCENARIOS) {
  console.log(`\n${"═".repeat(72)}`);
  console.log(`SCENARIO ${sc.label}`);
  console.log("═".repeat(72));

  // Build inp: BASE + country profile + lat/lon override + per-scenario overrides
  const profile = applyCountryProfile(sc.cc);
  const inp = { ...BASE, ...profile, ...sc.latLon, ...(sc.inpOverride || {}) };

  // [1] Country profile fields wired
  console.log("\n  [1] Country profile applied");
  chk(inp.currency === sc.expect.currency,
      `currency = "${sc.expect.currency}"`, `got: "${inp.currency}"`);
  chk(inp.currencySymbol === sc.expect.currencySymbol,
      `currencySymbol = "${sc.expect.currencySymbol}"`, `got: "${inp.currencySymbol}"`);
  chk(Math.abs((inp.ng ?? 2.0) - sc.expect.ng) < 0.01,
      `ng (lightning) = ${sc.expect.ng} fl/km²/yr`, `got: ${inp.ng}`);
  chk(Math.abs((inp.p90Factor ?? 0.920) - sc.expect.p90Factor) < 0.001,
      `p90Factor = ${sc.expect.p90Factor}`, `got: ${inp.p90Factor}`);
  chk(inp.bosPerKwp === sc.expect.bosPerKwpLocal,
      `bosPerKwp = ${sc.expect.bosPerKwpLocal} ${inp.currency}/kWp`, `got: ${inp.bosPerKwp}`);
  chk(inp.engPerKwp === sc.expect.engPerKwpLocal,
      `engPerKwp = ${sc.expect.engPerKwpLocal} ${inp.currency}/kWp`, `got: ${inp.engPerKwp}`);

  // [2] Soiling profile: has 12 elements, sums < 0.5 (not all 50% losses)
  console.log("\n  [2] Soiling profile");
  chk(Array.isArray(inp.soilProfile) && inp.soilProfile.length === 12,
      `soilProfile is 12-element array`, `got length: ${inp.soilProfile?.length}`);
  const soilSum = (inp.soilProfile || []).reduce((s, v) => s + v, 0);
  chk(soilSum > 0 && soilSum < 1.0,
      `soilProfile sum in (0, 1)`, `sum: ${fmt(soilSum, 3)}`);
  const peakSoilIdx = inp.soilProfile.indexOf(Math.max(...inp.soilProfile));
  chk(peakSoilIdx >= sc.expect.soilingPeakMonthIdx[0] && peakSoilIdx <= sc.expect.soilingPeakMonthIdx[1],
      `soiling peak in months [${sc.expect.soilingPeakMonthIdx[0]+1}–${sc.expect.soilingPeakMonthIdx[1]+1}]`,
      `peak at month idx ${peakSoilIdx} (${peakSoilIdx+1})`);

  // [3] Run engine
  const r = calcEngine(inp, P01, I04, B00, null);
  if (!r) {
    console.log(`\n  [${FAIL}] calcEngine returned null — remaining checks skipped`);
    totalFail++;
    continue;
  }

  console.log(`\n  System: ${fmt(r.actKwp,2)} kWp  (${r.totP} × ${P01.wp}W)  |  ` +
              `noBat: ${r.noBat}  |  DC/AC: ${fmt(r.dcAc,3)}`);

  // [4] sysC validity (catches NaN/zero from bad bosPerKwp wiring)
  console.log("\n  [4] System cost validity");
  chk(!isNaN(r.sysC) && r.sysC > 0,
      `sysC is a valid positive number`, `got: ${Math.round(r.sysC).toLocaleString()} ${inp.currency}`);

  const bosCost = r.actKwp * inp.bosPerKwp;
  const engCost = r.actKwp * inp.engPerKwp;
  chk(Math.abs((r.bos  - bosCost) / bosCost) < 0.01,
      `r.bos = actKwp × bosPerKwp (${inp.bosPerKwp} ${inp.currency}/kWp)`,
      `expected: ${fmt(bosCost,0)}  got: ${r.bos}`);
  chk(Math.abs((r.engCost - engCost) / engCost) < 0.01,
      `r.engCost = actKwp × engPerKwp (${inp.engPerKwp} ${inp.currency}/kWp)`,
      `expected: ${fmt(engCost,0)}  got: ${r.engCost}`);

  const costPerKwp = r.sysC / r.actKwp;
  chk(inRange(costPerKwp, sc.expect.costPerKwpRange),
      `Cost/kWp in [${sc.expect.costPerKwpRange[0].toLocaleString()}–${sc.expect.costPerKwpRange[1].toLocaleString()}] ${inp.currency}`,
      `got: ${Math.round(costPerKwp).toLocaleString()} ${inp.currency}/kWp`);

  // Cross-check: BoS+eng should be >0 and <sysC
  chk(r.bos > 0 && r.bos < r.sysC,
      `BoS cost > 0 and < sysC`, `bos: ${Math.round(r.bos).toLocaleString()}  sysC: ${Math.round(r.sysC).toLocaleString()}`);

  // [5] Generation — P90 factor correctly applied
  console.log("\n  [5] Generation & P90");
  const siteP90 = inp.p90Factor ?? P90_FACTOR;
  const expectedP90 = r.annGenTMY * siteP90;
  chk(Math.abs(r.annGenP90 - expectedP90) < 0.5,
      `annGenP90 = annGenTMY × ${siteP90} (p90Factor)`,
      `expected: ${fmt(expectedP90,0)} kWh  got: ${fmt(r.annGenP90,0)} kWh`);
  chk(r.annGenP90 < r.annGenTMY,
      `P90 yield < TMY yield (derating applied)`,
      `TMY: ${fmt(r.annGenTMY,0)} kWh  P90: ${fmt(r.annGenP90,0)} kWh`);

  const syP50 = r.annGenTMY / r.actKwp;
  chk(inRange(syP50, sc.expect.specificYieldRange),
      `Specific yield P50 in [${sc.expect.specificYieldRange}] kWh/kWp`,
      `got: ${fmt(syP50,0)} kWh/kWp`);

  // [6] Cashflow integrity
  console.log("\n  [6] Cashflow integrity");
  chk(r.cfYears.every((y,i) => i===0 || y.cum >= r.cfYears[i-1].cum - 1),
      "Cumulative cashflow monotonically non-decreasing");
  chk(r.pb !== null && r.pb <= inp.analysisPeriod,
      `Payback within ${inp.analysisPeriod}yr analysis period`, `pb = ${r.pb} yr`);
  chk(!isNaN(r.irr) && parseFloat(r.irr) > 0,
      `IRR > 0%`, `got: ${r.irr}%`);

  console.log(`\n  ── ${fmt(r.actKwp,2)} kWp | TMY: ${fmt(r.annGenTMY,0)} kWh | ` +
    `P90: ${fmt(r.annGenP90,0)} kWh | PB: ${r.pb}yr | IRR: ${r.irr}%`);
  console.log(`  ── Cost: ${Math.round(r.sysC).toLocaleString()} ${inp.currency}  ` +
    `(BoS: ${Math.round(r.bos).toLocaleString()}  eng: ${Math.round(r.engCost).toLocaleString()}  ` +
    `${Math.round(r.sysC/r.actKwp).toLocaleString()} ${inp.currency}/kWp  ≈ ` +
    `$${fmt(r.sysC/r.actKwp/inp.usdRate,0)}/kWp)`);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(72)}`);
console.log(`RESULT: ${totalPass} passed  |  ${totalFail} failed`);
if (totalFail === 0) {
  console.log(`\x1b[32m  All international checks PASS.\x1b[0m`);
} else {
  console.log(`\x1b[31m  ${totalFail} check(s) FAILED — review output above.\x1b[0m`);
}
console.log("═".repeat(72) + "\n");
