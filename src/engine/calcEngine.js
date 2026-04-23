import { CAIRO_TMY_FALLBACK, CAIRO_SOILING, P90_FACTOR, WIN_HRS } from "../constants/index.js";
import { tieredMonthlySaving } from "../lib/financial.js";
import { runHourlyDispatch } from "../lib/dispatch.js";
import { kimberSoiling } from "../lib/physics.js";
import { computeLoadProfile, seasonalAcScale, computeEtaSys } from "../lib/profile.js";

export function bilinearDeg(yearsElapsed, annualRate) {
  const EARLY_MULT  = 1.3;
  const EARLY_YEARS = 3;
  let factor = 1.0;
  for (let y = 0; y < yearsElapsed; y++) {
    factor *= (1 - annualRate * (y < EARLY_YEARS ? EARLY_MULT : 1.0));
  }
  return factor;
}

export function calcEngine(inp, panel, inverter, battery, hourlyData, opts) {
  if (!panel || !inverter) return null;
  const noBat = !battery || battery.kwh === 0;

  // -- Unified load analysis — single source of truth ----------
  // kW ratings (independent of method)
  const acKW    = inp.acUnits * inp.acTonnage * (3.517 / (inp.acCOP||3.0)); // 3.517 kW/ton ÷ COP
  const lightKW = (inp.lightingAreaM2*8)/1000;  // 8 W/m² LED standard
  const peakKW  = acKW+lightKW+inp.whKW+(inp.kitchenW/1000)+(inp.laundryW/1000)+inp.poolKW+inp.miscKW;

  // Per-load daily kWh — always from profile fractions (single source of truth)
  // Profile fractions × window hours give actual hours-equivalent per load per day
  const pf = {
    AC:      inp.prof_AC      || [0.3,0.8,0.6],
    Light:   inp.prof_Light   || [0.2,0.0,1.0],
    WH:      inp.prof_WH      || [0.8,0.0,0.5],
    Kitchen: inp.prof_Kitchen || [0.5,0.2,0.8],
    Laundry: inp.prof_Laundry || [0.0,0.8,0.2],
    Pool:    inp.prof_Pool    || [0.0,1.0,0.0],
    Misc:    inp.prof_Misc    || [0.2,0.3,0.5],
  };
  const effHrs = k => pf[k].reduce((s,f,i)=>s+f*WIN_HRS[i], 0);




  const acKWh   = acKW              * effHrs("AC");
  const lightKWh= lightKW           * effHrs("Light");
  const whKWh   = inp.whKW          * effHrs("WH");
  const kitKWh  = (inp.kitchenW/1000)* effHrs("Kitchen");
  const launKWh = (inp.laundryW/1000)* effHrs("Laundry");
  const poolKWh = inp.poolKW        * effHrs("Pool");
  const miscKWh = inp.miscKW        * effHrs("Misc");

  // Bill-based override: if loadMethod==="bill", scale all loads to match bill
  const billDailyKwh = inp.loadMethod==="bill"
    ? (inp.monthlyBillEGP / inp.tariffNow) / 30.5  // EGP/month ÷ EGP/kWh ÷ days
    : null;
  const profileDailyKwh = acKWh+lightKWh+whKWh+kitKWh+launKWh+poolKWh+miscKWh;
  const billScale = billDailyKwh ? billDailyKwh / Math.max(profileDailyKwh, 0.1) : 1;

  // Final daily kWh per load (scaled if bill method)
  const acKWhF   = acKWh   * billScale;
  const lightKWhF= lightKWh* billScale;
  const whKWhF   = whKWh   * billScale;
  const kitKWhF  = kitKWh  * billScale;
  const launKWhF = launKWh * billScale;
  const poolKWhF = poolKWh * billScale;
  const miscKWhF = miscKWh * billScale;
  const loadTot  = acKWhF+lightKWhF+whKWhF+kitKWhF+launKWhF+poolKWhF+miscKWhF;

  const loadMap = {
    AC:             { kWh:acKWhF,   kW:acKW,               solar:inp.solarAC      },
    Lighting:       { kWh:lightKWhF,kW:lightKW,            solar:inp.solarLighting },
    "Water Heating":{ kWh:whKWhF,   kW:inp.whKW,           solar:inp.solarWH      },
    Kitchen:        { kWh:kitKWhF,  kW:inp.kitchenW/1000,  solar:inp.solarKitchen },
    Laundry:        { kWh:launKWhF, kW:inp.laundryW/1000,  solar:inp.solarLaundry },
    Pool:           { kWh:poolKWhF, kW:inp.poolKW,         solar:inp.solarPool    },
    Misc:           { kWh:miscKWhF, kW:inp.miscKW,         solar:inp.solarMisc    },
  };
  let solarKwh, solarKW;
  if (inp.coverageMode==="percentage") {
    solarKwh = loadTot*(inp.offsetPct/100);
    solarKW  = peakKW *(inp.offsetPct/100);
  } else {
    solarKwh = Object.values(loadMap).filter(l=>l.solar).reduce((a,l)=>a+l.kWh,0);
    solarKW  = Object.values(loadMap).filter(l=>l.solar).reduce((a,l)=>a+l.kW ,0);
  }
  const effPct = (solarKwh/loadTot)*100;

  // --- Temperature corrections (design month = Dec) ---
  const tCellMax = inp.tAmbMax + (panel.noct-20)*0.8;




  const tCellMin = inp.tAmbMin;
  const dTmax = tCellMax-25, dTmin = tCellMin-25;
  const etaSys = computeEtaSys(panel, inp.tAmbMax);

  // --- Array sizing on DESIGN_PSH (Dec worst month) ---
  const reqKwp  = solarKwh / (inp.pshDesign * etaSys);
  const netRoof = Math.max(0, inp.roofAreaM2 - inp.roofObstructionsM2);
  const vocWin  = panel.voc*(1+(panel.betaVoc/100)*dTmin);
  // A3: Vmp uses betaVmp not betaVoc — they differ by ~20% (IEC 60891)
  // betaVmp is not in standard datasheets; estimate as betaVoc × 1.20 when absent
  const betaVmp  = panel.betaVmp || (panel.betaVoc * 1.20);
  const vmpSum   = panel.vmp * (1 + (betaVmp/100) * dTmax);
  const pmaxSum = panel.wp *(1+(panel.gammaPmax/100)*dTmax);
  const nMax  = Math.floor(inverter.vdcMax / vocWin);
  const nMin  = Math.ceil(inverter.mpptMin / vmpSum);
  const nSel  = Math.min(nMax, Math.max(nMin, Math.floor((inverter.mpptMax*0.88)/vmpSum)));

  // --- Fix 2: Inter-row shading geometry (computed BEFORE panel cap, needed for cap) ---
  const tiltRad    = (inp.tiltDeg*Math.PI)/180;
  const panelVertM = (panel.dimL/1000)*Math.sin(tiltRad);
  const panelBaseM = (panel.dimL/1000)*Math.cos(tiltRad);
  // Solar altitude at Dec 21, 9am local solar time — computed from site latitude
  // dec = −23.45° (winter solstice), hour angle = −45° (3h before noon)
  const _decRad = (-23.45 * Math.PI) / 180;
  const _haRad  = (-45    * Math.PI) / 180;
  const _latRad = ((inp.lat || 30) * Math.PI) / 180;
  const altDeg  = Math.asin(
    Math.sin(_latRad)*Math.sin(_decRad) + Math.cos(_latRad)*Math.cos(_decRad)*Math.cos(_haRad)
  ) * 180 / Math.PI;
  const altRad  = Math.max(5 * Math.PI / 180, altDeg * Math.PI / 180); // clamp ≥ 5° (polar edge)
  const minPitch   = panelBaseM + panelVertM/Math.tan(altRad);
  const roofDepth  = inp.roofDepthM || 12;
  const maxRows    = Math.max(1, Math.floor(roofDepth/minPitch));
  const roofWidth  = netRoof/roofDepth;
  const panelsPerRow = Math.max(1, Math.floor(roofWidth/(panel.dimW/1000)));
  const maxPanelsNoShade = maxRows * panelsPerRow;
  // Roof area cap: how many panels physically fit (ignoring row spacing)
  const maxPanelsByArea  = Math.floor(netRoof / ((panel.dimL/1000)*(panel.dimW/1000)));
  // Mount mode determines the effective panel cap
  // "roof"   — roof only: tighter of area cap and row-spacing cap
  // "hybrid" — roof + ground: separate row-spacing calcs, combined total
  // "ground" — no roof constraint; user supplies total ground area
  const groundNet    = Math.max(0, inp.groundAreaM2 || 0);
  const groundDepth  = inp.roofDepthM || 12;  // same depth assumption for ground rows
  const groundWidth  = groundDepth > 0 ? groundNet / groundDepth : 0;
  const gPanelsPerRow = Math.max(0, Math.floor(groundWidth / (panel.dimW/1000)));
  const gMaxRows      = Math.max(0, Math.floor(groundDepth / minPitch));
  const maxPanelsGroundNoShade = gMaxRows * gPanelsPerRow;
  const maxPanelsByGround      = groundNet > 0 ? Math.floor(groundNet / ((panel.dimL/1000)*(panel.dimW/1000))) : 0;
  const groundPanelCap         = Math.min(maxPanelsByGround, maxPanelsGroundNoShade);

  let roofPanelCap, totalPanelCap;
  const mm = inp.mountMode || "roof";




  if (mm === "ground") {
    // No roof — pure ground mount; cap = ground area / row-spacing (whichever tighter)
    roofPanelCap  = 0;
    totalPanelCap = Math.max(1, groundPanelCap);
  } else if (mm === "hybrid") {
    // Roof cap (shade-limited) + ground cap combined
    roofPanelCap  = Math.max(1, Math.min(maxPanelsByArea, maxPanelsNoShade));
    totalPanelCap = Math.max(1, roofPanelCap + groundPanelCap);
  } else {
    // Roof only — original behaviour
    roofPanelCap  = Math.max(1, Math.min(maxPanelsByArea, maxPanelsNoShade));
    totalPanelCap = roofPanelCap;
  }

  // Required panels from load
  const nPanelsReq = Math.ceil((reqKwp*1000)/panel.wp);
  // Actual strings: based on required panels, HARD-CAPPED by total available area
  const nStrReq    = Math.ceil(nPanelsReq/nSel);
  const nStrCapped = Math.min(nStrReq, Math.floor(totalPanelCap/nSel));
  const nStr       = Math.max(1, nStrCapped);  // always at least 1 string
  const totP       = nSel*nStr;
  const actKwp     = (totP*panel.wp)/1000;
  const strVoc     = nSel*vocWin;
  const strVmp     = nSel*vmpSum;
  const dcAc       = actKwp/inverter.acKW;
  const panArea    = totP*(panel.dimL/1000)*(panel.dimW/1000);
  const roofFit    = panArea<=netRoof;
  // Effective coverage after cap (may be less than requested offset)
  const roofCapped     = totP < nStrReq*nSel;  // true if roof limited the array
  const cappedKwp      = (nStrReq*nSel*panel.wp)/1000; // what we'd need uncapped
  const coverageActual = roofCapped
    ? (actKwp * inp.pshDesign * etaSys / loadTot) * 100
    : effPct;

  // Row spacing status
  const rowShadeOk      = totP <= maxPanelsNoShade;
  const interRowLossPct = rowShadeOk ? 0 : Math.min(30,((totP-maxPanelsNoShade)/totP)*100);
  const chkRowShade     = rowShadeOk ? "PASS" : "REVIEW";

  // -- Phase A: Irradiance source selection ---------------------
  // Use PVGIS hourly data if fetched; otherwise fall back to monthly averages
  const tmySource  = hourlyData ? "pvgis" : "fallback";
  const tmyMonthly = hourlyData ? hourlyData.monthly : CAIRO_TMY_FALLBACK;

  // Elevation lapse rate correction for fallback path only.
  // PVGIS ERA5 already provides site-specific temperatures; the fallback table is
  // calibrated to Cairo (~74 m ASL). For other elevations apply ISA −6.5 °C/1000 m.
  const elevM     = inp.elevationM != null ? inp.elevationM : 74; // default = Cairo baseline
  const elevCorr  = tmySource === "fallback" ? -((elevM - 74) / 1000) * 6.5 : 0;

  // Monthly generation — always computed for display and monthly financial model
  // v4: bifacial gain multiplier applied when panel.bifacial is true
  const bifacialMult = panel.bifacial ? 1 + (panel.bifacialGain || 0) / 100 : 1;
  // Inverter efficiency: applied here so annGenTMY represents AC output (IEC 61724-1 PR basis)
  // Hourly dispatch path applies it per-hour via invEtaAtLoad(); monthly fallback uses rated eta.
  const invEtaFrac = (inverter.eta || 97.6) / 100;

  const monthlyGen = tmyMonthly.map((mo, mi) => {
    const tAmbCorr = mo.tAmb + elevCorr;
    const etaMo = computeEtaSys(panel, tAmbCorr);
    const soilF = 1 - ((inp.soilProfile && inp.soilProfile[mi]) || CAIRO_SOILING[mi] || 0.02);
    return { m:mo.m, psh:mo.psh, tAmb:tAmbCorr, days:mo.days, soilFactor:soilF,
             gen: actKwp * mo.psh * mo.days * etaMo * soilF * bifacialMult * invEtaFrac };
  });
  const annGenTMY  = monthlyGen.reduce((s,m)=>s+m.gen, 0);
  // v4: P90 yield = TMY × p90Factor (country-specific; default 0.92 for Egypt per PVGIS studies)
  const siteP90    = inp.p90Factor ?? P90_FACTOR;
  const annGenP90  = annGenTMY * siteP90;
  const annGenFlat = actKwp * inp.pshDesign * 365 * etaSys * invEtaFrac; // legacy (no soiling)

  // -- Build demand arrays — single source, billScale applied -----
  // Annual average demand (for SC approximation and display)
  const { demand, solarShape } = computeLoadProfile(inp, billScale, 1);

  // Monthly demand arrays for dispatch — Fix 5: seasonal AC scale per month
  // Fix 1+2+4: billScale flows through here so dispatch and financial model
  // both use the same scaled consumption
  const monthlyDemands = Array.from({length:12}, (_,mi) => {
    const acs = seasonalAcScale(inp, mi);
    const { demand: d } = computeLoadProfile(inp, billScale, acs);
    return d; // Float32Array(24) for this month
  });

  // -- Dispatch: hourly path (PVGIS data available) --------------
  let dispatch = null;
  if (hourlyData && hourlyData.hourly && hourlyData.hourly.length >= 8760) {
    // Build meter-derived monthly demand profiles (E12)
    // meterData is Float32Array(8760) of kWh/hr; reshape to [12][24] avg profiles
    let meterDemands = null;
    if (inp.meterData) {
      const MD = [31,28,31,30,31,30,31,31,30,31,30,31];
      meterDemands = [];
      let dayStart = 0;
      for (let mi=0; mi<12; mi++) {
        const prof = new Array(24).fill(0);
        const days = MD[mi];
        for (let d=0; d<days; d++)
          for (let h=0; h<24; h++)
            prof[h] += (inp.meterData[(dayStart+d)*24+h] || 0);
        for (let h=0; h<24; h++) prof[h] /= days; // avg kW per hour
        meterDemands.push(prof);
        dayStart += days;
      }
    }
    dispatch = runHourlyDispatch(
      hourlyData.hourly, actKwp, etaSys,
      (hourlyData.precip
        ? kimberSoiling(hourlyData.precip, inp.soilingRate, 0.5, 0.005, 0.005, inp.cleaningIntervalDays)  // Kimber model
        : (inp.soilProfile || CAIRO_SOILING)),       // fallback: manual/Cairo schedule
      monthlyDemands, battery, inverter, 0,




      {
        gpoa:        hourlyData.gpoa,
        tamb:        hourlyData.tamb,
        gbeam:       hourlyData.gbeam,     // D3: beam on tilted surface
        gdiff:       hourlyData.gdiff,     // D3: diffuse on tilted surface
        windspeed:   hourlyData.windspeed, // D1: Faiman wind cooling
        panel,
        zeroExport:  inp.systemMode==="zeroexport",
        meterDemands,
        lat:  inp.lat   || 30.06,          // D3: solar incidence angle
        tilt: inp.tiltDeg || 22,
        az:   inp.azimuth  || 0,
        horizonProfile: inp.horizonProfile,
        shadingMatrix:  opts && opts.shadingMatrix,
        touPeakStart:   inp.touPeakStart || 17,
        touPeakEnd:     inp.touPeakEnd   || 22,
      }
    );
  }

  // -- Self-consumption + dispatch outputs -----------------------
  let profileSCPct, eveningDeficit, hourlyGenDisplay;
  let annSCPct, annSSPct, batCyclesYear, monthlyGridArr, monthlySCArr;

  if (dispatch) {
    // Hourly dispatch available — use real simulated values
    annSCPct       = dispatch.annSCPct;
    annSSPct       = dispatch.annSSPct;
    profileSCPct   = dispatch.annSCPct;           // for backward compat
    batCyclesYear  = dispatch.batCycles;
    monthlyGridArr = dispatch.monthlyGridArr;
    monthlySCArr   = dispatch.monthlySCArr;
    // Evening deficit = average monthly unmet evening demand (Dec is design month)
    eveningDeficit = dispatch.eveningDeficits[11]; // December
    // Build 24h display curve from average annual daily generation
    // annGenTMY is AC energy (includes invEtaFrac), so back-calc PSH excludes it
    const annAvgPsh = annGenTMY / actKwp / etaSys / invEtaFrac / 365;
    const genNorm = solarShape.reduce((s,v)=>s+v,0);
    const totSolDay = actKwp * etaSys * invEtaFrac * annAvgPsh;
    hourlyGenDisplay = solarShape.map(s => genNorm>0 ? (totSolDay*s)/genNorm : 0);
  } else {
    // Monthly fallback — sin-bell profile approximation with seasonal SC correction.
    // SCR is computed month-by-month using the same seasonal AC scaling as the financial
    // model (seasonalAcScale per month) so winter low-AC months don't inflate the annual figure.
    const genNorm = solarShape.reduce((s,v)=>s+v,0);
    // hourlyGenDisplay uses the annual-average daily gen (for the profile display tab)
    const annAvgDailyGen = annGenTMY / 365;
    hourlyGenDisplay = solarShape.map(s => genNorm>0 ? (annAvgDailyGen*s)/genNorm : 0);
    // Seasonal monthly SCR: for each month compute daily SC using that month's demand profile
    let totalSCkwh = 0;
    monthlyGen.forEach((mo, mi) => {
      const acs        = seasonalAcScale(inp, mi);
      const { demand: demH } = computeLoadProfile(inp, billScale, acs);
      const dailyGen   = mo.gen / mo.days;
      const moGenShape = solarShape.map(s => genNorm>0 ? (dailyGen*s)/genNorm : 0);
      const dailySC    = demH.reduce((sc, d, h) => sc + Math.min(d, moGenShape[h]), 0);
      totalSCkwh      += dailySC * mo.days;
    });
    profileSCPct   = annGenTMY > 0 ? (totalSCkwh / annGenTMY) * 100 : 80;
    annSCPct       = profileSCPct;
    annSSPct       = profileSCPct;
    // Use December (design month) seasonal demand to match the dispatch path's
    // eveningDeficits[11] — avoids 45% overestimate from acs=1 (full AC year-round)
    const acsDec = seasonalAcScale(inp, 11);
    const { demand: demDec } = computeLoadProfile(inp, billScale, acsDec);
    eveningDeficit = demDec.slice(17,23).reduce((s,v)=>s+v,0);
    batCyclesYear  = null;
    monthlyGridArr = null;
    monthlySCArr   = null;
  }
  const hourlyGen = hourlyGenDisplay; // alias for profile tab render

  // --- Battery sizing — profile-derived (IEC 62548 §9) ---




  // eveTarget: cover (batEveningCovPct%) of evening deficit from 24h demand profile
  // critE: scale eveTarget for backup windows longer than the default 6h evening window
  const eveTarget  = noBat ? 0 : eveningDeficit * (inp.batEveningCovPct/100);
  const critE      = noBat ? 0 : eveTarget * (inp.backupHours / 6);
  const designE    = noBat ? 0 : Math.max(eveTarget, critE);
  const usableBat  = noBat ? 0 : battery.kwh * (battery.dod/100);
  const autonomy   = noBat ? 0 : usableBat / Math.max(eveningDeficit / 6, 0.1);
  const batRulePct = noBat ? 0 : (battery.kwh/(actKwp*0.2*inp.backupHours))*100;

  // --- Compatibility checks ---
  // A1: Inverter must cover peak simultaneous demand from 24h profile (not solarKW)
  // solarKW = peakCoincident × offset% — a physically impossible sum, never simultaneous
  // peakDemandKW = max(demand[h]) — the actual worst-case AC draw the inverter must
// serve
  const peakDemandKW = Math.max(...demand, 0.1);
  const chkInvSize = inverter.acKW >= peakDemandKW ? "PASS":"FAIL";
  // Use each inverter's rated dcAcRatio as the hard cap; >limit → FAIL so the
  // recommendation engine rejects the combination rather than silently passing it.
  const chkDcAc    = dcAc > (inverter.dcAcRatio||1.3) ? "FAIL"
                   : dcAc < 1.0                        ? "REVIEW"  // under-loaded
                   :                                    "PASS";
  const chkMpptMin = strVmp >= inverter.mpptMin ? "PASS":"FAIL";
  const chkMpptMax = strVoc <= inverter.vdcMax  ? "PASS":"FAIL";
  // Fix 5: use inverter.numMppt (from library); worst MPPT carries ceil(nStr/numMppt) strings
  const strPerMppt = Math.ceil(nStr / Math.max(1, inverter.numMppt||1));
  const chkIscMppt = (panel.isc * strPerMppt) <= inverter.iscPerMppt ? "PASS":"FAIL";
  const chkBatVolt = noBat ? "N/A" : (battery.voltage>=(inverter.batVoltMin||0) &&
                     battery.voltage<=(inverter.batVoltMax||9999) ? "PASS":"INCOMPATIBLE");
  const chkBatChg  = noBat ? "N/A" : (inverter.batChargeKW>=(battery.kwh*battery.dod/100/inp.backupHours) ? "PASS":"REVIEW");
  const chkBatRule = noBat ? "N/A" : (battery.kwh<=actKwp*0.2*inp.backupHours ? "PASS":"EXCEEDS LIMIT");
  const allOk = [chkInvSize,chkDcAc,chkMpptMin,chkMpptMax,chkIscMppt,
    ...(noBat ? [] : [chkBatVolt,chkBatChg,chkBatRule])].every(c=>c==="PASS");

  // --- Wiring ---
  // E6: Temperature-corrected copper resistivity (IEC 60228 / IEC 60364-5-52)
  // ρ(T) = ρ20 × (1 + α×(T-20))   α_copper = 0.00393 /°C
  const rho20 = 0.0172;  // Ω·mm²/m at 20°C
  const rhoDC = rho20 * (1 + 0.00393 * 50); // 70°C operating (PV1-F XLPE DC cable)
  const rhoAC = rho20 * (1 + 0.00393 * 40); // 60°C operating (AC cable)

  // E7: Cable CSA calculator — minimum cross-section from VD limit + IEC 60364-5-52
  // IEC 60364-5-52 Table B.52.2 current capacity (simplified for 40°C ambient, XLPE)
  const STD_CSA    = [1.5,2.5,4,6,10,16,25,35,50]; // mm² standard sizes




  const CSA_IMAX   = [18, 24, 32,41,57, 76,101,125,151]; // A (XLPE, 40°C, single phase DC)
  function minCSA(I_design, L_m, V_circuit, vd_limit_pct) {
    // CSA from VD limit: CSA_vd = 2*L*I*ρ / (vd_limit * V)
    const csaVD  = (2 * L_m * I_design * rhoDC) / ((vd_limit_pct/100) * V_circuit);
    // CSA from current capacity (thermal limit)
    let csaI = STD_CSA[STD_CSA.length-1];
    for (let i=0; i<STD_CSA.length; i++) {
      if (CSA_IMAX[i] >= I_design) { csaI = STD_CSA[i]; break; }
    }
    const csaMin = Math.max(csaVD, csaI);
    return STD_CSA.find(s => s >= csaMin) || STD_CSA[STD_CSA.length-1];
  }

  // String cable
  const iStr    = panel.isc * 1.56;               // IEC 62548: Isc × 1.25²
  const iStrD   = iStr / 0.87;                    // 45°C ambient derating factor
  const csaStr  = minCSA(iStr, inp.lenStringM, strVmp, 1.5);
  const vdStr   = ((2*inp.lenStringM*panel.imp*rhoDC)/(csaStr*strVmp))*100;
  // Feeder cable
  const iFdr    = panel.isc * nStr * 1.56;
  const iFdrD   = iFdr / 0.87;
  const csaFdr  = minCSA(iFdr, inp.lenFeederM, strVmp, 1.5);
  const vdFdr   = ((2*inp.lenFeederM*(panel.imp*nStr)*rhoDC)/(csaFdr*strVmp))*100;
  const iBat    = noBat ? 0 : (battery.kwh*1000)/battery.voltage/inp.backupHours*1.25;
  // AC cable
  const iAC     = (inverter.acKW*1000)/(inp.supplyPhase==="three"
                    ? inp.supplyVoltageLL*1.732*0.95
                    : inp.supplyVoltageLN*0.95)*1.25;
  const vCircAC = inp.supplyPhase==="three" ? inp.supplyVoltageLL : inp.supplyVoltageLN;
  const csaAC   = minCSA(iAC, inp.lenACM, vCircAC, 2.0);
  const vdAC    = ((2*inp.lenACM*iAC*rhoAC)/(csaAC*vCircAC))*100;
  const strFuse   = Math.ceil(panel.isc*1.56/5)*5;
  const acBreaker = Math.ceil(iAC/5)*5;
  const mdbCheck  = (inp.supplyAmps+iAC)/0.80<=inp.mdbBusbarA ? "PASS":"UPGRADE NEEDED";

  // --- Costs ---
  const arrayCostEGP = totP * panel.costUSD * panel.wp * inp.usdRate;
  // Normalize inverter/battery costs: prefer costUSD, else treat costEGP as priced at Egypt rate (55)
  const _EGP_BASE  = 55;
  const invCostEGP = inverter.costUSD
    ? inverter.costUSD * inp.usdRate
    : (inverter.costEGP / _EGP_BASE) * inp.usdRate;
  const batCostEGP = noBat ? 0
    : (battery.costUSD
        ? battery.costUSD * inp.usdRate
        : (battery.costEGP / _EGP_BASE) * inp.usdRate);
  const bos          = actKwp * (inp.bosPerKwp ?? 8000);
  const engCost      = actKwp * (inp.engPerKwp ?? 5000);
  const connectionFeeEGP = inp.connectionFeeEnabled ? (inp.connectionFeeEGP||0) : 0;
  const sysC         = arrayCostEGP+invCostEGP+batCostEGP+bos+engCost+connectionFeeEGP;
  const costPerKwp   = sysC/actKwp;

  // E4: Performance Ratio — standard KPI (IEC 61724-1)




  // PR = actual annual yield / (actKwp × reference yield at STC irradiance)
  // Reference yield = annual POA irradiance / 1000 W/m²
  const annPSH     = tmyMonthly.reduce((s,m) => s + m.psh * m.days, 0); // kWh/m²/yr
  const perfRatio  = (actKwp > 0 && annPSH > 0)
    ? (annGenTMY / (actKwp * annPSH)) : 0;
  // Target PR for Cairo grid-tied residential: 0.74–0.80

  // E8: Bifacial rear irradiance — IEC TS 60904-1-2 two-component model
  // Component 1 (ground-reflected): albedo × GHI × VF_rear→ground × (1 − row_shade_frac)
  //   VF rear→ground = (1 + cos(tilt))/2
  // Component 2 (sky diffuse rear):  Gd × VF_rear→sky
  //   VF rear→sky = (1 − cos(tilt))/2  (small at low tilts, ~4% at 22°)
  //   Gd ≈ 0.27 × GHI (Cairo DHI/GHI ratio, PVGIS monthly average)
  // Row-height correction: fraction of inter-row ground in shadow reduces ground albedo component
  const albedo    = inp.albedo || 0.20;
  const tiltRad2  = (inp.tiltDeg * Math.PI) / 180;
  const panelSlpM = 2.10;  // standard panel length along slope (72-cell, m)
  // Inter-row pitch from winter-solstice 9 AM criterion (IEC 62817)
  const latR2   = (inp.lat || 30.06) * Math.PI / 180;
  const sinAlt9 = Math.max(0.08,
    Math.sin(latR2) * Math.sin(-0.4094) + Math.cos(latR2) * Math.cos(-0.4094) * Math.cos(0.7854));
  const pitchM  = Math.min(8.0, Math.max(panelSlpM + 0.3, panelSlpM * Math.sin(tiltRad2) / sinAlt9));
  const groundShadedFrac = Math.min(0.85, (panelSlpM * Math.cos(tiltRad2)) / Math.max(1, pitchM));
  const gRearGnd = albedo * ((1 + Math.cos(tiltRad2)) / 2) * (1 - groundShadedFrac * 0.55);
  const gRearSky = 0.27 * ((1 - Math.cos(tiltRad2)) / 2);
  const gRearFrac = panel.bifacial
    ? (gRearGnd + gRearSky) * (panel.bifacialFactor || 0.70)
    : 0;
  const bifacialMultE8 = panel.bifacial ? (1 + gRearFrac) : 1.0;

  // E9: IAM correction — ASHRAE simplified model (b0 = 0.05 per IEC 61853-2)
  // IAM applied as annual loss factor derived from monthly solar position
  // Spencer (1971) solar declination + Cairo latitude for mean daily incidence angle
  function iamFactor(lat_deg, tilt_deg) {
    const b0 = 0.05;
    const lat = lat_deg * Math.PI / 180;
    const tilt = tilt_deg * Math.PI / 180;
    let sumIAM = 0, count = 0;
    // Approximate annual IAM by sampling 12 monthly mean solar noon angles
    const decls = [-23.45,-20.9,-11.6,0,11.6,20.9,23.45,20.9,11.6,0,-11.6,-20.9]
      .map(d => d * Math.PI / 180);
    decls.forEach(decl => {
      // Solar elevation at solar noon: sin(elev) = sin(lat)sin(decl)+cos(lat)cos(decl)
      const sinElev = Math.sin(lat)*Math.sin(decl) + Math.cos(lat)*Math.cos(decl);
      const elev    = Math.asin(Math.max(-1, Math.min(1, sinElev)));
      // Incidence angle on south-facing tilted surface at solar noon
      const theta   = Math.abs(lat - decl - tilt); // simplified noon incidence
      const cosTheta = Math.max(0, Math.cos(theta));
      if (cosTheta > 0.01) {
        const iam = 1 - b0 * (1/cosTheta - 1);
        sumIAM += Math.max(0, iam);
        count++;
      }
    });
    return count > 0 ? sumIAM / count : 0.97;



  }
  const iamLoss    = iamFactor(inp.lat || 30.06, inp.tiltDeg || 22);
  // Apply IAM and updated bifacial to annual generation
  // E13: Near-shading from roof obstacles (parapets, AC units, water tanks)
  // Spencer (1971) solar position for Cairo, hourly for worst-month (Dec)
  function shadingLoss(obstacles, lat_deg, tilt_deg) {
    if (!obstacles || obstacles.length === 0) return 1.0;
    const lat = lat_deg * Math.PI / 180;
    // Sample 12 representative days (15th of each month), 24 hours
    const decls = [-23.45,-20.9,-11.6,0,11.6,20.9,23.45,20.9,11.6,0,-11.6,-20.9]
      .map(d => d * Math.PI / 180);
    let totalHrs = 0, shadedHrs = 0;
    decls.forEach((decl, mi) => {
      for (let h = 0; h < 24; h++) {
        const ha = (h - 12) * 15 * Math.PI / 180; // hour angle
        const sinAlt = Math.sin(lat)*Math.sin(decl) + Math.cos(lat)*Math.cos(decl)*Math.cos(ha);
        const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
        if (alt <= 0) continue; // below horizon — no generation anyway
        totalHrs++;
        const cosAz = (Math.sin(decl)-Math.sin(lat)*sinAlt)/(Math.cos(lat)*Math.cos(alt)+1e-9);
        const az_rad = ha < 0 ? -Math.acos(Math.max(-1,Math.min(1,cosAz))) : Math.acos(Math.max(-1,Math.min(1,cosAz)));
        const az_deg = (az_rad * 180 / Math.PI + 180) % 360; // 0=N, 90=E, 180=S, 270=W
        const alt_deg = alt * 180 / Math.PI;
        // Check each obstacle
        const shaded = obstacles.some(ob => {
          const shadeAngle = Math.atan2(ob.h, Math.max(0.1, ob.d)) * 180 / Math.PI;
          const azDiff = Math.abs(((az_deg - (ob.az||180)) + 540) % 360 - 180);
          return azDiff < 30 && alt_deg < shadeAngle; // within ±30° azimuth sector
        });
        if (shaded) shadedHrs++;
      }
    });
    return totalHrs > 0 ? 1 - (shadedHrs / totalHrs) * 0.8 : 1.0; // 80% — diffuse still reaches
  }
  const shadeFactor = shadingLoss(inp.obstacles, inp.lat||30.06, inp.tiltDeg||22);

  // E14: Horizon profile shading (user-supplied sun elevation vs azimuth table)
  function horizonShadingFactor(profile, lat_deg) {
    if (!profile || profile.length < 4) return 1.0;
    // Sort profile by azimuth, interpolate
    const sorted = [...profile].sort((a,b)=>a.az-b.az);
    function getHorizonElev(az) {
      for (let i=0; i<sorted.length-1; i++) {
        if (az >= sorted[i].az && az <= sorted[i+1].az) {
          const t = (az-sorted[i].az)/(sorted[i+1].az-sorted[i].az);
          return sorted[i].elev + t*(sorted[i+1].elev-sorted[i].elev);
        }


      }
      return sorted[0]?.elev || 0;
    }
    const lat = lat_deg * Math.PI / 180;
    const decls = [-23.45,-20.9,-11.6,0,11.6,20.9,23.45,20.9,11.6,0,-11.6,-20.9]
      .map(d => d*Math.PI/180);
    let tot=0, blk=0;
    decls.forEach(decl => {
      for (let h=0; h<24; h++) {
        const ha = (h-12)*15*Math.PI/180;
        const sinAlt = Math.sin(lat)*Math.sin(decl)+Math.cos(lat)*Math.cos(decl)*Math.cos(ha);
        const alt = Math.asin(Math.max(-1,Math.min(1,sinAlt)));
        if (alt<=0) continue;
        tot++;
        const cosAz=(Math.sin(decl)-Math.sin(lat)*sinAlt)/(Math.cos(lat)*Math.cos(alt)+1e-9);
        const az_rad = ha<0?-Math.acos(Math.max(-1,Math.min(1,cosAz))):Math.acos(Math.max(-1,Math.min(1,cosAz)));
        const az_deg = (az_rad*180/Math.PI+180)%360;
        if (alt*180/Math.PI < getHorizonElev(az_deg)) blk++;
      }
    });
    return tot>0 ? 1-(blk/tot)*0.85 : 1.0;
  }
  const horizonFactor = horizonShadingFactor(inp.horizonProfile, inp.lat||30.06);

  const annGenIAM = annGenTMY * iamLoss * bifacialMultE8 * shadeFactor * horizonFactor;

  // -- Financial model — v4: tiered tariff + P90 yield mode ------
  const monthlyLoadKwh = monthlyDemands.map((demH, mi) => {
    const dailyKwh = demH.reduce((s,v)=>s+v, 0);
    return dailyKwh * tmyMonthly[mi].days;
  });
  const annLoadKwh = monthlyLoadKwh.reduce((s,v)=>s+v, 0);

  // Yield factor: P90 applies country-specific derating to generation
  const yieldFactor = inp.yieldMode === "p90" ? siteP90 : 1.0;

  const scFrac = annSCPct / 100;
  let cum=0, pb=null, totalSav=0;
  const cfYears = [];
  for (let yr=1; yr<=inp.analysisPeriod; yr++) {
    // D4: LID (Light-Induced Degradation) — one-time first-year loss
    // PERC: ~2.0% year-1 LID; N-type (TOPCon/HJT): ~0.5% (IEC 61215 test data)
    const isNtypePanel = Math.abs(panel.gammaPmax || -0.40) <= 0.31 ||
                         /Neo|N-type|TOPCon|HJT|Hi-MO X/i.test(panel.model || "");
    const lidLoss = yr === 1 ? (isNtypePanel ? 0.005 : 0.020) : 0;
    // IEA-PVPS T13-2021 bi-linear degradation (1.3× rate for first 3 years)
    const deg     = bilinearDeg(yr-1, inp.panelDeg/100) * (1 - lidLoss);
    const escFac  = Math.pow(1 + inp.tariffEsc/100, yr-1);
    const tariff  = inp.tariffNow * escFac; // for flat mode display
    // SOH-aware dispatch for this year (battery degrades)
    let yearSav = 0;
    monthlyGen.forEach((mo, mi) => {




      const genMo  = mo.gen * deg * yieldFactor;
      const loadMo = monthlyLoadKwh[mi];
      const scMo   = dispatch
        ? Math.min((monthlySCArr[mi] || 0) * deg * yieldFactor, loadMo)
        : Math.min(genMo * scFrac, loadMo);
      if (inp.tariffMode === "tiered") {
        yearSav += tieredMonthlySaving(loadMo, scMo, escFac, inp.tariffTiers);
      } else {
        yearSav += scMo * tariff;
      }
      // Net metering / FiT — split peak/off-peak when TOU enabled
      if (inp.netMeteringEnabled) {
        const totalExport = Math.max(0, genMo - scMo);
        if (inp.touEnabled && dispatch && dispatch.monthlyPeakExportArr) {
          const pkScale  = deg * yieldFactor;
          const peakExp  = Math.min(totalExport, (dispatch.monthlyPeakExportArr[mi]||0) * pkScale);
          const offPkExp = Math.max(0, totalExport - peakExp);
          yearSav += (peakExp  * (inp.touPeakExportRate || inp.netMeteringRate || 0.68)
                    + offPkExp * (inp.netMeteringRate || 0.50)) * escFac;
        } else {
          yearSav += totalExport * (inp.netMeteringRate || 0.50) * escFac;
        }
      }
    });
    const om   = inp.omPerYear * Math.pow(1 + inp.omEsc/100, yr-1);
    const batR = (!noBat && yr === inp.batReplaceYear) ? batCostEGP : 0;
    const net  = yearSav - om - batR;
    cum += net;
    if (!pb && cum >= sysC) pb = yr;
    totalSav = cum;
    cfYears.push({yr, sav:Math.round(yearSav), om:Math.round(om),
                  bat:Math.round(batR), net:Math.round(net),
                  cum:Math.round(cum), pos:Math.round(cum - sysC)});
  }
  const netGain = totalSav - sysC;
  const roi = netGain / sysC * 100;
  // IRR via binary search
  let lo=0, hi=300, irr=0;
  for (let k=0; k<200; k++) {
    const m   = (lo + hi) / 2;
    const npv = cfYears.reduce((a,y) => a + y.net / Math.pow(1+m/100, y.yr), -sysC);
    if (Math.abs(npv) < 1) { irr = m; break; }
    npv > 0 ? (lo = m) : (hi = m);
    irr = m;
  }
  // E11: NPV at user discount rate
  const discRate = (inp.discountRate || 12) / 100;
  const npvAtRate = cfYears.reduce((a,y) => a + y.net / Math.pow(1+discRate, y.yr), -sysC);
  // E11: LCOE = (sysC + PV_OM + PV_replacements) / PV_kWh  (IEA/IRENA standard
// definition)
  // Numerator: all lifecycle costs in present value terms
  // Denominator: all lifetime energy production in present value terms
  const pvOM   = cfYears.reduce((a,y) => a + (y.om  / Math.pow(1+discRate, y.yr)), 0);
  const pvBatR = cfYears.reduce((a,y) => a + (y.bat  / Math.pow(1+discRate, y.yr)), 0);
  const pvKwh  = cfYears.reduce((a,y) => {
    const degLcoe = bilinearDeg(y.yr-1, inp.panelDeg/100);
    return a + (annGenTMY * degLcoe * (inp.yieldMode==="p90" ? siteP90 : 1))
               / Math.pow(1+discRate, y.yr);
  }, 0);
  // LCOE in EGP/kWh — cost per kWh that makes NPV = 0
  const lcoe = pvKwh > 0 ? ((sysC + pvOM + pvBatR) / pvKwh) : 0;

  // E11: Sensitivity — run ±20% on 4 key variables
  function sensitivityRun(varKey, delta) {
    const adjInp = {...inp, [varKey]: inp[varKey] * (1 + delta)};
    let cum2=0;
    cfYears.forEach(y => {
      const deg2 = Math.pow(1-adjInp.panelDeg/100, y.yr-1);
      const esc2 = Math.pow(1+adjInp.tariffEsc/100, y.yr-1);
      const genMo2 = annGenTMY * deg2 * (inp.yieldMode==="p90" ? siteP90 : 1) * scFrac / 12;
      let sav2 = 0;
      for (let mi=0; mi<12; mi++) {
        const loadMo = monthlyLoadKwh[mi] || (annLoadKwh / 12);
        const scMo   = Math.min(genMo2, loadMo);
        if (adjInp.tariffMode === "tiered") {
          sav2 += tieredMonthlySaving(loadMo, scMo, esc2, adjInp.tariffTiers);
        } else {
          sav2 += scMo * adjInp.tariffNow * esc2;
        }
      }
      const om2  = adjInp.omPerYear * Math.pow(1+adjInp.omEsc/100, y.yr-1);
      cum2 += sav2 - om2 - (!noBat && y.yr===inp.batReplaceYear ? batCostEGP : 0);
    });
    const adjSysC = varKey==="sysCAdj" ? sysC*(1+delta) : sysC;
    return cum2 - adjSysC;
  }
  const sensitivity = {
    tariff:   { lo: sensitivityRun("tariffNow",-0.2), hi: sensitivityRun("tariffNow", 0.2) },
    yield:    { lo: annGenTMY*(1-0.2)*scFrac*cfYears[24]?.sav/Math.max(1,cfYears[24]?.sav)||0,
                hi: 0 }, // simplified — show as % swing
    omCost:   { lo: sensitivityRun("omPerYear",-0.2), hi: sensitivityRun("omPerYear", 0.2) },
    panelDeg: { lo: sensitivityRun("panelDeg", -0.5), hi: sensitivityRun("panelDeg",  0.5) },
  };

  return {
    loadTot, peakKW, solarKwh, solarKW, effPct, coverageActual, loadMap,
    billScale, billDailyKwh, profileDailyKwh,
    annLoadKwh, monthlyLoadKwh, roofCapped, cappedKwp, roofPanelCap, maxPanelsByArea,
    tCellMax, tCellMin, etaSys, reqKwp,
    netRoof, panArea, roofFit, vocWin, vmpSum, pmaxSum,
    groundPanelCap, maxPanelsGroundNoShade, gMaxRows, gPanelsPerRow, totalPanelCap, roofPanelCap,
    nMax, nMin, nSel, nStr, totP, actKwp, strVoc, strVmp, dcAc, strPerMppt,
    annGenFlat, annGenTMY, annGenP90, bifacialMult, monthlyGen, tmySource, tmyMonthly,
    demand, hourlyGen, profileSCPct, annSCPct, annSSPct, eveningDeficit,
    batCyclesYear, monthlyGridArr, monthlySCArr, dispatch,
    clippingKwh: dispatch?.clippingKwh||0, clippingPct: dispatch?.clippingPct||0,
    panelVertM, panelBaseM, minPitch, maxRows, panelsPerRow,
    maxPanelsNoShade, rowShadeOk, interRowLossPct, chkRowShade,
    solarAltDeg: parseFloat(altDeg.toFixed(1)), elevCorr,
    usableBat, autonomy, designE, batRulePct, eveningDeficit,
    peakDemandKW, chkInvSize, chkDcAc, chkMpptMin, chkMpptMax, chkIscMppt,
    chkBatVolt, chkBatChg, chkBatRule, allOk,
    iStr, iStrD, csaStr, vdStr, iFdr, iFdrD, csaFdr, vdFdr, iBat, iAC, csaAC, vdAC,
    strFuse, acBreaker, mdbCheck,
    chkVdStr:vdStr<=1.5?"PASS":"FAIL", csaStr, csaFdr, csaAC,
    // B2: Clipping feedback — flag if significant clipping suggests inverter undersizing
    chkClipping: (dispatch?.clippingPct||0) > 6 ? "HIGH"   :
                 (dispatch?.clippingPct||0) > 3 ? "REVIEW" : "OK",
    chkVdFdr:vdFdr<=1.5?"PASS":"FAIL",
    chkVdAC :vdAC<=2.0 ?"PASS":"FAIL",
    chkSize500:actKwp<500?"PASS":"FAIL",
    chkSize50: actKwp<=50?"OK":"WARN",
    chkSize10: actKwp<=10?"OK":"WARN",
    arrayCostEGP, invCostEGP, batCostEGP, bos, engCost, sysC, costPerKwp,
    pb, netGain, roi:roi.toFixed(1), irr:irr.toFixed(1), cfYears,
    npvAtRate:Math.round(npvAtRate), lcoe:lcoe.toFixed(2), sensitivity,
    perfRatio:perfRatio.toFixed(3), iamLoss:iamLoss.toFixed(3), annGenIAM:Math.round(annGenIAM),
    shadeFactor:shadeFactor.toFixed(3), horizonFactor:horizonFactor.toFixed(3),
    totalSysC3:sysC*inp.nVillas, totalNetGain3:netGain*inp.nVillas,
    noBat,
  };
}

export function runOpt(inp, panelLib, invLib, batLib, selInv, selBat) {
  const inv = invLib.find(x=>x.id===selInv);
  const bat = batLib.find(x=>x.id===selBat);
  if (!inv||!bat) return [];
  // Fix 6: include nVillas in optimiser output; BoS/eng have scale discount at 3 villas
  const villaScale = Math.max(1, inp.nVillas||1);
  return Array.from({length:15},(_,idx)=>{
    const pct=30+idx*5;
    const r=calcEngine({...inp,coverageMode:"percentage",offsetPct:pct},panelLib[0],inv,bat);
    if(!r)return null;
    return {pct,kWp:r.actKwp.toFixed(1),panels:r.totP,
            costPerVilla:Math.round(r.sysC),
            cost3Villa:Math.round(r.sysC*villaScale),
            payback:r.pb||26,irr:parseFloat(r.irr),
            netGain:Math.round(r.netGain),
            netGain3:Math.round(r.netGain*villaScale)};
  }).filter(Boolean);
}
