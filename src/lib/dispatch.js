import { cellTempFaiman, lowIrradianceFactor, solarCosIncidence, iamBeam,
         oneDiodeFromPanel, translateOneDiode, solveMPP_norm, solarAltAz,
         bypassDiodeClip } from "./physics.js";

// Interpolate horizon elevation at a given azimuth from south (west=+, east=-).
// horizonProfile can be:
//   - Array of {az, elev} objects (az from N=0, clockwise — PVGIS convention)
//   - Array of 12 numbers at 0°,30°,...,330° from North
function _horizonElevAt(horizonProfile, azDegFromSouth) {
  if (!horizonProfile || horizonProfile.length === 0) return 0;
  // Convert solar azimuth (south=0) to geographic bearing (north=0, clockwise)
  const bearing = ((azDegFromSouth + 180) % 360 + 360) % 360;

  if (typeof horizonProfile[0] === 'number') {
    // Simple 12-value array at 30° intervals from North
    const step = 360 / horizonProfile.length;
    const idx  = bearing / step;
    const lo   = Math.floor(idx) % horizonProfile.length;
    const hi   = (lo + 1) % horizonProfile.length;
    const t    = idx - Math.floor(idx);
    return (horizonProfile[lo] || 0) * (1 - t) + (horizonProfile[hi] || 0) * t;
  }
  // {az, elev} array — az assumed in geographic bearing (0=N, PVGIS format)
  const sorted = [...horizonProfile].sort((a, b) => a.az - b.az);
  if (sorted.length < 2) return sorted[0]?.elev || 0;
  if (bearing <= sorted[0].az) return sorted[0].elev;
  if (bearing >= sorted[sorted.length-1].az) return sorted[sorted.length-1].elev;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (bearing >= sorted[i].az && bearing <= sorted[i+1].az) {
      const t = (bearing - sorted[i].az) / (sorted[i+1].az - sorted[i].az);
      return sorted[i].elev + t * (sorted[i+1].elev - sorted[i].elev);
    }
  }
  return 0;
}

export function runHourlyDispatch(hourlyGenKwp, actKwp, etaSysFixed, soilingByMonth,
                            monthlyDemands, battery, inverter, yearOffset,
                            opts) {
  const {
    gpoa, tamb, panel, zeroExport, meterDemands,
    gbeam, gdiff, windspeed: wsArr, lat, tilt, az,
    horizonProfile,                      // NEW: far-field horizon obstruction
    shadingMatrix,                       // NEW: near-shading matrix[mi][h] fraction
    touPeakStart, touPeakEnd,            // NEW: TOU peak hours for export tracking
  } = opts || {};

  const DAYS = [31,28,31,30,31,30,31,31,30,31,30,31];
  const _DOY = [17,47,75,105,135,162,198,228,258,288,318,344];
  const yr   = yearOffset || 0;
  const noBat = !battery || battery.kwh === 0;
  const pkStart = touPeakStart || 17;
  const pkEnd   = touPeakEnd   || 22;

  const sohFactor  = noBat ? 1 : Math.max(0.70, 1 - 0.02 * yr);
  const etaChg     = noBat ? 1 : Math.sqrt((battery.eta || 95) / 100);
  const etaDch     = noBat ? 1 : Math.sqrt((battery.eta || 95) / 100);
  const usableCapBase = noBat ? 0 : battery.kwh * (battery.dod/100) * sohFactor;
  const maxChargekW = noBat ? 0 : (inverter.batChargeKW || battery.kwh);
  const maxDischkW  = noBat ? 0 : battery.kwh * (battery.cRate || 1.0);
  const invAcKW     = inverter.acKW || 999;

  function invEtaAtLoad(dcKW, effCurve, nomEta) {
    if (!effCurve || effCurve.length < 2) return nomEta / 100;
    const loadPct = Math.min(100, Math.max(0, (dcKW / invAcKW) * 100));
    const sorted  = [...effCurve].sort((a,b) => a.pct - b.pct);
    if (loadPct <= sorted[0].pct) return sorted[0].eta / 100;
    if (loadPct >= sorted[sorted.length-1].pct) return sorted[sorted.length-1].eta / 100;
    for (let i=0; i<sorted.length-1; i++) {
      if (loadPct >= sorted[i].pct && loadPct <= sorted[i+1].pct) {
        const t = (loadPct - sorted[i].pct) / (sorted[i+1].pct - sorted[i].pct);
        return (sorted[i].eta + t*(sorted[i+1].eta - sorted[i].eta)) / 100;
      }
    }
    return nomEta / 100;
  }
  let soc = usableCapBase * 0.50;

  const noct      = panel ? (panel.noct || 44)        : 44;
  const gammaPmax = panel ? (panel.gammaPmax || -0.35) : -0.35;

  let totalGenKwh=0, totalSCKwh=0, totalGridKwh=0, totalExportKwh=0;
  let totalBatChgKwh=0, totalBatDischKwh=0, clippingKwh=0;
  let peakExportKwh = 0;           // TOU peak-hour export
  let horizonLossKwh = 0;          // energy lost to horizon obstruction
  let nearShadeLossKwh = 0;        // energy lost to near-field shading

  const monthlyGenArr      = new Array(12).fill(0);
  const monthlySCArr       = new Array(12).fill(0);
  const monthlyGridArr     = new Array(12).fill(0);
  const monthlyPeakExportArr = new Array(12).fill(0);
  const eveningDeficits    = new Array(12).fill(0);

  const _SPECTRAL_CAIRO = [1.005,1.005,1.002,0.994,0.990,0.998,1.002,1.003,1.003,1.003,1.004,1.005];
  const ETA_SYS_OD      = 0.98 * 0.98 * 0.99 * 0.99; // wire × mismatch × LID × availability

  // D5: Prefer real CEC parameters over fitted estimate (reduces 2–4% model error)
  const oneDiodeRef = (gpoa && panel) ? oneDiodeFromPanel(panel) : null;

  // Horizon profile present → will apply per-hour beam blocking
  const hasHorizon = horizonProfile && horizonProfile.length > 0;

  let hr = 0;
  for (let mi=0; mi<12; mi++) {
    const soilFactor = 1 - (soilingByMonth[mi] || 0);
    const DAYS_ARR = [31,28,31,30,31,30,31,31,30,31,30,31];
    let tAmbMonthAvg = 25;
    if (tamb) {
      let startHr = 0;
      for (let k=0; k<mi; k++) startHr += DAYS_ARR[k]*24;
      let tSum = 0, cnt = DAYS_ARR[mi]*24;
      for (let k=0; k<cnt; k++) tSum += (tamb[startHr+k] || 25);
      tAmbMonthAvg = tSum / cnt;
    }
    const batTempDerateMonthly = Math.max(0.80, 1 - Math.max(0, (25 - tAmbMonthAvg) * 0.006));
    const usableCap  = usableCapBase * batTempDerateMonthly;
    const minSOC     = usableCap * 0.10;
    const demandH    = (meterDemands && meterDemands[mi]) || monthlyDemands[mi];
    const repDOY     = _DOY[mi];  // representative day for horizon/shading calculation

    for (let d=0; d<DAYS[mi]; d++) {
      for (let h=0; h<24; h++) {

        const G_raw = gpoa ? (gpoa[hr] || 0) : 0;
        const Ta  = tamb ? (tamb[hr] || 25) : 25;
        const ws  = wsArr ? Math.max(0, wsArr[hr] || 1.0) : 1.0;
        const U0  = panel?.u0 || 25.0;
        const U1  = panel?.u1 || 6.84;

        // ── Horizon far-field shading (hourly beam blocking) ──────────────────
        let G = G_raw;
        if (hasHorizon && G_raw > 10) {
          const { altDeg, azDeg } = solarAltAz(repDOY, h + 0.5, lat || 30.06);
          if (altDeg > 0) {
            const horizElev = _horizonElevAt(horizonProfile, azDeg);
            if (altDeg <= horizElev) {
              // Sun is below horizon obstruction: zero beam, keep diffuse + reflected
              const Gb_hr = gbeam ? Math.max(0, gbeam[hr] || 0) : G_raw * 0.75;
              G = Math.max(0, G_raw - Gb_hr);
              horizonLossKwh += Gb_hr > 0 ? Gb_hr * actKwp * ETA_SYS_OD / 1000 : 0;
            }
          }
        }

        // ── Near-field shading (from 3D shading matrix) ─────────────────────
        let nearShadeFrac = 0;
        if (shadingMatrix && shadingMatrix[mi] && shadingMatrix[mi][h] != null) {
          nearShadeFrac = Math.max(0, Math.min(1, shadingMatrix[mi][h]));
        }

        const Tc  = cellTempFaiman(G, Ta, ws, U0, U1);

        // D3: Hourly IAM
        let iamHr = 1.0;
        if (G > 10 && gbeam && gdiff) {
          const Gb = Math.max(0, gbeam[hr] || 0);
          const Gd = Math.max(0, gdiff[hr] || 0);
          const Gr = Math.max(0, G - Gb - Gd);
          const cosT = solarCosIncidence(hr, lat || 30.06, tilt || 22, az || 0);
          const iamB = iamBeam(cosT, panel?.b0 || 0.05);
          const iamW = (Gb * iamB + Gd * 0.900 + Gr * 0.856) / Math.max(G, 1);
          iamHr = Math.max(0.65, Math.min(1.05, iamW / 0.99));
        }

        const specCorr = _SPECTRAL_CAIRO[mi] || 1.0;

        // D5/E1: DC generation
        let dcKW;
        if (oneDiodeRef && G > 20) {   // 20 W/m² minimum inverter startup threshold
          const tr       = translateOneDiode(oneDiodeRef, G, Tc);
          const pmppNorm = solveMPP_norm(tr, panel.wp);
          dcKW = pmppNorm * actKwp * ETA_SYS_OD * iamHr * specCorr * soilFactor;
        } else {
          const etaTmp      = 1 + (gammaPmax / 100) * (Tc - 25);
          const TcRef       = cellTempFaiman(1000, 25, 1.0, U0, U1);
          const etaTmpRef   = Math.max(0.5, 1 + (gammaPmax / 100) * (TcRef - 25));
          const etaTempCorr = Math.max(0.5, Math.min(1.1, etaTmp / etaTmpRef));
          const liCorr      = G < 800 ? lowIrradianceFactor(G, panel) : 1.0;
          dcKW = (hourlyGenKwp[hr] || 0) * actKwp * etaSysFixed * etaTempCorr * liCorr * iamHr * specCorr * soilFactor;
        }

        // Apply near-field shading loss + bypass diode correction
        if (nearShadeFrac > 0 && panel) {
          const nStr = Math.max(1, Math.round(actKwp * 1000 / (panel.wp * (panel.nInStr || 20))));
          const shadedMods = Math.round(nearShadeFrac * (panel.nInStr || 20));
          const diodeLoss  = bypassDiodeClip(shadedMods, panel.nInStr || 20, panel.wp, nearShadeFrac);
          nearShadeLossKwh += dcKW * diodeLoss;
          dcKW *= (1 - diodeLoss);
        }

        const invEta   = invEtaAtLoad(dcKW, inverter.effCurve, inverter.eta || 98);
        const invTDerate = Math.min(1.0, 1 - Math.max(0, (Ta - 40) * 0.02));
        const genDC    = dcKW * invEta * invTDerate;
        const clipped  = Math.max(0, genDC - invAcKW);
        clippingKwh   += clipped;
        const gen      = genDC - clipped;

        const load = (demandH[h] || 0);
        const net  = gen - load;
        const isPeak = h >= pkStart && h < pkEnd;

        let gridImport=0, curtailed=0;
        if (net >= 0) {
          if (!noBat) {
            const canCharge  = Math.min((usableCap - soc) / etaChg, maxChargekW);
            const chargeElin = Math.min(net, canCharge);
            soc             += chargeElin * etaChg;
            totalBatChgKwh  += chargeElin;
            const afterCharge = net - chargeElin;
            if (zeroExport) { curtailed = afterCharge; }
            else {
              totalExportKwh += afterCharge;
              monthlyPeakExportArr[mi] += isPeak ? afterCharge : 0;
              if (isPeak) peakExportKwh += afterCharge;
            }
          } else {
            if (zeroExport) { curtailed = net; }
            else {
              totalExportKwh += net;
              monthlyPeakExportArr[mi] += isPeak ? net : 0;
              if (isPeak) peakExportKwh += net;
            }
          }
        } else {
          const needed = -net;
          if (!noBat) {
            const canDrawSOC = Math.min((soc - minSOC), maxDischkW / etaDch);
            const socDrawn   = Math.max(0, Math.min(needed / etaDch, canDrawSOC));
            const delivered  = socDrawn * etaDch;
            soc             -= socDrawn;
            totalBatDischKwh += delivered;
            gridImport       = Math.max(0, needed - delivered);
          } else {
            gridImport = needed;
          }
          totalGridKwh    += gridImport;
          if (h>=17 && h<=22) eveningDeficits[mi] += gridImport;
        }

        const sc = Math.min(gen, load);
        totalGenKwh  += gen;
        totalSCKwh   += sc;
        monthlyGenArr[mi]  += gen;
        monthlySCArr[mi]   += sc;
        monthlyGridArr[mi] += gridImport;
        // LiFePO4 self-discharge ~3%/month (IEC 62619); applied every hour
        if (!noBat) soc = Math.max(minSOC, soc * (1 - 0.03 / 730.5));
        hr++;
      }
    }
  }

  const batCycles    = usableCapBase > 0 ? totalBatDischKwh / usableCapBase : 0;
  const annSCPct     = totalGenKwh > 0 ? (totalSCKwh  / totalGenKwh) * 100 : 0;
  const annSSPct     = totalGenKwh > 0 ? ((totalGenKwh - totalExportKwh) / totalGenKwh) * 100 : 0;
  const clippingPct  = totalGenKwh > 0 ? (clippingKwh / (totalGenKwh + clippingKwh)) * 100 : 0;

  return {
    totalGenKwh, totalSCKwh, totalGridKwh, totalExportKwh,
    totalBatChgKwh, totalBatDischKwh, batCycles,
    clippingKwh, clippingPct,
    annSCPct, annSSPct,
    monthlyGenArr, monthlySCArr, monthlyGridArr,
    monthlyPeakExportArr, peakExportKwh,
    horizonLossKwh, nearShadeLossKwh,
    eveningDeficits, sohFactor, usableCap: usableCapBase,
    hourlyResolution: true,
  };
}
