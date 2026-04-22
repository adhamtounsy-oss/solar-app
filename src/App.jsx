import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { C, CAIRO_TMY_FALLBACK, DESIGN_PSH, CAIRO_SOILING, P90_FACTOR, SIGMA_IRR, SIGMA_MODEL, SIGMA_TOT, WIN_HRS, WIN_START, WIN_END } from "./constants/index.js";
import { I18N, T } from "./i18n/index.js";
import { SAMPLE_PANELS, SAMPLE_INVERTERS, SAMPLE_BATTERIES } from "./data/components.js";
import { NAV_GROUPS, DEF } from "./config/nav.js";
import { EGYPT_TARIFF_TIERS, tieredMonthlySaving } from "./lib/financial.js";
import { saveProject, loadProject, listProjects, deleteProject } from "./lib/storage.js";
import { cellTempFaiman, lowIrradianceFactor, solarCosIncidence, iamBeam, fitOneDiodeParams, translateOneDiode, solveMPP_norm, kimberSoiling } from "./lib/physics.js";
import { parseSmartMeterCSV, parsePVGISJson, parsePANFile, parseONDFile, fetchPVGIS } from "./lib/parsers.js";
import { runHourlyDispatch } from "./lib/dispatch.js";
import { computeLoadProfile, seasonalAcScale, computeEtaSys } from "./lib/profile.js";
import { passColor, cardS, tbl, SH, Row, Calc, Bar, TblHead } from "./components/ui/primitives.jsx";
import LocationPickerModal from "./components/LocationPickerModal.jsx";
import MiniMapPreview from "./components/MiniMapPreview.jsx";
import { calcEngine, runOpt, bilinearDeg } from "./engine/calcEngine.js";

/**
 * Monte Carlo yield distribution — lognormal, 500 samples, Box-Muller transform
 * @param {number} annGenP50  P50 annual generation kWh
 * @param {number} [nSamples] default 500
 * @returns {{p10,p25,p50,p75,p90,p99}} percentile yields in kWh
 */function monteCarloYield(annGenP50, nSamples) {
  nSamples = nSamples || 500;
  const mu    = Math.log(Math.max(1, annGenP50)) - 0.5 * SIGMA_TOT * SIGMA_TOT;
  const sigma = SIGMA_TOT;
  const samples = [];
  for (let i = 0; samples.length < nSamples + 2; i++) {
    const u1 = Math.max(1e-10, Math.random());
    const u2 = Math.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
    samples.push(Math.exp(mu + sigma * z0));
    samples.push(Math.exp(mu + sigma * z1));
  }
  samples.sort(function(a, b) { return a - b; });
  const s = samples.slice(0, nSamples);
  function pct(p) { return Math.round(s[Math.min(Math.floor(p / 100 * nSamples), nSamples - 1)]); }
  return { p10: pct(10), p25: pct(25), p50: pct(50), p75: pct(75), p90: pct(90), p99: pct(99) };
}

/**
 * Bypass diode shading loss — IEC 62979 / PVsyst methodology
 * 3 bypass diodes per 72-cell module (24-cell sub-strings)
 * @param {number} shadedModules   count of partially shaded modules in string
 * @param {number} nInString       modules per string
 * @param {number} modulePowerW    STC Wp per module
 * @param {number} shadedFraction  fraction of module area shaded (0–1)
 * @returns {number} fraction of string power lost (0–1)
 */function bypassDiodeClip(shadedModules, nInString, modulePowerW, shadedFraction) {
  const DIODES       = 3;
  const bypassedSubs = Math.min(DIODES, Math.ceil(shadedFraction * DIODES));
  const modLossFrac  = bypassedSubs / DIODES;
  if (!nInString || !modulePowerW) return 0;
  return (shadedModules * modLossFrac * modulePowerW) / (nInString * modulePowerW);
}

/**
 * Lightning protection / SPD sizing — IEC 62305-2 + IEC 60364-7-712
 * Egypt Ng = 2.0 flashes/km²/yr (IEC 62305-2 Annex A, Cairo region)
 * @param {Object} inp  DEF input object
 * @param {Object} r    calcEngine result object
 * @returns {{type,Nd,Nc,spdRating,note}}
 */function calcSPD(inp, r) {
  const Ng   = 2.0;    // Egypt ground flash density
  const Cd   = 1.0;    // isolated structure (no nearby trees/buildings)
  const nPan = (r && r.nPanels) || Math.round((inp.systemKwp || 5) * 1000 / 580);
  const side = Math.sqrt(Math.max(1, nPan) * 2.0); // ~2 m² footprint per panel
  // IEC 62305-2 eq. A.1: equivalent collection area
  const Ae   = side * side
              + 6 * (side + side) * Math.tan(30 * Math.PI / 180)
              + Math.PI * 36;
  const Nd   = Ng * Ae * 1e-6 * Cd;
  const Nc   = 1.0 / (inp.analysisPeriod || 25);
  const hi   = Nd > Nc;
  return {
    type:      hi ? "Type 1 + Type 2" : "Type 2 only",
    Nd:        +Nd.toFixed(4),
    Nc:        +Nc.toFixed(4),
    spdRating: hi ? "25 kA (10/350 µs)" : "20 kA (8/20 µs)",
    note:      hi ? "Direct strike risk — Type 1 mandatory per IEC 62305"
                  : "Indirect/induced surges — Type 2 sufficient per IEC 60364-7-712"
  };
}

/**
 * Tilt-azimuth parametric sweep — isotropic sky model (Klein 1977)
 * Tilts: 0°…45° (11 steps); Azimuths: −60°…+60° (9 steps, S=0)
 * @param {Object} inp       DEF input parameters (lat, systemKwp, tiltDeg)
 * @param {Object} pvgisRef  PVGIS result (annGenKwh) — null uses 1850 kWh/kWp fallback
 * @returns {{tilts, azimuths, grid, optTilt, optAz, optYield}}
 */function tiltAzSweep(inp, pvgisRef) {
  const tilts    = [0, 5, 10, 15, 20, 22, 25, 30, 35, 40, 45];
  const azimuths = [-60, -45, -30, -15, 0, 15, 30, 45, 60];
  const lat_r    = (inp.lat || 30.06) * Math.PI / 180;
  const baseYield = pvgisRef && pvgisRef.annGenKwh
    ? pvgisRef.annGenKwh / Math.max(0.1, inp.systemKwp || 5)
    : 1850;
  const grid = tilts.map(function(tilt) {
    const t_r = tilt * Math.PI / 180;
    return azimuths.map(function(az) {
      const Rb  = Math.max(0, Math.cos(lat_r - t_r) / Math.max(0.01, Math.cos(lat_r)));
      const Fd  = (1 + Math.cos(t_r)) / 2;   // diffuse view factor
      const Fr  = 0.20 * (1 - Math.cos(t_r)) / 2; // ground-reflected
      const azP = 1 - Math.min(0.20, 0.002 * Math.abs(az)); // ~0.2%/° off south
      const rel = (Rb * 0.60 + Fd * 0.30 + Fr * 0.10) * azP;
      return Math.round(baseYield * Math.max(0.70, rel));
    });
  });
  let optTilt = tilts[0], optAz = 0, optYield = 0;
  tilts.forEach(function(tilt, ti) {
    azimuths.forEach(function(az, ai) {
      if (grid[ti][ai] > optYield) { optYield = grid[ti][ai]; optTilt = tilt; optAz = az; }
    });
  });
  return { tilts: tilts, azimuths: azimuths, grid: grid,
           optTilt: optTilt, optAz: optAz, optYield: optYield };
}

/**
 * Optimizer / micro-inverter incremental NPV (NREL Deline 2013)
 * η_recovery = 0.75: fraction of shading loss recovered by MLPE
 * Uses bilinear degradation in discounted savings calculation
 * @param {Object} r    calcEngine result (annGenTMY, nPanels)
 * @param {Object} inp  DEF input parameters
 * @returns {{costEGP, extraYieldPct, deltaNPV, netBenefit, paybackYr, worthIt}}
 */function optimizerNPV(r, inp) {
  const shadingLoss = inp.shadingLossFraction || 0.05;
  const etaRecov    = 0.75;   // NREL Deline 2013
  const extraFrac   = shadingLoss * etaRecov;
  const nPan        = (r && r.nPanels) || 0;
  const costEGP     = nPan * (inp.costPerOptimizerUSD || 30) * (inp.usdRate || 55);
  const disc        = (inp.discountRate || 12) / 100;
  let deltaNPV = 0, cum = 0, paybackYr = null;
  for (let yr = 1; yr <= (inp.analysisPeriod || 25); yr++) {
    const deg      = bilinearDeg(yr - 1, (inp.panelDeg || 0.65) / 100);
    const escFac   = Math.pow(1 + (inp.tariffEsc || 18) / 100, yr - 1);
    const extraKwh = (r && r.annGenTMY || 0) * extraFrac * deg;
    const extraSav = extraKwh * (inp.tariffNow || 1.95) * escFac;
    deltaNPV += extraSav / Math.pow(1 + disc, yr);
    cum      += extraSav;
    if (!paybackYr && cum >= costEGP) paybackYr = yr;
  }
  return { costEGP: Math.round(costEGP),
           extraYieldPct: +(extraFrac * 100).toFixed(1),
           deltaNPV: Math.round(deltaNPV),
           netBenefit: Math.round(deltaNPV - costEGP),
           paybackYr: paybackYr,
           worthIt: (deltaNPV - costEGP) > 0 };
}

/**
 * Fetch NASA POWER monthly GHI cross-check vs PVGIS (10-yr mean 2014–2023)
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{ghiAnn:number, months:number[]}>}
 */async function fetchNASAPOWER(lat, lon) {
  const url = "https://power.larc.nasa.gov/api/temporal/monthly/point?" +
    "parameters=ALLSKY_SFC_SW_DWN&community=RE" +
    "&longitude=" + lon + "&latitude=" + lat +
    "&start=2014&end=2023&format=JSON";
  const ctrl = new AbortController();
  const t    = setTimeout(function() { ctrl.abort(); }, 30000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error("NASA POWER returned HTTP " + res.status);
    const json = await res.json();
    const raw  = json && json.properties && json.properties.parameter
               && json.properties.parameter.ALLSKY_SFC_SW_DWN;
    if (!raw) throw new Error("NASA POWER: missing ALLSKY_SFC_SW_DWN in response");
    const sums   = new Array(12).fill(0);
    const counts = new Array(12).fill(0);
    Object.keys(raw).forEach(function(key) {
      if (key.length === 6 && raw[key] > 0) {
        const mo = parseInt(key.slice(4, 6), 10) - 1;
        sums[mo]   += raw[key];
        counts[mo] += 1;
      }
    });
    const MDAYS  = [31,28,31,30,31,30,31,31,30,31,30,31];
    const months = sums.map(function(s, i) {
      return counts[i] > 0 ? +(s / counts[i]).toFixed(2) : 0;
    });
    const ghiAnn = Math.round(months.reduce(function(a, v, i) {
      return a + v * MDAYS[i];
    }, 0));
    return { ghiAnn: ghiAnn, months: months };
  } catch(e) {
    clearTimeout(t);
    throw e;
  }
}



// --- Main App 

export default function App() { 
  const [inp,setInp] = useState(() => {
    try {
      const saved = localStorage.getItem("solar_wb_inp");
      return saved ? {...DEF, ...JSON.parse(saved)} : DEF;
    } catch { return DEF; }
  }); 
  const [tab,setTab]           = useState("dashboard"); 
  const [panelLib,setPLib]     = useState(SAMPLE_PANELS); 
  const [invLib,setILib]       = useState(SAMPLE_INVERTERS); 
  const [batLib,setBLib]       = useState(SAMPLE_BATTERIES); 
  const [selPanel,setSelPanel] = useState("P01"); 
  const [selInv,setSelInv]     = useState("I04"); 
  const [selBat,setSelBat]     = useState("B00");
  const [locked,setLocked]     = useState({panel:false,inverter:false,battery:false}); 
  const [rankMode,setRankMode] = useState("weighted"); 
  const [showCmp,setShowCmp]   = useState(false); 
  const [uploadMsg,setUpMsg]   = useState(""); 
  // PVGIS 
  const [pvgisData,setPvgisData]     = useState(null); 
  const [pvgisStatus,setPvgisStatus] = useState("idle"); 
  const [pvgisMsg,setPvgisMsg]       = useState(""); 
  // Projects 
  const [projects,setProjects]   = useState([]); 
  const [projName,setProjName]   = useState("My Project"); 
  const [saveStatus,setSaveStatus] = useState(""); 

 
 
  // Proposal 
  const [propLoading,setPropLoading] = useState(false); 
  const [propText,setPropText]       = useState(""); 
  // SLD mode 
  const [sldMode,setSldMode] = useState("client"); 
  // Smart meter CSV (E12) — stored in inp.meterData for dispatch 
  const [meterData,setMeterData] = useState(null); 
  const [meterMsg,setMeterMsg]   = useState(""); 
  // PAN/OND file upload state (E15) 
  const [panMsg,setPanMsg] = useState(""); 
  const [ondMsg,setOndMsg] = useState(""); 
  // Two-tier nav: track active group
  const [navGroup,setNavGroup] = useState("results");
  // Client presentation mode: hides engineering tabs for screen-sharing
  const [clientMode,setClientMode] = useState(false);
  // Phase 1 new state
  const [lang,setLang]               = useState(inp.lang || "en");
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [nasaWarning,setNasaWarning] = useState(null);    // NASA POWER cross-check result
  const [inputHash,setInputHash]     = useState('');       // SHA-256 QR verification
  const [yieldDist,setYieldDist]     = useState(null);     // Monte Carlo result
  const [sweepResult,setSweepResult] = useState(null);     // tilt/az sweep heatmap
  const [usdRateLive,setUsdRateLive] = useState(null);     // live EGP/USD rate
  const [optimNpv,setOptimNpv]       = useState(null);     // optimizer NPV result
  const [spdResult,setSpdResult]     = useState(null);     // SPD sizing result

  const fileRef       = useRef();
  const pvgisTimerRef = useRef(null);   // debounce auto-PVGIS fetch
  const prevLatRef    = useRef(30.06);  // track prev lat for auto-tilt
  const upd = useCallback((k,v) => setInp(p => ({...p,[k]:v})), []);

  // Auto-save to localStorage — debounced 1s to avoid thrashing on rapid input
  const saveTimerRef = useRef(null);
  useEffect(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try { localStorage.setItem("solar_wb_inp", JSON.stringify(inp)); } catch {}
    }, 1000);
    return () => clearTimeout(saveTimerRef.current);
  }, [inp]); 

  // -- Tooltip help system -----------------------------------------------------
  const [tooltip,setTooltip] = useState({visible:false,text:"",x:0,y:0});
  const showTip = (e, text) => {
    const r2 = e.currentTarget.getBoundingClientRect();
    setTooltip({visible:true, text, x:r2.left+r2.width/2, y:r2.top-8});
  };
  const hideTip = () => setTooltip(t=>({...t,visible:false}));
  // Tip(text) → inline ? icon that shows tooltip on hover
  const Tip = ({text}) => (
    <span onMouseEnter={e=>showTip(e,text)} onMouseLeave={hideTip}
      style={{display:"inline-flex",alignItems:"center",justifyContent:"center",
        width:14,height:14,borderRadius:"50%",background:C.border,color:C.muted,
        fontSize:9,fontWeight:800,cursor:"help",marginLeft:4,flexShrink:0,
        verticalAlign:"middle",userSelect:"none"}}>
      ?
    </span>
  );

  const handleFetchPVGIS = useCallback(async () => { 
    setPvgisStatus("loading"); 
    setPvgisMsg("⏳ Connecting to PVGIS (JRC / European Commission)… fetching 8,760 hourly values, takes 5–20s."); 
    try { 
      const data = await fetchPVGIS(inp.lat||30.06, inp.lon||31.45, inp.tiltDeg||22, inp.azimuth||0); 
      setPvgisData(data);
      setPvgisStatus("done");
      // Auto-populate horizon profile if PVGIS printhorizon endpoint returned data
      if (data.horizonProfile && data.horizonProfile.length > 0) {
        upd("horizonProfile", data.horizonProfile);
      }
      const annPsh = data.monthly.reduce((s,m) => s+m.psh*m.days, 0) / 365;
      const decPsh = data.monthly[11].psh;
      setPvgisMsg("✅ PVGIS ERA5 loaded — 8,760 hourly values · Dec PSH: " + decPsh.toFixed(2) + "h · Ann avg: " + annPsh.toFixed(2) + "h/day · Hourly dispatch active"); 
    } catch(e) { 
      setPvgisStatus("error"); 
      setPvgisMsg("❌ " + e.message + " — workbook will use built-in monthly TMY fallback.");
    } 
  }, [inp.lat, inp.lon, inp.tiltDeg, inp.azimuth]); 

  const handleLocationPick = useCallback((newLat, newLon, name, elev) => {
    setInp(prev => ({
      ...prev,
      lat:          newLat,
      lon:          newLon,
      locationName: name || "",
      elevationM:   elev ?? null,
      // Auto-fill address from reverse geocode only when blank or still factory default
      address: (!prev.address || prev.address === DEF.address)
        ? (name || prev.address)
        : prev.address,
    }));
    setShowLocationPicker(false);
    // pvgisKey effect auto-triggers PVGIS fetch on lat/lon change
  }, []);

  // Project handlers — all promise-based, no async in JSX
  const handleSaveProject = useCallback(() => { 
    const state = {inp, selPanel, selInv, selBat}; 
    saveProject(projName, state).then(ok => { 
      setSaveStatus(ok ? "Saved: " + projName : "Save failed"); 
      listProjects().then(setProjects); 
      setTimeout(() => setSaveStatus(""), 3000); 
    }); 
  }, [inp, selPanel, selInv, selBat, projName]); 

  const handleLoadProject = useCallback((name) => { 
    loadProject(name).then(state => { 
      if (!state) return; 

 
 
 
 
      if (state.inp)      setInp(state.inp); 
      if (state.selPanel) setSelPanel(state.selPanel); 
      if (state.selInv)   setSelInv(state.selInv); 
      if (state.selBat)   setSelBat(state.selBat); 
      setProjName(name); 
      setSaveStatus("Loaded: " + name); 
      setTimeout(() => setSaveStatus(""), 3000); 
    }); 
  }, []); 

  const handleDeleteProject = useCallback((name) => { 
    deleteProject(name).then(() => listProjects().then(setProjects)); 
  }, []); 

  const handleMeterCSV = useCallback((e) => { 
    const file = e.target.files[0]; 
    if (!file) return; 
    const reader = new FileReader(); 
    reader.onload = (ev) => { 
      const hourly = parseSmartMeterCSV(ev.target.result); 
      if (hourly) { 
        setMeterData(hourly); upd('meterData', hourly); 
        const avg = (hourly.reduce((s,v) => s+v, 0) / hourly.length).toFixed(2); 
        setMeterMsg("Smart meter loaded: " + hourly.length + " hours, avg " + avg + " kWh/hr"); 
      } else { 
        setMeterMsg("Could not parse CSV — expected time-series with kWh column."); 
      } 
    }; 
    reader.readAsText(file); 
    e.target.value = ""; 
  }, []); 

  // -- Derived state — declared before callbacks that reference them -- 
  const pvgisKey = inp.lat + "_" + inp.lon + "_" + inp.tiltDeg + "_" + inp.azimuth;

  // Auto-fetch PVGIS when location or tilt changes (debounced 800ms)
  // Eliminates the manual fetch button — data loads automatically
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    clearTimeout(pvgisTimerRef.current);
    pvgisTimerRef.current = setTimeout(() => {
      setPvgisStatus("loading");
      setPvgisMsg("⏳ Fetching PVGIS ERA5 hourly data…");
      fetchPVGIS(inp.lat||30.06, inp.lon||31.45, inp.tiltDeg||22, inp.azimuth||0)
        .then(data => {
          setPvgisData(data);
          setPvgisStatus("done");
          if (data.horizonProfile && data.horizonProfile.length > 0) {
            upd("horizonProfile", data.horizonProfile);
          }
          const annPsh = data.monthly.reduce((s,m)=>s+m.psh*m.days,0)/365;
          const decPsh = data.monthly[11].psh;
          setPvgisMsg("✅ PVGIS ERA5 · Dec PSH: "+decPsh.toFixed(2)+"h · Annual avg: "+annPsh.toFixed(2)+"h/day · Hourly dispatch active");
        })
        .catch(e => { setPvgisStatus("error"); setPvgisMsg("❌ "+e.message+" — using monthly TMY fallback"); });
    }, 800);
    return () => clearTimeout(pvgisTimerRef.current);
  }, [pvgisKey]);

  // Auto-tilt: optimal tilt ≈ lat × 0.76 — only updates if tilt was previously auto-set
  useEffect(() => {
    const prevOpt = Math.round(prevLatRef.current * 0.76);
    const newOpt  = Math.round((inp.lat||30) * 0.76);
    if (inp.tiltDeg === prevOpt) upd("tiltDeg", newOpt);
    prevLatRef.current = inp.lat||30;
  }, [inp.lat]);

  // -- NASA POWER GHI cross-check (re-runs when lat/lon or pvgisData changes) --
  useEffect(() => {
    if (!inp.lat || !inp.lon) return;
    fetchNASAPOWER(inp.lat, inp.lon)
      .then(function(nasa) {
        const pvgisGhi = pvgisData
          ? Math.round(pvgisData.monthly.reduce(function(s,m) { return s + m.psh * m.days; }, 0))
          : null;
        if (pvgisGhi && Math.abs(nasa.ghiAnn - pvgisGhi) / pvgisGhi > 0.08) {
          setNasaWarning("⚠ NASA POWER GHI (" + nasa.ghiAnn + " kWh/m²/yr) differs from " +
            "PVGIS by " + (Math.abs(nasa.ghiAnn - pvgisGhi) / pvgisGhi * 100).toFixed(1) +
            "% — verify site coordinates and horizon profile.");
        } else {
          setNasaWarning(pvgisGhi
            ? "✅ NASA POWER GHI " + nasa.ghiAnn + " kWh/m²/yr — within 8% of PVGIS (" + pvgisGhi + ")"
            : "NASA POWER GHI: " + nasa.ghiAnn + " kWh/m²/yr");
        }
      })
      .catch(function() { /* silent — informational only */ });
  }, [inp.lat, inp.lon, pvgisData]);  // eslint-disable-line react-hooks/exhaustive-deps

  // -- Live EGP/USD exchange rate ---------------------------------------------
  useEffect(() => {
    fetch("https://open.er-api.com/v6/latest/USD")
      .then(function(r2) { return r2.json(); })
      .then(function(d) {
        if (d && d.rates && d.rates.EGP) {
          setUsdRateLive(+d.rates.EGP.toFixed(2));
          upd("usdRate", +d.rates.EGP.toFixed(2));
        }
      })
      .catch(function() {});
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // -- SHA-256 QR verification hash ------------------------------------------
  useEffect(() => {
    if (!window.crypto || !window.crypto.subtle) return;
    const keyParams = { lat: inp.lat, lon: inp.lon, systemKwp: inp.systemKwp,
      panelDeg: inp.panelDeg, yieldMode: inp.yieldMode,
      analysisPeriod: inp.analysisPeriod, discountRate: inp.discountRate };
    const encoded = new TextEncoder().encode(JSON.stringify(keyParams));
    window.crypto.subtle.digest("SHA-256", encoded).then(function(buf) {
      setInputHash(Array.from(new Uint8Array(buf))
        .map(function(b) { return b.toString(16).padStart(2, "0"); }).join("").slice(0, 16));
    }).catch(function() {});
  }, [inp.lat, inp.lon, inp.systemKwp, inp.panelDeg, inp.yieldMode,
      inp.analysisPeriod, inp.discountRate]);

  const panel    = useMemo(() => panelLib.find(p => p.id===selPanel) || panelLib[0], [panelLib, selPanel]);
  const inverter = useMemo(() => invLib.find(x => x.id===selInv)    || invLib[0],    [invLib, selInv]);
  const battery  = useMemo(() => batLib.find(b => b.id===selBat)    || batLib[0],    [batLib, selBat]);
  const r        = useMemo(() => calcEngine(inp, panel, inverter, battery, pvgisData),
                            [inp, panel, inverter, battery, pvgisData]);

  // -- Monte Carlo yield distribution ----------------------------------------
  useEffect(() => {
    if (!r || !r.annGenTMY) { setYieldDist(null); return; }
    setYieldDist(monteCarloYield(r.annGenTMY, 500));
  }, [r ? r.annGenTMY : null]);  // eslint-disable-line react-hooks/exhaustive-deps

  // -- Tilt/azimuth sweep heatmap --------------------------------------------
  useEffect(() => {
    setSweepResult(tiltAzSweep(inp, pvgisData));
  }, [inp.lat, inp.lon, inp.systemKwp, pvgisData]);  // eslint-disable-line react-hooks/exhaustive-deps

  // -- Optimizer NPV ---------------------------------------------------------
  useEffect(() => {
    if (!r || !r.annGenTMY) { setOptimNpv(null); return; }
    setOptimNpv(optimizerNPV(r, inp));
  }, [r ? r.annGenTMY : null, inp.shadingLossFraction, inp.costPerOptimizerUSD,
      inp.usdRate, inp.discountRate]);  // eslint-disable-line react-hooks/exhaustive-deps

  // -- SPD sizing ------------------------------------------------------------
  useEffect(() => {
    if (!r) { setSpdResult(null); return; }
    setSpdResult(calcSPD(inp, r));
  }, [r ? r.nPanels : null, inp.systemKwp, inp.tiltDeg, inp.analysisPeriod]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Sync navGroup when tab changes from external setTab calls
  useEffect(() => {
    const grp = NAV_GROUPS.find(g => g.tabs.some(t => t.id === tab));
    if (grp && grp.id !== navGroup) setNavGroup(grp.id);
  }, [tab]);
  // -- Workflow completeness — drives nav group badges ------------------------
  const completeness = useMemo(() => {
    const loadOk = inp.loadMethod==="meter"
      ? !!inp.meterData
      : (inp.loadMethod==="bill" ? inp.monthlyBillEGP > 0 : inp.acUnits > 0 || inp.miscKW > 0);
    const equipOk  = !!(panel && inverter && battery);
    const solarOk  = pvgisStatus==="done" || pvgisStatus==="error";
    const sizingOk = !!(r && r.actKwp > 0);
    const resultsOk= sizingOk && solarOk;
    return {
      setup:   loadOk && equipOk ? "done" : (loadOk || equipOk) ? "partial" : "empty",
      design:  solarOk && sizingOk ? "done" : solarOk ? "partial" : "empty",
      results: resultsOk ? "done" : sizingOk ? "partial" : "empty",
      export:  resultsOk ? "done" : "empty",
    };
  }, [inp, panel, inverter, battery, pvgisStatus, r]);

  // -- Inline validation — proactive warnings computed from current state ------
  // NOTE: must stay after `r` is defined above
  const warnings = useMemo(() => {
    const w = [];
    if (!r) return w;
    // DC/AC ratio
    if (r.dcAc > 1.58)
      w.push({id:"dcac",   sev:"red",    scope:"sizing",
        msg:`DC/AC ratio ${r.dcAc.toFixed(2)} exceeds 1.58 — high clipping risk. Reduce panels or increase inverter size.`});
    else if (r.dcAc > 1.45)
      w.push({id:"dcac",   sev:"orange", scope:"sizing",
        msg:`DC/AC ratio ${r.dcAc.toFixed(2)} — moderate clipping. Acceptable for high-irradiance sites; verify clipping < 3%.`});
    // String Voc vs inverter max
    if (r.strVoc > (inverter?.vdcMax || 1000) * 0.95)
      w.push({id:"voc",    sev:"red",    scope:"array",
        msg:`String Voc ${r.strVoc?.toFixed(0)}V is within 5% of inverter limit ${inverter?.vdcMax}V. Reduce series panels or check cold-temp Voc.`});
    // Monthly bill vs profile mismatch
    if (inp.loadMethod==="bill" && r.annLoadKwh > 0) {
      const billKwh = (inp.monthlyBillEGP / Math.max(0.1, inp.tariffNow)) * 12;
      const ratio   = billKwh / r.annLoadKwh;
      if (ratio < 0.5 || ratio > 2.0)
        w.push({id:"load",   sev:"orange", scope:"load",
          msg:`Bill implies ~${Math.round(billKwh)} kWh/yr but appliance profile gives ${Math.round(r.annLoadKwh)} kWh/yr (${(ratio*100).toFixed(0)}% match). Check bill amount or profile.`});
    }
    // Coverage too low to justify battery
    if (r.coverageActual < 40 && r.usableBat > 5)
      w.push({id:"bat",    sev:"orange", scope:"battery",
        msg:`Solar coverage ${r.coverageActual?.toFixed(0)}% is low — battery may not charge fully. Consider increasing panel count first.`});
    // Clipping
    if ((r.clippingPct||0) > 5)
      w.push({id:"clip",   sev:"orange", scope:"sizing",
        msg:`Inverter clipping ${r.clippingPct?.toFixed(1)}% — ${Math.round(r.clippingKwh||0)} kWh/yr lost. Consider larger inverter.`});
    // Tilt/azimuth suboptimal for Cairo
    if (inp.azimuth > 45 || inp.azimuth < -45)
      w.push({id:"az",     sev:"orange", scope:"solar",
        msg:`Azimuth ${inp.azimuth}° deviates >45° from South — yield penalty ~${Math.round((1-Math.cos((inp.azimuth||0)*Math.PI/180)*0.15)*100-85)}%. Consider south-facing orientation.`});
    return w;
  }, [r, inp, inverter]);

  // Warning banner component — renders scope-filtered warnings inline
  const WarnBanner = ({scope}) => {
    const relevant = warnings.filter(w => w.scope===scope);
    if (!relevant.length) return null;
    return(
      <div style={{marginBottom:10}}>
        {relevant.map(w=>(
          <div key={w.id} style={{padding:"8px 14px",borderRadius:8,marginBottom:6,
            background:w.sev==="red"?`${C.red}18`:`${C.orange}18`,
            borderLeft:`3px solid ${w.sev==="red"?C.red:C.orange}`,
            fontSize:11,color:w.sev==="red"?C.red:C.orange,lineHeight:1.5}}>
            {w.sev==="red"?"⛔":"⚠"} {w.msg}
          </div>
        ))}
      </div>
    );
  };

  const optData  = useMemo(() => runOpt(inp, panelLib, invLib, batLib, selInv, selBat),
                            [inp, panelLib, invLib, batLib, selInv, selBat]); 
  const profile  = useMemo(() => { 
    const profileDailyKwh = (() => { 
      const acKW2=inp.acUnits*inp.acTonnage*(3.517/(inp.acCOP||3.0)), lKW2=(inp.lightingAreaM2*8)/1000; 

 
 
 
 
      const pf2={AC:inp.prof_AC||[0.3,0.8,0.6],Light:inp.prof_Light||[0.2,0.0,1.0], 
        WH:inp.prof_WH||[0.8,0.0,0.5],Kitchen:inp.prof_Kitchen||[0.5,0.2,0.8], Laundry:inp.prof_Laundry||[0.0,0.8,0.2],Pool:inp.prof_Pool||[0.0,1.0,0.0],Misc:inp.prof_Misc||[

0.2,0.3,0.5]}; 
      const kws2={AC:acKW2,Light:lKW2,WH:inp.whKW,Kitchen:inp.kitchenW/1000, 
        Laundry:inp.laundryW/1000,Pool:inp.poolKW,Misc:inp.miscKW}; 
      return Object.keys(kws2).reduce((s,k,ki) => s+kws2[k]*pf2[k].reduce((a,f,i) => a+f*WIN_HRS[i], 0), 0); 
    })(); 
    const billScale2 = inp.loadMethod==="bill" 
      ? ((inp.monthlyBillEGP/inp.tariffNow)/30.5) / Math.max(profileDailyKwh, 0.1) 
      : 1; 
    return computeLoadProfile(inp, billScale2, 1); 
  }, [inp]); 
  const fmtE = v => "E\xa3" + (v/1000).toFixed(0) + "K";
  const yGen = r ? (inp.yieldMode==="p90" ? r.annGenP90 : r.annGenTMY) : 0;
  const fmtU = v => "$" + (v/inp.usdRate/1000).toFixed(0) + "K"; 

  const handleGenerateProposal = useCallback(async () => { 
    if (!r) return; 
    setPropLoading(true); 
    setPropText(""); 
    const systemData = { 
      client:inp.clientName, project:inp.projectRef, address:inp.address, 
      engineer:inp.engineer, company:inp.companyName, 
      system:{kWp:r.actKwp.toFixed(1),panels:r.totP+"× "+(panel?.brand)+" "+(panel?.wp)+"Wp", 
        inverter:(inverter?.brand)+" "+(inverter?.model), 
        battery:(battery?.brand)+" "+(battery?.kwh)+"kWh", 
        strings:r.nStr, panelsPerString:r.nSel, cellTech:panel?.cellTech||"", 
        bifacial:panel?.bifacial}, 
      yield:{annualMWh:(r.annGenTMY/1000).toFixed(2), p90MWh:(r.annGenP90/1000).toFixed(2), 
        scPct:(r.annSCPct||r.profileSCPct||0).toFixed(1), 
        performanceRatio:r.perfRatio, clippingPct:(r.clippingPct||0).toFixed(1), 
        iamLossPct:((1-parseFloat(r.iamLoss||1))*100).toFixed(1), 
        dataSource:r.tmySource==="pvgis"?"PVGIS-ERA5 8760hr simulation":"Monthly TMY fallback"}, 
      financial:{costEGP:Math.round(r.sysC), paybackYrs:r.pb||">25", 
        irr:r.irr+"%", roi:r.roi+"%", netGain25:Math.round(r.netGain), 
        npv:r.npvAtRate, lcoe:r.lcoe, tariffMode:inp.tariffMode, 
        tariffEscPct:inp.tariffEsc, discountRatePct:inp.discountRate}, 
      load:{dailyKwh:r.loadTot?.toFixed(1), peakKW:r.peakKW?.toFixed(1), coveragePct:r.effPct?.toFixed(1)}, 
      compliance:{egyptERA:r.chkBatRule, ncedc:r.chkSize500, allPass:r.allOk}, 
      villas:inp.nVillas, totalCostEGP:Math.round(r.totalSysC3), 
    }; 
    try { 

        
 
      const resp = await fetch("https://api.anthropic.com/v1/messages", { 
        method:"POST", headers:{"Content-Type":"application/json"}, 
        body: JSON.stringify({ 
          model:"claude-sonnet-4-20250514", max_tokens:1000, 
          system:"You are a professional solar energy consultant writing a concise client proposal. Write in clear, professional English. Structure your response with these exact sections separated by ### markers: EXECUTIVE SUMMARY, SYSTEM OVERVIEW, ENERGY & FINANCIAL ANALYSIS, REGULATORY COMPLIANCE, NEXT STEPS. Be specific with numbers. Keep total response under 600 words.", 
          messages:[{role:"user", content:"Write a client proposal for this solar PV system:\n" + JSON.stringify(systemData, null, 2)}], 
        }), 
      }); 
      const data = await resp.json(); 
      const text = data.content.filter(b => b.type === "text").map(b => b.text).join(""); 
      setPropText(text); 
    } catch(e) { 
      setPropText("Generation failed: " + e.message); 
    } 
    setPropLoading(false); 
  }, [r, inp, panel, inverter, battery]); 

  // Recommendation engine (unchanged logic) 
  const recommendations = useMemo(()=>{ 
    const pC=locked.panel?[panel]:panelLib; 
    const iC=locked.inverter?[inverter]:invLib; 
    const bC=locked.battery?[battery]:batLib; 
    const res=[]; 
    for(const p of pC) for(const inv of iC) for(const bat of bC){ 
      const r2=calcEngine({...inp,coverageMode:"percentage",offsetPct:inp.offsetPct},p,inv,bat); 
      if(!r2)continue; 
      const checks={invSizing:r2.chkInvSize,dcAcRatio:r2.chkDcAc,mpptMin:r2.chkMpptMin, 
        mpptMax:r2.chkMpptMax,iscPerMppt:r2.chkIscMppt,batVoltage:r2.chkBatVolt, 
        batCharge:r2.chkBatChg,batRule:r2.chkBatRule,roofFit:r2.roofFit?"PASS":"REVIEW", 
        vdStr:r2.chkVdStr,vdAC:r2.chkVdAC}; 
      const pass=Object.values(checks).filter(v=>v==="PASS").length; 
      const fail=Object.values(checks).filter(v=>v==="FAIL"||v==="INCOMPATIBLE").length; 
      const elecScore=((pass-fail*2)/Object.keys(checks).length)*100; 
      if(fail>0){res.push({p,inv,bat,r:r2,checks,pass,fail,elecScore,rejected:true, rejectReasons:Object.entries(checks).filter(([,v])=>v==="FAIL"||v==="INCOMPATIBLE").map(

([k,v])=>`${k}: ${v}`)});continue;} 
      const finScore=r2.pb?Math.max(0,100-(r2.pb-5)*5)+parseFloat(r2.irr)*2:0; 
      const costScore=Math.max(0,100-(r2.sysC/10000)); 
      const premBrands=["LONGi","Huawei","SMA","BYD","CATL","Sungrow","JA Solar"]; 
      const brandScore=([p.brand,inv.brand,bat.brand].filter(b=>premBrands.includes(b)).length/3)*100; 

 
        
      const weighted=rankMode==="electrical"?elecScore:rankMode==="financial"?finScore 
        :elecScore*0.40+finScore*0.35+costScore*0.15+brandScore*0.10; res.push({p,inv,bat,r:r2,checks,pass,fail,elecScore,finScore,costScore,brandScore,weighted,rejected:false,rejectReasons:[]}); 

    } 
    return res.sort((a,b)=>a.rejected!==b.rejected?a.rejected?1:-1:b.weighted-a.weighted); 
  },[panelLib,invLib,batLib,locked,panel,inverter,battery,inp,rankMode]); 
  const compatibleRecs=recommendations.filter(x=>!x.rejected); 
  const rejectedRecs  =recommendations.filter(x=>x.rejected); 

  // Excel upload handler (unchanged) 
  const handleFile=(e)=>{ 
    const file=e.target.files[0]; if(!file)return; 
    const reader=new FileReader(); 
    reader.onload=(ev)=>{ 
      try{ 
        const wb=XLSX.read(ev.target.result,{type:"array"}); 
        let imp={panels:0,inverters:0,batteries:0}; 
        wb.SheetNames.forEach(name=>{ 
          const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{defval:""}); 
          if(!rows.length)return; 
          const cols=Object.keys(rows[0]).map(k=>k.toLowerCase().replace(/[\s\/\-\(\)°%]/g,"")); 
          const hasWp  =cols.some(c=>["wp","pmax","ratedpower","ratedwattage"].includes(c)); 
          const hasAckw=cols.some(c=>["ackw","acpower","ratedacpower","nominalacpower"].includes(c)); 
          const hasKwh =cols.some(c=>["kwh","capacity","nominalcapacity","batterycapacity"].includes(c)); 
          const gV=(row,keys)=>{const rK=Object.keys(row).map(k=>k.toLowerCase().replace(/[\s\/\-\(\)°%]/g,""));for(const k of keys){const i=rK.indexOf(k);if(i>=0){const v=parseFloat(Object.values(row)[i]);if(!isNaN(v))return v;}}return null;}; 
          const gS=(row,keys)=>{const rK=Object.keys(row).map(k=>k.toLowerCase().replace(/[\s\/\-\(\)°%]/g,""));for(const k of keys){const i=rK.indexOf(k);if(i>=0){const v=String(Object.values(row)[i]);if(v)return v;}}return "";}; 
          if(hasWp&&!hasAckw&&!hasKwh){const nP=rows.filter(r=>{const wp=gV(r,["wp","pmax","ratedpower","powerwp","peakpower","nominalpower"]);return wp&&wp>100&&wp<1000;}).map((r,i)=>({id:`UP${i+1}`,brand:gS(r,["brand","manufacturer","make"]),model:gS(r,["model","modelno","modelname","productname"]),wp:gV(r,["wp","pmax","ratedpower","powerwp","peakpower"])||400,voc:gV(r,["voc","opencircuitvoltage","vopen"])||49.5,vmp:gV(r,["vmp","vmpp","maximumpowervoltage","vmaxpower"])||41.7,isc:gV(r,["isc","shortcircuitcurrent","ishortcircuit"])||14.8,imp:gV(r,["imp","impp","maximumpowercurrent","imaxpower"])||13.9,betaVoc:gV(r,["betavoc","tempcoeffvoc","temperaturecoefficientvoc","betav"])||-0.28,gammaPmax:gV(r,["gammapmax","tempcoeffpmax","temperaturecoefficientpmax","gammap"])||-0.35,noct:gV(r,["noct","nominaloperatingcelltemperature"])||44,dimL:gV(r,["diml","lengthmm","length","modulelength"])||2278,dimW:gV(r,["dimw","widthmm","width","modulewidth"])||1134,weightKg:gV(r,["weight","weightkg","moduleweight"])||32,warranty25:gV(r,["warranty","powerwarranty","25yrwarranty"])||80,costUSD:gV(r,["costusd","priceperw","priceusd","costperwatt","usdperwatt"])||0.22,certifications:gS(r,["certifications","certs","standards","certification"])||"IEC 61215"}));if(nP.length){setPLib(p=>[...p,...nP]);imp.panels+=nP.length;}} 

      
 
          if(hasAckw){const nI=rows.map((r,i)=>({id:`UI${i+1}`,brand:gS(r,["brand","manufacturer"]),model:gS(r,["model","modelno","modelname"]),acKW:gV(r,["ackw","acpower","ratedacpower","nominalacpower"])||15,vdcMax:gV(r,["vdcmax","maxdcinputvoltage","maximumdcvoltage"])||1000,mpptMin:gV(r,["mpptmin","mpptminvoltage","mpptrangemin"])||200,mpptMax:gV(r,["mpptmax","mpptmaxvoltage","mpptrangemax"])||850,iscPerMppt:gV(r,["iscpermppt","maxinputcurrentpermppt","maxshortcircuitcurrentpermppt"])||30,numMppt:gV(r,["nummppt","numberofmppt","mpptinputs","mpptchannels"])||2,batVoltMin:gV(r,["batvoltmin","batteryvoltageminimum","batminvolt"])||48,batVoltMax:gV(r,["batvoltmax","batteryvoltagemaximum","batmaxvolt"])||800,batChargeKW:gV(r,["batchargekw","maxchargepower","batterychargingpower"])||15,eta:gV(r,["eta","maxefficiency","efficiency","peakefficiency"])||98,thd:gV(r,["thd","totalharmonicdistortion"])||3.0,antiIslanding:"IEC 62116",certifications:gS(r,["certifications","certs","standards"])||"IEC 62109",costEGP:gV(r,["costegp","priceegp","costegyptianpound"])||90000,dcAcRatio:gV(r,["dcacratio","maxdcacratio"])||1.3}));if(nI.length){setILib(p=>[...p,...nI]);imp.inverters+=nI.length;}
} 
          if(hasKwh&&!hasWp&&!hasAckw){const nB=rows.map((r,i)=>({id:`UB${i+1}`,brand:gS(r,["brand","manufacturer"]),model:gS(r,["model","modelno","modelname"]),kwh:gV(r,["kwh","capacity","nominalcapacity","usablecapacity","energycapacity"])||25,voltage:gV(r,["voltage","nominalvoltage","systemvoltage"])||48,dod:gV(r,["dod","depthofdischarge","maxdod"])||90,eta:gV(r,["eta","efficiency","roundtripefficiency"])||95,cycleLife:gV(r,["cyclelife","cycles","lifecycles","nominalcycles"])||6000,cRate:gV(r,["crate","maxcrate","dischargeratec"])||1.0,tempMax:gV(r,["tempmax","maxoperatingtemperature","maxtemp"])||45,tempMin:gV(r,["tempmin","minoperatingtemperature","mintemp"])||0,weightKg:gV(r,["weight","weightkg"])||230,chemistry:gS(r,["chemistry","batterytype","technology"])||"LiFePO4",bms:gS(r,["bms","batterymanagement"])||"Integrated",warranty:gV(r,["warranty","warrantyyr","warrantyperiod"])||10,costEGP:gV(r,["costegp","priceegp","costegyptianpound"])||120000,certifications:gS(r,["certifications","certs","standards"])||"IEC 62619",dimL:gV(r,["diml","lengthmm","length"])||700,dimW:gV(r,["dimw","widthmm","width"])||500,dimH:gV(r,["dimh","heightmm","height"])||1000}));if(nB.length){setBLib(p=>[...p,...nB]);imp.batteries+=nB.length;}} 
        }); 
        setUpMsg(`✅ Imported: ${imp.panels} panels, ${imp.inverters} inverters, ${imp.batteries} batteries from "${file.name}"`); 
        setTimeout(()=>setUpMsg(""),8000); 
      }catch(err){setUpMsg(`❌ Error: ${err.message}`);} 
    }; 
    reader.readAsArrayBuffer(file); e.target.value=""; 
  }; 

  // -- ☀ SOLAR RESOURCE TAB --------------------------------- 
  // E10: Loss waterfall diagram data — computed from named factors 
  function lossWaterfall(r) { 
    if (!r) return []; 
    // C3: Real computed values from calcEngine named factors and dispatch output 
    const annPOA   = (r.tmyMonthly||[]).reduce((s,m)=>s+m.psh*m.days, 0); 

 
    const stc      = r.actKwp * annPOA;   // STC reference yield 
    const etaFixed = 0.98*0.98*0.99*0.99*0.98*0.98*0.98; // named factors product excl. temp 
    const tempLoss = Math.max(0, stc * (1 - (r.etaSys||0.76) / etaFixed)); 
    const sp       = inp.soilProfile || CAIRO_SOILING; 
    const soilAvg  = (r.tmyMonthly||[]).reduce((s,m,i)=>s+m.psh*m.days*(sp[i]||0.02),0)/Math.max(annPOA,1); 
    const soilLoss = stc * soilAvg; 
    const iamLoss2 = stc * (1 - parseFloat(r.iamLoss||1)); 
    const fixedLoss= stc * (1 - 0.98*0.98*0.99*0.99*0.98*0.98); 
    const shadeLoss= stc * (1 - parseFloat(r.shadeFactor||1)) * 0.8; 
    const clipLoss = r.clippingKwh || 0; 
    const delivered= yGen  || 0;
    return [ 
      { label:"STC Reference",    value:stc,        color:"#22d3ee", isBase:true }, 
      { label:"Temperature loss", value:tempLoss,   color:"#ef4444" }, 
      { label:"Soiling",          value:soilLoss,   color:"#f59e0b" }, 
      { label:"IAM / Reflectance",value:iamLoss2,   color:"#8b5cf6" }, 
      { label:"Wiring/Mismatch",  value:fixedLoss,  color:"#f472b6" }, 
      { label:"Shading losses",   value:shadeLoss,  color:"#6366f1" }, 
      { label:"Inverter clipping",value:clipLoss,   color:"#fb923c" }, 
      { label:"Delivered energy", value:delivered,  color:"#10b981", isResult:true }, 
    ]; 
  } 

  const renderSolar=()=>{ 
    if(!r)return<div style={{color:C.muted,padding:20}}>Select components first.</div>; 
    const maxGen=Math.max(...r.monthlyGen.map(m=>m.gen)); 
    const worstMo=r.monthlyGen.reduce((a,b)=>b.gen<a.gen?b:a); 
    const bestMo =r.monthlyGen.reduce((a,b)=>b.gen>a.gen?b:a); 
    const isHourly = r.tmySource==="pvgis" && r.dispatch; 
    const pct=(v,max)=>Math.min(100,(v/max)*100); 
    const MNAMES=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; 
    return( 
      <div> 
        {/* -- Location & PVGIS -- */}
        <div style={cardS(C.accent)}>
          <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}>
            📡 Site Location & PVGIS Hourly Data Fetch
          </div>
          <div style={{padding:"14px 20px"}}>

            {/* Row: mini-map + coordinate/tilt inputs */}
            <div style={{display:"grid",gridTemplateColumns:"200px 1fr",gap:16,marginBottom:14,alignItems:"start"}}>

              {/* Mini-map preview */}
              <div>
                <MiniMapPreview
                  lat={inp.lat} lon={inp.lon}
                  locationName={inp.locationName}
                  elevationM={inp.elevationM}
                  onOpen={() => setShowLocationPicker(true)}
                />
                <button onClick={() => setShowLocationPicker(true)}
                  style={{width:"100%",marginTop:6,padding:"6px 0",
                    background:"transparent",border:`1px solid ${C.accent}`,
                    borderRadius:7,color:C.accent,fontWeight:700,fontSize:11,
                    cursor:"pointer"}}>
                  📍 Pick on map
                </button>
              </div>

              {/* Numeric inputs */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10}}>
                {[
                  {l:"Latitude (°N)",  k:"lat",     s:0.01, tip:"Decimal degrees north. Drives solar position, declination and air-mass calculations."},
                  {l:"Longitude (°E)", k:"lon",     s:0.01, tip:"Decimal degrees east. Fetches site-specific PVGIS ERA5 hourly irradiance (auto on change)."},
                  {l:"Tilt (°)",       k:"tiltDeg", s:1,    tip:"Inclination from horizontal. Optimal ≈ latitude × 0.76 for annual yield. Auto-updates with latitude."},
                  {l:"Azimuth",        k:"azimuth", s:5,    tip:"0 = south-facing, −90 = east, +90 = west."},
                ].map(({l,k,s,tip})=>(
                  <div key={k}>
                    <div style={{fontSize:10,color:C.muted,marginBottom:4,display:"flex",alignItems:"center"}}>
                      {l}{tip&&<Tip text={tip}/>}
                    </div>
                    <input type="number" value={inp[k]||0} step={s}
                      onChange={e=>upd(k,parseFloat(e.target.value)||0)}
                      style={{width:"100%",background:"#0f172a",border:`2px solid ${C.accent}`,
                        borderRadius:8,color:C.accent,fontSize:15,fontWeight:800,
                        padding:"7px 10px",textAlign:"right",boxSizing:"border-box"}}/>
                  </div>
                ))}
                {/* Elevation (read-only, populated by map picker) */}
                {inp.elevationM != null && (
                  <div>
                    <div style={{fontSize:10,color:C.muted,marginBottom:4}}>
                      Elevation (m) <Tip text="Site elevation above sea level — fetched automatically when you pick a location on the map."/>
                    </div>
                    <div style={{background:"#0f172a",border:`1px solid ${C.border}`,
                      borderRadius:8,color:C.muted,fontSize:15,fontWeight:800,
                      padding:"7px 10px",textAlign:"right"}}>
                      {Math.round(inp.elevationM)}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* PVGIS fetch status */}
            <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
              <button onClick={handleFetchPVGIS}
                disabled={pvgisStatus==="loading"}
                style={{padding:"10px 24px",background:pvgisStatus==="loading"?C.border:C.accent,
                  color:C.bg,border:"none",borderRadius:8,fontWeight:800,fontSize:13,
                  cursor:pvgisStatus==="loading"?"not-allowed":"pointer",
                  opacity:pvgisStatus==="loading"?0.7:1}}>
                {pvgisStatus==="loading"?"⏳ Fetching...":"☀ Fetch PVGIS Hourly Data"}
              </button>
              <div style={{flex:1,padding:"8px 12px",borderRadius:8,fontSize:11,
                background:isHourly?`${C.green}18`:pvgisStatus==="error"?`${C.red}18`:C.card,
                color:isHourly?C.green:pvgisStatus==="error"?C.red:C.muted,
                border:`1px solid ${isHourly?C.green:pvgisStatus==="error"?C.red:C.border}`}}>
                {pvgisMsg||"Click to fetch 8,760 hourly irradiance values for your exact location, tilt and azimuth. Required for hourly dispatch simulation."}
              </div>
            </div>
            {pvgisStatus==="done"&&pvgisData&&(
              <div style={{marginTop:10,padding:"6px 12px",background:`${C.green}12`,borderRadius:8,
                fontSize:10,color:C.green,display:"flex",gap:16,flexWrap:"wrap"}}>
                <span>Source: PVGIS-ERA5 2020</span>
                <span>Resolution: hourly (8,760 values)</span>
                <span>Tilt: {inp.tiltDeg}° · Azimuth: {inp.azimuth}°</span>
                <span style={{fontWeight:700}}>Dispatch: {r.dispatch?"✓ simulated":"building..."}</span>
              </div>
            )}
          </div>
        </div>

        {/* -- Data source badge + KPIs -- */} 

 
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:14}}> 
          {[ 
            {l:"Data source",       v:isHourly?"PVGIS hourly ✓":"Monthly fallback",   c:isHourly?C.green:C.yellow}, 
            {l:`Annual yield (${inp.yieldMode==="p90"?"P90":"P50"})`, v:`${(yGen/1000).toFixed(2)} MWh`, c:inp.yieldMode==="p90"?C.yellow:C.green}, 
            {l:"Self-consumption",  v:`${r.annSCPct!=null?r.annSCPct.toFixed(1):r.profileSCPct.toFixed(1)}%`, c:C.green}, 
            {l:"Grid import/yr",    v:isHourly?`${(r.dispatch.totalGridKwh/1000).toFixed(1)} MWh`:"—", c:C.blue}, 
            {l:"Export/yr",         v:isHourly?`${(r.dispatch.totalExportKwh/1000).toFixed(1)} MWh`:"—", c:C.muted}, 
            {l:"Bat cycles/yr",     v:isHourly?r.batCyclesYear.toFixed(0):"—",         c:C.purple}, 
            {l:"Design PSH (Dec)",  v:`${DESIGN_PSH}h/day`,                            c:C.accent}, 
            {l:"Best month",        v:`${bestMo.m} · ${bestMo.gen.toFixed(0)} kWh`,    c:C.green}, 
          ].map(k=>( 
            <div key={k.l} style={{background:C.card,borderRadius:10,padding:"12px 14px",borderLeft:`4px solid ${k.c}`}}> 
              <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:3}
}>{k.l}</div> 
              <div style={{fontSize:14,fontWeight:800,color:k.c}}>{k.v}</div> 
            </div> 
          ))} 
        </div> 

        {/* -- Monthly generation bar chart -- */} 
        <div style={cardS(C.yellow)}> 
          <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}> 
            📊 Monthly Generation — {r.actKwp.toFixed(1)} kWp 
            {isHourly&&<span style={{fontSize:10,color:`${C.green}`,fontWeight:600,marginLeft:10}}> 
              (with soiling · hourly simulation)</span>} 
          </div> 
          <div style={{padding:"16px 20px"}}> 
            {r.monthlyGen.map(mo=>{ 
              const isW=mo.m===worstMo.m,isB=mo.m===bestMo.m; 
              const bc=isW?C.orange:isB?C.green:C.yellow; 
              const sc=isHourly&&r.monthlySCArr?r.monthlySCArr[r.monthlyGen.indexOf(mo)]:null; 
              return( 
                <div key={mo.m} style={{display:"grid", 
                  gridTemplateColumns:`40px 1fr${isHourly?" 70px":""} 80px 58px 52px`, 
                  alignItems:"center",gap:8,marginBottom:8}}> 
                  <span style={{fontSize:11,color:bc,fontWeight:isW||isB?800:400}}>{mo.m}</span> 

 
                  <div style={{background:C.border,borderRadius:4,height:16,position:"relative",overflow:"hidden"}}> 
                    <div style={{width:`${pct(mo.gen,maxGen)}%`,background:bc,height:16,opacity:0.85,borderRadius:4}}/> 
                    {isHourly&&sc!=null&&<div style={{position:"absolute",top:0,left:0, width:`${pct(sc,maxGen)}%`,height:16,background:`${C.green}60`,borderRadius:4}}/>} 

                    {isW&&<span style={{position:"absolute",right:6,top:2,fontSize:9,color:C.bg,fontWeight:800}}>DESIGN ▲</span>} 
                  </div> 
                  {isHourly&&<span style={{fontSize:10,color:C.green,textAlign:"right"}}> 
                    {sc!=null?(sc/mo.gen*100).toFixed(0):"—"}% SC 
                  </span>} 
                  <span style={{fontSize:11,color:C.text,textAlign:"right",fontWeight:600}}>{mo.gen.toFixed(0)} kWh</span> 
                  <span style={{fontSize:10,color:C.muted,textAlign:"right"}}>{mo.psh}h</span> 
                  <span style={{fontSize:10,color:C.muted,textAlign:"right"}}>{mo.tAmb}°C</span> 
                </div> 
              ); 
            })} 
            <div style={{marginTop:12,padding:"8px 12px",background:"#0f172a",borderRadius:8, fontSize:10,color:C.muted,display:"flex",gap:20,flexWrap:"wrap",alignItems:"center"}}> 

              <span><span style={{color:C.green}}>■</span> Best month</span> 
              <span><span style={{color:C.orange}}>■</span> Design month</span> 
              {isHourly&&<span><span style={{color:`${C.green}60`}}>■</span> Self-consumed 
(green overlay)</span>} 
              <span style={{marginLeft:"auto",color:C.accent,fontWeight:700}}> 
                Annual ({inp.yieldMode==="p90"?"P90":"P50"}): {(yGen/1000).toFixed(2)} MWh/yr
                {!isHourly&&<span style={{color:C.yellow}}> · Fetch PVGIS for soiling-corrected hourly simulation</span>} 
              </span> 
            </div> 
          </div> 
        </div> 

        {/* -- Monthly dispatch table (hourly mode only) -- */} 
        {isHourly&&( 
          <div style={cardS(C.green)}> 
            <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}> 
              📋 Monthly Energy Balance — Hourly Dispatch Simulation 
            </div> 
            <div style={{overflowX:"auto"}}> 

                      
              
 
              <table style={{...tbl,fontSize:11}}> 
                <thead><tr style={{borderBottom:`2px solid ${C.border}`}}> 
                  {["Month","Gen kWh","Self-consumed","Grid import","Exported","Soiling","SC%"].map(h=>( 
                    <th key={h} style={{padding:"7px 12px",textAlign:"right",color:C.muted,fontWeight:600}}>{h}</th> 
                  ))} 
                </tr></thead> 
                <tbody> 
                  {MNAMES.map((mn,mi)=>{ 
                    const gen  = r.monthlyGen[mi]?.gen || 0; 
                    const sc   = r.monthlySCArr?.[mi] || 0; 
                    const grid = r.monthlyGridArr?.[mi] || 0; 
                    const exp  = Math.max(0, gen - sc); 
                    const soil = (CAIRO_SOILING[mi]*100).toFixed(0); 
                    const scP  = gen>0?(sc/gen*100).toFixed(0):"0"; 
                    const isW  = mn===worstMo.m; 
                    return( 
                      <tr key={mn} style={{background:isW?`${C.orange}15`:mi%2===0?"transparent":"#070f1f", 
                        borderLeft:isW?`3px solid ${C.orange}`:"3px solid transparent"}}> 
                        <td style={{padding:"6px 12px",color:isW?C.orange:C.text,fontWeight:isW?700:400}}>{mn}{isW?" ◄":""}</td> 
                        <td style={{padding:"6px 12px",textAlign:"right",color:C.yellow,fontWeight:600}}>{gen.toFixed(0)}</td> 
                        <td style={{padding:"6px 12px",textAlign:"right",color:C.green,fontWeight:600}}>{sc.toFixed(0)}</td> 
                        <td style={{padding:"6px 12px",textAlign:"right",color:C.blue}}>{grid.toFixed(0)}</td> 
                        <td style={{padding:"6px 12px",textAlign:"right",color:C.muted}}>{exp.toFixed(0)}</td> 
                        <td style={{padding:"6px 12px",textAlign:"right",color:parseFloat(soil)>5?C.orange:C.muted}}>{soil}%</td> 
                        <td style={{padding:"6px 12px",textAlign:"right",fontWeight:700, color:parseFloat(scP)>=70?C.green:parseFloat(scP)>=50?C.yellow:C.red}}>{scP}%</td> 

                      </tr> 
                    ); 
                  })} 
                  <tr style={{background:`${C.yellow}12`,borderTop:`2px solid ${C.yellow}`}}> 
                    <td style={{padding:"8px 12px",color:C.yellow,fontWeight:800}}>ANNUAL</td> 
                    <td style={{padding:"8px 12px",textAlign:"right",color:C.yellow,fontWeight:800}}>{r.dispatch.totalGenKwh.toFixed(0)}</td> 
                    <td style={{padding:"8px 12px",textAlign:"right",color:C.green,fontWeight:800}}>{r.dispatch.totalSCKwh.toFixed(0)}</td> 

                          
                    <td style={{padding:"8px 12px",textAlign:"right",color:C.blue,fontWeight:800}}>{r.dispatch.totalGridKwh.toFixed(0)}</td> 
                    <td style={{padding:"8px 12px",textAlign:"right",color:C.muted,fontWeight:800}}>{r.dispatch.totalExportKwh.toFixed(0)}</td> 
                    <td style={{padding:"8px 12px",textAlign:"right",color:C.muted}}>avg 
{(CAIRO_SOILING.reduce((a,v)=>a+v,0)/12*100).toFixed(1)}%</td> 
                    <td style={{padding:"8px 12px",textAlign:"right",fontWeight:800,color:C.green}}>{r.annSCPct.toFixed(1)}%</td> 
                  </tr> 
                </tbody> 
              </table> 
            </div> 
          </div> 
        )} 

        {/* -- Battery dispatch summary -- */} 
        {isHourly&&( 
          <div style={cardS(C.purple)}> 
            <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}>🔋 Battery Dispatch Summary — Simulated</div> 
            <div style={{padding:"12px 16px",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8}}> 
              {[ 
                {l:"Annual charged",    v:`${(r.dispatch.totalBatChgKwh/1000).toFixed(1)} MWh`, c:C.green}, 
                {l:"Annual discharged", v:`${(r.dispatch.totalBatDischKwh/1000).toFixed(1)} MWh`,c:C.blue}, 
                {l:"Cycles/year",       v:r.dispatch.batCycles.toFixed(0),                      c:C.purple}, 
                {l:"Dec evening unmet", v:`${r.dispatch.eveningDeficits[11].toFixed(1)} kWh`,   c:r.dispatch.eveningDeficits[11]<5?C.green:C.orange}, 
                {l:"Jul evening unmet", v:`${r.dispatch.eveningDeficits[6].toFixed(1)} kWh`,    c:r.dispatch.eveningDeficits[6]<5?C.green:C.orange}, 
                {l:"Battery adequate?", v:Math.max(...r.dispatch.eveningDeficits)<2?"YES ✓":"CHECK ⚠", c:Math.max(...r.dispatch.eveningDeficits)<2?C.green:C.orange}, 
              ].map(k=>( 
                <div key={k.l} style={{background:"#0f172a",borderRadius:8,padding:"10px 12px"}}> 
                  <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",marginBottom:3}}>{k.l}</div> 
                  <div style={{fontSize:14,fontWeight:800,color:k.c}}>{k.v}</div> 
                </div> 
              ))} 
            </div> 
            <div style={{padding:"8px 16px 12px",fontSize:10,color:C.muted,lineHeight:1.6}}> 
              Dispatch logic: surplus charges battery (up to max C-rate), deficit discharges (down to DoD), remainder imports from grid. 

 
              Cycles = total annual discharge ÷ usable capacity. Unmet evening demand = grid imports 17–22h. 
            </div> 
          </div> 
        )} 

        {/* -- Static TMY table -- */} 
        <div style={cardS(C.accent)}> 
          <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}> 
            {isHourly?"PVGIS Hourly Data — Monthly Summary":"Monthly Irradiance Table — Built-in TMY Fallback"} 
          </div> 
          <div style={{overflowX:"auto"}}> 
            <table style={{...tbl,fontSize:11}}> 
              <thead><tr style={{borderBottom:`2px solid ${C.border}`}}> 
                {["Month","PSH h/day","T amb °C","T cell °C","η sys %","Soiling %","Gen kWh","Cumul kWh"].map(h=>( 
                  <th key={h} style={{padding:"7px 12px",textAlign:"right",color:C.muted,fontWeight:600}}>{h}</th> 
                ))} 
              </tr></thead> 
              <tbody> 
                {r.monthlyGen.map((mo,mi)=>{ 
                  const tCell=(mo.tAmb+(panel.noct-20)*0.8); 
                  const etaMo=computeEtaSys(panel,mo.tAmb); 
                  const cumul=r.monthlyGen.slice(0,mi+1).reduce((s,m)=>s+m.gen,0); 
                  const isW=mo.m===worstMo.m; 
                  return( 
                    <tr key={mo.m} style={{background:isW?`${C.orange}18`:mi%2===0?"transparent":"#070f1f", 
                      borderLeft:isW?`3px solid ${C.orange}`:"3px solid transparent"}}> 
                      <td style={{padding:"6px 12px",color:isW?C.orange:C.text,fontWeight:isW?700:400}}> 
                        {mo.m}{isW?" ◄ DESIGN":""} 
                      </td> 
                      <td style={{padding:"6px 12px",textAlign:"right",color:C.accent,fontWeight:600}}>{mo.psh}</td> 
                      <td style={{padding:"6px 12px",textAlign:"right",color:C.muted}}>{mo.tAmb}</td> 
                      <td style={{padding:"6px 12px",textAlign:"right",color:C.muted}}>{tCell.toFixed(1)}</td> 
                      <td style={{padding:"6px 12px",textAlign:"right",color:C.muted}}>{(etaMo*100).toFixed(1)}</td> 
                      <td style={{padding:"6px 12px",textAlign:"right", 
                        color:(CAIRO_SOILING[mi]*100)>5?C.orange:C.muted}}> 
                        {(CAIRO_SOILING[mi]*100).toFixed(0)} 
                      </td> 

 
                      <td style={{padding:"6px 12px",textAlign:"right",color:C.yellow,fontWeight:600}}>{mo.gen.toFixed(0)}</td> 
                      <td style={{padding:"6px 12px",textAlign:"right",color:C.muted}}>{cumul.toFixed(0)}</td> 
                    </tr> 
                  ); 
                })} 
                <tr style={{background:`${C.yellow}15`,borderTop:`2px solid ${C.yellow}`}}> 
                  <td colSpan={6} style={{padding:"8px 12px",color:C.yellow,fontWeight:800}}>ANNUAL TOTAL</td> 
                  <td style={{padding:"8px 12px",textAlign:"right",color:C.yellow,fontWeight:800}}>{yGen.toFixed(0)}</td>
                  <td style={{padding:"8px 12px",textAlign:"right",color:C.yellow,fontWeight:800}}>{yGen.toFixed(0)}</td>
                </tr> 
              </tbody> 
            </table> 
          </div> 
        </div> 
      </div> 
    ); 
  }; 

  const renderProfile=()=>{ 
    if(!r)return<div style={{color:C.muted,padding:20}}>Select components first.</div>; 
    const {demand,solarShape,morningKwh,dayKwh,eveningKwh,totalKwh}=profile; 
    const totalSolarGen=r.actKwp*r.etaSys*inp.pshDesign; 
    const genNorm=solarShape.reduce((s,v)=>s+v,0); 
    const hourlyGen=solarShape.map(s=>genNorm>0?(totalSolarGen*s)/genNorm:0); 
    const scH=demand.map((d,h)=>Math.min(d,hourlyGen[h])); 
    const totalSC=scH.reduce((s,v)=>s+v,0); 
    const scPct=r.annSCPct!=null?r.annSCPct.toFixed(0):(totalSolarGen>0?((totalSC/totalSolarGen)*100).toFixed(0):"0"); 
    const eveningDef=demand.slice(17,23).reduce((s,v)=>s+v,0); 
    const maxY=Math.max(...demand,...hourlyGen,0.1); 
    const profLabels=["AC","Light","WH","Kitchen","Laundry","Pool","Misc"]; 
    const profIcons =["❄","💡","🚿","🍳","👗","🏊","🔌"]; 
    const profKeys  =["prof_AC","prof_Light","prof_WH","prof_Kitchen","prof_Laundry","prof_Pool","prof_Misc"]; 
    const winLabels =["Morning 06–10h","Day 10–17h","Evening 17–23h"]; 
    return( 
      <div> 
        <div style={{padding:"10px 14px",background:`${C.orange}18`,borderRadius:8,marginBottom:12, 
          borderLeft:`3px solid ${C.orange}`,fontSize:11,color:C.orange,lineHeight:1.6}}> 
          🕐 <strong>Load Profile Builder</strong> — Set the fraction of each load active in each 

 
          time window. Battery is sized against the actual <strong>evening deficit</strong>, replacing 
          the flat heuristic. Self-consumption is computed from the demand/generation overlap. 
        </div> 

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:14}}> 
          {[ 
            {l:"Evening deficit",     v:`${eveningDef.toFixed(1)} kWh`,  c:C.blue,  n:"17–23h demand"}, 
            {l:"Profile SC rate",     v:`${scPct}%`,                     c:C.green, n:"of solar gen"}, 
            {l:"Daytime curtailment", v:`${Math.max(0,totalSolarGen-totalSC).toFixed(1)} kWh`, c:C.yellow,n:"excess gen not stored"}, 
            {l:"Battery target",      v:`${r.eveningDeficit.toFixed(1)} kWh`, c:C.accent,n:"profile-derived"}, 
            {l:"Battery usable",      v:`${r.usableBat.toFixed(1)} kWh`, c:r.usableBat>=r.eveningDeficit*(inp.batEveningCovPct/100)?C.green:C.red, n:"available"}, 
            {l:"Evening covered?",    v:r.usableBat>=r.eveningDeficit*(inp.batEveningCovPct/100)?"YES ✓":"UNDER ⚠", 
              c:r.usableBat>=r.eveningDeficit*(inp.batEveningCovPct/100)?C.green:C.red}, 
          ].map(k=>( 
            <div key={k.l} style={{background:C.card,borderRadius:10,padding:"12px 14px",borderLeft:`4px solid ${k.c}`}}> 
              <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:3}
}>{k.l}</div> 
              <div style={{fontSize:13,fontWeight:800,color:k.c}}>{k.v}</div> 
              <div style={{fontSize:9,color:C.muted,marginTop:2}}>{k.n}</div> 
            </div> 
          ))} 
        </div> 

        {/* 24h chart */} 
        <div style={cardS(C.orange)}> 
          <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}> 
            24-Hour Demand vs Solar Generation 
          </div> 
          <div style={{padding:"14px 20px"}}> 
            <div style={{display:"flex",gap:16,marginBottom:8,flexWrap:"wrap",fontSize:10,color:C.muted}}> 
              <span><span style={{color:C.orange}}>-</span> Demand</span> 
              <span><span style={{color:C.yellow}}>-</span> Solar gen</span> 
              <span><span style={{color:C.green}}>-</span> Self-consumed</span> 
              <span style={{color:`${C.blue}cc`}}>- Evening window 17–23h</span> 
            </div> 
            <div style={{display:"flex",gap:2,alignItems:"flex-end",height:96, 
              borderBottom:`1px solid ${C.border}`,paddingBottom:2}}> 

 
 
              {Array.from({length:24},(_,h)=>{ 
                const d=demand[h],g=hourlyGen[h],sc=scH[h]; 
                const isEve=h>=17&&h<=22; 
                const bH=v=>`${Math.round((v/maxY)*92)}px`; 
                return( 
                  <div key={h} style={{flex:1,display:"flex",alignItems:"flex-end",gap:1, position:"relative",background:isEve?`${C.blue}12`:"transparent",borderRadius:2}}> 

                    <div style={{flex:1,height:bH(d),background:`${C.orange}80`, 
                      borderRadius:"2px 2px 0 0",minHeight:d>0?2:0}}/> 
                    <div style={{flex:1,height:bH(g),background:`${C.yellow}80`, 
                      borderRadius:"2px 2px 0 0",minHeight:g>0?2:0}}/> 
                    <div style={{position:"absolute",bottom:0,left:0,width:"50%", 
                      height:bH(sc),background:`${C.green}70`,borderRadius:"2px 2px 0 0"}}/> 
                  </div> 
                ); 
              })} 
            </div> 
            <div style={{display:"flex",gap:2,marginTop:3}}> 
              {Array.from({length:24},(_,h)=>( 
                <div key={h} style={{flex:1,textAlign:"center",fontSize:8, 
                  color:h%6===0?C.muted:"transparent"}}>{h}</div> 
              ))} 
            </div> 
            <div style={{textAlign:"center",fontSize:9,color:C.muted,marginTop:1}}>Hour of day</div> 
          </div> 
        </div> 

        {/* Profile sliders */} 
        <div style={cardS(C.accent)}> 
          <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}> 
            Load Fraction per Time Window 
          </div> 
          <div style={{padding:"6px 16px 4px",display:"grid", 
            gridTemplateColumns:"110px repeat(3,1fr)",gap:8,borderBottom:`1px solid ${C.border}`}}> 
            <span/> 
            {winLabels.map(l=>( 
              <span key={l} style={{textAlign:"center",fontSize:10,fontWeight:700,color:C.accent}}>{l}</span> 
            ))} 
          </div> 
          {profLabels.map((lbl,li)=>{ 
            const pk=profKeys[li]; 
            const fr=inp[pk]; 
            return( 
              <div key={lbl} style={{padding:"10px 16px",borderBottom:`1px solid ${C.border}`, 

                    
 
                display:"grid",gridTemplateColumns:"110px repeat(3,1fr)",gap:8,alignItems:"center"}}> 
                <span style={{fontSize:11,color:C.text,fontWeight:600}}>{profIcons[li]} {lbl}</span> 
                {[0,1,2].map(wi=>( 
                  <div key={wi} style={{display:"flex",flexDirection:"column",gap:3}}> 
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:10}}> 
                      <span style={{color:C.muted}}>0</span> 
                      <span style={{color:C.accent,fontWeight:800}}>{Math.round(fr[wi]*100)}%</span> 
                      <span style={{color:C.muted}}>100</span> 
                    </div> 
                    <input type="range" min={0} max={1} step={0.05} value={fr[wi]} 
                      onChange={e=>{const nf=[...fr];nf[wi]=parseFloat(e.target.value);upd(pk,nf);}} 
                      style={{width:"100%",accentColor:C.accent}}/> 
                  </div> 
                ))} 
              </div> 
            ); 
          })} 
        </div> 

        {/* Daily energy summary */} 
        <div style={cardS(C.blue)}> 
          <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}> 
            Daily Energy Summary 
          </div> 
          <div style={{padding:"12px 16px",display:"grid", 
            gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8}}> 
            {[ 
              {l:"Morning demand", v:`${morningKwh.toFixed(1)} kWh`, s:"06–10h",     c:C.muted  
}, 
              {l:"Daytime demand", v:`${dayKwh.toFixed(1)} kWh`,     s:"10–17h",     c:C.yellow }, 
              {l:"Evening demand", v:`${eveningKwh.toFixed(1)} kWh`, s:"17–23h",     c:C.blue   }, 
              {l:"Total demand",   v:`${totalKwh.toFixed(1)} kWh`,   s:"daily total",c:C.text   }, 
              {l:"Solar gen",      v:`${totalSolarGen.toFixed(1)} kWh`,s:"daily",    c:C.yellow }, 
              {l:"Self-consumed",  v:`${totalSC.toFixed(1)} kWh`,    s:`${scPct}% of gen`,c:C.green}, 
              {l:"Battery target", v:`${eveningDef.toFixed(1)} kWh`, s:"evening deficit",c:C.accent}, 
              {l:"Grid makeup",    v:`${Math.max(0,totalKwh-totalSolarGen).toFixed(1)} kWh`,s:"daily grid draw",c:C.red}, 
            ].map(k=>( 
              <div key={k.l} style={{background:"#0f172a",borderRadius:8,padding:"10px 12px"}}> 
                <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",marginBottom:3}}>{k.l}</div> 
                <div style={{fontSize:14,fontWeight:800,color:k.c}}>{k.v}</div> 
                <div style={{fontSize:9,color:C.muted,marginTop:2}}>{k.s}</div> 
              </div> 

 
            ))} 
          </div> 
        </div> 
      </div> 
    ); 
  }; 

  // -- EQUIPMENT LIBRARY TAB -------------------------------- 
  const renderLibrary=()=>( 
    <div> 
      <div style={cardS(C.accent)}> 
        <div style={{padding:"12px 16px",color:"white",fontWeight:800,fontSize:13}}>📚 Equipment Library — Upload Supplier Data</div> 
        <div style={{padding:"16px 20px"}}> 
          <div style={{fontSize:11,color:C.muted,marginBottom:14,lineHeight:1.7}}> 
            Upload supplier Excel files (.xlsx/.xls). Parser auto-detects <strong style={{color:C.yellow}}>Panel</strong>, 
            <strong style={{color:C.purple}}> Inverter</strong>, and <strong style={{color:C.blue}}> Battery</strong> sheets 
            by column headers. Sample data pre-loaded. 
          </div> 
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}> 
            <label style={{padding:"10px 20px",background:C.accent,color:C.bg,border:"none", 
              borderRadius:8,fontWeight:800,fontSize:13,cursor:"pointer",display:"inline-block"}}> 
              📂 Upload Excel File 
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} 
                style={{display:"none"}} /> 
            </label> 
            <span style={{fontSize:11,color:C.muted}}>Accepts .xlsx / .xls · Multiple sheets · Auto-detects type</span> 
          </div> 
          {uploadMsg&&<div style={{marginTop:12,padding:"8px 14px",borderRadius:8,fontSize:12,fontWeight:600, 
            background:uploadMsg.includes("✅")?"#dcfce7":"#fee2e2", 
            color:uploadMsg.includes("✅")?"#166534":"#991b1b"}}>{uploadMsg}</div>} 
        </div> 
      </div> 

      <div style={cardS(C.orange)}> 
        <div style={{padding:"12px 16px",color:"white",fontWeight:800,fontSize:13}}>🎛 Component Selection — Active System Design</div> 
        <div style={{padding:"16px 20px",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}> 
          {[ 
            {lbl:"☀ PV Panel",   sel:selPanel, fn:setSelPanel, lib:panelLib, col:C.yellow, bg:"#1c1800", 
             fmt:p=>`${p.brand} — ${p.model} (${p.wp}Wp)`, det:p=>[[`Wp`,p.wp],[`Voc`,`${p.voc}V`],[`Vmp`,`${p.vmp}V`],[`Isc`,`${p.isc}A`],[`Imp`,`${p.imp}A`],[`β`,`${p.betaVoc}%/°C`],[`γ`,`${p.gammaPmax}%/°C`],[`NOCT`,`${p.noct}°C`],[`Cost`,`$${p.costUSD}/W`]]}, 

 
 
            {lbl:"🔌 Inverter",   sel:selInv,   fn:setSelInv,   lib:invLib,   col:C.purple, bg:"#1a0033", 
             fmt:x=>`${x.brand} — ${x.model} (${x.acKW}kW)`, 
             det:x=>[[`AC kW`,x.acKW],[`Vdc Max`,`${x.vdcMax}V`],[`MPPT`,`${x.mpptMin}–${x.mpptMax}V`],[`MPPTs`,x.numMppt],[`Isc/MPPT`,`${x.iscPerMppt}A`],[`Bat V`,`${x.batVoltMin||"—"}–${x.batVoltMax||"—"}V`],[`Bat Chg`,`${x.batChargeKW}kW`],[`η`,`${x.eta}%`],[`Cost`,fmtE(x.costEGP)]]}, 
            {lbl:"🔋 Battery",    sel:selBat,   fn:setSelBat,   lib:batLib,   col:C.blue,   bg:"#001433", 
             fmt:x=>`${x.brand} — ${x.model} (${x.kwh}kWh)`, det:x=>[[`kWh`,x.kwh],[`Voltage`,`${x.voltage}V`],[`DoD`,`${x.dod}%`],[`η`,`${x.eta}%`],[`Cycles`,x.cycleLife],[`Type`,x.chemistry],[`Warranty`,`${x.warranty}yr`],[`Cost`,fmtE(x.costEGP)]]}, 

          ].map(({lbl,sel,fn,lib,col,bg,fmt,det})=>{ 
            const item=lib.find(x=>x.id===sel)||lib[0]; 
            return( 
              <div key={lbl}> 
                <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>{lbl}</div> 
                <select value={sel} onChange={e=>fn(e.target.value)} 
                  style={{width:"100%",background:bg,border:`2px solid ${col}`,borderRadius:8, 
                  color:col,fontSize:12,padding:"8px 10px",cursor:"pointer",fontWeight:700}}> 
                  {lib.map(p=><option key={p.id} value={p.id}>{fmt(p)}</option>)} 
                </select> 
                {item&&( 
                  <div style={{marginTop:8,background:"#0f172a",borderRadius:8,padding:"10px 12px",fontSize:11}}> 
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"3px 12px"}}> 
                      {det(item).map(([k,v])=>( 
                        <div key={k} style={{display:"flex",justifyContent:"space-between"}}> 
                          <span style={{color:C.muted}}>{k}</span> 
                          <span style={{color:col,fontWeight:600}}>{v}</span> 
                        </div> 
                      ))} 
                    </div> 
                    <div style={{marginTop:6,fontSize:9,color:C.muted}}>{item.certifications}</div> 
                  </div> 
                )} 
              </div> 
            ); 
          })} 
        </div> 
      </div> 

      {r&&( 

             
             
 
        <div style={cardS(r.allOk?C.green:C.red)}> 
          <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13, 
            display:"flex",justifyContent:"space-between",alignItems:"center"}}> 
            <span>⚙ Compatibility Checks</span> 
            <span style={{color:r.allOk?C.green:C.red}}> 
              {r.allOk?"✅ ALL COMPATIBLE":"⚠ INCOMPATIBILITY DETECTED"} 
            </span> 
          </div> 
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))"}}> 
            {[ 
              {l:"Inverter ≥ peak demand",   v:r.chkInvSize, d:`${r.peakDemandKW.toFixed(1)}kW vs ${inverter?.acKW}kW`}, 
              {l:`DC/AC ratio (≤${inverter?.dcAcRatio||1.3})`,    v:r.chkDcAc,    d:`${r.dcAc.toFixed(2)} / limit ${inverter?.dcAcRatio||1.3}`}, 
              {l:"String Vmp ≥ MPPT min",   v:r.chkMpptMin, d:`${r.vmpSum.toFixed(1)}V vs ${inverter?.mpptMin}V`}, 
              {l:"String Voc ≤ Vdc max",    v:r.chkMpptMax, d:`${r.strVoc.toFixed(1)}V vs ${inverter?.vdcMax}V`}, 
              {l:"String Isc per MPPT",     v:r.chkIscMppt, d:`${(panel?.isc*r.strPerMppt).toFixed(1)}A vs ${inverter?.iscPerMppt}A`}, 
              {l:"Battery voltage ↔ inv",   v:r.chkBatVolt, d:`${battery?.voltage}V in ${inverter?.batVoltMin||"—"}–${inverter?.batVoltMax||"—"}V`}, 
              {l:"Inverter charge power",   v:r.chkBatChg,  d:`${inverter?.batChargeKW}kW avail.`}, 
              {l:"Battery ≤20% (Circ.3)",   v:r.chkBatRule, d:`${r.batRulePct.toFixed(0)}% of limit`}, 
              {l:`Inter-row shading (${inp.mountMode==="ground"?"ground":inp.mountMode==="hybrid"?"roof+gnd":"roof"})`,v:r.chkRowShade,d:r.rowShadeOk?`OK — ${r.totalPanelCap} panels fit`:`~${r.interRowLossPct.toFixed(0)}% loss risk`}, 
            ].map(({l,v,d},i)=>( 
              <div key={l} style={{padding:"9px 14px",background:i%2===0?"transparent":"#070f1f", 
                borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between", 
                alignItems:"center",gap:8}}> 
                <div> 
                  <div style={{fontSize:11,color:C.muted}}>{l}</div> 
                  <div style={{fontSize:10,color:"#475569"}}>{d}</div> 
                </div> 
                <span style={{fontSize:11,fontWeight:800,color:passColor(v),padding:"2px 8px", background:`${passColor(v)}18`,borderRadius:6,whiteSpace:"nowrap"}}>{v}</span> 

              </div> 
            ))} 
          </div> 
        </div> 
      )} 

                  
 
      <button onClick={()=>setShowCmp(!showCmp)} 
        style={{width:"100%",padding:"10px",background:C.card,border:`1px solid ${C.border}`, borderRadius:8,color:C.muted,fontSize:12,fontWeight:700,cursor:"pointer",marginBottom:12}

}> 
        {showCmp?"▲ Hide":"▼ Show"} Component Comparison View 
      </button> 

      {showCmp&&( 
        <div style={cardS(C.purple)}> 
          <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}>🔍 All Library Components</div> 
          {[ 
            {title:"☀ PV Panels",  color:C.yellow, lib:panelLib,  sel:selPanel, fn:setSelPanel, 
             cols:["","Brand","Model","Wp","Voc","Vmp","Isc","β","γ","$/W","Certs"], row:p=>[p.brand,p.model,p.wp,p.voc,p.vmp,p.isc,p.betaVoc,p.gammaPmax,p.costUSD,p.certifications]}, 

            {title:"🔌 Inverters", color:C.purple, lib:invLib,    sel:selInv,   fn:setSelInv, 
             cols:["","Brand","Model","AC kW","Vdc","MPPT V","Bat V","Chg kW","η%","EGP"], row:x=>[x.brand,x.model,x.acKW,x.vdcMax,`${x.mpptMin}–${x.mpptMax}`,`${x.batVoltMin||"—"}–${x.batVoltMax||"—"}`,x.batChargeKW,`${x.eta}%`,fmtE(x.costEGP)]}, 

            {title:"🔋 Batteries", color:C.blue,   lib:batLib,    sel:selBat,   fn:setSelBat, 
             cols:["","Brand","Model","kWh","V","DoD","η%","Cycles","Type","EGP"], row:x=>[x.brand,x.model,x.kwh,`${x.voltage}V`,`${x.dod}%`,`${x.eta}%`,x.cycleLife,x.chemistry,fmtE(x.costEGP)]}, 

          ].map(({title,color,lib,sel,fn,cols,row})=>( 
            <div key={title}> 
              <div style={{padding:"10px 16px",fontSize:11,color,fontWeight:700, 
                textTransform:"uppercase",letterSpacing:1,borderTop:`1px solid ${C.border}`}}>{title}</div> 
              <div style={{overflowX:"auto"}}> 
                <table style={{...tbl,fontSize:11}}> 
                  <thead><tr style={{borderBottom:`2px solid ${C.border}`}}> 
                    {cols.map(h=><th key={h} style={{padding:"6px 10px",textAlign:"right", 
                      color:C.muted,fontWeight:600,whiteSpace:"nowrap"}}>{h}</th>)} 
                  </tr></thead> 
                  <tbody> 
                    {lib.map((item,i)=>( 
                      <tr key={item.id} onClick={()=>fn(item.id)} style={{cursor:"pointer", 
                        background:item.id===sel?`${color}18`:i%2===0?"transparent":"#070f1f", 
                        borderLeft:item.id===sel?`3px solid ${color}`:"3px solid transparent"}}> 
                        <td style={{padding:"6px 8px",textAlign:"center",fontSize:10,color}}> 
                          {item.id===sel?"●":""} 
                        </td> 
                        {row(item).map((v,j)=>( 

        
 
             
             
             
                          <td key={j} style={{padding:"6px 10px",textAlign:"right", 
                            color:item.id===sel?color:C.muted, 
                            fontSize:j===1?10:11}}> 
                            {typeof v==="number"?v.toFixed(j>=6?2:1):v} 
                          </td> 
                        ))} 
                      </tr> 
                    ))} 
                  </tbody> 
                </table> 
              </div> 
            </div> 
          ))} 
          <div style={{padding:"8px 16px",fontSize:10,color:C.muted}}>Click any row to select.</div> 
        </div> 
      )} 
    </div> 
  ); 

  // -- COVERAGE TAB ----------------------------------------- 
  const renderCoverage=()=>{ 
    const mm = inp.mountMode || "roof"; 
    // Show sizing/load warnings at top of Coverage tab (rendered below)
    const MOUNT_MODES = [ 
      { 
        id:"roof", 
        icon:"🏠", 
        title:"Rooftop Only", 
        desc:"Array limited to available roof area after obstructions and row-spacing constraints.", 
        color:C.accent, 
        detail: r ? `Cap: ${r.roofPanelCap} panels · ${((r.roofPanelCap*(panel?.wp||580))/1000).toFixed(1)} kWp` : null, 
      }, 
      { 
        id:"hybrid", 
        icon:"🏠+🌱", 
        title:"Roof + Ground Mount", 
        desc:"Roof panels supplemented by additional ground-mounted array on site. Specify ground area below.", 
        color:C.green, 
        detail: r ? `Roof: ${r.roofPanelCap}p + Ground: ${r.groundPanelCap}p = ${r.totalPanelCap}p total` : null, 
      }, 
      { 
        id:"ground", 
        icon:"🌱", 
        title:"Ground Mount Only", 

 
        desc:"No rooftop constraint. Array sized freely against available ground area. Row spacing still enforced.", 
        color:C.yellow, 
        detail: r ? `Ground cap: ${r.groundPanelCap} panels · ${((r.groundPanelCap*(panel?.wp||580))/1000).toFixed(1)} kWp` : null, 
      }, 
    ]; 
    return(
    <div>
      <WarnBanner scope="sizing"/>
      {/* -- Mount Mode Selector -- */}
      <div style={{marginBottom:16}}> 
        <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1.2, 
          fontWeight:700,marginBottom:10}}>⚙ System Configuration — Panel Placement</div> 
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:10}}> 
          {MOUNT_MODES.map(m=>{ 
            const active = mm===m.id; 
            return( 
              <div key={m.id} onClick={()=>upd("mountMode",m.id)} 
                style={{background:active?`${m.color}14`:C.card,borderRadius:12,padding:"14px 16px", 
                cursor:"pointer",border:`2px solid ${active?m.color:C.border}`, 
                transition:"all 0.15s",position:"relative"}}> 
                {active&&<div style={{position:"absolute",top:10,right:12,width:8,height:8, 
                  borderRadius:"50%",background:m.color}}/>} 
                <div style={{fontSize:20,marginBottom:6}}>{m.icon}</div> 
                <div style={{fontWeight:800,fontSize:13,color:active?m.color:C.text,marginBottom:5}}> 
                  {m.title} 
                </div> 
                <div style={{fontSize:11,color:C.muted,lineHeight:1.5,marginBottom:m.detail?8:0}}> 
                  {m.desc} 
                </div> 
                {m.detail&&active&&( 
                  <div style={{fontSize:10,color:m.color,fontWeight:700,marginTop:4, 
                    padding:"4px 8px",background:`${m.color}18`,borderRadius:6,display:"inline-block"}}> 
                    {m.detail} 
                  </div> 
                )} 
              </div> 
            ); 
          })} 
        </div> 

        {/* Ground area input — shown only for hybrid or ground modes */} 

 
        {(mm==="hybrid"||mm==="ground")&&( 
          <div style={{marginTop:12,padding:"14px 16px",background:C.card,borderRadius:10, 
            border:`2px solid ${mm==="hybrid"?C.green:C.yellow}`}}> 
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,alignItems:"center"}}> 
              <div> 
                <div style={{fontSize:12,fontWeight:700,color:mm==="hybrid"?C.green:C.yellow,marginBottom:4}}> 
                  {mm==="hybrid"?"🌱 Additional Ground Area":"🌱 Total Ground Area"} 
                </div> 
                <div style={{fontSize:11,color:C.muted,lineHeight:1.5}}> 
                  {mm==="hybrid" 
                    ? "Extra area beyond the roof — garden, driveway, or side yard (m²)" 
                    : "Total available ground area for the array (m²)"} 
                </div> 
              </div> 
              <div style={{display:"flex",alignItems:"center",gap:10}}> 
                <input type="number" value={inp.groundAreaM2||0} min={0} step={10} 
                  onChange={e=>upd("groundAreaM2",parseFloat(e.target.value)||0)} 
                  style={{width:"100%",background:"#0f172a", 
                  border:`2px solid ${mm==="hybrid"?C.green:C.yellow}`, 
                  borderRadius:8,color:mm==="hybrid"?C.green:C.yellow, 
                  fontSize:18,fontWeight:800,padding:"10px 14px",textAlign:"right"}}/> 
                <span style={{color:C.muted,fontSize:12,flexShrink:0}}>m²</span> 
              </div> 
            </div> 
            {r&&inp.groundAreaM2>0&&( 
              <div style={{marginTop:10,display:"grid", 
                gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:8}}> 
                {[ 
                  {l:"Ground rows",v:`${r.gMaxRows??0}`,c:mm==="hybrid"?C.green:C.yellow}, 
                  {l:"Panels/row",v:`${r.gPanelsPerRow??0}`,c:mm==="hybrid"?C.green:C.yellow}, 
                  {l:"Ground cap",v:`${r.groundPanelCap} panels`,c:mm==="hybrid"?C.green:C.yellow}, 
                  {l:"Ground kWp",v:`${((r.groundPanelCap*(panel?.wp||580))/1000).toFixed(1)} kWp`,c:mm==="hybrid"?C.green:C.yellow}, 
                ].map(k=>( 
                  <div key={k.l} style={{background:"#0f172a",borderRadius:8,padding:"8px 10px"}}> 
                    <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",marginBottom:2}}>{k.l}</div> 
                    <div style={{fontSize:13,fontWeight:800,color:k.c}}>{k.v}</div> 
                  </div> 
                ))} 
              </div> 
            )} 
            {mm==="hybrid"&&r&&( 

              <div style={{marginTop:10,padding:"8px 12px",background:"#0f172a",borderRadius:8, 
                fontSize:11,color:C.muted,borderLeft:`3px solid ${C.green}`}}> 
                Combined cap: <strong style={{color:C.green}}>{r.roofPanelCap} roof</strong> 
                &nbsp;+&nbsp;<strong style={{color:C.green}}>{r.groundPanelCap} ground</strong> 
                &nbsp;=&nbsp;<strong style={{color:C.accent}}>{r.totalPanelCap} panels total 
                &nbsp;({((r.totalPanelCap*(panel?.wp||580))/1000).toFixed(1)} kWp max)</strong> 
                {r.roofCapped 
                  ? <span style={{color:C.green}}> · Array no longer roof-limited ✓</span> 
                  : <span style={{color:C.muted}}> · Load still within combined cap</span>} 
              </div> 
            )} 
            {mm==="ground"&&r&&( 
              <div style={{marginTop:10,padding:"8px 12px",background:"#0f172a",borderRadius:8, 
                fontSize:11,color:C.muted,borderLeft:`3px solid ${C.yellow}`}}> 
                Row spacing enforced: min pitch <strong style={{color:C.yellow}}>{r.minPitch?.toFixed(2)}m</strong> 
                &nbsp;→&nbsp;<strong style={{color:C.yellow}}>{r.maxRows} rows × 
{r.panelsPerRow} panels</strong> 
                . Increase ground area to accommodate more rows. 
              </div> 
            )} 
          </div> 
        )} 

        {/* Roof-only cap status */} 
        {mm==="roof"&&r&&r.roofCapped&&( 
          <div style={{marginTop:10,padding:"12px 14px",background:`${C.red}12`,borderRadius:10, 
            border:`2px solid ${C.red}44`,display:"flex",justifyContent:"space-between", 
            alignItems:"center",flexWrap:"wrap",gap:10}}> 
            <div> 
              <div style={{fontWeight:800,color:C.red,fontSize:12,marginBottom:3}}> 
                ⚠ Roof limits array to {r.actKwp.toFixed(1)} kWp — target was 
{r.cappedKwp.toFixed(1)} kWp 
              </div> 
              <div style={{fontSize:11,color:C.muted}}> 
                Actual coverage: <strong style={{color:C.orange}}>{r.coverageActual.toFixed(0)}%</strong> 
                &nbsp;vs requested <strong>{r.effPct.toFixed(0)}%</strong> 
                &nbsp;· Switch to <strong>Roof + Ground</strong> to meet your target 
              </div> 
            </div> 
            <button onClick={()=>upd("mountMode","hybrid")} 
              style={{padding:"7px 16px",background:C.green,color:"white",border:"none", 
              borderRadius:8,fontWeight:800,fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}> 

 
              + Add Ground Area → 
            </button> 
          </div> 
        )} 
        {mm==="roof"&&r&&!r.roofCapped&&( 
          <div style={{marginTop:10,padding:"8px 12px",background:`${C.green}12`,borderRadius:8, 
            fontSize:11,color:C.green,borderLeft:`3px solid ${C.green}`}}> 
            ✓ Target array fits within roof — {r.maxPanelsNoShade} panels available, {r.totP} designed 
          </div> 
        )} 
      </div> 

      <div style={{marginBottom:14,padding:"1px 0"}}/> 

      {/* -- Coverage mode selector (unchanged) -- */} 
      <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1.2, 
        fontWeight:700,marginBottom:10}}>🎯 Solar Coverage Target</div> 
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}> 
        {[{mode:"percentage",title:"📊 Percentage Offset",desc:"Cover a % of total consumption."}, 
          {mode:"loadbased", title:"⚡ Specific Load Coverage",desc:"Choose which appliances run on solar."}].map(m=>( 
          <div key={m.mode} onClick={()=>upd("coverageMode",m.mode)} 
            style={{background:C.card,borderRadius:10,padding:14,cursor:"pointer", 
            border:`2px solid ${inp.coverageMode===m.mode?C.orange:C.border}`}}> 
            <div style={{fontWeight:800,color:inp.coverageMode===m.mode?C.orange:C.text,marginBottom:6}}>{m.title}</div> 
            <div style={{fontSize:11,color:C.muted}}>{m.desc}</div> 
          </div> 
        ))} 
      </div> 

      {inp.coverageMode==="percentage"&&( 
        <div style={cardS(C.orange)}> 
          <div style={{padding:"10px 16px",color:"white",fontWeight:800}}>Solar Offset Target</div> 
          <div style={{padding:"16px 20px"}}> 
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}> 
              <span style={{color:C.muted,fontSize:12}}>Offset %</span> 
              <span style={{fontSize:26,fontWeight:900,color:C.orange}}>{inp.offsetPct}%</span> 
            </div> 
            <input type="range" min={20} max={100} step={5} value={inp.offsetPct} 
              onChange={e=>upd("offsetPct",parseInt(e.target.value))} 
              style={{width:"100%",accentColor:C.orange}}/> 
            <div style={{display:"flex",gap:8,marginTop:8,flexWrap:"wrap"}}> 

 
 
 
              {[20,40,60,80,100].map(p=>( 
                <button key={p} onClick={()=>upd("offsetPct",p)} 
                  style={{padding:"4px 12px",borderRadius:6,cursor:"pointer",fontSize:12, 
                  border:`1px solid ${inp.offsetPct===p?C.orange:C.border}`, 
                  background:inp.offsetPct===p?`${C.orange}22`:"transparent", color:inp.offsetPct===p?C.orange:C.muted,fontWeight:inp.offsetPct===p?700:400}}>{p}%</button> 

              ))} 
            </div> 
            {r&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8,marginTop:14}}> 
              {[{l:r.roofCapped?"Roof-limited ⚠":"Solar-supplied",v:r.roofCapped?`${r.coverageActual.toFixed(0)}% coverage`:`${r.solarKwh.toFixed(0)} kWh/d`,c:r.roofCapped?C.red:C.orange}, 
                {l:"Grid-supplied", v:`${(r.loadTot-r.solarKwh).toFixed(0)} kWh/d`,c:C.blue}, 
                {l:"Array",         v:`${r.actKwp.toFixed(1)} kWp`,c:C.yellow}, 
                {l:`Annual (${inp.yieldMode==="p90"?"P90":"P50"})`, v:`${(yGen/1000).toFixed(1)} MWh`,c:inp.yieldMode==="p90"?C.yellow:C.green}, 
                {l:"Payback",       v:r.pb?`${r.pb} yrs`:">25",c:C.green}, 
                {l:"25yr gain",     v:fmtE(r.netGain),c:C.green}].map(k=>( 
                <div key={k.l} style={{background:"#0f172a",borderRadius:8,padding:"10px 12px",borderLeft:`3px solid ${k.c}`}}> 
                  <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:3}
}>{k.l}</div> 
                  <div style={{fontSize:15,fontWeight:800,color:k.c}}>{k.v}</div> 
                </div> 
              ))} 
            </div>} 
          </div> 
        </div> 
      )} 

      {inp.coverageMode==="loadbased"&&( 
        <div style={cardS(C.orange)}> 
          <div style={{padding:"10px 16px",color:"white",fontWeight:800}}>Select Solar-Priority Loads</div> 
          <div style={{padding:"16px 20px",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:8}}> 
            {[{k:"solarAC",l:"❄ AC"},{k:"solarLighting",l:"💡 Lighting"}, 
              {k:"solarWH",l:"🚿 Water Heating"},{k:"solarKitchen",l:"🍳 Kitchen"}, 
              {k:"solarLaundry",l:"👗 Laundry"},{k:"solarPool",l:"🏊 Pool"},{k:"solarMisc",l:"🔌 Misc"}].map(({k,l})=>{ 
              const on=inp[k]; 
              const kwh=r?.loadMap?.[l.replace(/^[^ ]+ /,"")]?.kWh||0; 
              return( 
                <div key={k} onClick={()=>upd(k,!on)} 

                  
 
                  style={{background:"#0f172a",borderRadius:10,padding:"12px 14px",cursor:"pointer", 
                  border:`2px solid ${on?C.orange:C.border}`}}> 
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}> 
                    <span style={{fontWeight:700,color:on?C.orange:C.muted,fontSize:12}}>{l}</span> 
                    <div style={{width:18,height:18,borderRadius:5,background:on?C.orange:C.border, display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"white"}}>{on?"✓":""}</div> 

                  </div> 
                  <div style={{fontSize:10,color:on?C.text:C.muted}}>{kwh.toFixed(1)} kWh/day</div> 
                </div> 
              ); 
            })} 
          </div> 
        </div> 
      )} 

      <div style={cardS(C.blue)}> 
        <div style={{padding:"10px 16px",color:"white",fontWeight:800}}>🔋 Battery Evening Coverage</div> 
        <div style={{padding:"16px 20px"}}> 
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}> 
            <span style={{color:C.muted,fontSize:12}}>Battery covers this % of evening deficit</span> 
            <span style={{fontSize:22,fontWeight:900,color:C.blue}}>{inp.batEveningCovPct}%</span> 
          </div> 
          <input type="range" min={20} max={100} step={10} value={inp.batEveningCovPct} 
            onChange={e=>upd("batEveningCovPct",parseInt(e.target.value))} 
            style={{width:"100%",accentColor:C.blue}}/> 
          {r&&<div style={{marginTop:10,padding:"8px 12px",background:"#0f172a",borderRadius:8,fontSize:11,color:C.muted}}> 
            Profile evening deficit: <strong style={{color:C.blue}}>{r.eveningDeficit.toFixed(1)} kWh</strong> 
            &nbsp;·&nbsp; Battery target: <strong style={{color:C.accent}}>{(r.eveningDeficit*(inp.batEveningCovPct/100)).toFixed(1)} kWh</strong> 
            &nbsp;·&nbsp; Available: <strong style={{color:r.usableBat>=r.eveningDeficit*(inp.batEveningCovPct/100)?C.green:C.red}}>{r.usableBat.toFixed(1)} kWh</strong> 
          </div>} 
        </div> 
      </div> 
    </div> 

                      
 
  );}; 

  // -- DASHBOARD -------------------------------------------- 
  const renderDashboard=()=>{ 
    if(!r)return<div style={{color:C.muted,padding:20}}>Select components first.</div>; 
    const kpis=[ 
      {l:"Selected panel",    v:`${panel?.brand} ${panel?.wp}Wp`,                    c:C.yellow}, 
      {l:"Selected inverter", v:`${inverter?.brand} ${inverter?.acKW}kW`,            c:C.purple}, 
      {l:"Selected battery",  v:`${battery?.brand} ${battery?.kwh}kWh`,             c:C.blue  }, 
      {l:"Array per villa",   v:`${r.actKwp.toFixed(1)} kWp (${r.totP} panels)`,    c:C.yellow}, 
      {l:"Coverage",          v:r.roofCapped?`${r.coverageActual.toFixed(0)}% (roof-ltd)`:`${r.effPct.toFixed(0)}% offset`, c:r.roofCapped?C.red:C.orange}, 
      {l:r.tmySource==="pvgis"?`Annual yield ${inp.yieldMode==="p90"?"P90 ":""}(PVGIS ✓)`:`Annual yield ${inp.yieldMode==="p90"?"P90 ":""}(fallback)`,v:`${(yGen/1000).toFixed(2)} MWh/villa`,c:r.tmySource==="pvgis"?C.green:C.yellow}, 
      {l:r.tmySource==="pvgis"?"SC rate (simulated)":"SC rate (approx)",v:`${r.annSCPct!=null?r.annSCPct.toFixed(1):r.profileSCPct.toFixed(1)}%`,c:r.tmySource==="pvgis"?C.green:C.yellow}, 
      {l:"Cost per villa",    v:fmtE(r.sysC),                                       c:C.red   }, 
      {l:"3-villa total",     v:fmtE(r.totalSysC3),                                 c:C.red   }, 
      {l:"Payback",           v:r.pb?`${r.pb} yrs`:">25",                           c:C.accent}, 
      {l:"IRR / ROI",         v:`${r.irr}% / ${r.roi}%`,                            c:C.green }, 
      {l:"25yr net gain/villa", v:fmtE(r.netGain),                                  c:C.green }, 
      {l:`NPV @${inp.discountRate||12}% discount`, v:fmtE(r.npvAtRate),             c:r.npvAtRate>=0?C.green:C.red}, 
      {l:"LCOE",                v:`E£${r.lcoe}/kWh`,                                c:C.yellow}, 
      {l:"Specific yield (P50)", v:`${(r.annGenTMY/r.actKwp).toFixed(0)} kWh/kWp`, c:C.accent},
      {l:"Specific yield (P90)", v:`${(r.annGenP90/r.actKwp).toFixed(0)} kWh/kWp`, c:C.yellow},
      {l:"Performance Ratio",   v:r.perfRatio||"—",                                 c:C.accent},
      {l:"Clipping loss",       v:`${(r.clippingPct||0).toFixed(1)}%`,             c:(r.clippingPct||0)>3?C.orange:C.green},
    ]; 
    const checks=[
      {l:"Inverter sizing",   v:r.chkInvSize},{l:"DC/AC ratio",    v:r.chkDcAc   },
      {l:"MPPT min",          v:r.chkMpptMin},{l:"MPPT max",       v:r.chkMpptMax},
      {l:"Isc per MPPT",      v:r.chkIscMppt},{l:"String VD",      v:r.chkVdStr  },
      {l:"Feeder VD",         v:r.chkVdFdr  },{l:"AC cable VD",    v:r.chkVdAC   },
      {l:"MDB busbar",        v:r.mdbCheck  },{l:"<500kW NCEDC",   v:r.chkSize500},
      {l:"Roof fit",          v:r.roofFit?"PASS":"REVIEW"},
      {l:"Inter-row shading", v:r.chkRowShade},
      ...(r.noBat ? [] : [
        {l:"Battery voltage",  v:r.chkBatVolt},
        {l:"Battery charge",   v:r.chkBatChg },
        {l:"Battery Circ.3",   v:r.chkBatRule},
      ]),
    ];
    const allPass=checks.every(c=>c.v==="PASS"); 
    return( 
      <div> 
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:14}}> 
          {kpis.map(k=>( 

 
            <div key={k.l} style={{background:C.card,borderRadius:10,padding:"12px 14px",borderLeft:`4px solid ${k.c}`}}> 
              <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:3}
}>{k.l}</div> 
              <div style={{fontSize:15,fontWeight:800,color:k.c}}>{k.v}</div> 
            </div> 
          ))} 
        </div> 
        <div style={cardS(allPass?C.green:C.yellow)}> 
          <div style={{padding:"10px 14px",fontWeight:800,color:"white",display:"flex",justifyContent:"space-between"}}> 
            <span>Compliance Checks</span> 
            <span style={{color:allPass?C.green:C.yellow}}>{allPass?"✅ ALL PASS":"⚠ REVIEW"}</span> 
          </div> 
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))"}}> 
            {checks.map((c,i)=>( 
              <div key={c.l} style={{display:"flex",justifyContent:"space-between",alignItems:"center", 
                padding:"7px 14px",background:i%2===0?"transparent":"#070f1f", 
                borderBottom:`1px solid ${C.border}`}}> 
                <span style={{fontSize:11,color:C.muted}}>{c.l}</span> 
                <span style={{fontSize:11,fontWeight:700,color:passColor(c.v),padding:"2px 8px", 
                  background:`${passColor(c.v)}18`,borderRadius:6}}>{c.v}</span> 
              </div> 
            ))} 
          </div> 
        </div> 
        <div style={cardS(C.red)}> 
          <div style={{padding:"10px 14px",color:"white",fontWeight:800}}>Cost Breakdown (per villa)</div> 
          <div style={{padding:"12px 16px",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8}}> 
            {[ 
              {l:"PV Array",    v:fmtE(r.arrayCostEGP), pct:r.arrayCostEGP/r.sysC*100, c:C.yellow}, 
              {l:"Inverter",    v:fmtE(r.invCostEGP),   pct:r.invCostEGP/r.sysC*100,   c:C.purple}, 
              {l:"Battery",     v:fmtE(r.batCostEGP),   pct:r.batCostEGP/r.sysC*100,   c:C.blue  }, 
              {l:"BoS/Install", v:fmtE(r.bos),          pct:r.bos/r.sysC*100,          c:C.orange}, 
              {l:"Engineering", v:fmtE(r.engCost),      pct:r.engCost/r.sysC*100,      c:C.muted }, 
            ].map(k=>( 
              <div key={k.l} style={{background:"#0f172a",borderRadius:8,padding:"10px 12px"}}> 
                <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",marginBottom:4}}>{k.l}</div> 
                <div style={{fontSize:15,fontWeight:800,color:k.c}}>{k.v}</div> 

                <div style={{marginTop:5,background:C.border,borderRadius:4,height:5}}> 
                  <div style={{width:`${k.pct}%`,background:k.c,borderRadius:4,height:5}}/> 
                </div> 
                <div style={{fontSize:10,color:k.c,marginTop:3}}>{k.pct.toFixed(0)}%</div> 
              </div> 
            ))} 
          </div> 
        </div> 
      </div> 
    ); 
  }; 

  // -- PHASE TABS -------------------------------------------- 
  const renderLoad=()=>{ 
    if(!r)return<div style={{color:C.muted,padding:20}}>Select components first.</div>; 

    // Smart meter CSV import card 
    const meterCard = ( 
      <div style={cardS("#14b8a6")}> 
        <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13, 
          display:"flex",justifyContent:"space-between",alignItems:"center"}}> 
          <span>Smart Meter CSV Import <span style={{fontSize:10,fontWeight:400,color:"#14b8a6cc"}}>(optional — overrides profile demand)</span></span> 
          {meterData && <span style={{fontSize:11,color:C.green,fontWeight:700}}>Loaded</span>} 
        </div> 
        <div style={{padding:"12px 16px"}}> 
          <div style={{fontSize:11,color:C.muted,marginBottom:10}}> 
            Upload a smart meter CSV export with hourly kWh readings. Accepted column headers: kwh, energy, consumption, usage, import. 
          </div> 
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}> 
            <label style={{padding:"7px 16px",background:"#14b8a6",color:C.bg,border:"none", 
              borderRadius:8,fontWeight:800,fontSize:12,cursor:"pointer",display:"inline-block"}}> 
              Choose CSV File 
              <input type="file" accept=".csv,.txt" onChange={handleMeterCSV} 
                style={{display:"none"}} /> 
            </label> 
            {meterData && ( 
              <button onClick={() => { setMeterData(null); setMeterMsg(""); }} 
                style={{padding:"7px 12px",background:C.red+"22",color:C.red, 
                border:"1px solid "+C.red,borderRadius:8,fontSize:11,cursor:"pointer"}}> 
                Clear 
              </button> 
            )} 
          </div> 
          {meterMsg && ( 

 
 
            <div style={{marginTop:10,fontSize:11,padding:"7px 12px",borderRadius:6, 
              background:meterData?C.green+"18":C.red+"18", 
              color:meterData?C.green:C.red, 
              borderLeft:"3px solid "+(meterData?C.green:C.red)}}> 
              {meterMsg} 
            </div> 
          )} 
        </div> 
      </div> 
    ); 

    const METHOD_OPTS = [ 
      { 
        id:"bill", 
        icon:"🧾", 
        title:"Bill-Based Estimate", 
        accuracy:25, 
        accuracyLabel:"±25–35%", 
        accuracyColor:C.orange, 
        desc:"Enter your monthly electricity bill. The engine back-calculates daily consumption from tariff. Fast — no appliance breakdown needed.", 
        unlocks:"Array sizing only. Battery sizing and self-consumption are approximate.", 
        limits:true, 
      }, 
      { 
        id:"profile", 
        icon:"🕐", 
        title:"Time-of-Day Profile", 
        accuracy:90, 
        accuracyLabel:"±8–12%", 
        accuracyColor:C.green, 
        desc:"Set the fraction of each appliance active in morning, daytime, and evening windows. Produces a real 24h demand curve.", 
        unlocks:"Enables full hourly dispatch simulation, accurate battery sizing, and real self-consumption calculation.", 
        limits:false, 
      }, 
    ]; 
    const method = inp.loadMethod || "profile"; 
    const profLabels =["AC","Light","WH","Kitchen","Laundry","Pool","Misc"]; 
    const profIcons  =["❄","💡","🚿","🍳","👗","🏊","🔌"]; 
    const profKeys   =["prof_AC","prof_Light","prof_WH","prof_Kitchen","prof_Laundry","prof_Pool","prof_Misc"]; 
    const winLabels  =["Morning 06–10h","Day 10–17h","Evening 17–23h"]; 
    const {demand,solarShape,morningKwh,dayKwh,eveningKwh,totalKwh} = profile; 
    const totalSolarGen = r.actKwp * r.etaSys * inp.pshDesign; 
    const genNorm = solarShape.reduce((s,v)=>s+v,0); 
    const hourlyGenDisp = solarShape.map(s=>genNorm>0?(totalSolarGen*s)/genNorm:0); 

 
    const scH = demand.map((d,h)=>Math.min(d,hourlyGenDisp[h])); 
    const totalSC = scH.reduce((s,v)=>s+v,0); 
    const scPct = r.annSCPct!=null ? r.annSCPct.toFixed(0) 
                  : (totalSolarGen>0?((totalSC/totalSolarGen)*100).toFixed(0):"0"); 
    const eveningDef = demand.slice(17,23).reduce((s,v)=>s+v,0); 
    const maxY = Math.max(...demand,...hourlyGenDisp,0.1); 
    return( 
      <div> 
        {meterCard} 
        {/* -- Method Selector -- */} 
        <div style={{marginBottom:16}}> 
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1.2, 
            fontWeight:700,marginBottom:10}}>⚡ Consumption Input Method</div> 
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}> 
            {METHOD_OPTS.map(m=>{ 
              const active = method===m.id; 
              return( 
                <div key={m.id} onClick={()=>upd("loadMethod",m.id)} 
                  style={{background:active?`${m.accuracyColor}10`:C.card, 
                  borderRadius:12,padding:"16px 18px",cursor:"pointer", 
                  border:`2px solid ${active?m.accuracyColor:C.border}`, 
                  transition:"all 0.15s",position:"relative"}}> 
                  {active&&<div style={{position:"absolute",top:12,right:14, 
                    width:8,height:8,borderRadius:"50%",background:m.accuracyColor}}/>} 
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}> 
                    <span style={{fontSize:22}}>{m.icon}</span> 
                    <div> 
                      <div style={{fontWeight:800,fontSize:13, 
                        color:active?m.accuracyColor:C.text}}>{m.title}</div> 
                      {/* Accuracy bar */} 
                      <div style={{display:"flex",alignItems:"center",gap:6,marginTop:4}}> 
                        <div style={{width:80,background:C.border,borderRadius:4,height:5}}> 
                          <div style={{width:`${m.accuracy}%`,background:m.accuracyColor, 
                            borderRadius:4,height:5}}/> 
                        </div> 
                        <span style={{fontSize:10,color:m.accuracyColor,fontWeight:700}}> 
                          {m.accuracyLabel} 
                        </span> 
                      </div> 
                    </div> 
                  </div> 
                  <div style={{fontSize:11,color:C.muted,lineHeight:1.6,marginBottom:8}}> 
                    {m.desc} 
                  </div> 
                  <div style={{fontSize:10,padding:"5px 8px",borderRadius:6, 
                    background:m.limits?`${C.orange}18`:`${C.green}18`, 
                    color:m.limits?C.orange:C.green,lineHeight:1.5}}> 
                    {m.limits?"⚠ ":"✓ "}{m.unlocks} 

                  </div> 
                </div> 
              ); 
            })} 
          </div> 

          {/* -- BILL METHOD -- */} 
          {method==="bill"&&( 
            <div style={cardS(C.orange)}> 
              <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}> 
                🧾 Monthly Bill Input 
              </div> 
              <div style={{padding:"16px 20px"}}> 
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,alignItems:"center",marginBottom:14}}> 
                  <div> 
                    <div style={{fontSize:12,color:C.muted,marginBottom:6}}>Monthly electricity bill 
(EGP)</div> 
                    <input type="number" value={inp.monthlyBillEGP} step={500} min={0} 
                      onChange={e=>upd("monthlyBillEGP",parseFloat(e.target.value)||0)} 
                      style={{width:"100%",background:"#0f172a",border:`2px solid ${C.orange}`, 
                      borderRadius:8,color:C.orange,fontSize:22,fontWeight:800, 
                      padding:"10px 14px",textAlign:"right"}}/> 
                    <div style={{fontSize:10,color:C.muted,marginTop:4}}> 
                      Current tariff: E£{inp.tariffNow}/kWh · Set in Financial inputs 
                    </div> 
                  </div> 
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}> 
                    {[ 
                      {l:"Est. daily consumption",v:`${r.billDailyKwh!=null?r.billDailyKwh.toFixed(1):"—"} kWh`,c:C.orange}, 
                      {l:"Est. monthly consumption",v:`${r.billDailyKwh!=null?(r.billDailyKwh*30.5).toFixed(0):"—"} kWh`,c:C.orange}, 
                      {l:"Profile baseline",v:`${r.profileDailyKwh!=null?r.profileDailyKwh.toFixed(1):"—"} kWh/day`,c:C.muted}, 
                      {l:"Bill scale factor",v:`${r.billScale!=null?r.billScale.toFixed(2):"—"}×`, 
                        c:r.billScale&&(r.billScale>2||r.billScale<0.3)?C.red:C.muted}, 
                    ].map(k=>( 
                      <div key={k.l} style={{background:"#0f172a",borderRadius:8,padding:"8px 10px"}}> 
                        <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",marginBottom:2}}>{k.l}</div> 
                        <div style={{fontSize:13,fontWeight:800,color:k.c}}>{k.v}</div> 
                      </div> 
                    ))} 
                  </div> 

 
                </div> 
                {r.billScale&&(r.billScale>2.5||r.billScale<0.4)&&( 
                  <div style={{padding:"8px 12px",background:`${C.red}18`,borderRadius:8, 
                    fontSize:11,color:C.red,borderLeft:`3px solid ${C.red}`}}> 
                    ⚠ Bill scale factor is {r.billScale.toFixed(2)}× — the appliance list and bill 
                    are very mismatched. Check that the tariff is correct and appliances are representative. 
                    Consider switching to Time-of-Day Profile for better accuracy. 
                  </div> 
                )} 
                <div style={{marginTop:10,padding:"8px 12px",background:"#0f172a",borderRadius:8, 
                  fontSize:10,color:C.muted,lineHeight:1.6,borderLeft:`3px solid ${C.orange}`}}> 
                  <strong style={{color:C.orange}}>How this works:</strong> The engine uses your 
                  appliance list to determine the <em>shape</em> of consumption (which loads run when), 
                  then scales all loads proportionally so the daily total matches your bill. 
                  Accuracy improves significantly if you also set the profile fractions below — 
                  but the bill total overrides the profile total. 
                </div> 
              </div> 
            </div> 
          )} 
        </div> 

        {/* -- PROFILE SECTION (always shown, prominent in profile mode) -- */} 
        <div style={{opacity:method==="bill"?0.6:1,transition:"opacity 0.2s"}}> 
          {method==="bill"&&( 
            <div style={{fontSize:11,color:C.muted,marginBottom:8, 
              padding:"6px 12px",background:C.card,borderRadius:8, 
              borderLeft:`3px solid ${C.orange}`}}> 
              ℹ Appliance fractions below determine <em>when</em> consumption happens 
              (morning / day / evening split). The total is set by your bill above. 
            </div> 
          )} 

          {/* KPI strip */} 
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:14}}> 
            {[ 
              {l:"Daily consumption",  v:`${r.loadTot.toFixed(1)} kWh`,    c:C.orange, 
               note:method==="bill"?"from bill":"from profile"}, 
              {l:"Evening demand",     v:`${eveningDef.toFixed(1)} kWh`,   c:C.blue,   note:"17–23h"}, 
              {l:"Solar self-consumed",v:`${scPct}%`,                      c:C.green,  note:"of generation"}, 

 
 
              {l:"Battery target",     v:`${r.eveningDeficit.toFixed(1)} kWh`,c:C.accent,note:"deficit to cover"}, 
              {l:"Peak demand",        v:`${r.peakKW.toFixed(1)} kW`,      c:C.yellow, note:"coincident"}, 
              {l:"Annual load",        v:`${(r.loadTot*365/1000).toFixed(1)} MWh`,c:C.muted,note:"est."}, 
            ].map(k=>( 
              <div key={k.l} style={{background:C.card,borderRadius:10,padding:"12px 14px", 
                borderLeft:`4px solid ${k.c}`}}> 
                <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:3}
}>{k.l}</div> 
                <div style={{fontSize:14,fontWeight:800,color:k.c}}>{k.v}</div> 
                <div style={{fontSize:9,color:C.muted,marginTop:2}}>{k.note}</div> 
              </div> 
            ))} 
          </div> 

          {/* 24h chart */} 
          <div style={cardS(C.orange)}> 
            <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}> 
              24-Hour Demand vs Solar Generation 
              {method==="bill"&&<span style={{fontSize:10,color:C.orange,marginLeft:8,fontWeight:600}}> 
                (shape from profile · total from bill) 
              </span>} 
            </div> 
            <div style={{padding:"14px 20px"}}> 
              <div style={{display:"flex",gap:16,marginBottom:8,flexWrap:"wrap",fontSize:10,color:C.muted}}> 
                <span><span style={{color:C.orange}}>-</span> Demand</span> 
                <span><span style={{color:C.yellow}}>-</span> Solar gen</span> 
                <span><span style={{color:C.green}}>-</span> Self-consumed</span> 
                <span style={{color:`${C.blue}cc`}}>- Evening 17–23h</span> 
              </div> 
              <div style={{display:"flex",gap:2,alignItems:"flex-end",height:96, 
                borderBottom:`1px solid ${C.border}`,paddingBottom:2}}> 
                {Array.from({length:24},(_,h)=>{ 
                  const d=demand[h],g=hourlyGenDisp[h],sc=scH[h]; 
                  const isEve=h>=17&&h<=22; 
                  const bH=v=>`${Math.round((v/maxY)*92)}px`; 
                  return( 
                    <div key={h} style={{flex:1,display:"flex",alignItems:"flex-end",gap:1, position:"relative",background:isEve?`${C.blue}12`:"transparent",borderRadius:2}}> 

                      <div style={{flex:1,height:bH(d),background:`${C.orange}80`, 
                        borderRadius:"2px 2px 0 0",minHeight:d>0?2:0}}/> 
                      <div style={{flex:1,height:bH(g),background:`${C.yellow}80`, 

 
                      
                        borderRadius:"2px 2px 0 0",minHeight:g>0?2:0}}/> 
                      <div style={{position:"absolute",bottom:0,left:0,width:"50%", 
                        height:bH(sc),background:`${C.green}70`,borderRadius:"2px 2px 0 0"}}/> 
                    </div> 
                  ); 
                })} 
              </div> 
              <div style={{display:"flex",gap:2,marginTop:3}}> 
                {Array.from({length:24},(_,h)=>( 
                  <div key={h} style={{flex:1,textAlign:"center",fontSize:8, 
                    color:h%6===0?C.muted:"transparent"}}>{h}</div> 
                ))} 
              </div> 
            </div> 
          </div> 

          {/* Profile sliders */} 
          <div style={cardS(C.accent)}> 
            <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}> 
              Time-Window Fractions — Fraction of each load active per window 
            </div> 
            <div style={{padding:"6px 16px 4px",display:"grid", 
              gridTemplateColumns:"110px repeat(3,1fr)",gap:8, 
              borderBottom:`1px solid ${C.border}`}}> 
              <span/> 
              {winLabels.map(l=>( 
                <span key={l} style={{textAlign:"center",fontSize:10,fontWeight:700,color:C.accent}}>{l}</span> 
              ))} 
            </div> 
            {profLabels.map((lbl,li)=>{ 
              const pk=profKeys[li]; 
              const fr=inp[pk]; 
              const _acKW=inp.acUnits*inp.acTonnage*(3.517/(inp.acCOP||3.0)), _lightKW=(inp.lightingAreaM2*8)/1000; 
              const kw=[_acKW,_lightKW,inp.whKW,inp.kitchenW/1000,inp.laundryW/1000,inp.poolKW,inp.miscKW][li]; 
              const dailyKwh = fr.reduce((s,f,i)=>s+f*WIN_HRS[i],0)*kw*(inp.loadMethod==="bill"?r.billScale:1); 
              return( 
                <div key={lbl} style={{padding:"10px 16px",borderBottom:`1px solid ${C.border}`, 
                  display:"grid",gridTemplateColumns:"110px repeat(3,1fr)",gap:8,alignItems:"center"}}> 
                  <div> 
                    <div style={{fontSize:11,color:C.text,fontWeight:600}}>{profIcons[li]} {lbl}</div> 
                    <div style={{fontSize:9,color:C.muted,marginTop:2}}>{dailyKwh.toFixed(1)} kWh/day</div> 

 
                  </div> 
                  {[0,1,2].map(wi=>( 
                    <div key={wi} style={{display:"flex",flexDirection:"column",gap:3}}> 
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:10}}> 
                        <span style={{color:C.muted}}>0</span> 
                        <span style={{color:C.accent,fontWeight:800}}>{Math.round(fr[wi]*100)}%</span> 
                        <span style={{color:C.muted}}>100</span> 
                      </div> 
                      <input type="range" min={0} max={1} step={0.05} value={fr[wi]} 
                        onChange={e=>{const nf=[...fr];nf[wi]=parseFloat(e.target.value);upd(pk,nf);}} 
                        style={{width:"100%",accentColor:C.accent}}/> 
                    </div> 
                  ))} 
                </div> 
              ); 
            })} 
          </div> 

          {/* Load breakdown table */} 
          <div style={cardS(C.yellow)}> 
            <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}> 
              ⚡ Load Breakdown 
              {method==="bill"&&<span style={{fontSize:10,fontWeight:600,color:C.orange,marginLeft:8}}> 
                scaled {r.billScale?.toFixed(2)}× to match bill 
              </span>} 
            </div> 
            <table style={tbl}><thead><tr style={{borderBottom:`2px solid ${C.border}`}}> 
              <th style={{padding:"8px 14px",textAlign:"left",color:C.muted,fontSize:11,width:"28%"}}>Load</th> 
              <th style={{padding:"8px 10px",textAlign:"right",color:C.yellow,fontSize:11}}>kW</th> 
              <th style={{padding:"8px 10px",textAlign:"right",color:C.orange,fontSize:11}}>kWh/day</th> 
              <th style={{padding:"8px 10px",textAlign:"right",color:C.muted,fontSize:11}}>Eff. hrs</th> 
              <th style={{padding:"8px 10px",textAlign:"center",color:C.orange,fontSize:11}}>Supply</th> 
            </tr></thead><tbody> 
              {Object.entries(r.loadMap).map(([n,{kWh,kW,solar}],i)=>( 
                <tr key={n} style={{background:i%2===0?"transparent":"#070f1f",borderBottom:`1px solid #1e293b`}}> 
                  <td style={{padding:"6px 14px",color:C.muted,fontSize:11}}>{n}</td> 
                  <td style={{padding:"6px 10px",textAlign:"right",color:C.text,fontSize:12}}>{kW.toFixed(2)}</td> 
                  <td style={{padding:"6px 10px",textAlign:"right",color:C.text,fontSize:12}}>{kWh.toFixed(2)}</td> 

 
                  <td style={{padding:"6px 10px",textAlign:"right",color:C.muted,fontSize:11}}> 
                    {kW>0?(kWh/kW).toFixed(1):"—"}h 
                  </td> 
                  <td style={{padding:"6px 10px",textAlign:"center"}}> 
                    <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:10, background:inp.coverageMode==="percentage"?C.border:solar?`${C.orange}22`:C.border, 

                      color:inp.coverageMode==="percentage"?C.muted:solar?C.orange:C.muted}}> 
                      {inp.coverageMode==="percentage"?"BLENDED":solar?"☀ SOLAR":"🔌 GRID"} 
                    </span> 
                  </td> 
                </tr> 
              ))} 
              <tr style={{background:`${C.orange}12`,borderTop:`2px solid ${C.orange}`}}> 
                <td style={{padding:"8px 14px",fontWeight:800,color:C.orange,fontSize:12}}>TOTAL</td> 
                <td style={{padding:"8px 10px",textAlign:"right",fontWeight:800,color:C.yellow}}>{r.peakKW.toFixed(2)}</td> 
                <td style={{padding:"8px 10px",textAlign:"right",fontWeight:800,color:C.orange}}>{r.loadTot.toFixed(2)}</td> 
                <td style={{padding:"8px 10px",textAlign:"right",color:C.muted,fontSize:11}}> 
                  {r.peakKW>0?(r.loadTot/r.peakKW).toFixed(1):"—"}h avg 
                </td> 
                <td style={{padding:"8px 10px",textAlign:"center",color:C.orange,fontSize:11,fontWeight:700}}> 
                  {r.effPct.toFixed(0)}% solar 
                </td> 
              </tr> 
            </tbody></table> 
          </div> 
        </div> 
      </div> 
    ); 
  }; 

  // E5: Optimal tilt sweep — uses monthly TMY PSH × days for annual yield estimate 
  function optimalTiltYields(tmyMonthly) { 
    if (!tmyMonthly || tmyMonthly.length < 12) return []; 
    // For each tilt 0-45° in 5° steps, approximate yield using cosine of incidence 
    const lat = (inp.lat||30.06) * Math.PI/180; 
    return Array.from({length:10}, (_,i) => { 
      const tilt = i*5; // 0,5,...45 
      const tRad = tilt * Math.PI/180; 
      // Annual yield ∝ Σ(monthly PSH × days × cos(incidence_correction)) 
      // Simplified: apply latitude-tilt factor per month 
      const decls = [-23.45,-20.9,-11.6,0,11.6,20.9,23.45,20.9,11.6,0,-11.6,-20.9] 
        .map(d => d*Math.PI/180); 

                      
 
      let annYield = 0; 
      tmyMonthly.forEach((mo, mi) => { 
        const decl = decls[mi]; 
        // Beam component on tilted surface at solar noon (simplified) 
        const cosInc = Math.sin(lat-tRad)*Math.sin(decl)+Math.cos(lat-tRad)*Math.cos(decl); 
        const tiltFactor = Math.max(0.7, Math.min(1.2, cosInc / (Math.sin(lat)*Math.sin(decl)+Math.cos(lat)*Math.cos(decl)+0.001))); 
        annYield += mo.psh * mo.days * Math.max(0.8, tiltFactor); 
      }); 
      return { tilt, yield: Math.round(annYield) }; 
    }); 
  } 
  const tiltSweep = optimalTiltYields(r?.tmyMonthly); 
  const optTilt   = tiltSweep.length ? tiltSweep.reduce((a,b)=>b.yield>a.yield?b:a,tiltSweep[0]) : null; 

  // E11: Sensitivity tornado chart renderer 
  function renderSensitivity() { 
    if (!r?.sensitivity) return null; 
    const s = r.sensitivity; 
    const base25 = r.netGain; 
    const bars = [ 
      { label:"Tariff ±20%",    lo:s.tariff.lo,   hi:s.tariff.hi,  c:C.yellow }, 
      { label:"O&M ±20%",      lo:s.omCost.lo,   hi:s.omCost.hi,  c:C.red    }, 
      { label:"Degradation ±",  lo:s.panelDeg.hi, hi:s.panelDeg.lo,c:C.orange }, 
    ]; 
    const allVals = bars.flatMap(b=>[b.lo,b.hi,base25]).filter(v=>!isNaN(v)&&isFinite(v)); 
    if (!allVals.length) return null; 
    const minV = Math.min(...allVals); 
    const maxV = Math.max(...allVals); 
    const range = maxV - minV || 1; 
    const toX = v => Math.round(((v-minV)/range)*420); 
    const baseX = toX(base25); 
    return ( 
      <div style={{background:"#1e293b",borderRadius:12,marginBottom:12, 
        border:"1px solid #8b5cf6",overflow:"hidden"}}> 
        <div style={{padding:"10px 14px",background:"#8b5cf6",color:"white",fontWeight:800,fontSize:13}}> 
          🌪 E11 Sensitivity — 25yr Net Gain at ±20% on Key Variables 
        </div> 
        <div style={{padding:"12px 14px"}}> 
          <svg width="100%" viewBox={`0 0 520 ${bars.length*44+40}`} style={{overflow:"visible"}}> 
            <line x1={20+baseX} y1={0} x2={20+baseX} y2={bars.length*44+10} 
              stroke="#22d3ee" strokeWidth={1} strokeDasharray="4 3"/> 
            <text x={20+baseX} y={bars.length*44+28} textAnchor="middle" 
              fill="#22d3ee" fontSize={10}>Base: {fmtE(base25)}</text> 
            {bars.map((b,i)=>{ 

 
              const x1=20+Math.min(toX(b.lo),toX(b.hi)); 
              const x2=20+Math.max(toX(b.lo),toX(b.hi)); 
              return ( 
                <g key={i} transform={`translate(0,${i*44+8})`}> 
                  <text x={0} y={16} fill="#94a3b8" fontSize={11}>{b.label}</text> 
                  <rect x={x1} y={22} width={Math.max(6,x2-x1)} height={14} 
                    rx={3} fill={b.c} opacity={0.75}/> 
                  <text x={x1-4} y={33} textAnchor="end" fill="#94a3b8" fontSize={9}> 
                    {fmtE(Math.round(b.lo))} 
                  </text> 
                  <text x={x2+4} y={33} fill="#94a3b8" fontSize={9}> 
                    {fmtE(Math.round(b.hi))} 
                  </text> 
                </g> 
              ); 
            })} 
          </svg> 
          <div style={{fontSize:10,color:"#94a3b8",marginTop:4}}> 
            NPV @ {inp.discountRate||12}% discount: <strong style={{color:r.npvAtRate>=0?"#10b981":"#ef4444"}}> 
              {fmtE(r.npvAtRate)} 
            </strong> 
            {" · "}LCOE: <strong style={{color:"#f59e0b"}}>E£{r.lcoe}/kWh</strong> 
            {" · "}Grid tariff today: <strong style={{color:"#e2e8f0"}}>E£{inp.tariffNow}/kWh</strong> 
            {r.lcoe && inp.tariffNow && ( 
              <span style={{color:parseFloat(r.lcoe)<inp.tariffNow?"#10b981":"#ef4444"}}> 
                {" "}({parseFloat(r.lcoe)<inp.tariffNow?"✓ below grid tariff":"above grid tariff"}) 
              </span> 
            )} 
          </div> 
        </div> 
      </div> 
    ); 
  } 

  // -- Injected Solar tab additions ------------------------------ 
  function renderSolarAdditions() { 
    if(!r) return null; 
    const wf = lossWaterfall(r); 
    const maxVal = wf[0]?.value || 1; 

    // E10: Loss waterfall SVG 
    const waterfallEl = ( 
      <div style={cardS(C.yellow)} key="waterfall"> 
        <div style={{padding:"10px 14px",color:"white",fontWeight:800,fontSize:13}}> 
          ⬇ E10 Energy Loss Waterfall (kWh/yr/villa) 
        </div> 

 
 
        <div style={{padding:"0 14px 14px"}}> 
          <svg width="100%" viewBox={`0 0 600 ${wf.length*38+20}`} style={{overflow:"visible"}}> 
            {wf.map((item,i) => { 
              const barW = Math.max(4, (item.value/maxVal)*480); 
              return ( 
                <g key={i} transform={`translate(0,${i*38})`}> 
                  <text x="0" y="14" fill={C.muted} fontSize="11" fontFamily="monospace"> 
                    {item.label.padEnd(18,' ')} 
                  </text> 
                  <rect x="120" y="2" width={barW} height="22" rx="3" 
                    fill={item.isResult?"#10b981":item.isBase?"#22d3ee":item.color} 
                    opacity={item.isBase||item.isResult?1:0.8}/> 
                  <text x={124+barW} y="17" fill={C.text} fontSize="11" fontFamily="monospace"> 
                    {item.isBase||item.isResult 
                      ? `${Math.round(item.value).toLocaleString()} kWh` 
                      : `−${Math.round(item.value).toLocaleString()} kWh (${(item.value/maxVal*100).toFixed(1)}%)`} 
                  </text> 
                </g> 
              ); 
            })} 
          </svg> 
          <div style={{fontSize:10,color:C.muted,marginTop:4}}> 
            PR: {r.perfRatio} · IAM loss: {((1-parseFloat(r.iamLoss||1))*100).toFixed(1)}% 
            · Shading: {((1-parseFloat(r.shadeFactor||1))*100).toFixed(1)}% 
            · Clipping: {(r.clippingPct||0).toFixed(1)}% 
          </div> 
        </div> 
      </div> 
    ); 

    // E5: Optimal tilt chart 
    const maxYield = tiltSweep.length ? Math.max(...tiltSweep.map(t=>t.yield)) : 1; 
    const tiltEl = ( 
      <div style={cardS(C.accent)} key="tilt"> 
        <div style={{padding:"10px 14px",color:"white",fontWeight:800,fontSize:13}}> 
          📐 E5 Optimal Tilt Sweep ({inp.lat||30.06}°N latitude) 
        </div> 
        <div style={{padding:"0 14px 14px"}}> 
          <svg width="100%" viewBox="0 0 500 120"> 
            {tiltSweep.map((t,i) => { 
              const x = 30 + i*48; 
              const h = Math.round((t.yield/maxYield)*80); 
              const isOpt = optTilt && t.tilt===optTilt.tilt; 
              return ( 
                <g key={i}> 
                  <rect x={x} y={100-h} width={36} height={h} rx={3} 

 
                    fill={isOpt?"#10b981":C.accent} opacity={isOpt?1:0.6}/> 
                  <text x={x+18} y={115} textAnchor="middle" fill={C.muted} fontSize="10">{t.tilt}°</text> 
                  {isOpt && <text x={x+18} y={100-h-4} textAnchor="middle" fill="#10b981" fontSize="9" fontWeight="bold">✓</text>} 
                </g> 
              ); 
            })} 
          </svg> 
          <div style={{fontSize:11,color:C.green,fontWeight:700,marginTop:4}}> 
            Optimal tilt: {optTilt?.tilt}° — {optTilt?.yield} kWh/kWp/yr estimated 
            {' '}(current: {inp.tiltDeg}° 
            {inp.tiltDeg===optTilt?.tilt?" ✓ optimal":"" }) 
          </div> 
        </div> 
      </div> 
    ); 

    // E13: Obstacle input UI 
    const obstacleEl = ( 
      <div style={cardS(C.red)} key="obstacles"> 
        <div style={{padding:"10px 14px",color:"white",fontWeight:800,fontSize:13}}> 
          🏗 E13 Near-Shading Obstacles 
        </div> 
        <div style={{padding:"8px 14px 14px",fontSize:11,color:C.muted}}> 
          Add roof obstacles (parapets, AC units, water tanks). Shade angle α = atan(height/distance). 
        </div> 
        <div style={{padding:"0 14px 14px",display:"flex",flexWrap:"wrap",gap:8}}> 
          {(inp.obstacles||[]).map((ob,i) => ( 
            <div key={i} style={{background:C.bg,borderRadius:8,padding:"8px 12px",fontSize:11, 
              display:"flex",alignItems:"center",gap:8,border:`1px solid ${C.border}`}}> 
              <span>H:{ob.h}m D:{ob.d}m Az:{ob.az}° → α:{(Math.atan2(ob.h,ob.d)*180/Math.PI).toFixed(1)}°</span> 
              <button onClick={()=>upd("obstacles",(inp.obstacles||[]).filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontSize:14}}>×</button> 

            </div> 
          ))} 
          <button onClick={()=>{ 
            const h=parseFloat(prompt("Obstacle height (m):")||0); 
            const d=parseFloat(prompt("Horizontal distance from panels (m):")||1); 
            const az=parseFloat(prompt("Compass bearing to obstacle (° from N, 180=South):")||180); 
            if(h>0&&d>0) upd("obstacles",[...(inp.obstacles||[]),{h,d,az}]); 
          }} style={{padding:"6px 16px",background:C.red,color:"white",border:"none", 

 
                
            borderRadius:8,cursor:"pointer",fontSize:11,fontWeight:700}}>+ Add Obstacle</button> 
        </div> 
        {r.shadeFactor && ( 
          <div style={{padding:"8px 14px",fontSize:11,color:C.muted}}> 
            Shading factor: <strong style={{color:(r.shadeFactor||1)<0.97?C.red:C.green}}> 
              {((parseFloat(r.shadeFactor||1))*100).toFixed(1)}% 
            </strong> of generation reached (diffuse included) 
          </div> 
        )} 
      </div> 
    ); 

    // E14: Horizon profile input 
    const horizonEl = ( 
      <div style={cardS(C.purple)} key="horizon"> 
        <div style={{padding:"10px 14px",color:"white",fontWeight:800,fontSize:13}}> 
          🌄 E14 Horizon Profile 
        </div> 
        <div style={{padding:"8px 14px",fontSize:11,color:C.muted}}> 
          Enter horizon elevation angle at each compass bearing. Source: SunEye, SolarPathfinder, or Solargis. 
        </div> 
        <div style={{padding:"0 14px 14px",display:"flex",flexWrap:"wrap",gap:6}}> 
          {[0,30,60,90,120,150,180,210,240,270,300,330].map(az => { 
            const existing = (inp.horizonProfile||[]).find(p=>p.az===az); 
            return ( 
              <div key={az} style={{textAlign:"center"}}> 
                <div style={{fontSize:9,color:C.muted}}>{az}°</div> 
                <input type="number" min="0" max="45" step="1" 
                  value={existing?.elev||0} 
                  onChange={e=>{ 
                    const elev=parseFloat(e.target.value)||0; 
                    const prof=(inp.horizonProfile||[]).filter(p=>p.az!==az); 
                    upd("horizonProfile",[...prof,{az,elev}].sort((a,b)=>a.az-b.az)); 
                  }} 
                  style={{width:44,textAlign:"center",background:C.bg,border:`1px solid ${C.border}`, 
                    borderRadius:4,color:C.text,fontSize:11,padding:"3px 4px"}}/> 
              </div> 
            ); 
          })} 
        </div> 
        {r.horizonFactor && ( 
          <div style={{padding:"8px 14px",fontSize:11,color:C.muted}}> 
            Horizon shading factor: <strong style={{color:C.accent}}> 
              {((parseFloat(r.horizonFactor||1))*100).toFixed(1)}% 
            </strong> 

 
          </div> 
        )} 
      </div> 
    ); 

    // -- Monte Carlo yield distribution card ---------------------------------
    const mcEl = yieldDist ? (
      <div style={cardS(C.green)} key="montecarlo">
        <div style={{padding:"10px 14px",color:"white",fontWeight:800,fontSize:13}}>
          🎲 Monte Carlo Yield Distribution (500 samples, σ={`${(SIGMA_TOT*100).toFixed(1)}%`})
        </div>
        <div style={{padding:"0 14px 14px"}}>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:4}}>
            {[
              {k:"p10",label:"P10",color:"#ef4444"},{k:"p25",label:"P25",color:C.orange},
              {k:"p50",label:"P50",color:C.green},{k:"p75",label:"P75",color:C.accent},
              {k:"p90",label:"P90",color:"#8b5cf6"},{k:"p99",label:"P99",color:C.muted}
            ].map(({k,label,color}) => (
              <div key={k} style={{background:C.bg,borderRadius:8,padding:"10px 14px",
                flex:"1 1 80px",minWidth:80,textAlign:"center"}}>
                <div style={{fontSize:10,color:color,fontWeight:700,marginBottom:4}}>{label}</div>
                <div style={{fontSize:16,fontWeight:800,color:C.text}}>
                  {(yieldDist[k]||0).toLocaleString()}
                </div>
                <div style={{fontSize:9,color:C.muted}}>kWh/yr</div>
              </div>
            ))}
          </div>
          <div style={{fontSize:10,color:C.muted,marginTop:8}}>
            σ_irr={`${(SIGMA_IRR*100).toFixed(0)}%`} (PVGIS inter-annual) +
            σ_model={`${(SIGMA_MODEL*100).toFixed(0)}%`} (validation residuals) →
            P90/P50 = {yieldDist.p50 ? (yieldDist.p90/yieldDist.p50*100).toFixed(1) : "—"}%.
            {" "}Use P90 as bankable yield for financing.
          </div>
        </div>
      </div>
    ) : null;

    // -- NASA POWER GHI cross-check card --------------------------------------
    const nasaEl = nasaWarning ? (
      <div style={cardS(nasaWarning.startsWith("✅") ? C.green : C.orange)} key="nasa">
        <div style={{padding:"10px 14px",color:"white",fontWeight:800,fontSize:13}}>
          🛰 NASA POWER GHI Cross-Check
        </div>
        <div style={{padding:"8px 14px 14px",fontSize:11,color:C.text}}>
          {nasaWarning}
          <div style={{marginTop:4,fontSize:10,color:C.muted}}>
            Source: NASA POWER 10-yr mean (2014–2023). PVGIS ERA5 TMY is the primary data source.
            NASA cross-check flags systematic irradiance discrepancies {">"}8%.
          </div>
        </div>
      </div>
    ) : null;

    // -- Tilt/Azimuth heatmap card ---------------------------------------------
    const sweepEl = sweepResult ? (() => {
      const {tilts, azimuths, grid, optTilt, optAz, optYield} = sweepResult;
      const allVals  = grid.flat();
      const minY = Math.min(...allVals), maxY = Math.max(...allVals);
      const cellW = 40, cellH = 24;
      const svgW  = azimuths.length * cellW + 60;
      const svgH  = tilts.length * cellH + 40;
      function heatColor(v) {
        const t = (v - minY) / Math.max(1, maxY - minY);
        const r2 = Math.round(t < 0.5 ? 30 + t*2*130 : 160 + (t-0.5)*2*95);
        const g2 = Math.round(t < 0.5 ? 80 + t*2*120 : 200 - (t-0.5)*2*50);
        const b2 = Math.round(t < 0.5 ? 180 - t*2*60  : 120 - (t-0.5)*2*100);
        return `rgb(${r2},${g2},${b2})`;
      }
      return (
        <div style={cardS(C.accent)} key="sweep">
          <div style={{padding:"10px 14px",color:"white",fontWeight:800,fontSize:13}}>
            📐 Tilt / Azimuth Sweep Heatmap — Specific Yield (kWh/kWp/yr)
          </div>
          <div style={{padding:"0 14px 14px",overflowX:"auto"}}>
            <svg width={svgW} height={svgH}>
              {/* column headers: azimuth */}
              {azimuths.map((az,ai) => (
                <text key={ai} x={60 + ai*cellW + cellW/2} y={14} textAnchor="middle"
                  fill={C.muted} fontSize="9">{az>0?"+"+az:az}°</text>
              ))}
              {tilts.map((tilt,ti) => (
                <g key={ti} transform={`translate(0,${20 + ti*cellH})`}>
                  <text x="55" y={cellH/2+5} textAnchor="end" fill={C.muted} fontSize="9">
                    {tilt}°
                  </text>
                  {azimuths.map((az,ai) => {
                    const v   = grid[ti][ai];
                    const isO = tilt===optTilt && az===optAz;
                    return (
                      <g key={ai}>
                        <rect x={60+ai*cellW} y={0} width={cellW-1} height={cellH-1} rx="2"
                          fill={heatColor(v)} stroke={isO?"#fff":"none"} strokeWidth={isO?2:0}/>
                        <text x={60+ai*cellW+cellW/2} y={cellH/2+4} textAnchor="middle"
                          fill="#fff" fontSize="8" fontWeight={isO?"800":"400"}>
                          {v}
                        </text>
                      </g>
                    );
                  })}
                </g>
              ))}
            </svg>
            <div style={{fontSize:11,color:C.green,fontWeight:700,marginTop:4}}>
              Optimal: {optTilt}° tilt, {optAz}° azimuth → {optYield} kWh/kWp/yr
              {inp.tiltDeg===optTilt && (inp.azimuth||0)===optAz ? " ✓ current settings optimal" : ""}
            </div>
            <div style={{fontSize:10,color:C.muted,marginTop:2}}>
              Rows = tilt (0°–45°); Columns = azimuth from South (−=East, +=West).
              Klein (1977) isotropic sky model. Recalculates automatically when PVGIS data loads.
            </div>
          </div>
        </div>
      );
    })() : null;

    return [renderSoilingEditor(), mcEl, nasaEl, sweepEl, waterfallEl, tiltEl, obstacleEl, horizonEl];
  } 

  const renderP3=()=>{ 
    if(!r||!panel||!inverter)return null; 
    return( 
      <div> 
        <WarnBanner scope="array"/>
        <WarnBanner scope="sizing"/>
        <div style={cardS(C.yellow)}> 
          <div style={{padding:"10px 14px",color:"white",fontWeight:800}}> 
            🔆 Phase 3 — Array Design ({panel.brand} {panel.model}) 
          </div> 
          <table style={tbl}><thead><tr style={{borderBottom:`2px solid ${C.border}`}}> 
            <th style={{padding:"8px 14px",textAlign:"left",color:C.muted,fontSize:11,width:"45%"}}>Parameter</th> 
            <th style={{padding:"8px 12px",textAlign:"right",color:C.muted,fontSize:11}}>Formula</th> 
            <th style={{padding:"8px 12px",textAlign:"right",color:C.yellow,fontSize:11}}>Value</th> 
          </tr></thead><tbody> 
            <SH label="Temp-Corrected Voltages" color={C.orange}/> 
            <Row label="Voc corrected — winter" shade={false}><td style={{padding:"6px 12px",textAlign:"right",color:C.muted,fontSize:10}}>Voc×[1+β×(Tmin−25)]</td><Calc v={r.vocWin} unit="V"/></Row> 
            <Row label="Vmp corrected — summer" shade={true}><td style={{padding:"6px 12px",textAlign:"right",color:C.muted,fontSize:10}}>Vmp×[1+β×(Tmax−25)]</td><Calc v={r.vmpSum} unit="V"/></Row> 
            <Row label="Pmax corrected — summer" shade={false}><td style={{padding:"6px 12px",textAlign:"right",color:C.muted,fontSize:10}}>Pmax×[1+γ×(Tmax−25)]</td><Calc v={r.pmaxSum} unit="Wp"/></Row> 
            <SH label="String Configuration" color={C.yellow}/> 
            <Row label="N_max / N_min" shade={true}><td/><Calc v={`${r.nMax} / ${r.nMin}`}/></Row> 
            <Row label="▶ Selected modules / string" shade={false}><td/><Calc v={r.nSel} dp={0} big/></Row> 
            <Row label="▶ Number of strings" shade={true}><td/><Calc v={r.nStr} dp={0} big/></Row> 
            <Row label="▶ Total panels" shade={false}><td/><Calc v={r.totP} dp={0} big/></Row> 
            <Row label="▶ Actual array (kWp)" shade={true}><td/><Calc v={r.actKwp} unit="kWp" dp={2} big/></Row> 
            <Row label="DC/AC ratio" shade={false}><td/><Calc v={r.dcAc} dp={2}/></Row> 
            <Row label={`Annual yield — ${inp.yieldMode==="p90"?"P90 (×0.92)":"TMY P50"}`} shade={true} note="12 months × temp-corrected η">
              <td style={{padding:"6px 12px",textAlign:"right",color:C.green,fontSize:10}}>{inp.yieldMode==="p90"?"P90":"P50"}</td>
              <Calc v={yGen} unit="kWh/yr" dp={0} big/>
            </Row> 
            <Row label="Annual yield — flat PSH" shade={false} note="Legacy single-PSH estimate"> 
              <td/><Calc v={r.annGenFlat} unit="kWh/yr" dp={0}/> 
            </Row> 
            <Row label="Roof feasibility" shade={true}><td/><Calc v={r.roofFit?"PASS — fits roof":"REVIEW — check roof"}/></Row> 
            {r.roofCapped && ( 
              <Row label="⚠ Array roof-capped" shade={false} note={`Needed ${r.cappedKwp.toFixed(1)} kWp, limited to ${r.actKwp.toFixed(1)} kWp by roof`}> 
                <td/> 
                <Calc v={`${r.coverageActual.toFixed(0)}% actual vs ${r.effPct.toFixed(0)}% target`}/> 
              </Row> 
            )} 
          </tbody></table> 
        </div> 

        {/* IMPROVEMENT 2: Row spacing section */} 
        <div style={cardS(r.rowShadeOk?C.green:C.orange)}> 
          <div style={{padding:"10px 14px",color:"white",fontWeight:800,display:"flex",justifyContent:"space-between",alignItems:"center"}}> 
            <span>📐 Inter-Row Shading Analysis — Dec 21, 9am (Solar alt. {r.solarAltDeg != null ? r.solarAltDeg.toFixed(1) : "18.0"}°, lat {(inp.lat||30).toFixed(1)}°)</span>
            <span style={{fontSize:10,padding:"3px 10px",borderRadius:12,fontWeight:700, background:`${inp.mountMode==="ground"?C.yellow:inp.mountMode==="hybrid"?C.green:C.accent}22`, color:inp.mountMode==="ground"?C.yellow:inp.mountMode==="hybrid"?C.green:C.accent}}> 


              {inp.mountMode==="ground"?"🌱 Ground Mount":inp.mountMode==="hybrid"?"🏠+🌱 Hybrid":"🏠 Rooftop"} 
            </span> 
          </div> 
          <table style={tbl}><TblHead label="Result" calcCol={r.rowShadeOk?C.green:C.orange}/><tbody> 
            <SH label="Panel Geometry" color={C.yellow}/> 
            <Row label="Tilt angle" shade={false}><td/><Calc v={inp.tiltDeg} unit="°" dp={0}/></Row> 
            <Row label="Panel vertical projection" shade={true} note="L × sin(tilt)"> 
              <td style={{padding:"6px 12px",textAlign:"right",color:C.muted,fontSize:10}}>L·sin(tilt)</td> 
              <Calc v={r.panelVertM} unit="m" dp={2}/> 
            </Row> 

 
              
              
            <Row label="Panel base (horizontal)" shade={false} note="L × cos(tilt)"> 
              <td style={{padding:"6px 12px",textAlign:"right",color:C.muted,fontSize:10}}>L·cos(tilt)</td> 
              <Calc v={r.panelBaseM} unit="m" dp={2}/> 
            </Row> 
            <SH label="Minimum Row Pitch" color={C.orange}/> 
            <Row label="Solar altitude (design)" shade={false} note="Dec 21, 9am — conservative"> 
              <td/><Calc v="18°"/> 
            </Row> 
            <Row label="▶ Min pitch (no shading)" shade={true} note="base + vert/tan(18°)"> 
              <td style={{padding:"6px 12px",textAlign:"right",color:C.muted,fontSize:10}}>base+vert/tan(18°)</td> 
              <Calc v={r.minPitch} unit="m" dp={2} big/> 
            </Row> 
            <SH label="Roof Capacity Check" color={r.rowShadeOk?C.green:C.orange}/> 
            <Row label="Roof depth (N–S)" shade={false} note="Set in Other Inputs"> 
              <td/><Calc v={inp.roofDepthM||12} unit="m" dp={0}/> 
            </Row> 
            <Row label="▶ Max rows without shading" shade={true}><td/><Calc v={r.maxRows} dp={0} big/></Row> 
            <Row label="▶ Panels per row" shade={false}><td/><Calc v={r.panelsPerRow} dp={0}/></Row> 
            <Row label="▶ Max panels (shade-free)" shade={true}><td/><Calc v={r.maxPanelsNoShade} dp={0} big/></Row> 
            <Row label="▶ Designed panel count" shade={false}><td/><Calc v={r.totP} dp={0}/></Row> 
            <Row label="Row spacing status" shade={true}><td/><Calc v={r.rowShadeOk?"PASS":"REVIEW — reduce or respac"} big/></Row> 
            <Row label="Est. inter-row shading loss" shade={false}><td/><Calc v={r.rowShadeOk?0:r.interRowLossPct} unit="%" dp={1}/></Row> 
          </tbody></table> 
          {!r.rowShadeOk&&( 
            <div style={{padding:"10px 16px",background:`${C.orange}15`,borderLeft:`4px solid ${C.orange}`, 
              fontSize:11,color:C.orange,margin:"0 0 8px"}}> 
              ⚠ Array ({r.totP} panels) exceeds shade-free limit ({r.maxPanelsNoShade} panels) 
for 
              {inp.roofDepthM||12}m roof depth at {inp.tiltDeg}° tilt. Either reduce panel count to 
{r.maxPanelsNoShade}, 
              increase row pitch, or increase roof depth in Other Inputs. 
            </div> 
          )} 
        </div> 
      </div> 
    ); 
  }; 

 
  const renderP4=()=>{ 
    if(!r||!battery)return null; 
    return( 
      <div style={cardS(C.blue)}> 
        <div style={{padding:"10px 14px",color:"white",fontWeight:800}}> 
          🔋 Phase 4 — Battery ({battery.brand} {battery.model}) 
        </div> 
        <table style={tbl}><TblHead label="Value" calcCol={C.blue}/><tbody> 
          <SH label="Profile-Based Sizing (Improvement 3)" color={C.accent}/> 
          <Row label="Evening demand (17–23h)" shade={false} note="From Load Profile tab — actual battery target"> 
            <td/><Calc v={r.eveningDeficit} unit="kWh" big/> 
          </Row> 
          <Row label="Coverage target" shade={true}> 
            <td/><Calc v={r.eveningDeficit*(inp.batEveningCovPct/100)} unit="kWh" big/> 
          </Row> 
          <Row label="Design energy (max of target/backup)" shade={false}> 
            <td/><Calc v={r.designE} unit="kWh" big/> 
          </Row> 
          <Row label="▶ Usable battery capacity" shade={true}> 
            <td/><Calc v={r.usableBat} unit="kWh" big/> 
          </Row> 
          <Row label="▶ Evening demand covered?" shade={false}> 
            <td/><Calc v={r.usableBat>=r.eveningDeficit*(inp.batEveningCovPct/100)?"PASS":"UNDERSIZED"} big/> 
          </Row> 
          <Row label="▶ Autonomy @ 50% solar load" shade={true}> 
            <td/><Calc v={r.autonomy} unit="hrs" dp={1} big/> 
          </Row> 
          <SH label="Solar Self-Consumption" color={C.green}/> 
          <Row label={r.tmySource==="pvgis"?"Simulated SC rate (hourly dispatch)":"Profile SC rate (approx)"} shade={false} 
            note={r.tmySource==="pvgis"?"8,760-hour dispatch simulation":"Fetch PVGIS for hourly simulation"}> 
            <td style={{padding:"6px 12px",textAlign:"right",fontSize:10,color:r.tmySource==="pvgis"?C.green:C.yellow}}> 
              {r.tmySource==="pvgis"?"✓ PVGIS":"↻ fallback"} 
            </td> 
            <Calc v={`${r.annSCPct!=null?r.annSCPct.toFixed(1):r.profileSCPct.toFixed(1)}%`} big/> 
          </Row> 
          {r.dispatch&&<> 
            <Row label="Annual battery cycles" shade={true} note="Simulated throughput ÷ usable capacity"> 
              <td/><Calc v={r.batCyclesYear.toFixed(0)} unit="cycles/yr"/> 
            </Row> 

            <Row label="Dec evening unmet demand" shade={false} note="Grid imports 17–22h in December"> 
              <td/><Calc v={r.dispatch.eveningDeficits[11].toFixed(1)} unit="kWh/day" 
                big/> 
            </Row> 
            <Row label="Battery adequacy" shade={true}> 
              <td/><Calc v={Math.max(...r.dispatch.eveningDeficits)<2?"PASS":"REVIEW"} big/> 
            </Row> 
          </>} 
          <SH label="Regulatory Compliance" color={C.red}/> 
          <Row label="Battery ↔ inverter voltage" shade={false}> 
            <td/><Calc v={r.chkBatVolt} big/> 
          </Row> 
          <Row label="Battery rule (Circ.3/2023)" shade={true}> 
            <td/><Calc v={r.chkBatRule} big/> 
          </Row> 
        </tbody></table> 
      </div> 
    ); 
  }; 

  const renderP5=()=>{ 
    if(!r)return null; 
    return( 
      <div style={cardS(C.purple)}> 
        <div style={{padding:"10px 14px",color:"white",fontWeight:800}}> 
          🔌 Phase 5 — Inverter Checks ({inverter?.brand} {inverter?.model}) 
        </div> 
        <table style={tbl}><thead><tr style={{borderBottom:`2px solid ${C.border}`}}> 
          <th style={{padding:"8px 14px",textAlign:"left",color:C.muted,fontSize:11,width:"40%"}}>Check</th> 
          <th style={{padding:"8px 12px",textAlign:"right",color:C.muted,fontSize:11}}>Requirement</th> 
          <th style={{padding:"8px 12px",textAlign:"right",color:C.purple,fontSize:11}}>Result</th> 
        </tr></thead><tbody> 
          {[ 
            {l:"Inverter ≥ peak demand",req:`≥${r.peakDemandKW.toFixed(1)}kW`,      v:r.chkInvSize}, 
            {l:"DC/AC ratio",          req:r.dcAc.toFixed(2),                      v:r.chkDcAc   }, 
            {l:"Vmp ≥ MPPT min",       req:`${r.vmpSum.toFixed(1)}V≥${inverter?.mpptMin}V`, v:r.chkMpptMin}, 
            {l:"Voc ≤ Vdc max",        req:`${r.strVoc.toFixed(1)}V≤${inverter?.vdcMax}V`,  v:r.chkMpptMax}, 
            {l:"Isc per MPPT",         req:`${(panel?.isc*r.strPerMppt).toFixed(1)}A≤${inverter?.iscPerMppt}A`,v:r.chkIscMppt}, 
            {l:"Battery voltage range",req:`${battery?.voltage}V in ${inverter?.batVoltMin||"—"}–${inverter?.batVoltMax||"—"}V`,v:r.chkBatVolt}, 

 
            {l:"Battery charge power", req:`${inverter?.batChargeKW}kW`,           v:r.chkBatChg }, 
          ].map(({l,req,v},i)=>( 
            <Row key={l} label={l} shade={i%2===0}> 
              <td style={{padding:"6px 12px",textAlign:"right",color:C.muted,fontSize:11}}>{req}</td> 
              <Calc v={v} big/> 
            </Row> 
          ))} 
        </tbody></table> 
      </div> 
    ); 
  }; 

  const renderP6=()=>{ 
    if(!r)return null; 
    return( 
      <div style={cardS(C.red)}> 
        <div style={{padding:"10px 14px",color:"white",fontWeight:800}}>🔗 Phase 6 — Wiring</div> 
        <table style={tbl}><TblHead label="Value / Check" calcCol={C.red}/><tbody> 
          <SH label="Zone 1 — DC String" color={C.yellow}/> 
          <Row label="Design current (Isc×1.56)" shade={false}><td/><Calc v={r.iStr} unit="A"/></Row> 
          <Row label="Derated at 42°C" shade={true}><td/><Calc v={r.iStrD} unit="A" big/></Row> 
          <Row label="VD % (≤1.5%)" shade={false}><td/><Calc v={`${r.vdStr.toFixed(2)}% → ${r.chkVdStr}`}/></Row> 
          <Row label="String fuse rating" shade={true}><td/><Calc v={r.strFuse} unit="A dc"/></Row> 
          <SH label="Zone 2 — DC Feeder" color={C.orange}/> 
          <Row label="Feeder current" shade={false}><td/><Calc v={r.iFdr} unit="A"/></Row> 
          <Row label="Derated" shade={true}><td/><Calc v={r.iFdrD} unit="A" big/></Row> 
          <Row label="VD % (≤1.5%)" shade={false}><td/><Calc v={`${r.vdFdr.toFixed(2)}% → ${r.chkVdFdr}`}/></Row> 
          <SH label="Zone 3 & 4 — Battery & AC" color={C.blue}/> 
          <Row label="Battery current" shade={false}><td/><Calc v={r.iBat} unit="A" big/></Row> 
          <Row label="AC output current" shade={true}><td/><Calc v={r.iAC} unit="A" big/></Row> 
          <Row label="AC VD % (≤2.0%)" shade={false}><td/><Calc v={`${r.vdAC.toFixed(2)}% → ${r.chkVdAC}`}/></Row> 
          <Row label="AC MCB" shade={true}><td/><Calc v={r.acBreaker} unit="A Type C"/></Row> 
          <Row label="MDB busbar" shade={false}><td/><Calc v={r.mdbCheck} big/></Row> 
        </tbody></table> 
      </div> 
    ); 
  }; 

 
  // -- SPD Sizing Card (appended to SLD tab) ---------------------------------
  const renderSPDCard = () => {
    if (!spdResult) return null;
    const {type, Nd, Nc, spdRating, note} = spdResult;
    const isHigh = Nd > Nc;
    return (
      <div style={cardS(isHigh ? C.red : C.green)}>
        <div style={{padding:"10px 14px",color:"white",fontWeight:800,fontSize:13}}>
          ⚡ IEC 62305 / IEC 60364-7-712 Lightning & SPD Sizing
        </div>
        <div style={{padding:"8px 14px 14px"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <tbody>
              {[
                ["SPD Type Required", type],
                ["SPD Impulse Rating", spdRating],
                ["Annual strike freq. Nd", Nd + " strikes/yr"],
                ["Acceptable freq. Nc", Nc + " strikes/yr (1/" + (inp.analysisPeriod||25) + " yr)"],
                ["Risk classification", Nd > Nc ? "High — Type 1 required" : "Low — Type 2 sufficient"],
              ].map(([l,v],i) => (
                <tr key={i} style={{borderBottom:`1px solid ${C.border}`}}>
                  <td style={{padding:"5px 8px",color:C.muted}}>{l}</td>
                  <td style={{padding:"5px 8px",fontWeight:700,
                    color:l.includes("Type")?(isHigh?C.red:C.green):C.text}}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{marginTop:8,fontSize:10,color:C.muted}}>
            {note}. Egypt Ng=2.0 fl/km²/yr (IEC 62305-2 Annex A).
            Coordinate with MEP engineer for Type 1 Class I surge arrester installation.
          </div>
        </div>
      </div>
    );
  };

  // -- Optimizer NPV Card ------------------------------------------------------
  const renderOptimiserNPVCard = () => {
    if (!optimNpv) return null;
    const {costEGP, extraYieldPct, deltaNPV, netBenefit, paybackYr, worthIt} = optimNpv;
    return (
      <div style={cardS(worthIt ? C.green : C.orange)}>
        <div style={{padding:"10px 14px",color:"white",fontWeight:800,fontSize:13}}>
          🔧 DC Optimizer / Micro-Inverter NPV (NREL Deline 2013, η=0.75)
        </div>
        <div style={{padding:"8px 14px 14px"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <tbody>
              {[
                ["Shading loss assumption", (inp.shadingLossFraction||0.05)*100 + "%"],
                ["MLPE recovery efficiency", "75% (NREL Deline 2013)"],
                ["Extra yield recovered", extraYieldPct + "%"],
                ["Optimizer cost", "EGP " + costEGP.toLocaleString()],
                ["Discounted extra savings NPV", "EGP " + deltaNPV.toLocaleString()],
                ["Net benefit (NPV − cost)", "EGP " + netBenefit.toLocaleString()],
                ["Payback on optimizer", paybackYr ? paybackYr + " yrs" : ">25 yrs"],
                ["Recommendation", worthIt ? "Worth it — positive NPV" : "Marginal — only if shade is significant"],
              ].map(([l,v],i) => (
                <tr key={i} style={{borderBottom:`1px solid ${C.border}`}}>
                  <td style={{padding:"5px 8px",color:C.muted}}>{l}</td>
                  <td style={{padding:"5px 8px",fontWeight:700,
                    color:l==="Recommendation"?(worthIt?C.green:C.orange):C.text}}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{marginTop:6,fontSize:10,color:C.muted}}>
            Adjust shading loss fraction in Other Inputs. Optimizer cost:{" "}
            ${inp.costPerOptimizerUSD||30}/panel at EGP {inp.usdRate||55}/USD.
          </div>
        </div>
      </div>
    );
  };

  const renderOptimiser=()=>{
    if(!optData.length)return<div style={{color:C.muted,padding:20}}>Select components first.</div>;
    const maxGain=Math.max(...optData.map(d=>d.netGain));
    const sweet=optData.reduce((a,b)=>b.netGain/b.cost>a.netGain/a.cost?b:a);
    const mlpeCard = renderOptimiserNPVCard();
    return(
      <div>
        {/* DC Optimizer / MLPE NPV card */}
        {mlpeCard && <div style={{marginBottom:14}}>{mlpeCard}</div>} 
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10,marginBottom:14}}> 
          {[{l:"★ Optimal offset",v:`${sweet.pct}%`,c:C.purple}, 
            {l:"Cost per villa",v:fmtE(sweet.costPerVilla),c:C.red}, 
            {l:`Total (${inp.nVillas||1} villas)`,v:fmtE(sweet.cost3Villa),c:C.red}, 
            {l:"Payback",v:`${sweet.payback} yrs`,c:C.accent}, 
            {l:"25yr gain/villa",v:fmtE(sweet.netGain),c:C.green}, 
            {l:"3-villa total gain",v:fmtE(sweet.netGain3),c:C.green}].map(k=>( 
            <div key={k.l} style={{background:C.card,borderRadius:10,padding:"12px 14px",borderLeft:`4px solid ${k.c}`}}> 
              <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:3}
}>{k.l}</div> 
              <div style={{fontSize:18,fontWeight:800,color:k.c}}>{k.v}</div> 
            </div> 
          ))} 
        </div> 
        <div style={cardS(C.purple)}> 
          <div style={{padding:"10px 16px",color:"white",fontWeight:800}}> 
            Coverage Level Comparison (TMY-backed financials) 
          </div> 
          <div style={{overflowX:"auto"}}> 
            <table style={{...tbl,fontSize:11}}> 
              <thead><tr style={{borderBottom:`2px solid ${C.border}`}}> 
                {["Offset","kWp","Panels","Cost/Villa",`Total (${inp.nVillas||1}x)`,"Payback","IRR","25yr Gain/Villa",`Total Gain`].map(h=>( 
                  <th key={h} style={{padding:"7px 10px",textAlign:"right",color:C.muted,fontWeight:600,minWidth:90}}>{h}</th> 
                ))} 
              </tr></thead> 
              <tbody> 
                {optData.map((d,i)=>{ 
                  const isSw=d.pct===sweet.pct; 
                  const isCur=Math.abs(d.pct-(r?.effPct||0))<3; 
                  return( 
                    <tr key={d.pct} style={{ background:isSw?`${C.purple}22`:isCur?`${C.orange}18`:i%2===0?"transparent":"#070f1f", 


 
                      
                      borderLeft:isSw?`3px solid ${C.purple}`:isCur?`3px solid ${C.orange}`:"3px solid transparent"}}> 
                      <td style={{padding:"7px 10px",textAlign:"center",fontWeight:700, 
                        color:isSw?C.purple:isCur?C.orange:C.text}}>{d.pct}%{isSw?" ★":isCur?" ●":""}</td> 
                      <td style={{padding:"7px 10px",textAlign:"right"}}> 
                        <Bar val={parseFloat(d.kWp)} max={Math.max(...optData.map(x=>parseFloat(x.kWp)))} color={C.yellow} width={50}/> 
                      </td> 
                      <td style={{padding:"7px 10px",textAlign:"right",color:C.muted}}>{d.panels}</td> 
                      <td style={{padding:"7px 10px",textAlign:"right"}}> 
                        <Bar val={d.costPerVilla/1000} max={Math.max(...optData.map(x=>x.costPerVilla/1000))} color={C.red} width={50}/> 
                      </td> 
                      <td style={{padding:"7px 10px",textAlign:"right",color:C.red,fontWeight:600}}>E£{(d.cost3Villa/1000).toFixed(0)}K</td> 
                      <td style={{padding:"7px 10px",textAlign:"right",fontWeight:700, 
                        color:d.payback<=8?C.green:d.payback<=12?C.yellow:C.red}}> 
                        {d.payback===26?">25":d.payback} yrs 
                      </td> 
                      <td style={{padding:"7px 10px",textAlign:"right",color:C.purple,fontWeight:700}}>{d.irr.toFixed(1)}%</td> 
                      <td style={{padding:"7px 10px",textAlign:"right"}}> 
                        <Bar val={d.netGain/1000} max={maxGain/1000} color={C.green} width={45}/> 
                      </td> 
                      <td style={{padding:"7px 10px",textAlign:"right",color:C.green,fontWeight:600}}>E£{(d.netGain3/1000).toFixed(0)}K</td> 
                    </tr> 
                  ); 
                })} 
              </tbody> 
            </table> 
          </div> 
        </div> 
      </div> 
    ); 
  }; 

  const renderFinancial=()=>{ 
    if(!r)return null; 
    const yieldDisplay = inp.yieldMode==="p90" ? r.annGenP90 : r.annGenTMY; 
    return( 
      <div> 
        {/* Tariff mode + yield mode toggles */} 

 
        <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}> 
          <span style={{fontSize:11,color:C.muted}}>Tariff:</span> 
          {[{v:"tiered",l:"Tiered EgyptERA"},{v:"flat",l:"Flat rate"}].map(m=>( 
            <button key={m.v} onClick={()=>upd("tariffMode",m.v)} 
              style={{padding:"5px 14px",borderRadius:20,border:"none",cursor:"pointer", 
              fontSize:11,fontWeight:700, 
              background:inp.tariffMode===m.v?"#14b8a6":C.card, 
              color:inp.tariffMode===m.v?C.bg:C.muted}}> 
              {m.l} 
            </button> 
          ))} 
        </div>
        {inp.tariffMode==="tiered" && ( 
          <div style={{padding:"8px 14px",background:"#14b8a618",borderRadius:8,marginBottom:10, 
            fontSize:11,color:"#14b8a6",borderLeft:"3px solid #14b8a6"}}> 
            Tiered savings: displaced kWh valued at highest EgyptERA blocks first. 
            Rates: 0–50: E£0.68 · 51–100: E£0.78 · 101–200: E£0.95 · 201–350: E£1.55 · 351–650: E£1.95 · 651–1000: E£2.10 · 1000+: E£2.58/kWh 
          </div> 
        )} 
        {inp.tariffEsc===0 && inp.omEsc>0 && ( 
          <div style={{padding:"8px 14px",background:`${C.red}18`,borderRadius:8,marginBottom:10, 
            fontSize:11,color:C.red,borderLeft:`3px solid ${C.red}`}}> 
            ⚠ <strong>Tariff escalation is 0%</strong> but O&M escalates at {inp.omEsc}%/yr. 
            O&M will eventually exceed savings — payback may exceed 25 years even on a viable system. 
            Set a realistic tariff escalation (Egypt historical: 15–20%/yr) or reduce O&M escalation to ~3%/yr (CPI-linked). 
          </div> 
        )} 
        {inp.tariffEsc===0 && ( 
          <div style={{padding:"8px 14px",background:`${C.orange}18`,borderRadius:8,marginBottom:10, 
            fontSize:11,color:C.orange,borderLeft:`3px solid ${C.orange}`}}> 
            ℹ Zero tariff escalation is a conservative stress-test scenario. 

            Egypt tariff has risen ~15–20%/yr since 2022. Use 0% to find the minimum viable tariff growth. 
          </div> 
        )} 
        {inp.yieldMode==="p90" && (
          <div style={{padding:"8px 14px",background:C.orange+"18",borderRadius:8,marginBottom:10,
            fontSize:11,color:C.orange,borderLeft:"3px solid "+C.orange}}>
            P90 mode: financials derated to 92% of P50 — conservative/bankable projection.
            Annual yield basis: {(yieldDisplay/1000).toFixed(2)} MWh/villa.
          </div>
        )}
        {/* Net Metering / FiT toggle */}
        <div style={{padding:"10px 14px",background:`${C.green}12`,borderRadius:8,
          marginBottom:10,border:`1px solid ${C.green}44`}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:inp.netMeteringEnabled?6:0}}>
            <span style={{fontSize:11,fontWeight:700,color:C.green}}>⚡ Net Metering / Feed-in Tariff</span>
            <button onClick={()=>upd("netMeteringEnabled",!inp.netMeteringEnabled)}
              style={{padding:"3px 12px",borderRadius:12,border:"none",cursor:"pointer",
                fontSize:10,fontWeight:700,
                background:inp.netMeteringEnabled?C.green:C.card,
                color:inp.netMeteringEnabled?C.bg:C.muted}}>
              {inp.netMeteringEnabled?"ON":"OFF"}
            </button>
          </div>
          {inp.netMeteringEnabled && (
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:10,color:C.muted}}>Export rate (EGP/kWh):</span>
              <input type="number" min="0" max="5" step="0.05"
                value={inp.netMeteringRate||0.50}
                onChange={e=>upd("netMeteringRate",parseFloat(e.target.value)||0.50)}
                style={{width:70,background:C.card,border:`1px solid ${C.green}`,
                  borderRadius:6,color:C.green,fontSize:12,padding:"4px 6px",textAlign:"right"}}/>
              <span style={{fontSize:9,color:C.muted}}>Egypt net metering: 0.40–0.55 EGP/kWh typical</span>
            </div>
          )}
        </div>
        <div style={{padding:"8px 14px",background:`${C.green}18`,borderRadius:8,marginBottom:12, 
          borderLeft:`3px solid ${C.green}`,fontSize:11,color:C.green}}> 
          {r.tmySource==="pvgis" 
          ?<span>PVGIS hourly — {(r.annGenTMY/1000).toFixed(2)} MWh/yr · PR {r.perfRatio} · SC {(r.annSCPct||0).toFixed(1)}% · Clipping {(r.clippingPct||0).toFixed(1)}%</span> 
          :<span>Monthly TMY fallback — {(r.annGenTMY/1000).toFixed(2)} MWh/yr · PR 
{r.perfRatio} · Fetch PVGIS for hourly dispatch</span>} 
        </div> 
        {/* -- Year-by-year yield & cash flow chart -- */}
        {r.cfYears && r.cfYears.length > 0 && (() => {
          const W=680, H=220, PAD={t:24,r:16,b:36,l:64};
          const cw=W-PAD.l-PAD.r, ch=H-PAD.t-PAD.b;
          const years=r.cfYears.map(y=>y.yr);
          const gens=r.cfYears.map((y,i)=>{
            const deg=Math.pow(1-inp.panelDeg/100,i);
            return r.annGenTMY*deg*(inp.yieldMode==="p90"?0.92:1)/1000;
          });
          const cums=r.cfYears.map(y=>y.cum/1000);
          const sysK=r.sysC/1000;
          const maxGen=Math.max(...gens)*1.15;
          const minCum=Math.min(Math.min(...cums)-20,-sysK*1.1);
          const maxCum=Math.max(...cums)*1.05;
          const xS=i=>(PAD.l + i/(years.length-1)*cw);
          const yGen=v=>(PAD.t + ch*(1-v/maxGen));
          const yFinRange=maxCum-minCum;
          const yCum=v=>(PAD.t + ch*(1-(v-minCum)/yFinRange));
          const yZero=yCum(0);
          const pbX=r.pb ? xS(r.pb-1) : null;
          // Build SVG polyline points
          const genPts=gens.map((v,i)=>`${xS(i).toFixed(1)},${yGen(v).toFixed(1)}`).join(' ');
          const cumPts=cums.map((v,i)=>`${xS(i).toFixed(1)},${yCum(v).toFixed(1)}`).join(' ');
          const genAreaPts=`${xS(0)},${PAD.t+ch} `+genPts+` ${xS(years.length-1)},${PAD.t+ch}`;
          return(
            <div style={{background:C.card,borderRadius:12,padding:"14px 16px",marginBottom:14,
              border:`1px solid ${C.border}`}}>
              <div style={{fontSize:12,fontWeight:800,color:C.text,marginBottom:8}}>
                📈 25-Year Yield & Cash Flow
              </div>
              <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{overflow:"visible"}}>
                {/* Grid lines */}
                {[0,0.25,0.5,0.75,1].map(f=>{
                  const y=PAD.t+f*ch;
                  return <line key={f} x1={PAD.l} x2={PAD.l+cw} y1={y} y2={y}
                    stroke={C.border} strokeWidth="0.5" strokeDasharray="3,3"/>;
                })}
                {/* Zero line for cumulative */}
                {yZero>=PAD.t && yZero<=PAD.t+ch &&
                  <line x1={PAD.l} x2={PAD.l+cw} y1={yZero} y2={yZero}
                    stroke={C.muted} strokeWidth="1" strokeDasharray="4,2"/>}
                {/* Payback vertical line */}
                {pbX && <line x1={pbX} x2={pbX} y1={PAD.t} y2={PAD.t+ch}
                  stroke={C.green} strokeWidth="1.5" strokeDasharray="5,3" opacity="0.7"/>}
                {pbX && <text x={pbX+3} y={PAD.t+10} fill={C.green} fontSize="9" fontWeight="700">
                  Payback yr {r.pb}
                </text>}
                {/* Yield area fill */}
                <polygon points={genAreaPts} fill={C.yellow} opacity="0.12"/>
                {/* Yield line */}
                <polyline points={genPts} fill="none" stroke={C.yellow} strokeWidth="2"
                  strokeLinejoin="round"/>
                {/* Cash flow line */}
                <polyline points={cumPts} fill="none" stroke={C.green} strokeWidth="2.5"
                  strokeLinejoin="round"/>
                {/* Axes */}
                <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t+ch} stroke={C.border} strokeWidth="1"/>
                <line x1={PAD.l} x2={PAD.l+cw} y1={PAD.t+ch} y2={PAD.t+ch} stroke={C.border} strokeWidth="1"/>
                {/* Y labels left: yield */}
                {[0,0.5,1].map(f=>(
                  <text key={f} x={PAD.l-4} y={PAD.t+ch*(1-f)+4} textAnchor="end"
                    fill={C.yellow} fontSize="8">{(maxGen*f).toFixed(1)}</text>
                ))}
                <text x={PAD.l-30} y={PAD.t+ch/2} fill={C.yellow} fontSize="8"
                  transform={`rotate(-90,${PAD.l-38},${PAD.t+ch/2})`} textAnchor="middle">
                  Yield MWh/yr
                </text>
                {/* Y labels right: cash flow */}
                {[0,0.5,1].map(f=>(
                  <text key={f} x={PAD.l+cw+4} y={PAD.t+ch*(1-f)+4} textAnchor="start"
                    fill={C.green} fontSize="8">
                    {((minCum+yFinRange*f)/1000).toFixed(0)}k
                  </text>
                ))}
                {/* X labels */}
                {[1,5,10,15,20,25].filter(y=>y<=years.length).map(y=>(
                  <text key={y} x={xS(y-1)} y={PAD.t+ch+14} textAnchor="middle"
                    fill={C.muted} fontSize="8">yr{y}</text>
                ))}
                {/* Legend */}
                <rect x={PAD.l+cw-120} y={PAD.t} width="120" height="32" rx="4"
                  fill={C.bg} opacity="0.85"/>
                <line x1={PAD.l+cw-115} x2={PAD.l+cw-100} y1={PAD.t+10} y2={PAD.t+10}
                  stroke={C.yellow} strokeWidth="2"/>
                <text x={PAD.l+cw-97} y={PAD.t+13} fill={C.yellow} fontSize="8">Annual yield</text>
                <line x1={PAD.l+cw-115} x2={PAD.l+cw-100} y1={PAD.t+24} y2={PAD.t+24}
                  stroke={C.green} strokeWidth="2.5"/>
                <text x={PAD.l+cw-97} y={PAD.t+27} fill={C.green} fontSize="8">Cumulative savings</text>
              </svg>
              <div style={{fontSize:10,color:C.muted,marginTop:4,display:"flex",gap:16}}>
                <span style={{color:C.yellow}}>■ Yield (left axis, MWh/yr) — declines at {inp.panelDeg}%/yr degradation</span>
                <span style={{color:C.green}}>■ Cumulative net savings (right axis)</span>
                {r.pb && <span style={{color:C.green}}>· Payback crossover: year {r.pb}</span>}
              </div>
            </div>
          );
        })()}

                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:14}}> 
          {[{l:"Cost/villa",    v:fmtE(r.sysC),       s:fmtU(r.sysC),       c:C.red   }, 
            {l:"3-villa total", v:fmtE(r.totalSysC3), s:fmtU(r.totalSysC3), c:C.red   }, 
            {l:"Payback",       v:r.pb?`${r.pb} yrs`:">25", s:"Cash payback",c:C.accent}, 
            {l:"IRR",           v:`${r.irr}%`,         s:"25-year",          c:C.green }, 
            {l:"NPV",           v:fmtE(r.npvAtRate),   s:`@ ${inp.discountRate||12}% discount`,c:r.npvAtRate>=0?C.green:C.red}, 
            {l:"LCOE",          v:`E£${r.lcoe}/kWh`,   s:"Levelised cost",   c:C.yellow}, 
            {l:"25yr net gain", v:fmtE(r.netGain),     s:fmtU(r.netGain),   c:C.green }, 
            {l:"ROI",           v:`${r.roi}%`,          s:"25-year",          c:C.purple}].map(k=>( 
            <div key={k.l} style={{background:C.card,borderRadius:10,padding:"12px 14px",borderLeft:`4px solid ${k.c}`}}> 
              <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:3}
}>{k.l}</div> 
              <div style={{fontSize:18,fontWeight:800,color:k.c}}>{k.v}</div> 
              <div style={{fontSize:10,color:C.muted,marginTop:2}}>{k.s}</div> 
            </div> 
          ))} 
        </div> 
        <div style={cardS(C.green)}> 
          <div style={{padding:"10px 14px",color:"white",fontWeight:800}}>25-Year Cashflow 
(EGP per villa)</div> 
          <div style={{overflowX:"auto"}}> 
            <table style={{...tbl,fontSize:11}}> 

              <thead><tr style={{borderBottom:`2px solid ${C.border}`}}> 
                {["Year","Tariff","Savings","O&M","Bat","Net","Cumulative","Net Pos"].map(h=>( 
                  <th key={h} style={{padding:"6px 10px",textAlign:"right",color:C.muted,fontWeight:600,minWidth:75}}>{h}</th> 
                ))} 
              </tr></thead> 
              <tbody> 
                {r.cfYears.map((y,i)=>{ 
                  const isB=y.yr===r.pb; 
                  return( 
                    <tr key={y.yr} style={{ 
                      background:isB?`${C.green}18`:i%2===0?"transparent":"#070f1f", 
                      borderLeft:isB?`3px solid ${C.green}`:"3px solid transparent"}}> 
                      <td style={{padding:"5px 10px",textAlign:"right",color:isB?C.green:C.muted,fontWeight:isB?800:400}}> 
                        {y.yr}{isB?" ✓":""} 
                      </td> 
                      <td style={{padding:"5px 10px",textAlign:"right",color:C.yellow}}> 
                        {(inp.tariffNow*Math.pow(1+inp.tariffEsc/100,y.yr-1)).toFixed(2)} 
                      </td> 
                      <td style={{padding:"5px 10px",textAlign:"right",color:C.green}}>{(y.sav/1000).toFixed(0)}K</td> 
                      <td style={{padding:"5px 10px",textAlign:"right",color:C.muted}}>{(y.om/1000).toFixed(0)}K</td> 
                      <td style={{padding:"5px 10px",textAlign:"right",color:y.bat>0?C.red:C.muted}}> 
                        {y.bat>0?`${(y.bat/1000).toFixed(0)}K`:"—"} 
                      </td> 
                      <td style={{padding:"5px 10px",textAlign:"right",color:C.green,fontWeight:600}}>{(y.net/1000).toFixed(0)}K</td> 
                      <td style={{padding:"5px 10px",textAlign:"right",color:C.purple}}>{(y.cum/1000).toFixed(0)}K</td> 
                      <td style={{padding:"5px 10px",textAlign:"right",color:y.pos>=0?C.green:C.red,fontWeight:600}}> 
                        {y.pos>=0?"+":""}{(y.pos/1000).toFixed(0)}K 
                      </td> 
                    </tr> 
                  ); 
                })} 
              </tbody> 
            </table> 
          </div> 
        </div> 
      </div> 
    ); 
  }; 

  const renderInputs=()=>( 
    <div> 

 
      <div style={{padding:"10px 14px",background:`${C.yellow}18`,borderRadius:8,marginBottom:12, 
        fontSize:11,color:C.yellow,borderLeft:`3px solid ${C.yellow}`}}> 
        🟡 Component specs set in <strong>📚 Equipment Library</strong>. 
        Design PSH is <strong>locked to December TMY ({DESIGN_PSH}h)</strong> — always sized for worst month. 
        Load profile fractions set in <strong>🕐 Load Profile</strong> tab. 
      </div> 
      {[ 
        {title:"Site & Supply",color:C.blue,fields:[ 
          {l:"Roof area (m²)",k:"roofAreaM2",s:10}, 
          {l:"Obstructions (m²)",k:"roofObstructionsM2",s:5}, 
          {l:"Latitude (°N)",k:"lat",s:0.01,note:"Used for PVGIS fetch"}, 
          {l:"Longitude (°E)",k:"lon",s:0.01,note:"Used for PVGIS fetch"}, 
          {l:"Panel azimuth",k:"azimuth",s:5,note:"0=South, -90=East, +90=West"}, 
          {l:"Roof depth N–S (m)",k:"roofDepthM",s:1,note:"Used for inter-row shading calculation"}, 
          {l:"Ground area (m²)",k:"groundAreaM2",s:10,note:"For hybrid/ground mount — set in Coverage tab"}, 
          {l:"No. of villas",k:"nVillas",s:1}, 
          {l:"MDB busbar (A)",k:"mdbBusbarA",s:25}, 
          {l:"Monthly bill (EGP)",k:"monthlyBillEGP",s:500}, 
        ]}, 
        {title:"AC Loads",color:C.orange,fields:[ 
          {l:"No. AC units",k:"acUnits",s:1},{l:"Avg tonnage (tons)",k:"acTonnage",s:0.5}, 
          {l:"AC COP",k:"acCOP",s:0.5,note:"3.0=old split, 4.5=inverter-driven"},{l:"Summer hrs/day",k:"acHrsSummer",s:1},{l:"Winter hrs/day",k:"acHrsWinter",s:1}, 
        ]}, 
        {title:"Other Loads",color:C.yellow,fields:[ 
          {l:"Lighting area (m²)",k:"lightingAreaM2",s:25},{l:"Water heater (kW)",k:"whKW",s:0.5}, 
          {l:"WH hrs",k:"whHrs",s:0.5},{l:"Kitchen (W)",k:"kitchenW",s:100}, 
          {l:"Kitchen hrs",k:"kitchenHrs",s:0.5},{l:"Laundry (W)",k:"laundryW",s:100}, 
          {l:"Laundry hrs",k:"laundryHrs",s:0.5},{l:"Pool (kW)",k:"poolKW",s:0.5}, 
          {l:"Pool hrs",k:"poolHrs",s:0.5},{l:"Misc (kW)",k:"miscKW",s:0.5},{l:"Misc hrs",k:"miscHrs",s:0.5}, 
        ]}, 
        {title:"Site Conditions",color:C.red,fields:[
          {l:"Max ambient °C",k:"tAmbMax",s:1,note:inp.elevationM!=null&&inp.elevationM!==74?`Site elev. ${Math.round(inp.elevationM)}m — lapse-rate applied in TMY fallback`:""},
          {l:"Min ambient °C",k:"tAmbMin",s:1},
          {l:"Tilt angle (°)",k:"tiltDeg",s:1,note:"Affects TMY yield and row spacing"},
          ...((r?.noBat ?? battery?.kwh===0) ? [] : [{l:"Backup hours",k:"backupHours",s:1}]),
        ]},
        {title:"Cable Lengths (m)",color:C.red,fields:[ 
          {l:"DC string run",k:"lenStringM",s:1},{l:"DC feeder run",k:"lenFeederM",s:1}, 
          {l:"Battery–inverter",k:"lenBatteryM",s:1},{l:"Inverter–MDB",k:"lenACM",s:1}, 
        ]}, 
        {title:"Financial",color:C.green,fields:[ 
          {l:"Current tariff (EGP/kWh)",k:"tariffNow",s:0.05}, 
          {l:"Tariff escalation (%pa)",k:"tariffEsc",s:1}, 

          {l:"Annual O&M/villa (EGP)",k:"omPerYear",s:500}, 
          {l:"O&M escalation (%pa)",k:"omEsc",s:1,note:"3%=CPI-linked (standard), 10%=Egypt inflation"}, 
          {l:"Discount rate (%pa)",k:"discountRate",s:1,note:"For NPV — 12% = typical Egypt project WACC"}, 
          {l:"Panel degradation (%pa)",k:"panelDeg",s:0.05}, 
          {l:"Analysis period (yr)",k:"analysisPeriod",s:1}, 
          {l:"Battery replace yr",k:"batReplaceYear",s:1}, 
          {l:"USD rate" + (usdRateLive ? " (live ✅)" : " (manual)"), k:"usdRate", s:1,
            note: usdRateLive ? "Auto-updated from open.er-api.com — EGP "+usdRateLive+"/USD" : "Enter current EGP/USD rate"},
        ]}, 
      ].map(({title,color,fields})=>( 
        <div key={title} style={cardS(color)}> 
          <div style={{padding:"10px 14px",color:"white",fontWeight:800,fontSize:13}}>{title}</div> 
          <table style={tbl}><TblHead label="—" calcCol={color}/><tbody> 
            {fields.map(({l,k,s,note},i)=>( 
              <Row key={k} label={l} note={note} shade={i%2===0}> 
                <td style={{padding:"4px 8px"}}> 
                  <input type="number" value={inp[k]} step={s} 
                    onChange={e=>upd(k,parseFloat(e.target.value)||0)} 
                    style={{width:"100%",background:"#1c1800",border:`1px solid ${C.yellow}44`, 
                    borderRadius:6,color:C.yellow,fontSize:12,padding:"5px 8px",textAlign:"right"}}/> 
                </td> 
                <td style={{padding:"6px 12px",color:"#334155",fontSize:11,textAlign:"right",fontStyle:"italic"}}>—</td> 
              </Row> 
            ))} 
          </tbody></table> 
        </div> 
      ))} 
    </div> 
  ); 

  // -- RECOMMENDATIONS (unchanged logic, updated display) ---- 
  const renderRecommend=()=>{ 
    const top3=compatibleRecs.slice(0,3); 
    const noCompat=compatibleRecs.length===0; 
    const checkLabel={invSizing:"Inv sizing",dcAcRatio:"DC/AC",mpptMin:"MPPT min",mpptMax:"MPPT max", 
      iscPerMppt:"Isc/MPPT",batVoltage:"Bat voltage",batCharge:"Bat charge",batRule:"Bat rule (Circ.3)", 
      roofFit:"Roof fit",vdStr:"DC VD",vdAC:"AC VD"}; 
    return( 
      <div> 
        <div style={cardS(C.pink)}> 
          <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}>🔒 Lock Components</div> 

 
          <div style={{padding:"14px 16px",fontSize:11,color:C.muted,marginBottom:8,lineHeight:1.6}}> 
            Lock components already sourced. Engine recommends from <strong style={{color:C.pink}}>unlocked</strong> library entries. 
          </div> 
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12,padding:"0 16px 16px"}}> 
            {[ 
              {key:"panel",  icon:"☀",label:"PV Panel",  color:C.yellow,sel:selPanel,fn:setSelPanel,lib:panelLib, fmt:p=>`${p.brand} — ${p.model} (${p.wp}Wp)`}, 
              {key:"inverter",icon:"🔌",label:"Inverter",  color:C.purple,sel:selInv,  fn:setSelInv,  lib:invLib,  fmt:x=>`${x.brand} — ${x.model} (${x.acKW}kW)`}, 
              {key:"battery",icon:"🔋",label:"Battery",   color:C.blue,  sel:selBat,  fn:setSelBat,  lib:batLib,  fmt:x=>x.id==="B00"?`⚡ ${x.model}`:x.kwh?`${x.brand} — ${x.model} (${x.kwh}kWh)`:x.model}, 
            ].map(({key,icon,label,color,sel,fn,lib,fmt})=>{ 
              const isL=locked[key]; 
              return( 
                <div key={key} style={{background:"#0f172a",borderRadius:10,padding:14, 
                  border:`2px solid ${isL?color:C.border}`,transition:"all .15s"}}> 
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}> 
                    <span style={{fontWeight:800,color:isL?color:C.muted,fontSize:13}}>{icon} 
{label}</span> 
                    <button onClick={()=>setLocked(l=>({...l,[key]:!l[key]}))} 
                      style={{padding:"4px 12px",borderRadius:20,cursor:"pointer",fontSize:11,fontWeight:700, 
                      border:`1px solid ${isL?color:C.border}`,background:isL?`${color}22`:"transparent", 
                      color:isL?color:C.muted}}> 
                      {isL?"🔒 LOCKED":"🔓 Unlocked"} 
                    </button> 
                  </div> 
                  <select value={sel} onChange={e=>fn(e.target.value)} 
                    style={{width:"100%",background:"#1e293b",border:`1px solid ${isL?color:C.border}`, 
                    borderRadius:6,color:isL?color:C.muted,fontSize:11,padding:"6px 8px", 
                    cursor:"pointer",opacity:isL?1:0.6}}> 
                    {lib.map(x=><option key={x.id} value={x.id}>{fmt(x)}</option>)} 
                  </select> 
                  <div style={{marginTop:6,fontSize:10,color:isL?color:C.muted,fontWeight:isL?700:400}}> 
                    {isL?"✓ Fixed — system designed around this":`Engine tries all ${lib.length} options`} 
                  </div> 
                </div> 
              ); 

            })} 
          </div> 
        </div> 

        <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}> 
          <span style={{fontSize:11,color:C.muted,alignSelf:"center"}}>Rank by:</span> 
          {[{v:"electrical",l:"⚡ Electrical"},{v:"financial",l:"💰 Financial"},{v:"weighted",l:"🏆 Weighted (default)"}].map(m=>( 
            <button key={m.v} onClick={()=>setRankMode(m.v)} 
              style={{padding:"5px 14px",borderRadius:20,border:"none",cursor:"pointer",fontSize:11,fontWeight:700, background:rankMode===m.v?C.pink:C.card,color:rankMode===m.v?C.bg:C.muted}}> 

              {m.l} 
            </button> 
          ))} 
        </div> 

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:14}}> 
          {[{l:"Combinations tested",v:recommendations.length,c:C.accent}, 
            {l:"Compatible",v:compatibleRecs.length,c:C.green}, 
            {l:"Rejected",v:rejectedRecs.length,c:C.red}, 
            {l:"Locked",v:`${Object.values(locked).filter(Boolean).length}/3`,c:C.pink}].map(k=>( 
            <div key={k.l} style={{background:C.card,borderRadius:10,padding:"12px 14px",borderLeft:`4px solid ${k.c}`}}> 
              <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:3}
}>{k.l}</div> 
              <div style={{fontSize:20,fontWeight:800,color:k.c}}>{k.v}</div> 
            </div> 
          ))} 
        </div> 

        {noCompat&&( 
          <div style={{padding:"16px 20px",background:`${C.red}18`,borderRadius:10, 
            borderLeft:`4px solid ${C.red}`,marginBottom:14}}> 
            <div style={{fontWeight:800,color:C.red,fontSize:14,marginBottom:8}}>⚠ No compatible combination in library</div> 
            <div style={{fontSize:12,color:C.muted}}>Upload additional supplier data or unlock a component to widen the search.</div> 
          </div> 
        )} 

        {top3.length>0&&( 
          <div style={cardS(C.pink)}> 
            <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}> 

 
              
 
 
 
              🏆 Top {top3.length} Recommendation{top3.length>1?"s":""} 
            </div> 
            {top3.map((rec,ri)=>{ 
              const medals=["🥇","🥈","🥉"]; 
              const isSel=rec.p.id===selPanel&&rec.inv.id===selInv&&rec.bat.id===selBat; 
              return( 
                <div key={ri} style={{margin:"0 12px 12px",background:"#0f172a",borderRadius:10, 
                  padding:16,border:`2px solid ${ri===0?C.pink:C.border}`,position:"relative"}}> 
                  {isSel&&<div style={{position:"absolute",top:10,right:14,fontSize:10,color:C.green, 
                    fontWeight:800,background:`${C.green}22`,padding:"2px 8px",borderRadius:10}}>● ACTIVE</div>} 
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,flexWrap:"wrap"}}> 
                    <span style={{fontSize:20}}>{medals[ri]}</span> 
                    <div> 
                      <div style={{fontWeight:800,color:ri===0?C.pink:C.text,fontSize:13}}>Recommendation #{ri+1}</div> 
                      <div style={{fontSize:10,color:C.muted}}> 
                        Score {rec.weighted.toFixed(0)}/100 · Elec {rec.elecScore.toFixed(0)} · 
{rec.pass}/{Object.keys(rec.checks).length} checks pass 
                      </div> 
                    </div> 
                    <button onClick={()=>{setSelPanel(rec.p.id);setSelInv(rec.inv.id);setSelBat(rec.bat.id);}} 
                      style={{marginLeft:"auto",padding:"6px 16px",background:C.pink,color:C.bg, 
                      border:"none",borderRadius:8,fontWeight:800,fontSize:12,cursor:"pointer"}}> 
                      Apply → 
                    </button> 
                  </div> 
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:10,marginBottom:12}}> 
                    {[{icon:"☀",label:"Panel",  color:C.yellow,name:`${rec.p.brand} ${rec.p.model}`,   specs:`${rec.p.wp}Wp · $${rec.p.costUSD}/W`}, 
                      {icon:"🔌",label:"Inverter",color:C.purple,name:`${rec.inv.brand} ${rec.inv.model}`,specs:`${rec.inv.acKW}kW · ${fmtE(rec.inv.costEGP)}`}, 
                      {icon:"🔋",label:"Battery", color:C.blue,  name:`${rec.bat.brand} ${rec.bat.model}`,specs:`${rec.bat.kwh}kWh · ${fmtE(rec.bat.costEGP)}`}].map(({icon,label,color,name,specs})=>( 
                      <div key={label} style={{background:C.card,borderRadius:8,padding:"10px 12px",borderLeft:`3px solid ${color}`}}> 
                        <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:4}
}>{icon} {label}</div> 
                        <div style={{fontSize:12,fontWeight:700,color,marginBottom:3}}>{name}</div> 
                        <div style={{fontSize:10,color:C.muted}}>{specs}</div> 

                      </div> 
                    ))} 
                  </div> 
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:8,marginBottom:12}}> 
                    {[{l:"Array",v:`${rec.r.actKwp.toFixed(1)} kWp`,c:C.yellow}, 
                      {l:"Annual (TMY)",v:`${(rec.r.annGenTMY/1000).toFixed(1)} MWh`,c:C.green}, 
                      {l:"Cost",v:fmtE(rec.r.sysC),c:C.red}, 
                      {l:"Payback",v:rec.r.pb?`${rec.r.pb} yrs`:">25",c:C.accent}, 
                      {l:"IRR",v:`${rec.r.irr}%`,c:C.green}, 
                      {l:"25yr gain",v:fmtE(rec.r.netGain),c:C.green}].map(k=>( 
                      <div key={k.l} style={{background:C.card,borderRadius:7,padding:"7px 10px",textAlign:"center"}}> 
                        <div style={{fontSize:9,color:C.muted,marginBottom:2}}>{k.l}</div> 
                        <div style={{fontSize:13,fontWeight:800,color:k.c}}>{k.v}</div> 
                      </div> 
                    ))} 
                  </div> 
                  <div style={{display:"flex",flexWrap:"wrap",gap:5}}> 
                    {Object.entries(rec.checks).map(([k,v])=>( 
                      <div key={k} style={{fontSize:9,padding:"2px 7px",borderRadius:8,fontWeight:700, 
                        background:`${passColor(v)}18`,color:passColor(v),border:`1px solid ${passColor(v)}44`}}> 
                        {checkLabel[k]||k}: {v} 
                      </div> 
                    ))} 
                  </div> 
                </div> 
              ); 
            })} 
          </div> 
        )} 

        {rejectedRecs.length>0&&( 
          <div style={cardS(C.red)}> 
            <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}> 
              ❌ Rejected ({rejectedRecs.length}) — Incompatibility reasons 
            </div> 
            <div style={{overflowX:"auto"}}> 
              <table style={{...tbl,fontSize:11}}> 
                <thead><tr style={{borderBottom:`2px solid ${C.border}`}}> 
                  {["Panel","Inverter","Battery","Rejection reasons"].map(h=>( 
                    <th key={h} style={{padding:"7px 12px",textAlign:"left",color:C.muted,fontWeight:600}}>{h}</th> 
                  ))} 
                </tr></thead> 

 
                <tbody> 
                  {rejectedRecs.slice(0,20).map((rec,i)=>( 
                    <tr key={i} style={{background:i%2===0?"transparent":"#070f1f",borderBottom:`1px solid #1e293b`}}> 
                      <td style={{padding:"6px 12px",color:C.muted,fontSize:10}}>{rec.p.brand} 
{rec.p.wp}Wp</td> 
                      <td style={{padding:"6px 12px",color:C.muted,fontSize:10}}>{rec.inv.brand} 
{rec.inv.acKW}kW</td> 
                      <td style={{padding:"6px 12px",color:C.muted,fontSize:10}}>{rec.bat.brand} 
{rec.bat.kwh}kWh</td> 
                      <td style={{padding:"6px 12px"}}> 
                        <div style={{display:"flex",flexWrap:"wrap",gap:4}}> 
                          {rec.rejectReasons.map(reason=>( 
                            <span key={reason} style={{fontSize:9,padding:"2px 7px",borderRadius:8, 
                              background:`${C.red}22`,color:C.red,border:`1px solid ${C.red}44`,fontWeight:700}}> 
                              {reason} 
                            </span> 
                          ))} 
                        </div> 
                      </td> 
                    </tr> 
                  ))} 
                  {rejectedRecs.length>20&&( 
                    <tr><td colSpan={4} style={{padding:"8px 12px",color:C.muted,fontSize:10,textAlign:"center"}}> 
                      + {rejectedRecs.length-20} more rejected combinations 
                    </td></tr> 
                  )} 
                </tbody> 
              </table> 
            </div> 
          </div> 
        )} 
      </div> 
    ); 
  }; 

  // -- 💾 PROJECTS 

  const renderProjects = () => { 
    return ( 
      <div> 
        <div style={cardS("#14b8a6")}> 
          <div style={{padding:"12px 16px",color:"white",fontWeight:800,fontSize:13}}> 
            Project Save / Load 
          </div> 
          <div style={{padding:"16px 20px"}}> 

 
            <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:12,flexWrap:"wrap"}}> 
              <input value={projName} onChange={e => setProjName(e.target.value)} 
                style={{flex:1,minWidth:160,background:"#0f172a",border:"2px solid #14b8a6", 
                borderRadius:8,color:"#14b8a6",fontSize:14,fontWeight:700,padding:"7px 12px"}} /> 
              <button onClick={handleSaveProject} 
                style={{padding:"8px 20px",background:"#14b8a6",color:C.bg,border:"none", 
                borderRadius:8,fontWeight:800,fontSize:13,cursor:"pointer"}}> 
                Save Design 
              </button> 
            </div> 
            {saveStatus && ( 
              <div style={{padding:"7px 12px",borderRadius:6,fontSize:12,fontWeight:600,marginBottom:10, 
                background:"#10b98120",color:C.green,borderLeft:"3px solid " + C.green}}> 
                {saveStatus} 
              </div> 
            )} 
            <div style={{fontSize:11,color:C.muted,marginBottom:12}}> 
              Projects stored in artifact cloud storage — persist across browser sessions. 
            </div> 
            {projects.length === 0 
              ? <div style={{color:C.muted,fontSize:12,padding:16,textAlign:"center"}}>No saved projects yet.</div> 
              : ( 
                <div style={{display:"grid",gap:8}}> 
                  {projects.map(name => ( 
                    <div key={name} style={{display:"flex",alignItems:"center",gap:10, 
                      padding:"10px 14px",background:"#0f172a",borderRadius:8, 
                      border:"1px solid " + C.border}}> 
                      <span style={{flex:1,color:C.text,fontWeight:600,fontSize:12}}> 
                        {name} 
                      </span> 
                      <button onClick={() => handleLoadProject(name)} 
                        style={{padding:"4px 12px",background:"#14b8a620",border:"1px solid #14b8a6", borderRadius:6,color:"#14b8a6",fontSize:11,fontWeight:700,cursor:"pointer"}}> 

                        Load 
                      </button> 
                      <button onClick={() => handleDeleteProject(name)} 
                        style={{padding:"4px 10px",background:C.red + "20",border:"1px solid " + C.red, 
                        borderRadius:6,color:C.red,fontSize:11,cursor:"pointer"}}> 
                        Del 
                      </button> 
                    </div> 

                        
                  ))} 
                </div> 
              ) 
            } 
          </div> 
        </div> 
        <div style={cardS(C.blue)}> 
          <div style={{padding:"12px 16px",color:"white",fontWeight:800,fontSize:13}}> 
            Project Details 
          </div> 
          <div style={{padding:"16px 20px",display:"grid", 
            gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:12}}> 
            {[ 
              {l:"Project Ref",   k:"projectRef"}, 
              {l:"Client Name",  k:"clientName"}, 
              {l:"Villa / Unit", k:"villaRef"}, 
              {l:"Address",      k:"address"}, 
              {l:"Engineer",     k:"engineer"}, 
              {l:"Company",      k:"companyName"}, 
            ].map(({l,k}) => ( 
              <div key={k}> 
                <div style={{fontSize:10,color:C.muted,marginBottom:4}}>{l}</div> 
                <input value={inp[k]||""} onChange={e => upd(k, e.target.value)} 
                  style={{width:"100%",background:"#0f172a",border:"1px solid " + C.border, 
                  borderRadius:6,color:C.text,fontSize:12,padding:"7px 10px"}} /> 
              </div> 
            ))} 
          </div> 
        </div> 
      </div> 
    ); 
  }; 

  // -- 📐 SLD 

  const renderSLD = () => {
    if (!r) return <div style={{color:C.muted,padding:20}}>Select components first.</div>;
    const spdCard = renderSPDCard();
    return (
      <div>
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          {[{v:"client",l:"Client Schematic"},{v:"permit",l:"Engineering SLD (Permit)"}].map(m => ( 
            <button key={m.v} onClick={() => setSldMode(m.v)} 
              style={{padding:"7px 18px",borderRadius:8,border:"none",cursor:"pointer", 
              fontSize:12,fontWeight:700, 
              background:sldMode===m.v?"#6366f1":C.card, 
              color:sldMode===m.v?"white":C.muted}}> 
              {m.l} 
            </button> 

 
          ))} 
        </div> 

        {sldMode === "client" ? ( 
          <div style={cardS("#6366f1")}> 
            <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}> 
              Client Schematic — {r.actKwp.toFixed(1)} kWp Hybrid System 
            </div> 
            <div style={{padding:"16px",overflowX:"auto"}}> 
              <svg width="720" height="300" style={{display:"block",margin:"0 auto"}}> 
                <defs> 
                  <marker id="arr" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"> 
                    <polygon points="0 0, 8 3, 0 6" fill={C.green} /> 
                  </marker> 
                  <marker id="arrY" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"> 
                    <polygon points="0 0, 8 3, 0 6" fill={C.yellow} /> 
                  </marker> 
                </defs> 
                {/* PV Array */} 
                <rect x="20" y="40" width="90" height="80" rx="8" fill="#1a2840" stroke={C.yellow} strokeWidth="2.5" /> 
                <text x="65" y="65" textAnchor="middle" fill={C.yellow} fontSize="9" fontWeight="800">PV ARRAY</text> 
                <text x="65" y="80" textAnchor="middle" fill={C.text} fontSize="8">{r.totP} panels</text> 
                <text x="65" y="93" textAnchor="middle" fill={C.text} fontSize="8">{r.actKwp.toFixed(1)} kWp</text> 
                <text x="65" y="106" textAnchor="middle" fill={C.accent} fontSize="8">{r.nStr}S x 
{r.nSel}P</text> 
                {/* Arrow DC */} 
                <line x1="110" y1="80" x2="160" y2="80" stroke={C.yellow} strokeWidth="2" markerEnd="url(#arrY)" /> 
                <text x="135" y="74" fill={C.yellow} fontSize="8" textAnchor="middle">{r.strVoc.toFixed(0)}V DC</text> 
                {/* Inverter */} 
                <rect x="160" y="30" width="100" height="130" rx="8" fill="#1a2840" stroke="#8b5cf6" strokeWidth="2.5" /> 
                <text x="210" y="58" textAnchor="middle" fill="#8b5cf6" fontSize="9" fontWeight="800">HYBRID</text> 
                <text x="210" y="70" textAnchor="middle" fill="#8b5cf6" fontSize="9" fontWeight="800">INVERTER</text> 
                <text x="210" y="85" textAnchor="middle" fill={C.text} fontSize="8">{inverter&&inverter.brand}</text> 
                <text x="210" y="97" textAnchor="middle" fill={C.text} fontSize="8">{inverter&&inverter.model}</text> 

 
                <text x="210" y="110" textAnchor="middle" fill={C.accent} fontSize="8">{inverter&&inverter.acKW}kW AC</text> 
                <text x="210" y="122" textAnchor="middle" fill={C.muted} fontSize="7">Eta 
{inverter&&inverter.eta}%</text> 
                {/* Battery */} 
                <rect x="160" y="195" width="100" height="70" rx="8" fill="#1a2840" stroke={C.blue} strokeWidth="2.5" /> 
                <text x="210" y="218" textAnchor="middle" fill={C.blue} fontSize="9" fontWeight="800">BATTERY</text> 
                <text x="210" y="232" textAnchor="middle" fill={C.text} fontSize="8">{battery&&battery.brand}</text> 
                <text x="210" y="245" textAnchor="middle" fill={C.text} fontSize="8">{battery&&battery.kwh}kWh</text> 
                <text x="210" y="258" textAnchor="middle" fill={C.accent} fontSize="8">DoD 
{battery&&battery.dod}%</text> 
                <line x1="210" y1="160" x2="210" y2="195" stroke={C.blue} strokeWidth="2" strokeDasharray="5,3" /> 
                {/* Arrow AC */} 
                <line x1="260" y1="95" x2="320" y2="95" stroke={C.green} strokeWidth="2" markerEnd="url(#arr)" /> 
                <text x="290" y="89" fill={C.green} fontSize="8" textAnchor="middle">{inp.supplyVoltageLL}V AC</text> 
                {/* AC MCB */} 
                <rect x="320" y="60" width="70" height="70" rx="6" fill="#1a2840" stroke={C.red} strokeWidth="2" /> 
                <text x="355" y="82" textAnchor="middle" fill={C.red} fontSize="8" fontWeight="800">AC MCB</text> 
                <text x="355" y="95" textAnchor="middle" fill={C.text} fontSize="8">{r.acBreaker}A</text> 
                <text x="355" y="107" textAnchor="middle" fill={C.muted} fontSize="7">Type C + RCD</text> 
                <line x1="390" y1="95" x2="450" y2="95" stroke={C.green} strokeWidth="2" markerEnd="url(#arr)" /> 
                {/* MDB */} 
                <rect x="450" y="50" width="80" height="90" rx="6" fill="#1a2840" stroke={C.green} strokeWidth="2.5" /> 
                <text x="490" y="75" textAnchor="middle" fill={C.green} fontSize="9" fontWeight="800">MDB</text> 
                <text x="490" y="90" textAnchor="middle" fill={C.text} fontSize="8">{inp.mdbBusbarA}A</text> 
                <text x="490" y="103" textAnchor="middle" fill={C.muted} fontSize="7">{inp.supplyPhase}-ph</text> 
                <text x="490" y="115" textAnchor="middle" fill={C.muted} fontSize="7">{inp.supplyVoltageLL}V</text> 
                <line x1="490" y1="140" x2="490" y2="175" stroke={C.muted} strokeWidth="2" /> 
                {/* Grid */} 
                <rect x="450" y="175" width="80" height="40" rx="4" fill="#0f172a" stroke={C.muted} strokeWidth="1.5" /> 

                <text x="490" y="193" textAnchor="middle" fill={C.muted} fontSize="9" fontWeight="700">GRID (NCEDC)</text> 
                <text x="490" y="207" textAnchor="middle" fill={C.muted} fontSize="8">Net-metering</text> 
                {/* Loads */} 
                <rect x="580" y="50" width="80" height="90" rx="6" fill="#1a2840" stroke={C.orange} strokeWidth="2" /> 
                <text x="620" y="75" textAnchor="middle" fill={C.orange} fontSize="9" fontWeight="800">LOADS</text> 
                <text x="620" y="90" textAnchor="middle" fill={C.text} fontSize="8">{r.peakKW.toFixed(1)}kW peak</text> 
                <text x="620" y="103" textAnchor="middle" fill={C.text} fontSize="8">{r.loadTot.toFixed(1)}kWh/d</text> 
                <line x1="530" y1="95" x2="580" y2="95" stroke={C.orange} strokeWidth="2" markerEnd="url(#arr)" /> 
              </svg> 
            </div> 
            <div style={{padding:"0 16px 14px",display:"grid", 
              gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8}}> 
              {[ 
                {l:"Array",      v:r.actKwp.toFixed(1) + " kWp", c:C.yellow}, 
                {l:"DC Voltage", v:r.strVoc.toFixed(0) + "V",     c:C.orange}, 
                {l:"Inverter",   v:(inverter&&inverter.acKW) + "kW", c:"#8b5cf6"}, 
                {l:"Battery",    v:(battery&&battery.kwh) + "kWh",  c:C.blue}, 
                {l:"AC Breaker", v:r.acBreaker + "A",               c:C.red}, 
                {l:"Annual P50", v:(r.annGenTMY/1000).toFixed(1) + " MWh", c:C.green}, 
              ].map(k => ( 
                <div key={k.l} style={{background:"#0f172a",borderRadius:7,padding:"8px 12px", 
                  borderLeft:"3px solid " + k.c}}> 
                  <div style={{fontSize:9,color:C.muted,textTransform:"uppercase"}}>{k.l}</div> 
                  <div style={{fontSize:13,fontWeight:800,color:k.c}}>{k.v}</div> 
                </div> 
              ))} 
            </div> 
          </div> 
        ) : ( 
          <div style={cardS("#6366f1")}> 
            <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}> 
              Engineering SLD — Permit Package 
            </div> 
            <div style={{padding:"16px",overflowX:"auto"}}> 
              <svg width="720" height="420" style={{display:"block",margin:"0 auto"}}> 
                <rect x="0" y="0" width="720" height="32" fill="#111827" rx="4" /> 
                <text x="10" y="13" fill="#6366f1" fontSize="9" fontWeight="800"> 
                  SINGLE LINE DIAGRAM — HYBRID PV SYSTEM 
                </text> 
                <text x="10" y="26" fill={C.muted} fontSize="8"> 
                  {inp.projectRef} · {inp.address} · Engineer: {inp.engineer} 

                </text> 
                <text x="560" y="13" fill={C.muted} fontSize="8">Array: {r.actKwp.toFixed(1)} kWp</text> 
                <text x="560" y="26" fill={C.muted} fontSize="8">Ref: EgyptERA ssPV Code</text> 

                {/* Zone 1 */} 
                <rect x="5" y="40" width="130" height="200" rx="4" fill="none" 
                  stroke={C.yellow} strokeWidth="1" strokeDasharray="4,2" /> 
                <text x="70" y="54" textAnchor="middle" fill={C.yellow} fontSize="8" fontWeight="700"> 
                  ZONE 1 — DC STRING 
                </text> 
                {[0,1].map(i => ( 
                  <g key={i} transform={"translate(12," + (65 + i*80) + ")"}> 
                    <rect width="55" height="45" rx="3" fill="#1a2840" stroke={C.yellow} strokeWidth="1.5" /> 
                    <text x="27" y="17" textAnchor="middle" fill={C.yellow} fontSize="8">PV String 
{i+1}</text> 
                    <text x="27" y="29" textAnchor="middle" fill={C.muted} fontSize="7">{r.nSel}S x 
1P</text> 
                    <text x="27" y="40" textAnchor="middle" fill={C.muted} fontSize="7">{r.strVoc.toFixed(0)}V</text> 
                    <line x1="55" y1="22" x2="72" y2="22" stroke={C.yellow} strokeWidth="1.5" /> 
                    <rect x="72" y="18" width="16" height="8" rx="2" fill="none" stroke={C.orange} strokeWidth="1.5" /> 
                    <text x="80" y="25" textAnchor="middle" fill={C.orange} fontSize="6">{r.strFuse}A</text> 
                    <line x1="88" y1="22" x2="108" y2="22" stroke={C.yellow} strokeWidth="1.5" /> 
                    <text x="65" y="17" fill={C.yellow} fontSize="6">4mm PV1-F</text> 
                    <text x="65" y="26" fill={C.muted} fontSize="6">{r.iStr.toFixed(1)}A</text> 
                  </g> 
                ))} 
                {r.nStr > 2 && ( 
                  <text x="70" y="235" textAnchor="middle" fill={C.muted} fontSize="8"> 
                    + {r.nStr - 2} more strings 
                  </text> 
                )} 

                {/* Zone 2 */} 
                <rect x="145" y="40" width="110" height="200" rx="4" fill="none" 
                  stroke={C.orange} strokeWidth="1" strokeDasharray="4,2" /> 
                <text x="200" y="54" textAnchor="middle" fill={C.orange} fontSize="8" fontWeight="700"> 
                  ZONE 2 — DC FEEDER 
                </text> 
                <rect x="155" y="65" width="90" height="50" rx="4" fill="#1a2840" stroke={C.orange} strokeWidth="1.5" /> 

 
 
                <text x="200" y="84" textAnchor="middle" fill={C.orange} fontSize="8" fontWeight="700">DC SPD</text> 
                <text x="200" y="96" textAnchor="middle" fill={C.muted} fontSize="7">Type 2, 1000V</text> 
                <text x="200" y="107" textAnchor="middle" fill={C.muted} fontSize="7">+ DC Isolator</text> 
                <rect x="155" y="135" width="90" height="50" rx="4" fill="#1a2840" stroke={C.yellow} strokeWidth="1.5" /> 
                <text x="200" y="154" textAnchor="middle" fill={C.yellow} fontSize="8" fontWeight="700">DC COMBINER</text> 
                <text x="200" y="166" textAnchor="middle" fill={C.muted} fontSize="7">{r.nStr} strings</text> 
                <text x="200" y="178" textAnchor="middle" fill={C.muted} fontSize="7">16mm feeder</text> 
                <line x1="113" y1="85" x2="155" y2="85" stroke={C.yellow} strokeWidth="1.5" /> 
                <line x1="113" y1="165" x2="155" y2="165" stroke={C.yellow} strokeWidth="1.5" /> 

                {/* Zone 3 — Inverter */} 
                <rect x="265" y="40" width="120" height="200" rx="4" fill="none" 
                  stroke="#8b5cf6" strokeWidth="1" strokeDasharray="4,2" /> 
                <text x="325" y="54" textAnchor="middle" fill="#8b5cf6" fontSize="8" fontWeight="700"> 
                  ZONE 3 — INVERTER 
                </text> 
                <rect x="275" y="60" width="100" height="75" rx="4" fill="#1a2840" stroke="#8b5cf6" strokeWidth="2" /> 
                <text x="325" y="82" textAnchor="middle" fill="#8b5cf6" fontSize="9" fontWeight="800">HYBRID INV</text> 
                <text x="325" y="95" textAnchor="middle" fill={C.text} fontSize="7">{inverter&&inverter.brand}</text> 
                <text x="325" y="107" textAnchor="middle" fill={C.text} fontSize="7">{inverter&&inverter.model}</text> 
                <text x="325" y="119" textAnchor="middle" fill={C.accent} fontSize="7">{inverter&&inverter.acKW}kW</text> 
                <rect x="275" y="160" width="100" height="60" rx="4" fill="#1a2840" stroke={C.blue} strokeWidth="1.5" /> 
                <text x="325" y="179" textAnchor="middle" fill={C.blue} fontSize="8" fontWeight="700">BATTERY</text> 
                <text x="325" y="191" textAnchor="middle" fill={C.text} fontSize="7">{battery&&battery.brand}</text> 
                <text x="325" y="203" textAnchor="middle" fill={C.text} fontSize="7">{battery&&battery.kwh}kWh LFP</text> 
                <text x="325" y="214" textAnchor="middle" fill={C.muted} fontSize="6">Circ.3/2023 compliant</text> 
                <line x1="245" y1="155" x2="275" y2="100" stroke={C.yellow} strokeWidth="1.5" /> 

 
                <line x1="325" y1="135" x2="325" y2="160" stroke={C.blue} strokeWidth="1.5" strokeDasharray="4,2" /> 

                {/* Zone 4 — AC Output */} 
                <rect x="395" y="40" width="315" height="200" rx="4" fill="none" 
                  stroke={C.green} strokeWidth="1" strokeDasharray="4,2" /> 
                <text x="552" y="54" textAnchor="middle" fill={C.green} fontSize="8" fontWeight="700"> 
                  ZONE 4 — AC OUTPUT 
                </text> 
                <rect x="405" y="65" width="80" height="65" rx="4" fill="#1a2840" stroke={C.red} strokeWidth="1.5" /> 
                <text x="445" y="85" textAnchor="middle" fill={C.red} fontSize="8" fontWeight="700">AC MCB</text> 
                <text x="445" y="97" textAnchor="middle" fill={C.text} fontSize="7">{r.acBreaker}A Type C</text> 
                <text x="445" y="109" textAnchor="middle" fill={C.muted} fontSize="6">+ AC SPD Type2</text> 
                <text x="445" y="120" textAnchor="middle" fill={C.muted} fontSize="6">+ RCD 
30mA</text> 
                <rect x="520" y="55" width="85" height="80" rx="4" fill="#1a2840" stroke={C.green} strokeWidth="2" /> 
                <text x="562" y="78" textAnchor="middle" fill={C.green} fontSize="9" fontWeight="800">MDB</text> 
                <text x="562" y="92" textAnchor="middle" fill={C.text} fontSize="7">{inp.mdbBusbarA}A Busbar</text> 
                <text x="562" y="104" textAnchor="middle" fill={C.text} fontSize="7">{inp.supplyPhase}-phase</text> 
                <text x="562" y="116" textAnchor="middle" fill={C.muted} fontSize="6">{inp.supplyAmps}A supply</text> 
                <text x="562" y="127" textAnchor="middle" fill={C.muted} fontSize="6">+ Smart 
export meter</text> 
                <rect x="635" y="65" width="70" height="50" rx="4" fill="#0f172a" stroke={C.muted} strokeWidth="1.5" /> 
                <text x="670" y="85" textAnchor="middle" fill={C.muted} fontSize="8" fontWeight="700">GRID</text> 
                <text x="670" y="98" textAnchor="middle" fill={C.muted} fontSize="7">NCEDC</text> 
                <text x="670" y="110" textAnchor="middle" fill={C.muted} fontSize="6">EgyptERA</text> 
                <line x1="375" y1="98" x2="405" y2="98" stroke={C.green} strokeWidth="2" /> 
                <line x1="485" y1="98" x2="520" y2="95" stroke={C.green} strokeWidth="2" /> 
                <line x1="605" y1="95" x2="635" y2="90" stroke={C.muted} strokeWidth="1.5" /> 

                {/* Compliance block */} 
                <rect x="10" y="280" width="700" height="120" rx="4" fill="#0f172a" stroke={C.border} strokeWidth="1" /> 

 
 
                <text x="20" y="296" fill={C.accent} fontSize="9" fontWeight="800">COMPLIANCE NOTES</text> 
                {[ 
                  "1. DC string cables: 4mm PV1-F, rated 1000V DC — IEC 60364-7-712", 
                  "2. DC fuses per string: " + r.strFuse + "A — IEC 60269", 
                  "3. DC feeder: 16mm, VD " + r.vdFdr.toFixed(2) + "% (" + r.chkVdFdr + ")", 
                  "4. AC cable: 10mm, VD " + r.vdAC.toFixed(2) + "% (" + r.chkVdAC + ")", 
                  "5. Battery: " + (battery&&battery.kwh) + "kWh — EgyptERA Circ.3/2023 check: " + r.chkBatRule, 
                  "6. System < 500kWp: " + r.chkSize500 + " — NCEDC simplified interconnection applies", 
                  "7. All checks: " + (r.allOk ? "PASS" : "REVIEW REQUIRED"), 
                ].map((t, i) => ( 
                  <text key={i} x="20" y={312 + i * 13} fill={C.muted} fontSize="8">{t}</text> 
                ))} 
              </svg> 
            </div> 
          </div> 
        )} 
      {/* SPD Sizing Card — appended at bottom of SLD tab */}
      {spdCard && <div style={{marginTop:16}}>{spdCard}</div>}
      </div>
    );
  };

  // -- 📦 BOM
  //------------------------------------------------------
  const renderBOM = () => { 
    if (!r) return <div style={{color:C.muted,padding:20}}>Select components first.</div>; 
    const BOM_ITEMS = [ 
      {cat:"DC Protection",  item:"DC String Fuse per string", unit:"ea", unitEGP:180,  qty:r.nStr}, 
      {cat:"DC Protection",  item:"DC SPD Type 2",             unit:"ea", unitEGP:950,  qty:1}, 
      {cat:"DC Protection",  item:"DC Isolator 1000V",         unit:"ea", unitEGP:650,  qty:1}, 
      {cat:"AC Protection",  item:"AC MCB Type C",             unit:"ea", unitEGP:420,  qty:1}, 
      {cat:"AC Protection",  item:"AC SPD Type 2",             unit:"ea", unitEGP:750,  qty:1}, 
      {cat:"AC Protection",  item:"AC RCD 30mA",               unit:"ea", unitEGP:580,  qty:1}, 
      {cat:"Cabling", item:`DC String Cable ${r.csaStr||4}mm² PV1-F (m)`,  unit:"m", unitEGP:r.csaStr>=10?38:r.csaStr>=6?25:18,  qty:Math.round(inp.lenStringM*(r.nStr||1)*2)}, 
      {cat:"Cabling", item:`DC Feeder Cable ${r.csaFdr||16}mm² PV1-F (m)`, unit:"m", unitEGP:r.csaFdr>=25?85:r.csaFdr>=16?55:35, qty:Math.round(inp.lenFeederM*2)}, 
      {cat:"Cabling", item:`AC Cable ${r.csaAC||10}mm² XLPE (m)`,          unit:"m", unitEGP:r.csaAC>=25?90:r.csaAC>=16?65:48,  qty:Math.round(inp.lenACM*3)}, 
      {cat:"Cabling", item:"Battery Cable 35mm² (m)",                       unit:"m", unitEGP:120, qty:Math.round(inp.lenBatteryM*2)}, 
      {cat:"Mounting",       item:"Roof Rail per 4m",          unit:"ea", unitEGP:480,  qty:Math.ceil(r.totP/4)}, 
      {cat:"Mounting",       item:"Clamp Set per 4 panels",    unit:"set",unitEGP:220,  qty:Math.ceil(r.totP/4)}, 
      {cat:"Monitoring",     item:"Monitoring Gateway",        unit:"ea", unitEGP:3500, qty:1}, 

 
      {cat:"Monitoring",     item:"CT Sensor per phase",       unit:"ea", unitEGP:280,  qty:3}, 
      {cat:"Civil",          item:"Cable Conduit (m)",         unit:"m",  unitEGP:45,   qty:Math.round(inp.lenStringM+inp.lenACM)}, 
      {cat:"Civil",          item:"Earthing Rod + Cable",      unit:"set",unitEGP:1200, qty:1}, 
      {cat:"Civil",          item:"Warning Labels",            unit:"set",unitEGP:350,  qty:1}, 
      {cat:"Grid",           item:"NCEDC Application Fee",     unit:"ea", unitEGP:8500, qty:1}, 
      {cat:"Grid",           item:"Smart Export Meter",        unit:"ea", unitEGP:4200, qty:1}, 
    ].map(x => ({...x, totalEGP: x.qty * x.unitEGP})); 

    const bomTotal  = BOM_ITEMS.reduce((s,x) => s+x.totalEGP, 0); 
    const grandTotal = bomTotal + r.arrayCostEGP + r.invCostEGP + r.batCostEGP; 
    const cats = [...new Set(BOM_ITEMS.map(x => x.cat))]; 

    return ( 
      <div> 
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:14}}> 
          {[ 
            {l:"PV Array",   v:fmtE(r.arrayCostEGP), c:C.yellow}, 
            {l:"Inverter",   v:fmtE(r.invCostEGP),   c:"#8b5cf6"}, 
            {l:"Battery",    v:fmtE(r.batCostEGP),   c:C.blue}, 
            {l:"BOM Items",  v:fmtE(bomTotal),         c:"#84cc16"}, 
            {l:"Grand Total",v:fmtE(grandTotal),       c:C.green}, 
            {l:"Per kWp",    v:fmtE(grandTotal/r.actKwp), c:C.muted}, 
          ].map(k => ( 
            <div key={k.l} style={{background:C.card,borderRadius:10,padding:"12px 14px", 
              borderLeft:"4px solid " + k.c}}> 
              <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:3}
}>{k.l}</div> 
              <div style={{fontSize:16,fontWeight:800,color:k.c}}>{k.v}</div> 
            </div> 
          ))} 
        </div> 
        <div style={cardS("#84cc16")}> 
          <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13,
            display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
            <span>Bill of Materials — {inp.nVillas} Villa{inp.nVillas > 1 ? "s" : ""}</span>
            <span style={{fontWeight:400,fontSize:10,color:"rgba(255,255,255,0.7)"}}>
              {inp.address && <span>{inp.address}</span>}
              {inp.lat && <span> · {(inp.lat).toFixed(4)}°N, {(inp.lon||0).toFixed(4)}°E</span>}
              {inp.elevationM != null && <span> · {Math.round(inp.elevationM)} m ASL</span>}
            </span>
          </div>
          <div style={{overflowX:"auto"}}> 
            <table style={{...tbl,fontSize:11}}> 
              <thead> 
                <tr style={{borderBottom:"2px solid " + C.border}}> 
                  {["Category","Item","Qty","Unit","Unit EGP","Total EGP"].map(h => ( 
                    <th key={h} style={{padding:"7px 10px",textAlign:"right",color:C.muted, 
                      fontWeight:600,whiteSpace:"nowrap"}}>{h}</th> 
                  ))} 
                </tr> 

 
 
              </thead> 
              <tbody> 
                <tr style={{background:C.yellow + "18"}}> 
                  <td colSpan={6} style={{padding:"5px 10px",color:C.yellow,fontWeight:800, 
                    fontSize:10,textTransform:"uppercase"}}>Major Components</td> 
                </tr> 
                {[ 
                  {item:(panel&&panel.brand) + " " + (panel&&panel.model), qty:r.totP, unit:"ea", unitEGP:Math.round(r.arrayCostEGP/r.totP), totalEGP:r.arrayCostEGP}, 
                  {item:(inverter&&inverter.brand) + " " + (inverter&&inverter.model), qty:1, unit:"ea", unitEGP:r.invCostEGP, totalEGP:r.invCostEGP}, 
                  {item:(battery&&battery.brand) + " " + (battery&&battery.model), qty:1, unit:"ea", unitEGP:r.batCostEGP, totalEGP:r.batCostEGP}, 
                ].map((b,i) => ( 
                  <tr key={b.item} style={{background:i%2===0?"transparent":"#070f1f", 
                    borderBottom:"1px solid " + C.border}}> 
                    <td style={{padding:"5px 10px",color:C.muted,fontSize:10}}>Equipment</td> 
                    <td style={{padding:"5px 10px",color:C.text,fontSize:11}}>{b.item}</td> 
                    <td style={{padding:"5px 10px",textAlign:"right",color:C.text}}>{b.qty}</td> 
                    <td style={{padding:"5px 10px",textAlign:"right",color:C.muted}}>{b.unit}</td> 
                    <td style={{padding:"5px 10px",textAlign:"right",color:C.muted}}>{(b.unitEGP/1000).toFixed(1)}K</td> 
                    <td style={{padding:"5px 10px",textAlign:"right",color:C.yellow,fontWeight:700}}> 
                      {fmtE(b.totalEGP)} 
                    </td> 
                  </tr> 
                ))} 
                {cats.flatMap(cat => [ 
                  <tr key={"hdr-" + cat} style={{background:"#84cc1618"}}> 
                    <td colSpan={6} style={{padding:"5px 10px",color:"#84cc16",fontWeight:800, 
                      fontSize:10,textTransform:"uppercase"}}>{cat}</td> 
                  </tr>, 
                  ...BOM_ITEMS.filter(x => x.cat === cat).map((b,i) => ( 
                    <tr key={b.item} style={{background:i%2===0?"transparent":"#070f1f", 
                      borderBottom:"1px solid " + C.border}}> 
                      <td style={{padding:"5px 10px",color:C.muted,fontSize:10}}>{b.cat}</td> 
                      <td style={{padding:"5px 10px",color:C.text,fontSize:11}}>{b.item}</td> 
                      <td style={{padding:"5px 10px",textAlign:"right",color:C.accent}}>{b.qty}</td> 
                      <td style={{padding:"5px 10px",textAlign:"right",color:C.muted}}>{b.unit}</td> 
                      <td style={{padding:"5px 10px",textAlign:"right",color:C.muted}}>{b.unitEGP.toLocaleString()}</td> 
                      <td style={{padding:"5px 10px",textAlign:"right",color:"#84cc16",fontWeight:600}}> 
                        {(b.totalEGP/1000).toFixed(1)}K 
                      </td> 
                    </tr> 
                  )), 
                ])} 

                <tr style={{background:C.green + "18",borderTop:"2px solid " + C.green}}> 
                  <td colSpan={5} style={{padding:"9px 10px",color:C.green,fontWeight:800}}> 
                    Grand Total (per villa) 
                  </td> 
                  <td style={{padding:"9px 10px",textAlign:"right",color:C.green,fontWeight:800,fontSize:14}}> 
                    {fmtE(grandTotal)} 
                  </td> 
                </tr> 
                <tr style={{background:C.green + "08"}}> 
                  <td colSpan={5} style={{padding:"7px 10px",color:C.muted,fontSize:11}}> 
                    {inp.nVillas} Villa{inp.nVillas > 1 ? "s" : ""} Total 
                  </td> 
                  <td style={{padding:"7px 10px",textAlign:"right",color:C.green,fontWeight:800,fontSize:13}}> 
                    {fmtE(grandTotal * inp.nVillas)} 
                  </td> 
                </tr> 
              </tbody> 
            </table> 
          </div> 
        </div> 
      </div> 
    ); 
  }; 

  // -- 📄 PROPOSAL 

  // QR / SHA-256 hash display helper (rendered in proposal footer)
  const renderQRHash = () => inputHash ? (
    <div style={{marginTop:16,padding:"10px 14px",background:C.card,borderRadius:8,
      border:`1px solid ${C.border}`,textAlign:"center"}}>
      <div style={{fontSize:10,color:C.muted,marginBottom:4}}>
        Input verification hash (SHA-256 truncated to 64 bits)
      </div>
      <div style={{fontFamily:"monospace",fontSize:14,fontWeight:700,
        color:C.accent,letterSpacing:2}}>{inputHash}</div>
      <div style={{fontSize:9,color:C.muted,marginTop:4}}>
        Share with client to verify design parameters have not changed after proposal delivery.
      </div>
    </div>
  ) : null;

  const renderProposal = () => { 
    if (!r) return <div style={{color:C.muted,padding:20}}>Select components first.</div>; 
    const sections = propText 
      ? propText.split("###").filter(s => s.trim()) 
      : []; 
    return ( 
      <div> 
        <div style={cardS(C.pink)}> 
          <div style={{padding:"12px 16px",color:"white",fontWeight:800,fontSize:13, 
            display:"flex",justifyContent:"space-between",alignItems:"center"}}> 
            <span>AI-Generated Client Proposal</span> 
            <div style={{display:"flex",gap:8}}> 
              <button onClick={handleGenerateProposal} disabled={propLoading} 
                style={{padding:"7px 18px",background:propLoading?C.border:C.pink, 
                color:propLoading?C.muted:"white",border:"none",borderRadius:8, 
                fontWeight:800,fontSize:12,cursor:propLoading?"not-allowed":"pointer"}}> 
                {propLoading ? "Generating..." : "Generate Proposal"} 
              </button> 
              {propText && ( 
                <button onClick={() => window.print()} 

 
                  style={{padding:"7px 14px",background:C.green + "22", 
                  border:"1px solid " + C.green,color:C.green,borderRadius:8, 
                  fontSize:12,fontWeight:700,cursor:"pointer"}}> 
                  Print / PDF 
                </button> 
              )} 
            </div> 
          </div> 
          {!propText && !propLoading && ( 
            <div style={{padding:"30px",textAlign:"center",color:C.muted,fontSize:12}}> 
              Click Generate Proposal to create an AI-written client proposal using your design data. 
            </div> 
          )} 
          {propLoading && ( 
            <div style={{padding:"30px",textAlign:"center",color:C.pink,fontSize:13}}> 
              Writing proposal using Claude AI... 
            </div> 
          )} 
        </div> 
        {propText && ( 
          <div style={{background:"white",borderRadius:12,padding:"40px",color:"#1a1a2e", 
            fontFamily:"Georgia,serif",lineHeight:1.8}}> 
            <div style={{borderBottom:"3px solid #22d3ee",paddingBottom:20,marginBottom:28}}> 
              <div style={{fontSize:22,fontWeight:900,color:"#0a0f1e"}}> 
                {inp.companyName || "SolarTech Egypt"} 
              </div> 
              <div style={{fontSize:11,color:"#64748b",marginTop:4,letterSpacing:1.5, 
                textTransform:"uppercase"}}>Professional Solar Energy Solutions</div> 
              <div style={{marginTop:16,display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}> 
                <div> 
                  <div style={{fontSize:11,color:"#64748b",textTransform:"uppercase",letterSpacing:1}}>Prepared 
for</div> 
                  <div style={{fontSize:16,fontWeight:800,color:"#0a0f1e",marginTop:2}}> 
                    {inp.clientName || "Client"} 
                  </div> 
                  <div style={{fontSize:12,color:"#475569",marginTop:2}}>{inp.address}</div>
                  {(inp.lat||inp.lon) && (
                    <div style={{fontSize:10,color:"#94a3b8",marginTop:2}}>
                      {(inp.lat||0).toFixed(4)}°N, {(inp.lon||0).toFixed(4)}°E
                      {inp.elevationM != null && ` · ${Math.round(inp.elevationM)} m ASL`}
                    </div>
                  )}
                </div> 
                <div style={{textAlign:"right"}}> 
                  <div style={{fontSize:11,color:"#64748b",textTransform:"uppercase",letterSpacing:1}}>Prepared by</div> 
                  <div style={{fontSize:14,fontWeight:700,color:"#0a0f1e",marginTop:2}}> 
                    {inp.engineer || "Engineer"} 
                  </div> 

                  <div style={{fontSize:12,color:"#475569",marginTop:2}}>Ref: {inp.projectRef}</div> 
                  <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}> 
                    {new Date().toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"})} 
                  </div> 
                </div> 
              </div> 
            </div> 
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10, 
              marginBottom:28,padding:14,background:"#f8fafc",borderRadius:8}}> 
              {[ 
                {l:"System Size",     v:r.actKwp.toFixed(1) + " kWp"}, 
                {l:`Annual Yield (${inp.yieldMode==="p90"?"P90":"P50"})`, v:(yGen/1000).toFixed(1) + " MWh"}, 
                {l:"Self-Consumption",v:(r.annSCPct||r.profileSCPct||0).toFixed(0) + "%"}, 
                {l:"Payback Period",  v:r.pb ? r.pb + " Years" : ">25 Yrs"}, 
                {l:"25-Year IRR",     v:r.irr + "%"}, 
              ].map(k => ( 
                <div key={k.l} style={{textAlign:"center"}}> 
                  <div style={{fontSize:9,color:"#94a3b8",textTransform:"uppercase",letterSpacing:1}}>{k.l}</div> 
                  <div style={{fontSize:16,fontWeight:800,color:"#22d3ee",marginTop:2}}>{k.v}</div> 
                </div> 
              ))} 
            </div> 
            {sections.map((sec, i) => { 
              const lines = sec.trim().split("\n"); 
              const title = lines[0].trim(); 
              const body  = lines.slice(1).join("\n").trim(); 
              return ( 
                <div key={i} style={{marginBottom:22}}> 
                  <div style={{fontSize:13,fontWeight:800,color:"#22d3ee", 
                    textTransform:"uppercase",letterSpacing:1.5,marginBottom:8, 
                    paddingBottom:6,borderBottom:"1px solid #e2e8f0"}}> 
                    {title} 
                  </div> 
                  <div style={{fontSize:13,color:"#334155",whiteSpace:"pre-wrap"}}>{body}</div> 
                </div> 
              ); 
            })} 
            <div style={{marginTop:36,paddingTop:18,borderTop:"2px solid #e2e8f0",
              display:"flex",justifyContent:"space-between",fontSize:10,color:"#94a3b8"}}>
              <span>{inp.companyName} · {inp.engineer}</span>
              <span>Ref: {inp.projectRef} · {new Date().toLocaleDateString()}</span>
              <span>EgyptERA Compliant · {r.actKwp.toFixed(1)} kWp</span>
            </div>
            {/* SHA-256 input verification hash */}
            {renderQRHash()}
          </div> 

        )} 
      </div> 
    ); 
  }; 

  // -- Router 


  // B4/C5: Monthly soiling profile editor (inside App so upd() is in scope) 
  function renderSoilingEditor() { 
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; 
    const profile = inp.soilProfile || CAIRO_SOILING; 
    return ( 
      <div style={{background:C.card,borderRadius:10,padding:"14px 16px",marginBottom:12, 
        border:`1px solid ${C.border}`}}> 
        <div style={{fontSize:11,color:C.yellow,textTransform:"uppercase",letterSpacing:1, 
          fontWeight:700,marginBottom:10}}>🌫 Monthly Soiling Schedule (% loss) — B4</div> 
        <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:6,marginBottom:8}}> 
          {MONTHS.map((m,i)=>( 
            <div key={m} style={{textAlign:"center"}}> 
              <div style={{fontSize:9,color:C.muted,marginBottom:2}}>{m}</div> 
              <input type="number" min="0" max="30" step="0.5" 
                value={+(Math.round((profile[i]||0.02)*100*10)/10).toFixed(1)} 
                onChange={e=>{ 
                  const p=[...profile]; 
                  p[i]=Math.max(0,parseFloat(e.target.value)||0)/100; 
                  upd("soilProfile",p); 
                }} 
                style={{width:"100%",textAlign:"center",background:"#0f172a", 
                  border:`1px solid ${C.border}`,borderRadius:4,color:C.text, 
                  fontSize:12,padding:"4px 2px"}}/> 
            </div> 
          ))} 
        </div> 
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:6}}> 
          <div style={{fontSize:10,color:C.muted}}> 
            Default soiling profile. Customize for your site's dust and pollution patterns.
          </div> 
          <button onClick={()=>upd("soilProfile",[...CAIRO_SOILING])} 
            style={{padding:"4px 12px",background:"#1e293b",border:`1px solid ${C.border}`, 
            borderRadius:6,color:C.muted,cursor:"pointer",fontSize:11}}>Reset to Default</button> 
        </div> 
      </div> 
    ); 
  } 

 
 
  // C4: Cable summary card for Ph6 Wiring tab 
  function renderCableSummary() { 
    if(!r) return null; 
    return ( 
      <div style={{background:C.card,borderRadius:10,padding:"14px 16px",marginBottom:12, 
        border:`1px solid ${C.border}`}}> 
        <div style={{fontSize:11,color:C.green,textTransform:"uppercase",letterSpacing:1, 
          fontWeight:700,marginBottom:10}}>🔌 Recommended Cable Sizes (IEC 60364-5-52 · E7)</div> 
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8,marginBottom:8}}> 
          {[ 
            {l:"DC String",  v:`${r.csaStr||4} mm²`,  sub:`${r.nStr||1} run × ${Math.round((inp.lenStringM||25)*2)}m`, c:C.yellow}, 
            {l:"DC Feeder",  v:`${r.csaFdr||16} mm²`, sub:`${Math.round((inp.lenFeederM||15)*2)}m total`,                c:C.orange}, 
            {l:"AC Output",  v:`${r.csaAC||10} mm²`,  sub:`${Math.round((inp.lenACM||20)*3)}m (3-ph)`,                  c:C.green}, 
            {l:"Battery DC", v:"35 mm²",               sub:`${Math.round((inp.lenBatteryM||3)*2)}m`,                     c:C.blue}, 
          ].map(k=>( 
            <div key={k.l} style={{background:"#0f172a",borderRadius:8,padding:"10px 12px", 
              borderLeft:`3px solid ${k.c}`}}> 
              <div style={{fontSize:10,color:C.muted,marginBottom:2}}>{k.l}</div> 
              <div style={{fontSize:20,fontWeight:800,color:k.c}}>{k.v}</div> 
              <div style={{fontSize:10,color:C.muted,marginTop:2}}>{k.sub}</div> 
            </div> 
          ))} 
        </div> 
        <div style={{fontSize:10,color:C.muted,fontFamily:"monospace"}}> 
          ρ_DC=0.0206 Ω·mm²/m @70°C · ρ_AC=0.0199 @60°C · VD limits: DC ≤1.5% · AC ≤2.0% 
          {r.csaStr ? ` · From Isc=${r.iStr?.toFixed(1)}A string current` : ""} 
        </div> 
      </div> 
    ); 
  } 

  const renderers = { 
    projects:renderProjects, 
    library:renderLibrary, recommend:renderRecommend, coverage:renderCoverage, 
    dashboard:renderDashboard, solar:()=><>{renderSolar()}{renderSolarAdditions()}</>, 
    load:renderLoad, p3:renderP3, p4:renderP4, p5:renderP5, p6:()=><>{renderCableSummary()}{renderP6()}</>, 
    sld:renderSLD, bom:renderBOM, 
    optimizer:renderOptimiser, financial:()=><>{renderFinancial()}{renderSensitivity()}</>, 

 
 
    proposal:renderProposal, inputs:renderInputs, 
  }; 

  return (
    <div style={{background:C.bg,minHeight:"100vh",color:C.text,
      fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      {/* Print styles — injected once, only active on window.print() */}
      <style>{`@media print {body { background: #fff !important; color: #000 !important; }.no-print { display: none !important; }.print-only { display: block !important; }.print-page-break { page-break-before: always; }#solar-print-area { display: block !important; }* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }}@media screen { #solar-print-area { display: none; } .print-only { display: none; } }`}</style>
      {/* Global tooltip overlay */}
      {tooltip.visible && (
        <div style={{position:"fixed",left:tooltip.x,top:tooltip.y,transform:"translate(-50%,-100%)",
          zIndex:9999,background:"#1e293b",color:C.text,padding:"6px 10px",borderRadius:8,
          fontSize:11,maxWidth:280,lineHeight:1.5,pointerEvents:"none",
          border:`1px solid ${C.border}`,boxShadow:"0 4px 12px #0008"}}>
          {tooltip.text}
          <div style={{position:"absolute",left:"50%",bottom:-5,transform:"translateX(-50%)",
            width:8,height:8,background:"#1e293b",border:`1px solid ${C.border}`,
            borderTop:"none",borderLeft:"none",rotate:"45deg"}}/>
        </div>
      )}

      {/* -- Top bar: company + project title -- */}
      <div style={{padding:"10px 16px",borderBottom:`1px solid ${C.border}`,
        background:"#0a0f1a",display:"flex",alignItems:"center",
        justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:9,color:C.muted,letterSpacing:2,textTransform:"uppercase"}}>
            Solar Design Platform v5.2 · {inp.companyName||"SolarTech Egypt"} · ±2–3% PVsyst accuracy
          </div>
          <div style={{fontSize:18,fontWeight:900,color:"white",marginTop:2}}>
            {inp.projectRef||"Hybrid Solar PV"}
            <span style={{fontSize:12,color:C.muted,fontWeight:400}}> — {inp.clientName}</span>
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <div style={{fontSize:10,padding:"4px 12px",borderRadius:20,whiteSpace:"nowrap",
            background:pvgisStatus==="done"?`${C.green}22`:pvgisStatus==="loading"?`${C.yellow}22`:`${C.border}`,
            color:pvgisStatus==="done"?C.green:pvgisStatus==="loading"?C.yellow:C.muted,
            border:`1px solid ${pvgisStatus==="done"?C.green:pvgisStatus==="loading"?C.yellow:C.border}`}}>
            {pvgisStatus==="loading"?"⏳ Fetching PVGIS data…":pvgisStatus==="done"?"✓ PVGIS ERA5 hourly":"○ No PVGIS — using monthly fallback"}
          </div>
          <button className="no-print" onClick={()=>{
            document.title = (inp.projectRef||"Solar PV")+" — "+inp.clientName;
            window.print();
          }}
            style={{fontSize:10,padding:"4px 12px",borderRadius:20,border:"none",
              cursor:"pointer",fontWeight:700,background:C.card,color:C.muted,
              whiteSpace:"nowrap",transition:"all 0.15s"}}
            onMouseEnter={e=>e.target.style.color=C.text}
            onMouseLeave={e=>e.target.style.color=C.muted}>
            🖨 Export PDF
          </button>
        </div>
      </div>

      {/* -- Persistent summary bar -- */}
      {r && (
        <div style={{background:"#0d1526",borderBottom:`1px solid ${C.border}`,
          display:"flex",flexWrap:"wrap",alignItems:"stretch"}}>
          {/* P50/P90 toggle */}
          <div style={{padding:"6px 14px",borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",gap:4,justifyContent:"center"}}>
            <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:1}}>Yield basis</div>
            <div style={{display:"flex",gap:4}}>
              {[{v:"p50",l:"P50"},{v:"p90",l:"P90"}].map(m=>(
                <button key={m.v} onClick={()=>upd("yieldMode",m.v)}
                  style={{padding:"3px 10px",borderRadius:20,border:"none",cursor:"pointer",fontSize:11,fontWeight:700,
                  background:inp.yieldMode===m.v?C.yellow:C.card,
                  color:inp.yieldMode===m.v?C.bg:C.muted}}>
                  {m.l}
                </button>
              ))}
            </div>
          </div>
          {(()=>{
            const yGen = inp.yieldMode==="p90" ? r.annGenP90 : r.annGenTMY;
            return [
              {label:"System",        value:`${r.actKwp.toFixed(1)} kWp`,                     color:C.yellow },
              {label:`${inp.yieldMode==="p90"?"P90":"P50"} Yield`, value:`${(yGen/1000).toFixed(1)} MWh/yr`, color:inp.yieldMode==="p90"?C.yellow:C.green},
              {label:"Specific Yield", value:`${(yGen/r.actKwp).toFixed(0)} kWh/kWp`,         color:C.accent },
              {label:"Offset",         value:`${(r.coverageActual||0).toFixed(0)}%`,           color:"#22d3ee"},
              {label:"Payback",        value:r.pb?`${r.pb} yr`:">25 yr",                      color:C.orange },
              {label:"IRR",            value:`${r.irr}%`,                                      color:"#a78bfa"},
              {label:"Status",         value:r.allOk?"✓ Compatible":"⚠ Check design",         color:r.allOk?C.green:C.red},
            ];
          })().map(({label,value,color},i)=>(
            <div key={i} style={{padding:"6px 18px",borderRight:`1px solid ${C.border}`,
              display:"flex",flexDirection:"column",gap:2,minWidth:90}}>
              <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:1}}>{label}</div>
              <div style={{fontSize:13,fontWeight:800,color}}>{value}</div>
            </div>
          ))}
          {panel&&(
            <div style={{padding:"6px 18px",marginLeft:"auto",display:"flex",flexDirection:"column",gap:2}}>
              <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:1}}>Equipment</div>
              <div style={{fontSize:10,color:C.muted}}>
                <span style={{color:C.yellow}}>{panel.brand} {panel.wp}Wp{panel.bifacial?" ★Bifacial":""}</span>
                {inverter&&<span style={{color:"#8b5cf6"}}> · {inverter.brand} {inverter.acKW}kW</span>}
                {battery&&(battery.kwh===0
                  ? <span style={{color:C.muted}}> · Grid-Tied (No Storage)</span>
                  : <span style={{color:C.blue}}> · {battery.brand} {battery.kwh}kWh</span>)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* -- Two-tier navigation -- */}
      <div style={{background:"#0a0f1a",borderBottom:`1px solid ${C.border}`}}>
        {/* Group strip + client mode toggle */}
        <div style={{display:"flex",alignItems:"center",paddingLeft:8,justifyContent:"space-between"}}>
          <div style={{display:"flex"}}>
            {NAV_GROUPS
              .filter(g => !clientMode || ["results","export"].includes(g.id))
              .map(g=>{
                const active = navGroup===g.id;
                return(
                  <button key={g.id} onClick={()=>{
                    setNavGroup(g.id);
                    if(!g.tabs.find(t=>t.id===tab)) setTab(g.tabs[0].id);
                  }}
                    style={{padding:"10px 22px",border:"none",cursor:"pointer",background:"transparent",
                      color:active?g.color:C.muted,fontWeight:active?800:600,fontSize:12,
                      borderBottom:active?`3px solid ${g.color}`:"3px solid transparent",
                      transition:"all 0.15s",whiteSpace:"nowrap",
                      display:"flex",alignItems:"center",gap:6}}>
                    {g.label}
                    {(()=>{
                      const st = completeness[g.id];
                      const dot = st==="done" ? C.green : st==="partial" ? C.yellow : C.border;
                      return <span style={{width:7,height:7,borderRadius:"50%",
                        background:dot,flexShrink:0,
                        boxShadow:st==="done"?`0 0 4px ${C.green}`:undefined}}/>;
                    })()}
                  </button>
                );
              })}
          </div>
          <button onClick={()=>{ const nl=lang==="en"?"ar":"en"; setLang(nl); upd("lang",nl); }}
            style={{marginRight:6,padding:"5px 12px",borderRadius:20,border:"none",
              cursor:"pointer",fontSize:10,fontWeight:700,transition:"all 0.15s",
              background:C.card,color:C.accent,direction:"ltr"}}>
            {lang==="en"?"عربي":"English"}
          </button>
          <button onClick={()=>setClientMode(m=>!m)}
            style={{marginRight:12,padding:"5px 14px",borderRadius:20,border:"none",
              cursor:"pointer",fontSize:10,fontWeight:700,transition:"all 0.15s",
              background:clientMode?"#8b5cf6":C.card,
              color:clientMode?C.bg:C.muted}}>
            {clientMode?"✦ Client Mode ON":"○ Client Mode"}
          </button>
        </div>
        {/* Sub-tab strip */}
        <div style={{display:"flex",gap:4,padding:"6px 12px"}}>
          {(NAV_GROUPS.find(g=>g.id===navGroup)?.tabs||[])
            .filter(t => !clientMode || !["p3","p4","p5","p6","sld","inputs","optimizer"].includes(t.id))
            .map(t=>{
              const active = tab===t.id;
              const gc = NAV_GROUPS.find(g=>g.id===navGroup)?.color||C.accent;
              return(
                <button key={t.id} onClick={()=>setTab(t.id)}
                  style={{padding:"5px 12px",borderRadius:7,border:"none",cursor:"pointer",
                    fontSize:10,fontWeight:700,whiteSpace:"nowrap",transition:"all 0.15s",
                    background:active?gc:C.card, color:active?C.bg:C.muted}}>
                  {t.icon} {t.label}
                </button>
              );
            })}
        </div>
      </div>

      {/* -- Content area -- */}
      <div style={{padding:12}}>
        {renderers[tab] ? renderers[tab]() : null}
      </div>

      {/* -- Location picker modal -- */}
      {showLocationPicker && (
        <LocationPickerModal
          initialLat={inp.lat}
          initialLon={inp.lon}
          onConfirm={handleLocationPick}
          onCancel={() => setShowLocationPicker(false)}
        />
      )}
    </div>
  );
} 

 
 
