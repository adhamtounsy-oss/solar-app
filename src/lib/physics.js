export function cellTempFaiman(G, Ta, ws, U0, U1) {
  if (G <= 0) return Ta;
  return Ta + G / ((U0 || 25.0) + (U1 || 6.84) * Math.max(0, ws || 1.0));
}

const _LI_G     = [25,    50,    100,   200,   400,   600,   800,  1000];
const _LI_PERC  = [0.830, 0.880, 0.930, 0.970, 0.993, 0.999, 1.00, 1.00];
const _LI_NTYPE = [0.870, 0.910, 0.955, 0.982, 0.997, 1.000, 1.00, 1.00];
export function lowIrradianceFactor(G_wm2, panel) {
  if (G_wm2 >= 800) return 1.0;
  const isNtype = Math.abs(panel?.gammaPmax || -0.40) <= 0.31 ||
                  /Neo|N-type|TOPCon|HJT|Hi-MO X/i.test(panel?.model || '');
  const tbl = isNtype ? _LI_NTYPE : _LI_PERC;
  for (let i = 0; i < _LI_G.length - 1; i++) {
    if (G_wm2 >= _LI_G[i] && G_wm2 < _LI_G[i+1]) {
      const t = (G_wm2 - _LI_G[i]) / (_LI_G[i+1] - _LI_G[i]);
      return tbl[i] + t * (tbl[i+1] - tbl[i]);
    }
  }
  return Math.max(0.70, tbl[0] * (G_wm2 / _LI_G[0]));
}

// Fixed: removed spurious az_deg/15 term from hour angle (surface azimuth ≠ longitude offset)
export function solarCosIncidence(hr, lat_deg, tilt_deg, az_deg) {
  const dayOfYear  = Math.floor(hr / 24) + 1;
  const hourOfDay  = (hr % 24) + 0.5;
  const lat  = lat_deg  * Math.PI / 180;
  const tilt = tilt_deg * Math.PI / 180;
  const az   = az_deg   * Math.PI / 180;
  const B    = 2 * Math.PI * (dayOfYear - 1) / 366;           // 2020 = leap year
  const decl = 0.006918 - 0.399912*Math.cos(B) + 0.070257*Math.sin(B)
             - 0.006758*Math.cos(2*B) + 0.000907*Math.sin(2*B)
             - 0.002697*Math.cos(3*B) + 0.001480*Math.sin(3*B);
  const eot  = (229.18/60) * (0.000075 + 0.001868*Math.cos(B) - 0.032077*Math.sin(B)
              - 0.014615*Math.cos(2*B) - 0.04089*Math.sin(2*B));
  const ha   = (hourOfDay + eot - 12) * 15 * Math.PI / 180;  // hour angle only — no az_deg term
  return Math.max(0,
    Math.sin(decl)*Math.sin(lat)*Math.cos(tilt)
    - Math.sin(decl)*Math.cos(lat)*Math.sin(tilt)*Math.cos(az)
    + Math.cos(decl)*Math.cos(lat)*Math.cos(ha)*Math.cos(tilt)
    + Math.cos(decl)*Math.sin(lat)*Math.cos(ha)*Math.sin(tilt)*Math.cos(az)
    + Math.cos(decl)*Math.sin(ha)*Math.sin(tilt)*Math.sin(az)
  );
}

/**
 * Solar altitude and azimuth for a given day and hour (solar time).
 * Azimuth convention: south=0, west=+, east=- (matches app's surface azimuth convention).
 * @param {number} dayOfYear  1–365
 * @param {number} hourOfDay  0–23 (solar time; 12 = solar noon)
 * @param {number} lat_deg
 * @returns {{ altDeg: number, azDeg: number }}
 */
export function solarAltAz(dayOfYear, hourOfDay, lat_deg) {
  const lat  = lat_deg * Math.PI / 180;
  const B    = 2 * Math.PI * (dayOfYear - 1) / 365;
  const decl = 0.006918 - 0.399912*Math.cos(B) + 0.070257*Math.sin(B)
             - 0.006758*Math.cos(2*B) + 0.000907*Math.sin(2*B);
  const ha   = (hourOfDay - 12) * 15 * Math.PI / 180;  // hour angle, noon=0
  const sinAlt = Math.sin(lat)*Math.sin(decl) + Math.cos(lat)*Math.cos(decl)*Math.cos(ha);
  const altRad = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const cosAlt = Math.cos(altRad);
  const altDeg = altRad * 180 / Math.PI;
  const cosAz  = cosAlt > 0.001
    ? (Math.sin(decl) - Math.sin(lat)*sinAlt) / (Math.cos(lat)*cosAlt)
    : 0;
  // magnitude 0–180; sign: morning (ha<0) = east (negative), afternoon (ha>0) = west (positive)
  const azDeg  = Math.acos(Math.max(-1, Math.min(1, cosAz))) * 180 / Math.PI * (ha < 0 ? -1 : 1);
  return { altDeg, azDeg };
}

export function iamBeam(cosTheta, b0) {
  if (cosTheta <= 0.017) return 0;                   // θ > 89°
  return Math.max(0, 1 - (b0 || 0.05) * (1 / cosTheta - 1));
}

export function fitOneDiodeParams(panel) {
  const Isc = panel.isc, Voc = panel.voc, Impp = panel.imp, Vmpp = panel.vmp;
  if (!Isc || !Voc || !Impp || !Vmpp || Vmpp >= Voc || Impp >= Isc) return null;
  const Ns  = panel.ns || Math.max(36, Math.round(Voc / 0.685));
  const Vth = 0.025693;             // kT/q at 298.15 K [V]
  const a   = 1.2 * Ns * Vth;      // diode thermal voltage at STC [V]
  const I0_init = Isc * Math.exp(-Voc / a);
  if (I0_init <= 0) return null;
  const lnArg = (Isc - Impp) / I0_init;
  if (lnArg <= 0) return null;
  const Rs  = Math.max(0, (a * Math.log(lnArg) - Vmpp) / Impp);
  const x1 = Voc / a, x2 = (Vmpp + Impp * Rs) / a;
  const rshNum   = Voc - Vmpp - Impp * Rs;
  const rshDenom = I0_init * (Math.exp(Math.min(700, x1)) - Math.exp(Math.min(700, x2))) - Impp;
  const Rsh = (rshDenom > 0.01 * Isc)
    ? Math.min(3000, Math.max(50, rshNum / rshDenom))
    : 500;
  const IL  = Isc + I0_init * (Math.exp(Isc * Rs / a) - 1) + Isc * Rs / Rsh;
  const I0  = Math.max(1e-15, IL - Voc / Rsh) / Math.max(1e-15, Math.exp(Voc / a) - 1);
  return { IL, I0, Rs, Rsh, a, Ns };
}

/**
 * Build one-diode reference params from real CEC parameters (panel.cecA etc.)
 * Falls back to fitOneDiodeParams if CEC params are absent.
 */
export function oneDiodeFromPanel(panel) {
  if (!panel) return null;
  if (panel.cecA != null && panel.cecIl != null && panel.cecIo != null
      && panel.cecRs != null && panel.cecRsh != null) {
    return {
      IL: panel.cecIl, I0: panel.cecIo, Rs: panel.cecRs, Rsh: panel.cecRsh,
      a:  panel.cecA, Ns: panel.ns || 72,
      alphaIsc_AperK: panel.alphaIsc_AperK,    // absolute A/°C from CEC database
      isCEC: true,
    };
  }
  return fitOneDiodeParams(panel);
}

/**
 * Translate one-diode reference params to operating conditions (G, Tc).
 * Supports both CEC (absolute alphaIsc_AperK in A/°C) and legacy (%/°C) formats.
 * Uses De Soto (2006) model for IL, I0 translation; Varshni bandgap.
 */
export function translateOneDiode(ref, G, Tc_C) {
  if (!ref || G <= 0) return null;
  const Tc   = Tc_C + 273.15;        // °C → K
  const Tref = 298.15;               // K (25°C)

  // De Soto photocurrent: IL(G,Tc) = (G/Gref) * [IL_ref + alpha_sc * (Tc - Tref)]
  let IL;
  if (ref.alphaIsc_AperK != null) {
    // CEC path: absolute A/°C coefficient
    IL = (G / 1000) * (ref.IL + ref.alphaIsc_AperK * (Tc_C - 25));
  } else {
    // Legacy: %/°C relative coefficient
    const alphaIsc = (ref.alphaIsc || 0.05) / 100;
    IL = ref.IL * (G / 1000) * (1 + alphaIsc * (Tc_C - 25));
  }
  IL = Math.max(0, IL);

  const Eg_ref = 1.121;              // Si bandgap at 25°C [eV]
  const Eg     = Eg_ref * (1 - 0.0002677 * (Tc - Tref)); // Varshni T-dependence
  const Eg0_nkB = Eg_ref * ref.Ns * Tref / ref.a;
  const Eg_nkB  = Eg    * ref.Ns * Tref / ref.a;
  const I0  = ref.I0 * Math.pow(Tc / Tref, 3) * Math.exp(Eg0_nkB / Tref - Eg_nkB / Tc);
  const a   = ref.a * (Tc / Tref);
  const Rsh = ref.Rsh * (1000 / G);
  const Rs  = ref.Rs;
  return { IL, I0, Rs, Rsh, a };
}

export function solveMPP_norm(tr, Wp_stc) {
  if (!tr || tr.IL <= 0 || tr.I0 <= 0) return 0;
  const { IL, I0, Rs, Rsh, a } = tr;
  function solveI(V) {
    let I = Math.max(0, IL - I0 * Math.exp(Math.min(700, V / a)));
    for (let k = 0; k < 7; k++) {
      const x   = Math.min(700, (V + I * Rs) / a);
      const ex  = Math.exp(x);
      const f   = I - IL + I0 * (ex - 1) + (V + I * Rs) / Rsh;
      const df  = 1 + (I0 * Rs / a) * ex + Rs / Rsh;
      const dI  = f / df;
      I -= dI;
      I  = Math.max(0, I);
      if (Math.abs(dI) < 1e-8 * IL) break;
    }
    return Math.max(0, I);
  }
  const Voc_op = Math.min(a * Math.log(Math.max(1, IL / I0)), a * 80);
  const phi = 0.6180339887;
  let lo = Voc_op * 0.45, hi = Voc_op * 0.98;
  let vc = hi - phi * (hi - lo), vd = lo + phi * (hi - lo);
  let pc = vc * solveI(vc), pd = vd * solveI(vd);
  for (let k = 0; k < 55; k++) {
    if (hi - lo < 1e-5) break;
    if (pc < pd) { lo = vc; vc = vd; pc = pd; vd = lo + phi*(hi-lo); pd = vd*solveI(vd); }
    else         { hi = vd; vd = vc; pd = pc; vc = hi - phi*(hi-lo); pc = vc*solveI(vc); }
  }
  const Vmpp = (lo + hi) / 2;
  return Math.max(0, Vmpp * solveI(Vmpp)) / (Wp_stc || 1);
}

/**
 * Kimber (2006) soiling accumulation model with optional manual cleaning schedule.
 * @param {number[]} precipDaily   Daily precipitation (mm), length 365
 * @param {number}   sRate         Soiling accumulation rate (fraction/day), default 0.0015
 * @param {number}   threshold     Rain threshold for natural cleaning (mm), default 0.5
 * @param {number}   afterRain     Soiling residual after rain cleaning, default 0.005
 * @param {number}   initSoil      Initial soiling, default 0.005
 * @param {number}   cleanIntervalDays  0 = rain-only; >0 = manual cleaning every N days
 * @returns {number[]} 12-element monthly average soiling fraction
 */
export function kimberSoiling(precipDaily, sRate, threshold, afterRain, initSoil, cleanIntervalDays) {
  const sr   = sRate    || 0.0015;
  const thr  = threshold || 0.5;
  const ar   = afterRain || 0.005;
  const init = initSoil  || 0.005;
  const cleanEvery = cleanIntervalDays || 0;
  const DAYS = [31,28,31,30,31,30,31,31,30,31,30,31];
  const monthSoil = new Array(12).fill(0);
  let soil = init;
  let dayIdx = 0;
  for (let mi = 0; mi < 12; mi++) {
    let monthSum = 0;
    for (let d = 0; d < DAYS[mi]; d++) {
      const rain = precipDaily[dayIdx] || 0;
      if (rain >= thr) {
        soil = ar;                              // natural rain cleaning
      } else if (cleanEvery > 0 && dayIdx % cleanEvery === 0) {
        soil = ar;                              // manual cleaning event
      } else {
        soil = Math.min(0.30, soil + sr);       // accumulate (cap 30%)
      }
      monthSum += soil;
      dayIdx++;
    }
    monthSoil[mi] = monthSum / DAYS[mi];
  }
  return monthSoil;
}

/**
 * Bypass diode shading loss — IEC 62979 / PVsyst methodology.
 * 3 bypass diodes per 72-cell module (24-cell sub-strings).
 * @param {number} shadedModules   count of partially shaded modules in string
 * @param {number} nInString       modules per string
 * @param {number} modulePowerW    STC Wp per module
 * @param {number} shadedFraction  fraction of module area shaded (0–1)
 * @returns {number} fraction of string power lost (0–1)
 */
export function bypassDiodeClip(shadedModules, nInString, modulePowerW, shadedFraction) {
  const DIODES       = 3;
  const bypassedSubs = Math.min(DIODES, Math.ceil(shadedFraction * DIODES));
  const modLossFrac  = bypassedSubs / DIODES;
  if (!nInString || !modulePowerW) return 0;
  return (shadedModules * modLossFrac * modulePowerW) / (nInString * modulePowerW);
}
