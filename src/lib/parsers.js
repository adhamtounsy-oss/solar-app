export function parseSmartMeterCSV(text) {
  try {
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 25) return null;
    const header = lines[0].toLowerCase().split(/[,;\t]/);
    const kwhIdx = header.findIndex(h => /kwh|energy|consumption|usage|import/i.test(h));
    if (kwhIdx < 0) return null;
    const vals = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(/[,;\t]/);
      const v = parseFloat(cols[kwhIdx]);
      if (!isNaN(v) && v >= 0) vals.push(v);
    }
    if (vals.length < 24) return null;
    const hourly = new Float32Array(8760);
    for (let i = 0; i < 8760; i++) hourly[i] = vals[i % vals.length];
    return hourly;
  } catch(e) { return null; }
}

export function parsePVGISJson(data) {
  const rows  = data.outputs.hourly;          // 8760 objects
  const hourly    = new Float32Array(rows.map(r => (r.P        || 0) / 1000)); // kWh/kWp/h
  const gpoa      = new Float32Array(rows.map(r => (r["G(i)"]  || 0)));    // W/m² POA total
  const tamb      = new Float32Array(rows.map(r => (r.T2m      || 20)));   // °C ambient
  const gbeam     = new Float32Array(rows.map(r => Math.max(0, r["Gb(i)"] || 0))); // W/m² beam on tilted
  const gdiff     = new Float32Array(rows.map(r => Math.max(0, r["Gd(i)"] || 0))); // W/m² diffuse
  const windspeed = new Float32Array(rows.map(r => Math.max(0, r.WS10m    || 1.0))); // m/s at 10m E2
  const DAYS   = [31,28,31,30,31,30,31,31,30,31,30,31];
  const MNAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  let hi = 0;
  const monthly = DAYS.map((days, mi) => {
    let sumP=0, sumT=0, sumG=0;
    const count = days * 24;
    for (let d=0; d<count; d++) {
      sumP += hourly[hi] || 0;
      sumT += tamb[hi]   || 20;
      sumG += gpoa[hi]   || 0;
      hi++;
    }
    return {
      m: MNAMES[mi],
      psh:   parseFloat((sumP/days).toFixed(2)),
      tAmb:  parseFloat((sumT/count).toFixed(1)),
      gPoaAvg: parseFloat((sumG/count).toFixed(1)),
      days,
    };
  });
  const DAYS2 = [31,28,31,30,31,30,31,31,30,31,30,31];
  const precipDaily = [];
  let hi2 = 0;
  for (let mi2 = 0; mi2 < 12; mi2++) {
    for (let d = 0; d < DAYS2[mi2]; d++) {
      let dayRain = 0;
      for (let h = 0; h < 24; h++) { dayRain += (rows[hi2]?.RR || 0); hi2++; }
      precipDaily.push(dayRain);
    }
  }
  const hasPrecip = precipDaily.some(v => v > 0);
  return { hourly, gpoa, tamb, gbeam, gdiff, windspeed,
           precip: hasPrecip ? precipDaily : null,
           monthly, source: "pvgis" };
}

export function parsePANFile(text) {
  const lines = text.split(/\r?\n/);
  const get = (key) => {
    const line = lines.find(l => l.trim().toLowerCase().startsWith(key.toLowerCase()+'='));
    if (!line) return null;
    return line.split('=')[1]?.trim();
  };
  const pmax  = parseFloat(get('Pnom') || get('PNomTref') || '0');
  const voc   = parseFloat(get('Voc')  || '0');
  const isc   = parseFloat(get('Isc')  || '0');
  const vmp   = parseFloat(get('Vmpp') || get('Vmp') || '0');
  const imp   = parseFloat(get('Impp') || get('Imp') || '0');
  const beta     = parseFloat(get('muVocSpec') || get('BetaVoc') || '-0.30');
  const gamma    = parseFloat(get('muPmaxSpec') || get('GammaPmax') || '-0.40');
  const alphaIsc = parseFloat(get('muISCSpec')  || get('AlphaSC')  || '0.05');  // %/°C
  const noct     = parseFloat(get('NOCT') || get('Tnoct') || '45');
  const brand = get('Manufacturer') || get('Brand') || 'PAN Import';

  const model = get('PVObject_Name') || get('ModelName') || 'Imported Module';
  if (!pmax || !voc || !isc) return null;
  return {
    id: 'PAN_' + Date.now(), brand, model,
    wp: pmax, voc, vmp: vmp||voc*0.82, isc, imp: imp||isc*0.95,
    betaVoc: beta, gammaPmax: gamma, alphaIsc, noct,
    dimL: parseFloat(get('Width') || '2000'),
    dimW: parseFloat(get('Height') || '1000'),
    weightKg: parseFloat(get('Weight') || '30'),
    warranty25: 80, costUSD: 0.22,
    bifacial: (get('Bifacial') || '0') === '1',
    bifacialGain: parseFloat(get('BifacialityFactor') || '0') * 10,
    certifications: 'Imported from PAN file',
  };
}

export function parseONDFile(text) {
  const lines = text.split(/\r?\n/);
  const get = (key) => {
    const line = lines.find(l => l.trim().toLowerCase().startsWith(key.toLowerCase()+'='));
    if (!line) return null;
    return line.split('=')[1]?.trim();
  };
  const acKW     = parseFloat(get('Pnom') || get('PNomConv') || '10000') / 1000;
  const vdcMax   = parseFloat(get('VmppMax') || get('VAbsMax') || '1000');
  const eta      = parseFloat(get('EfficMax') || '97');
  const brand    = get('Manufacturer') || 'OND Import';
  const model    = get('PVObject_Name') || 'Imported Inverter';
  const effCurve = [];
  lines.forEach(l => {
    const m = l.match(/Eff_([0-9]+)=([0-9.]+)/i);
    if (m) effCurve.push({ pct: parseInt(m[1]), eta: parseFloat(m[2]) });
  });
  if (!acKW) return null;
  return {
    id: 'OND_' + Date.now(), brand, model,
    acKW, dcAcRatio: 1.3, vdcMax,
    mpptMin: parseFloat(get('VmppMin') || '200'),
    mpptMax: parseFloat(get('VmppMax') || '850'),
    iscPerMppt: parseFloat(get('IMaxDC') || '25'),
    numMppt: parseInt(get('NbInputs') || '2'),
    batVoltMin: 0, batVoltMax: 0, batChargeKW: 0,
    eta, thd: 3.0,
    effCurve,

    costEGP: 80000,
  };
}

export async function fetchPVGIS(lat, lon, tilt, azimuth) {
  const aspect = azimuth || 0;

  const pvgisUrl =
    `/api/pvgis?lat=${lat}&lon=${lon}&tilt=${tilt}&azimuth=${aspect}`;

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 45000); // 45s timeout

  let response;
  try {
    response = await fetch(pvgisUrl, {
      signal: controller.signal,
      headers: { "Accept": "application/json" },
    });
  } catch(e) {
    clearTimeout(timeout);
    if (e.name === "AbortError") throw new Error("PVGIS request timed out after 45s — check your internet connection");
    throw new Error(
      "PVGIS fetch blocked (CORS or network). " +
      "Open your browser console and check for a CORS error. " +
      "If running from claude.ai, try opening the workbook as a standalone HTML file instead."
    );
  }
  clearTimeout(timeout);

  if (!response.ok) {
    const txt = await response.text().catch(() => "");




    throw new Error(`PVGIS server returned ${response.status}: ${txt.slice(0,120)}`);
  }

  let data;
  try {
    data = await response.json();
  } catch(e) {
    throw new Error(`PVGIS returned non-JSON response: ${e.message}`);
  }

  if (!data?.outputs?.hourly) {
    throw new Error("PVGIS response missing outputs.hourly — check coordinates and parameters");
  }

  let horizonProfile = [];
  try {
    const hUrl = `https://re.jrc.ec.europa.eu/api/v5_2/printhorizon?lat=${lat}&lon=${lon}&outputformat=json`;
    const hRes = await fetch(hUrl, {
      headers: { "Accept": "application/json" },
      signal: (new AbortController()).signal
    });
    if (hRes.ok) {
      const hJson = await hRes.json();
      const hArr = hJson && hJson.outputs && hJson.outputs.horizon;
      if (Array.isArray(hArr)) {
        horizonProfile = hArr.map(function(pt) {
          return { az: pt.A, elev: pt.H_hor };
        });
      }
    }
  } catch(e) { /* horizon fetch is optional — ignore failures */ }

  const result = parsePVGISJson(data);
  if (horizonProfile.length > 0) result.horizonProfile = horizonProfile;
  return result;
}
