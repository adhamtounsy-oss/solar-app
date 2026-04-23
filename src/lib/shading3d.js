/**
 * Near-shading geometry for solar panel arrays — pure JS, no GPU required.
 * Computes inter-row shading fractions from sun geometry and row dimensions.
 *
 * Azimuth convention throughout: south=0, west=+, east=- (matches app convention).
 * Shadow length is measured along the horizontal ground plane.
 */

// Representative day-of-year for each month (middle of month)
const _DOY = [17,47,75,105,135,162,198,228,258,288,318,344];

/**
 * Solar altitude and azimuth for a given day and solar-time hour.
 * @param {number} dayOfYear   1–365
 * @param {number} hourOfDay   solar hour (0–24; 12 = solar noon)
 * @param {number} lat_deg
 * @returns {{ altDeg: number, azDeg: number }}
 *   altDeg: elevation above horizon (degrees)
 *   azDeg:  azimuth from south (°), west=+, east=-
 */
export function solarAltAz(dayOfYear, hourOfDay, lat_deg) {
  const lat  = lat_deg * Math.PI / 180;
  const B    = 2 * Math.PI * (dayOfYear - 1) / 365;
  // Spencer (1971) declination
  const decl = 0.006918 - 0.399912*Math.cos(B) + 0.070257*Math.sin(B)
             - 0.006758*Math.cos(2*B) + 0.000907*Math.sin(2*B);
  const ha   = (hourOfDay - 12) * 15 * Math.PI / 180;  // hour angle, noon=0
  const sinAlt = Math.sin(lat)*Math.sin(decl) + Math.cos(lat)*Math.cos(decl)*Math.cos(ha);
  const altRad = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const cosAlt = Math.cos(altRad);
  const altDeg = altRad * 180 / Math.PI;
  // Azimuth from south — cos formula, sign from hour angle
  const cosAz  = cosAlt > 0.001
    ? (Math.sin(decl) - Math.sin(lat)*sinAlt) / (Math.cos(lat)*cosAlt)
    : 0;
  const azDeg = Math.acos(Math.max(-1, Math.min(1, cosAz))) * 180 / Math.PI
                * (ha < 0 ? -1 : 1);  // morning→negative (east), afternoon→positive (west)
  return { altDeg, azDeg };
}

/**
 * Minimum row spacing to avoid inter-row shading at a target sun elevation.
 * @param {number} panelHeightM  dimension of panel along tilt direction (m)
 * @param {number} tilt_deg      panel tilt (°)
 * @param {number} sunAltDeg     minimum sun elevation to design for (°)
 * @returns {number} minimum row pitch (m), centre to centre
 */
export function minRowSpacing(panelHeightM, tilt_deg, sunAltDeg) {
  const tilt  = tilt_deg  * Math.PI / 180;
  const sunA  = Math.max(1, sunAltDeg) * Math.PI / 180;
  // Horizontal projection of panel + shadow length of vertical rise
  const horiz = panelHeightM * Math.cos(tilt);
  const rise  = panelHeightM * Math.sin(tilt);
  return horiz + rise / Math.tan(sunA);
}

/**
 * Fraction of panel row that is shaded given the sun direction and geometry.
 * Uses a simplified 2-D profile model (inter-row, south-facing array).
 * For non-south arrays, the effective sun altitude in the array plane is used.
 *
 * @param {number} altDeg      solar altitude (°)
 * @param {number} azDeg       solar azimuth from south (°)
 * @param {number} arrayAzDeg  array azimuth from south (°), south=0
 * @param {number} panelH      panel height along slope (m)
 * @param {number} rowSpacingM centre-to-centre row pitch (m)
 * @param {number} tilt_deg
 * @returns {number} shading fraction 0–1
 */
function _rowShadeFrac(altDeg, azDeg, arrayAzDeg, panelH, rowSpacingM, tilt_deg) {
  if (altDeg <= 0) return 0;
  const tilt   = tilt_deg * Math.PI / 180;
  // Project sun into the cross-section plane of the row (perpendicular to row axis)
  const relAz  = (azDeg - arrayAzDeg) * Math.PI / 180;
  const effAlt = Math.atan(Math.tan(altDeg * Math.PI / 180) / Math.max(0.001, Math.abs(Math.cos(relAz))));
  if (effAlt <= 0) return 0;
  // Horizontal ground between panel tops (clear distance)
  const clearGround = rowSpacingM - panelH * Math.cos(tilt);
  // Shadow length cast on ground by the panel's vertical rise
  const panelRise  = panelH * Math.sin(tilt);
  const shadowLen  = panelRise / Math.tan(effAlt);
  if (shadowLen <= clearGround) return 0;
  // Shaded fraction of next row's collector area
  const shadedLen  = Math.min(shadowLen - clearGround, panelH * Math.cos(tilt));
  return Math.min(1, shadedLen / (panelH * Math.cos(tilt)));
}

/**
 * Compute monthly × hourly inter-row shading matrix.
 * For an N-row array, only rows 2..N are shaded by the row in front.
 * The first row is never shaded (no obstruction in front of it).
 * Returns the array-average shading fraction (all rows weighted equally).
 *
 * @param {number} lat_deg       site latitude (°)
 * @param {number} tilt_deg      panel tilt (°)
 * @param {number} az_deg        array azimuth from south (°)
 * @param {number} panelHeightM  panel dimension along slope (m), typically 1.0–2.1
 * @param {number} rowSpacingM   centre-to-centre row pitch (m)
 * @param {number} [nRows=10]    number of rows in array
 * @returns {{
 *   matrix: number[][],        // [12][24] shading fraction (0–1)
 *   monthlyLoss: number[],     // [12] weighted average daily shading loss (0–1)
 *   annualLossFrac: number,    // irradiance-weighted annual shading loss (0–1)
 *   optSpacing: number,        // recommended spacing for <2% shading loss (m)
 * }}
 */
export function computeShadingMatrix(lat_deg, tilt_deg, az_deg, panelHeightM, rowSpacingM, nRows) {
  const rows  = nRows || 10;
  // Only rows behind the front row can be shaded
  const shadedRowFrac = (rows - 1) / rows;

  const matrix = Array.from({ length: 12 }, () => new Array(24).fill(0));
  const monthlyGhi  = [3.88,4.66,5.83,6.75,7.35,7.57,7.51,7.24,6.24,5.09,4.00,3.50]; // Cairo kWh/m²/d

  let annWeightedLoss = 0, annWeight = 0;
  for (let mi = 0; mi < 12; mi++) {
    let dayLossSum = 0, dayWeight = 0;
    for (let h = 5; h < 20; h++) {
      const { altDeg, azDeg } = solarAltAz(_DOY[mi], h + 0.5, lat_deg);
      if (altDeg <= 0) { matrix[mi][h] = 0; continue; }
      const frac = _rowShadeFrac(altDeg, azDeg, az_deg, panelHeightM, rowSpacingM, tilt_deg);
      // Array-average: only the non-front-row fraction is affected
      const arrFrac = frac * shadedRowFrac;
      matrix[mi][h] = arrFrac;
      // Weight by approximate irradiance (sin of altitude proxy)
      const w = Math.sin(altDeg * Math.PI / 180);
      dayLossSum += arrFrac * w;
      dayWeight  += w;
    }
    const dayAvg = dayWeight > 0 ? dayLossSum / dayWeight : 0;
    const ghiW   = monthlyGhi[mi];
    annWeightedLoss += dayAvg * ghiW;
    annWeight       += ghiW;
  }

  const annualLossFrac = annWeight > 0 ? annWeightedLoss / annWeight : 0;
  const monthlyLoss    = matrix.map(row => {
    const vals = row.filter(v => v > 0);
    return vals.length ? vals.reduce((s,v)=>s+v,0)/vals.length : 0;
  });

  // Optimal spacing: iterate until annual loss < 2%
  let optSpacing = rowSpacingM;
  for (let sp = panelHeightM; sp <= panelHeightM * 6; sp += 0.1) {
    let loss = 0, wt = 0;
    for (let mi = 0; mi < 12; mi++) {
      for (let h = 6; h < 18; h++) {
        const { altDeg, azDeg } = solarAltAz(_DOY[mi], h + 0.5, lat_deg);
        if (altDeg <= 0) continue;
        const f = _rowShadeFrac(altDeg, azDeg, az_deg, panelHeightM, sp, tilt_deg) * shadedRowFrac;
        const w = Math.sin(altDeg * Math.PI / 180);
        loss += f * w; wt += w;
      }
    }
    if (wt > 0 && loss / wt < 0.02) { optSpacing = sp; break; }
  }

  return { matrix, monthlyLoss, annualLossFrac, optSpacing: Math.round(optSpacing * 100) / 100 };
}

/**
 * Compute recommended row spacing for a given min winter sun elevation.
 * Cairo winter solstice (Dec 21) at 9 AM local → ~23° elevation.
 */
export function recommendedSpacing(panelHeightM, tilt_deg, lat_deg) {
  const dec21 = 355; // day 355 ≈ Dec 21
  // Find minimum sun altitude between 9 AM and 3 PM at winter solstice
  let minAlt = 90;
  for (let h = 9; h <= 15; h++) {
    const { altDeg } = solarAltAz(dec21, h, lat_deg);
    if (altDeg > 0 && altDeg < minAlt) minAlt = altDeg;
  }
  return minRowSpacing(panelHeightM, tilt_deg, Math.max(5, minAlt));
}
