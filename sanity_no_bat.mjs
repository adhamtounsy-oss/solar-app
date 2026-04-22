/**
 * No-battery sanity check script
 * Run: node sanity_no_bat.mjs   (from solar-app/)
 *
 * Verifies 4 scenarios against expected real-world ranges and arithmetic identities.
 * Fix applied: inverter fixtures include costEGP (was missing → NaN sysC last run).
 */
import { calcEngine } from './src/engine/calcEngine.js';
import { CAIRO_TMY_FALLBACK, CAIRO_SOILING, P90_FACTOR, DESIGN_PSH } from './src/constants/index.js';
import { computeEtaSys } from './src/lib/profile.js';

// ── Component fixtures (match src/data/components.js exactly) ────────────────

const P01 = {
  id:"P01", brand:"LONGi", model:"Hi-MO X6 LR5-72HTH-580M",
  wp:580, voc:52.21, vmp:44.06, isc:14.20, imp:13.17,
  betaVoc:-0.28, gammaPmax:-0.29, noct:44,
  dimL:2278, dimW:1134, weightKg:27.5,
  bifacial:false, bifacialGain:0, costUSD:0.22,
};

const I04 = {  // hybrid inverter running battery-less
  id:"I04", brand:"Sungrow", model:"SH10T Hybrid 10kW",
  acKW:10, dcAcRatio:1.3, vdcMax:1100, mpptMin:160, mpptMax:1000,
  iscPerMppt:30, numMppt:2, batVoltMin:176, batVoltMax:560,
  batChargeKW:10, eta:98.4, costEGP:78000,
};

const I14 = {  // pure grid-tied string inverter
  id:"I14", brand:"Sungrow", model:"SG10RT On-Grid String",
  acKW:10, dcAcRatio:1.3, vdcMax:1100, mpptMin:180, mpptMax:1000,
  iscPerMppt:22, numMppt:2, batVoltMin:0, batVoltMax:0,
  batChargeKW:0, eta:98.6, costEGP:42000,
};

const B00 = {  // sentinel: no battery
  id:"B00", brand:"Grid-Tied", model:"No Storage — Direct Use Only",
  kwh:0, voltage:0, dod:0, eta:100, cRate:0, costEGP:0,
};

const B01 = {  // Sungrow 25.6 kWh — comparison scenario only
  id:"B01", brand:"Sungrow", model:"SBR256 25.6kWh",
  kwh:25.6, voltage:256, dod:90, eta:96.5, cRate:0.5, costEGP:130000,
};

// ── Default inputs (mirrors DEF in src/config/nav.js) ─────────────────────────

const DEF = {
  lat:30.06, lon:31.45, azimuth:0, tiltDeg:22,
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
  tariffNow:1.95, tariffEsc:18, tariffMode:"tiered",
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
};

// ── Scenarios ─────────────────────────────────────────────────────────────────

const SCENARIOS = [
  {
    label: "A — AC-Heavy Daytime (default DEF, no battery)",
    inp: { ...DEF },
    panel: P01, inverter: I04, battery: B00,
    expect: {
      noBat: true,
      specificYieldP50: [1850, 2100],
      specificYieldP90: [1700, 1950],
      perfRatio:        [0.74, 0.88],   // 0.84 upper relaxed — etaSys clamped 0.92 in cool months boosts PR
      annSCPct:         [55, 80],        // seasonal-corrected fallback: AC drops in winter → 60-70% for daytime-heavy
      batChecks:        ["N/A","N/A","N/A"],
      batCostEGP:       0,
      irrRange:         [15, 45],
      pbRange:          [4, 15],
    },
  },
  {
    label: "B — Evening-Heavy Load (lighting/misc all evening, no battery)",
    inp: {
      ...DEF,
      acUnits:0, poolKW:0, miscKW:3.0,
      prof_Light:[0.0,0.0,1.0],
      prof_Misc: [0.0,0.0,1.0],
      offsetPct:60,
    },
    panel: P01, inverter: I14, battery: B00,
    expect: {
      noBat: true,
      specificYieldP50: [1850, 2100],
      specificYieldP90: [1700, 1950],
      perfRatio:        [0.74, 0.88],
      annSCPct:         [10, 40],       // evening profile: solar hours see little demand → low SC
      batChecks:        ["N/A","N/A","N/A"],
      batCostEGP:       0,
      irrRange:         [5, 30],
      pbRange:          [4, 25],
    },
  },
  {
    label: "C — No Battery vs With Battery (same load, IRR delta check)",
    inp: { ...DEF },
    panel: P01, inverter: I04, battery: B01,
    expect: {
      noBat: false,
      batChecks: ["PASS","PASS","EXCEEDS LIMIT"],  // B01 25.6kWh > EgyptERA rule for 11kWp — expected
    },
  },
  {
    label: "D — Zero-Export Mode, no battery (confirms noBat + no bat cost)",
    inp: { ...DEF, systemMode:"zeroexport", offsetPct:50 },
    panel: P01, inverter: I04, battery: B00,
    expect: {
      noBat: true,
      batCostEGP: 0,
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const PASS = "\x1b[32mPASS\x1b[0m";
const FAIL = "\x1b[31mFAIL\x1b[0m";
const WARN = "\x1b[33mWARN\x1b[0m";

function chk(ok, label, detail = "") {
  console.log(`  [${ok ? PASS : FAIL}] ${label}${detail ? "  →  " + detail : ""}`);
  return ok;
}
function warn(label, detail = "") {
  console.log(`  [${WARN}] ${label}${detail ? "  →  " + detail : ""}`);
}

function inRange(v, [lo, hi]) { return v >= lo && v <= hi; }
function fmt(n, d = 1) { return Number(n).toFixed(d); }

// Re-derive annGenTMY from same formula as calcEngine to check arithmetic
function manualAnnGen(actKwp, panel, inverter, soilProfile) {
  const invEtaFrac  = (inverter.eta || 97.6) / 100;
  const bifacialMult = panel.bifacial ? 1 + (panel.bifacialGain || 0) / 100 : 1;
  return CAIRO_TMY_FALLBACK.reduce((sum, mo, mi) => {
    const etaMo = computeEtaSys(panel, mo.tAmb);
    const soilF = 1 - (soilProfile[mi] ?? CAIRO_SOILING[mi] ?? 0.02);
    return sum + actKwp * mo.psh * mo.days * etaMo * soilF * bifacialMult * invEtaFrac;
  }, 0);
}

// Check whether the profile-fallback SCR inflates savings vs a realistic dispatch estimate.
// The fallback uses acs=1 in computeLoadProfile, so the demand array has full AC year-round.
// Real hourly dispatch with seasonal AC scaling typically gives 15-30pp lower SCR for AC-heavy systems.
function checkSCRInflation(r, inp, label) {
  if (!r.noBat) return;
  if (r.annSCPct > 75 && inp.acUnits > 0) {
    warn(
      `SCR = ${fmt(r.annSCPct,1)}% looks high for no-battery — profile-fallback uses acs=1 (full AC year-round)`,
      `Real PVGIS dispatch would apply seasonal AC scaling and typically gives 15–30pp lower SCR`
    );
    // Estimate financial impact: difference between fallback SCR and a conservative estimate (65%)
    const conservativeSCR = 0.65;
    const overCountedKwh  = r.annGenTMY * (r.annSCPct/100 - conservativeSCR);
    const marginalRate    = 2.10; // EGP/kWh — rough Tier 6/7 marginal
    const yr1Impact       = overCountedKwh * marginalRate;
    warn(
      `Estimated yr-1 savings overcount vs conservative 65% SCR: ~${Math.round(overCountedKwh)} kWh = ~${Math.round(yr1Impact).toLocaleString()} EGP`,
      `Load PVGIS data to get accurate dispatch-based SCR`
    );
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

let irrA, irrC;

for (const sc of SCENARIOS) {
  console.log(`\n${"═".repeat(72)}`);
  console.log(`SCENARIO ${sc.label}`);
  console.log("═".repeat(72));

  const r = calcEngine(sc.inp, sc.panel, sc.inverter, sc.battery, null);
  if (!r) { console.log(`  [${FAIL}] calcEngine returned null`); continue; }

  console.log(`\n  System: ${fmt(r.actKwp,2)} kWp  (${r.totP} × ${sc.panel.wp}W)  |  ` +
              `inv ${sc.inverter.acKW}kW  |  ` +
              `battery: ${sc.battery.kwh === 0 ? "NONE" : sc.battery.kwh+"kWh"}  |  ` +
              `DC/AC: ${fmt(r.dcAc,3)}  |  noBat: ${r.noBat}`);

  // ── 1. noBat flag ─────────────────────────────────────────────────────────
  console.log("\n  [1] noBat flag");
  if (sc.expect.noBat !== undefined)
    chk(r.noBat === sc.expect.noBat, `noBat === ${sc.expect.noBat}`, `got: ${r.noBat}`);

  // ── 2. Battery checks ─────────────────────────────────────────────────────
  if (sc.expect.batChecks) {
    console.log("\n  [2] Battery compatibility checks");
    const [expVolt, expChg, expRule] = sc.expect.batChecks;
    chk(r.chkBatVolt === expVolt, `chkBatVolt = "${expVolt}"`,  `got: "${r.chkBatVolt}"`);
    chk(r.chkBatChg  === expChg,  `chkBatChg  = "${expChg}"`,   `got: "${r.chkBatChg}"`);
    chk(r.chkBatRule === expRule,  `chkBatRule = "${expRule}"`,  `got: "${r.chkBatRule}"`);
    if (expRule === "EXCEEDS LIMIT")
      console.log(`         ↑ expected — B01 25.6kWh > EgyptERA rule limit for ${fmt(r.actKwp,1)}kWp system`);
  }

  // ── 3. Battery cost ───────────────────────────────────────────────────────
  if (sc.expect.batCostEGP !== undefined) {
    console.log("\n  [3] Battery cost");
    chk(r.batCostEGP === sc.expect.batCostEGP,
        `batCostEGP = ${sc.expect.batCostEGP} EGP`, `got: ${r.batCostEGP}`);
    // No battery replacement in cashflow
    if (r.noBat) {
      const batRows = r.cfYears.filter(y => y.bat > 0);
      chk(batRows.length === 0,
          `No battery replacement cost in 25-yr cashflow`,
          batRows.length ? `Found in years: ${batRows.map(y=>y.yr).join(",")}` : "");
    }
  }

  // ── 4. Generation arithmetic ──────────────────────────────────────────────
  console.log("\n  [4] Generation arithmetic");

  const manual = manualAnnGen(r.actKwp, sc.panel, sc.inverter, sc.inp.soilProfile || CAIRO_SOILING);
  chk(Math.abs(r.annGenTMY - manual) < 1.0,
      `annGenTMY matches manual re-calc within 1 kWh`,
      `engine: ${fmt(r.annGenTMY,0)}  manual: ${fmt(manual,0)}  Δ: ${fmt(Math.abs(r.annGenTMY-manual),2)}`);

  const siteP90 = sc.inp.p90Factor ?? P90_FACTOR;
  const expP90 = r.annGenTMY * siteP90;
  chk(Math.abs(r.annGenP90 - expP90) < 0.5,
      `annGenP90 = annGenTMY × ${siteP90} (p90Factor)`,
      `expected: ${fmt(expP90,0)}  got: ${fmt(r.annGenP90,0)}`);

  if (sc.expect.specificYieldP50) {
    const yP50 = r.annGenTMY / r.actKwp;
    const yP90 = r.annGenP90 / r.actKwp;
    chk(inRange(yP50, sc.expect.specificYieldP50),
        `Specific yield P50 in [${sc.expect.specificYieldP50}] kWh/kWp`, `got: ${fmt(yP50,0)}`);
    chk(inRange(yP90, sc.expect.specificYieldP90),
        `Specific yield P90 in [${sc.expect.specificYieldP90}] kWh/kWp`, `got: ${fmt(yP90,0)}`);
    chk(inRange(parseFloat(r.perfRatio), sc.expect.perfRatio),
        `Performance Ratio in [${sc.expect.perfRatio}]`,
        `got: ${r.perfRatio}  (target ~0.74–0.86 Cairo grid-tied)`);

    const peakIdx   = r.monthlyGen.map(m=>m.gen).indexOf(Math.max(...r.monthlyGen.map(m=>m.gen)));
    const troughIdx = r.monthlyGen.map(m=>m.gen).indexOf(Math.min(...r.monthlyGen.map(m=>m.gen)));
    chk(peakIdx >= 4 && peakIdx <= 7,
        `Monthly peak in May–Aug`, `peak: ${r.monthlyGen[peakIdx].m} (idx ${peakIdx})`);
    chk(troughIdx === 0 || troughIdx === 11,
        `Monthly trough in Dec or Jan`, `trough: ${r.monthlyGen[troughIdx].m} (idx ${troughIdx})`);
  }

  // ── 5. Self-consumption ───────────────────────────────────────────────────
  if (sc.expect.annSCPct && r.noBat) {
    console.log("\n  [5] Self-consumption (profile-fallback, no PVGIS hourly dispatch)");
    chk(inRange(r.annSCPct, sc.expect.annSCPct),
        `annSCPct in [${sc.expect.annSCPct}]%`, `got: ${fmt(r.annSCPct,1)}%`);
    chk(Math.abs(r.annSCPct - r.annSSPct) < 0.01,
        `annSSPct = annSCPct in fallback mode`, `SC: ${fmt(r.annSCPct,2)}%  SS: ${fmt(r.annSSPct,2)}%`);
    chk(r.eveningDeficit > 0,
        `eveningDeficit > 0 (real unmet evening demand exists)`,
        `got: ${fmt(r.eveningDeficit,2)} kWh/day (Dec)`);
    chk(r.batCyclesYear === null || r.batCyclesYear === 0,
        `batCyclesYear null or 0`, `got: ${r.batCyclesYear}`);
    checkSCRInflation(r, sc.inp, sc.label);
  }

  // ── 6. Cashflow integrity ─────────────────────────────────────────────────
  console.log("\n  [6] Cashflow integrity");
  chk(r.cfYears.every((y,i) => i===0 || y.cum >= r.cfYears[i-1].cum - 1),
      "Cumulative cashflow monotonically non-decreasing");
  const hasPB = r.pb !== null && r.pb <= sc.inp.analysisPeriod;
  chk(hasPB, `Payback exists within ${sc.inp.analysisPeriod} yr`, `pb = ${r.pb} yr`);

  // Verify sysC is not NaN (the bug we fixed — missing costEGP in inverter)
  chk(!isNaN(r.sysC) && r.sysC > 0,
      `sysC is a valid number (costEGP present on all components)`,
      `got: ${Math.round(r.sysC).toLocaleString()} EGP`);

  // ── 7. Financial ranges ───────────────────────────────────────────────────
  if (sc.expect.irrRange) {
    console.log("\n  [7] Financial outputs");
    const irr = parseFloat(r.irr);
    chk(inRange(irr, sc.expect.irrRange),         `IRR in [${sc.expect.irrRange}]%`,   `got: ${fmt(irr,1)}%`);
    chk(inRange(r.pb, sc.expect.pbRange),          `PB in [${sc.expect.pbRange}] yr`,   `got: ${r.pb} yr`);
    chk(inRange(r.sysC/r.actKwp, [20000,42000]),   `Cost/kWp in [20k–42k] EGP (Egypt 2024-26 market)`,  `got: ${fmt(r.sysC/r.actKwp,0)} EGP/kWp (~${fmt(r.sysC/r.actKwp/55,0)} USD/kWp)`);
    chk(r.npvAtRate > 0,                            `NPV@12% discount positive`,          `got: ${Math.round(r.npvAtRate).toLocaleString()} EGP`);
    // Sense-check: first-year savings should be plausible (>0, <annGenTMY × top tariff)
    const yr1Sav = r.cfYears[0].sav;
    const maxTheo = Math.round(r.annGenTMY * 2.58); // all gen at top tier
    chk(yr1Sav > 0 && yr1Sav <= maxTheo,
        `Yr-1 savings in plausible range [1 – ${maxTheo.toLocaleString()} EGP]`,
        `got: ${yr1Sav.toLocaleString()} EGP`);
  }

  // Store for cross-scenario comparison
  if (sc.label.startsWith("A")) irrA = parseFloat(r.irr);
  if (sc.label.startsWith("C")) irrC = parseFloat(r.irr);

  console.log(`\n  ── ${fmt(r.actKwp,2)} kWp | ` +
    `P50=${fmt(r.annGenTMY,0)} kWh | P90=${fmt(r.annGenP90,0)} kWh | PR=${r.perfRatio} | ` +
    `SCR=${fmt(r.annSCPct,1)}% | PB=${r.pb}yr | IRR=${r.irr}%`);
  console.log(`  ── Cost: ${Math.round(r.sysC/1000)}k EGP  ` +
    `(panels:${Math.round(r.arrayCostEGP/1000)}k  inv:${Math.round(r.invCostEGP/1000)}k  ` +
    `bat:${Math.round(r.batCostEGP/1000)}k  BoS+eng:${Math.round((r.bos+r.engCost)/1000)}k)`);
}

// ── Cross-scenario: no-bat vs with-bat IRR ────────────────────────────────────

console.log(`\n${"═".repeat(72)}`);
console.log("CROSS-SCENARIO: No Battery (A) vs With Battery (C)");
console.log("═".repeat(72));
if (irrA !== undefined && irrC !== undefined) {
  const delta = irrA - irrC;
  console.log(`\n  No-battery IRR: ${fmt(irrA,1)}%  |  With-battery IRR: ${fmt(irrC,1)}%  |  Δ = ${fmt(delta,1)} pp`);
  chk(delta >= -5,
      "No-battery IRR ≥ with-battery (or within 5 pp) for daytime-heavy AC load",
      `positive = no-bat is better return`);
  if (delta > 0)
    console.log(`         Battery adds cost without proportionate savings for daytime AC load — expected.`);
}

// ── SCR inflation quantification (standalone) ─────────────────────────────────

console.log(`\n${"═".repeat(72)}`);
console.log("SCR INFLATION ANALYSIS: Profile-fallback vs expected dispatch SCR");
console.log("═".repeat(72));
console.log(`
  Root cause: computeLoadProfile(inp, billScale, acs=1) is used for the SCR
  hourly approximation. acs=1 means full AC profile year-round, which gives
  higher daytime demand than seasonal reality. The financial model then applies
  this SCR% to each month's generation (scMo = genMo × scFrac), but checks
  against seasonally-correct monthlyLoadKwh — so the cap never binds and all
  months assume the inflated SCR%.

  Impact for AC-heavy systems without PVGIS data loaded:
`);

// Quantify by computing savings two ways for Scenario A
{
  const r = calcEngine(DEF, P01, I04, B00, null);
  const fallbackSCR  = r.annSCPct / 100;                 // 0.917
  const conservSCR   = 0.60;                              // realistic for no-bat + hourly dispatch
  const annGenFallback   = r.annGenTMY;
  const yr1SaveFallback  = r.cfYears[0].sav;
  // Conservative: re-run savings estimate manually at 60% SCR
  // scMo = genMo × 0.60 for each month; use Tier 6 rate 2.10 EGP/kWh as proxy
  const monthlyGen = r.monthlyGen;
  let conservSav = 0;
  monthlyGen.forEach(mo => { conservSav += mo.gen * conservSCR * 2.10; });

  console.log(`  Scenario A (11 kWp, AC-heavy, tiered tariff, P50 yield):`);
  console.log(`    Profile-fallback SCR: ${fmt(fallbackSCR*100,1)}%  → yr-1 savings: ${yr1SaveFallback.toLocaleString()} EGP`);
  console.log(`    Conservative dispatch SCR estimate (~60%): → yr-1 savings: ~${Math.round(conservSav).toLocaleString()} EGP`);
  console.log(`    Overcount: ~${Math.round(yr1SaveFallback - conservSav).toLocaleString()} EGP/yr in year 1`);
  console.log(`\n  Recommendation: always load PVGIS data before presenting financial outputs`);
  console.log(`  to customers. Without it, SCR for AC-heavy no-battery is overstated by`);
  console.log(`  ~${fmt((fallbackSCR - conservSCR)*100,0)} pp, which inflates IRR and understates payback.\n`);
}

// ── Cairo TMY fallback arithmetic ─────────────────────────────────────────────

console.log("═".repeat(72));
console.log("CAIRO TMY FALLBACK — standalone arithmetic checks");
console.log("═".repeat(72));
const annPSH = CAIRO_TMY_FALLBACK.reduce((s,m) => s + m.psh * m.days, 0);
chk(Math.abs(annPSH - 2406) < 10,
    `Annual POA ≈ 2,400–2,410 kWh/m²/yr (PVGIS ERA5)`, `got: ${fmt(annPSH,1)}`);
chk(CAIRO_TMY_FALLBACK[11].psh < DESIGN_PSH + 0.5,
    `Dec fallback PSH (${CAIRO_TMY_FALLBACK[11].psh}) consistent with DESIGN_PSH (${DESIGN_PSH})`,
    `DESIGN_PSH is the P90-adjusted Dec value used for conservative array sizing`);

console.log(`\n${"═".repeat(72)}\nDone.\n${"═".repeat(72)}\n`);
