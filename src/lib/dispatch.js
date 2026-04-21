import { cellTempFaiman, lowIrradianceFactor, solarCosIncidence, iamBeam, fitOneDiodeParams, translateOneDiode, solveMPP_norm } from "./physics.js";

export function runHourlyDispatch(hourlyGenKwp, actKwp, etaSysFixed, soilingByMonth,
                            monthlyDemands, battery, inverter, yearOffset,
                            opts) {
  // opts = { gpoa, tamb, panel, zeroExport, meterDemands }
  const { gpoa, tamb, panel, zeroExport, meterDemands, gbeam, gdiff, windspeed: wsArr, lat, tilt, az } = opts || {};
  const DAYS = [31,28,31,30,31,30,31,31,30,31,30,31];
  const yr   = yearOffset || 0;

  // Battery SOH: LiFePO4 -2%/yr, floor 70% (IEC 62619)
  const sohFactor  = Math.max(0.70, 1 - 0.02 * yr);
  // E3: split round-trip eta symmetrically: sqrt for charge, sqrt for discharge
  const etaChg     = Math.sqrt((battery.eta || 95) / 100);
  const etaDch     = Math.sqrt((battery.eta || 95) / 100);




  // Applied as an additional factor on top of SOH
  // D1: Battery temp derate computed per-month in dispatch loop using actual tamb
  // (moved from fixed pre-loop scalar to monthly variable — see mi loop below)
  const usableCapBase = battery.kwh * (battery.dod/100) * sohFactor;
  // Monthly usableCap with temperature derate is computed per-month below
  const minSOCBase  = usableCapBase * 0.10; // 10% reserve floor (base, scaled per month)

  const maxChargekW = inverter.batChargeKW || battery.kwh;
  const maxDischkW  = battery.kwh * (battery.cRate || 1.0);
  const invAcKW     = inverter.acKW || 999; // E1: clipping ceiling
  // B1: Part-load inverter efficiency from OND curve (E19)
  // effCurve = [{pct, eta}] sorted by pct ascending
  // If no curve, use single fixed eta (existing behaviour)
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
  let   soc         = usableCapBase * 0.50; // initialised from base; rescaled per-month below

  // E2: per-module NOCT and gammaPmax for hourly cell temp
  const noct      = panel ? (panel.noct || 44)        : 44;
  const gammaPmax = panel ? (panel.gammaPmax || -0.35) : -0.35;

  let totalGenKwh=0, totalSCKwh=0, totalGridKwh=0, totalExportKwh=0;
  let totalBatChgKwh=0, totalBatDischKwh=0, clippingKwh=0;
  const monthlyGenArr   = new Array(12).fill(0);
  const monthlySCArr    = new Array(12).fill(0);
  const monthlyGridArr  = new Array(12).fill(0);
  const eveningDeficits = new Array(12).fill(0);

  // D4 spectral correction table — Cairo monthly AM1.5-relative factors
  // Khamsin dust events Apr–May reduce blue spectrum; dry winter slightly blue-rich
  const _SPECTRAL_CAIRO = [1.005,1.005,1.002,0.994,0.990,0.998,1.002,1.003,1.003,1.003,1.004,1.005];

  // D5: One-diode model setup (fit once per dispatch call)
  // ETA_SYS_OD = DC system losses without temperature (wire × mismatch × lid × avail)
  // Calibrated v2: removed eta_reflect (subsumed by hourly IAM), eta_quality, eta_shading
  // Mirrors updated computeEtaSys; temperature handled by translateOneDiode/solveMPP_norm
  const ETA_SYS_OD  = 0.98 * 0.98 * 0.99 * 0.99; // = 0.9412 (was 0.895)
  const oneDiodeRef = (gpoa && panel) ? fitOneDiodeParams(panel) : null;

  let hr = 0;
  for (let mi=0; mi<12; mi++) {
    const soilFactor = 1 - (soilingByMonth[mi] || 0);
    // D1: Battery temperature derating per month using monthly average tamb
    // LFP loses ~0.6%/°C below 25°C — use monthly average ambient as proxy
    const DAYS_ARR = [31,28,31,30,31,30,31,31,30,31,30,31];
    let tAmbMonthAvg = 25;
    if (tamb) {
      let startHr = 0;
      for (let k=0; k<mi; k++) startHr += DAYS_ARR[k]*24;
      let tSum = 0;
      const cnt = DAYS_ARR[mi]*24;
      for (let k=0; k<cnt; k++) tSum += (tamb[startHr+k] || 25);
      tAmbMonthAvg = tSum / cnt;
    }
    const batTempDerateMonthly = Math.max(0.80, 1 - Math.max(0, (25 - tAmbMonthAvg) * 0.006));
    const usableCap  = usableCapBase * batTempDerateMonthly;
    const minSOC     = usableCap * 0.10;
    // E12: use meter-derived demand if available, else synthetic profile
    const demandH = (meterDemands && meterDemands[mi]) || monthlyDemands[mi];

    for (let d=0; d<DAYS[mi]; d++) {
      for (let h=0; h<24; h++) {




        // D1: Faiman cell temperature model (PVsyst default U0/U1)
        const G   = gpoa ? (gpoa[hr] || 0) : 0;
        const Ta  = tamb ? (tamb[hr] || 25) : 25;
        const ws  = wsArr ? Math.max(0, wsArr[hr] || 1.0) : 1.0;
        const U0  = panel?.u0 || 25.0;  // W/(m²·K) — PVsyst default ventilated roof
        const U1  = panel?.u1 || 6.84;  // W/(m²·K)/(m/s) — PVsyst default
        const Tc  = cellTempFaiman(G, Ta, ws, U0, U1);

        // D3: Hourly beam/diffuse/albedo IAM (replaces annual-average in etaSysFixed)
        // IAM normalised against 0.99 (eta_reflect) already baked into etaSysFixed
        let iamHr = 1.0;
        if (G > 10 && gbeam && gdiff) {
          const Gb = Math.max(0, gbeam[hr] || 0);
          const Gd = Math.max(0, gdiff[hr] || 0);
          const Gr = Math.max(0, G - Gb - Gd);
          const cosT = solarCosIncidence(hr, lat || 30.06, tilt || 22, az || 0);
          const iamB = iamBeam(cosT, panel?.b0 || 0.05);
          const iamW = (Gb * iamB + Gd * 0.900 + Gr * 0.856) / G; // weighted
          iamHr = Math.max(0.65, Math.min(1.05, iamW / 0.99)); // normalise vs static
        }

        // D4: Monthly spectral correction for Cairo (AM1.5-relative, Khamsin dust Apr-May)
        const specCorr = _SPECTRAL_CAIRO[mi] || 1.0;

        // D5/E1: DC generation — one-diode physical model (preferred) or linear fallback
        let dcKW;
        if (oneDiodeRef && G > 0) {
          // One-diode path: De Soto model captures temperature + low-irradiance non-linearity
          // ETA_SYS_OD excludes temperature correction (handled physically by the model)
          const tr       = translateOneDiode(oneDiodeRef, G, Tc);
          const pmppNorm = solveMPP_norm(tr, panel.wp);
          dcKW = pmppNorm * actKwp * ETA_SYS_OD * iamHr * specCorr * soilFactor;
        } else {
          // Fallback: linear scaling with Faiman temperature + IEC 61853-1 LI correction
          const etaTmp      = 1 + (gammaPmax / 100) * (Tc - 25);
          const TcRef       = cellTempFaiman(1000, 25, 1.0, U0, U1);
          const etaTmpRef   = Math.max(0.5, 1 + (gammaPmax / 100) * (TcRef - 25));
          const etaTempCorr = Math.max(0.5, Math.min(1.1, etaTmp / etaTmpRef));
          const liCorr      = G < 800 ? lowIrradianceFactor(G, panel) : 1.0;
          dcKW = (hourlyGenKwp[hr] || 0) * actKwp * etaSysFixed * etaTempCorr * liCorr * iamHr * specCorr * soilFactor;
        }
        // B1: part-load efficiency correction (OND curve or fixed eta)
        const invEta   = invEtaAtLoad(dcKW, inverter.effCurve, inverter.eta || 98);
        // B6: inverter temperature derating above 40°C (typically −2%/°C per IEC 62109)
        const invTDerate = Math.min(1.0, 1 - Math.max(0, (Ta - 40) * 0.02));
        const genDC    = dcKW * invEta * invTDerate;
        const clipped  = Math.max(0, genDC - invAcKW);
        clippingKwh   += clipped;
        const gen      = genDC - clipped;  // AC output after inverter limit

        const load = (demandH[h] || 0);
        const net  = gen - load;

        let gridImport=0, curtailed=0;
        if (net >= 0) {
          // Surplus: charge battery first
          // E3: energy stored = electrical_in * etaChg (charging loss)
          const canCharge  = Math.min((usableCap - soc) / etaChg, maxChargekW);
          const chargeElin = Math.min(net, canCharge);
          soc             += chargeElin * etaChg;
          totalBatChgKwh  += chargeElin;
          const afterCharge = net - chargeElin;
          // E17: zero-export — curtail remainder instead of exporting
          if (zeroExport) {
            curtailed       = afterCharge; // curtailed on AC side
          } else {
            curtailed       = 0;
            totalExportKwh += afterCharge;
          }
        } else {
          // Deficit: discharge battery first



          const needed     = -net;
          // E3: energy delivered = soc_drawn * etaDch (discharging loss)
          const canDrawSOC = Math.min((soc - minSOC), maxDischkW / etaDch);
          const socDrawn   = Math.max(0, Math.min(needed / etaDch, canDrawSOC));
          const delivered  = socDrawn * etaDch;
          soc             -= socDrawn;
          totalBatDischKwh += delivered;
          gridImport       = Math.max(0, needed - delivered);
          totalGridKwh    += gridImport;
          if (h>=17 && h<=22) eveningDeficits[mi] += gridImport;
        }

        const sc = Math.min(gen, load);  // self-consumed = min(gen, load)
        totalGenKwh  += gen;
        totalSCKwh   += sc;
        monthlyGenArr[mi]  += gen;
        monthlySCArr[mi]   += sc;
        monthlyGridArr[mi] += gridImport;
        hr++;
      }
    }
  }

  const batCycles = usableCapBase > 0 ? totalBatDischKwh / usableCapBase : 0;
  const annSCPct  = totalGenKwh > 0 ? (totalSCKwh  / totalGenKwh) * 100 : 0;
  const annSSPct  = totalGenKwh > 0 ? ((totalGenKwh - totalExportKwh) / totalGenKwh) * 100 : 0;
  const clippingPct = totalGenKwh > 0 ? (clippingKwh / (totalGenKwh + clippingKwh)) * 100 : 0;

  return {
    totalGenKwh, totalSCKwh, totalGridKwh, totalExportKwh,
    totalBatChgKwh, totalBatDischKwh, batCycles,
    clippingKwh, clippingPct,
    annSCPct, annSSPct,
    monthlyGenArr, monthlySCArr, monthlyGridArr,
    eveningDeficits, sohFactor, usableCap: usableCapBase,
    hourlyResolution: true,
  };
}
