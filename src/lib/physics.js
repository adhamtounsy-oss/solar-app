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
  const ha   = (hourOfDay + az_deg/15 + eot - 12) * 15 * Math.PI / 180;
  return Math.max(0,
    Math.sin(decl)*Math.sin(lat)*Math.cos(tilt)
    - Math.sin(decl)*Math.cos(lat)*Math.sin(tilt)*Math.cos(az)
    + Math.cos(decl)*Math.cos(lat)*Math.cos(ha)*Math.cos(tilt)
    + Math.cos(decl)*Math.sin(lat)*Math.cos(ha)*Math.sin(tilt)*Math.cos(az)
    + Math.cos(decl)*Math.sin(ha)*Math.sin(tilt)*Math.sin(az)
  );
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

export function translateOneDiode(ref, G, Tc_C) {
  if (!ref || G <= 0) return null;
  const Tc   = Tc_C + 273.15;        // °C → K
  const Tref = 298.15;               // K (25°C)
  const alphaIsc = (ref.alphaIsc || 0.05) / 100;
  const IL  = ref.IL * (G / 1000) * (1 + alphaIsc * (Tc_C - 25));
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

export function kimberSoiling(precipDaily, sRate, threshold, afterRain, initSoil) {
  const sr   = sRate    || 0.0015;
  const thr  = threshold || 0.5;
  const ar   = afterRain || 0.005;
  const init = initSoil  || 0.005;
  const DAYS = [31,28,31,30,31,30,31,31,30,31,30,31];
  const monthSoil = new Array(12).fill(0);
  let soil = init;
  let dayIdx = 0;
  for (let mi = 0; mi < 12; mi++) {
    let monthSum = 0;
    for (let d = 0; d < DAYS[mi]; d++) {
      const rain = precipDaily[dayIdx] || 0;
      if (rain >= thr) soil = ar;              // rain cleaning event
      else             soil = Math.min(0.30, soil + sr); // accumulate (cap at 30%)
      monthSum += soil;
      dayIdx++;
    }
    monthSoil[mi] = monthSum / DAYS[mi];
  }
  return monthSoil;
}
