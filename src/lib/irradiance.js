/**
 * Perez 1990 anisotropic diffuse transposition model
 * Perez et al. (1990) Solar Energy 45(5):363–370
 * Hourly distribution: Collares-Pereira & Rabl (1979) + Liu & Jordan (1960)
 * Monthly integration: Duffie & Beckman (2013) ch.2–3
 */

// Cairo (30.06°N, 31.22°E) monthly horizontal irradiance — PVGIS ERA5
// Units: kWh/m²/day (monthly average)
export const CAIRO_HORIZ = [
  { ghi: 3.88, dhi: 1.02 }, // Jan
  { ghi: 4.66, dhi: 1.23 }, // Feb
  { ghi: 5.83, dhi: 1.59 }, // Mar
  { ghi: 6.75, dhi: 1.84 }, // Apr
  { ghi: 7.35, dhi: 2.00 }, // May
  { ghi: 7.57, dhi: 2.00 }, // Jun
  { ghi: 7.51, dhi: 1.97 }, // Jul
  { ghi: 7.24, dhi: 1.85 }, // Aug
  { ghi: 6.24, dhi: 1.51 }, // Sep
  { ghi: 5.09, dhi: 1.24 }, // Oct
  { ghi: 4.00, dhi: 1.01 }, // Nov
  { ghi: 3.50, dhi: 0.89 }, // Dec
];

// Representative day-of-year for middle of each month
const _DOY = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344];
const _DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Perez 1990 Table 1: sky clearness ε bin edges (last bin = ∞)
const _EPS_EDGES = [1.000, 1.065, 1.230, 1.500, 1.950, 2.800, 4.500, 6.200];

// Perez coefficients [f11, f12, f13, f21, f22, f23] per bin
const _PF = [
  [-0.0083,  0.5877, -0.0621, -0.0596,  0.0721, -0.0220],
  [ 0.1299,  0.6826, -0.1514, -0.0189,  0.0660, -0.0289],
  [ 0.3297,  0.4869, -0.2211,  0.0554,  0.0564, -0.0276],
  [ 0.5682,  0.1875, -0.2951,  0.1089,  0.0273, -0.0201],
  [ 0.8730, -0.3920, -0.3616,  0.2256, -0.0500, -0.0038],
  [ 1.1326, -1.2367, -0.4118,  0.2878, -0.1670,  0.0019],
  [ 1.0601, -1.5999, -0.3589,  0.2642, -0.2127,  0.0085],
  [ 0.6777, -0.3273, -0.2504,  0.1592, -0.1132,  0.0139],
];

function _declRad(doy) {
  // Spencer (1971)
  const B = 2 * Math.PI * (doy - 1) / 365;
  return 0.006918 - 0.399912 * Math.cos(B) + 0.070257 * Math.sin(B)
       - 0.006758 * Math.cos(2*B) + 0.000907 * Math.sin(2*B);
}

function _eqtimeH(doy) {
  const B = 2 * Math.PI * (doy - 1) / 365;
  return (229.18 / 60) * (0.000075 + 0.001868*Math.cos(B) - 0.032077*Math.sin(B)
         - 0.014615*Math.cos(2*B) - 0.04089*Math.sin(2*B));
}

function _perezBin(eps) {
  for (let i = 0; i < _EPS_EDGES.length - 1; i++) {
    if (eps < _EPS_EDGES[i + 1]) return i;
  }
  return _EPS_EDGES.length - 1;
}

// POA for one half-hour interval (W/m²)
function _halfHourPoa(GHI_h, DHI_h, cosZ, cosInc, tilt_r) {
  if (cosZ < 0.01 || GHI_h < 0.5) return 0;
  const DNI_h = Math.max(0, (GHI_h - DHI_h) / cosZ);
  const tilC = Math.cos(tilt_r);
  const tilS = Math.sin(tilt_r);

  // Sky clearness ε (Perez eq.1)
  const z_r = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  const eps = Math.max(1, Math.min(8,
    ((DHI_h + DNI_h) / Math.max(1, DHI_h) + 1.041 * z_r**3) / (1 + 1.041 * z_r**3)
  ));

  // Sky brightness Δ = DHI × airmass / I₀ (I₀ = 1367 W/m²)
  const delta = Math.max(0.01, DHI_h / Math.max(0.087, cosZ) / 1367);

  const bin = _perezBin(eps);
  const [f11, f12, f13, f21, f22, f23] = _PF[bin];
  const F1 = Math.max(0, f11 + f12 * delta + f13 * z_r);
  const F2 = f21 + f22 * delta + f23 * z_r;

  const a = Math.max(0, cosInc);
  const b = Math.max(0.087, cosZ);

  const Gd_t = DHI_h * ((1 - F1) * (1 + tilC) / 2 + F1 * a / b + Math.max(0, F2) * tilS);
  const Gb_t = DNI_h * a;
  const Gr_t = GHI_h * 0.20 * (1 - tilC) / 2;

  return Gb_t + Gd_t + Gr_t;
}

/**
 * Monthly Perez transposition — daily horizontal GHI/DHI → daily tilted POA (kWh/m²/d).
 * Integrates over daylight hours using Collares-Pereira & Rabl hourly distribution.
 *
 * @param {number} ghi_d   - daily GHI kWh/m²/d
 * @param {number} dhi_d   - daily DHI kWh/m²/d
 * @param {number} lat_deg
 * @param {number} tilt_deg
 * @param {number} az_deg  - surface azimuth from south (west=+, east=−)
 * @param {number} mi      - month index 0–11
 * @returns {number} daily POA kWh/m²/d
 */
export function perezMonthlyPoa(ghi_d, dhi_d, lat_deg, tilt_deg, az_deg, mi) {
  const lat   = lat_deg   * Math.PI / 180;
  const tilt  = tilt_deg  * Math.PI / 180;
  const az    = az_deg    * Math.PI / 180;
  const doy   = _DOY[mi];
  const decl  = _declRad(doy);

  // Sunset hour angle
  const cosSs = -Math.tan(lat) * Math.tan(decl);
  if (Math.abs(cosSs) >= 1) return 0;
  const omegaS = Math.acos(cosSs);

  // Collares-Pereira & Rabl coefficients for GHI distribution
  const a_cpr = 0.409 + 0.5016 * Math.sin(omegaS - Math.PI / 3);
  const b_cpr = 0.6609 - 0.4767 * Math.sin(omegaS - Math.PI / 3);
  const denom = Math.sin(omegaS) - omegaS * Math.cos(omegaS);

  let poaWh = 0; // accumulate in Wh/m²
  const STEPS = 48; // 30-min intervals per day

  for (let k = 0; k < STEPS; k++) {
    // Solar hour angle ω (rad), noon = 0, morning < 0, afternoon > 0
    const omega = (-omegaS) + (k + 0.5) * 2 * omegaS / STEPS;
    if (Math.abs(omega) >= omegaS) continue;

    // Hourly fraction of daily GHI (Collares-Pereira & Rabl 1979)
    const rt = (Math.PI / 24) * (a_cpr + b_cpr * Math.cos(omega)) *
               (Math.cos(omega) - Math.cos(omegaS)) / denom;
    // Hourly fraction of daily DHI (Liu & Jordan 1960)
    const rd = (Math.PI / 24) * (Math.cos(omega) - Math.cos(omegaS)) / denom;

    const GHI_h = Math.max(0, rt * ghi_d * 1000); // W/m²
    const DHI_h = Math.max(0, rd * dhi_d * 1000);

    const cosZ = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(omega);
    if (cosZ < 0.01) continue;

    // cos(incidence) on tilted surface — Duffie & Beckman eq. 1.6.2
    const cosInc =
        Math.sin(decl) * Math.sin(lat) * Math.cos(tilt)
      - Math.sin(decl) * Math.cos(lat) * Math.sin(tilt) * Math.cos(az)
      + Math.cos(decl) * Math.cos(lat) * Math.cos(omega) * Math.cos(tilt)
      + Math.cos(decl) * Math.sin(lat) * Math.cos(omega) * Math.sin(tilt) * Math.cos(az)
      + Math.cos(decl) * Math.sin(omega) * Math.sin(tilt) * Math.sin(az);

    poaWh += _halfHourPoa(GHI_h, DHI_h, cosZ, cosInc, tilt) * (24 / STEPS);
  }

  return poaWh / 1000; // kWh/m²/d
}

/**
 * Annual POA (kWh/kWp/yr) via Perez model over 12 months.
 * Uses CAIRO_HORIZ as baseline irradiance; a calibration factor scales to
 * actual site yield when PVGIS data is available.
 *
 * @param {number} lat_deg
 * @param {number} tilt_deg
 * @param {number} az_deg
 * @param {number} [calib=1]  - scale factor: pvgisYield / perezYieldAtRefTilt
 * @returns {number} kWh/kWp/yr
 */
export function perezAnnualPoa(lat_deg, tilt_deg, az_deg, calib) {
  let annual = 0;
  for (let mi = 0; mi < 12; mi++) {
    const { ghi, dhi } = CAIRO_HORIZ[mi];
    annual += perezMonthlyPoa(ghi, dhi, lat_deg, tilt_deg, az_deg, mi) * _DAYS[mi];
  }
  return annual * (calib || 1.0);
}
