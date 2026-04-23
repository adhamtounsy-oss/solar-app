import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { C, CAIRO_TMY_FALLBACK, DESIGN_PSH, CAIRO_SOILING, P90_FACTOR, SIGMA_IRR, SIGMA_MODEL, SIGMA_TOT, WIN_HRS, WIN_START, WIN_END } from "./constants/index.js";
import { I18N, T } from "./i18n/index.js";
import { SAMPLE_PANELS, SAMPLE_INVERTERS, SAMPLE_BATTERIES } from "./data/components.js";
import { COUNTRY_DATA, applyCountryProfile } from "./data/countryData.js";
import { NAV_GROUPS, DEF } from "./config/nav.js";
import { EGYPT_TARIFF_TIERS, tieredMonthlySaving } from "./lib/financial.js";
import { saveProject, loadProject, listProjects, deleteProject } from "./lib/storage.js";
import { cellTempFaiman, lowIrradianceFactor, solarCosIncidence, iamBeam, fitOneDiodeParams, translateOneDiode, solveMPP_norm, kimberSoiling } from "./lib/physics.js";
import { parseSmartMeterCSV, parsePVGISJson, parsePANFile, parseONDFile, fetchPVGIS } from "./lib/parsers.js";
import { runHourlyDispatch } from "./lib/dispatch.js";
import { computeLoadProfile, seasonalAcScale, computeEtaSys, slotsFromFractions, fractionsFromSlots, initAllSlots } from "./lib/profile.js";
import LoadTab from "./tabs/LoadTab.jsx";
import ProjectsTab from "./tabs/ProjectsTab.jsx";
import InputsTab from "./tabs/InputsTab.jsx";
import DashboardTab from "./tabs/DashboardTab.jsx";
import LibraryTab from "./tabs/LibraryTab.jsx";
import RecommendTab from "./tabs/RecommendTab.jsx";
import P3Tab from "./tabs/P3Tab.jsx";
import P4Tab from "./tabs/P4Tab.jsx";
import P5Tab from "./tabs/P5Tab.jsx";
import P6Tab from "./tabs/P6Tab.jsx";
import CoverageTab from "./tabs/CoverageTab.jsx";
import OptimizerTab from "./tabs/OptimizerTab.jsx";
import FinancialTab from "./tabs/FinancialTab.jsx";
import SldTab from "./tabs/SldTab.jsx";
import BomTab from "./tabs/BomTab.jsx";
import ProposalTab from "./tabs/ProposalTab.jsx";
import SolarTab from "./tabs/SolarTab.jsx";
import { passColor, cardS, tbl, SH, Row, Calc, Bar, TblHead, WarnBanner } from "./components/ui/primitives.jsx";
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
  const Ng   = inp.ng != null ? inp.ng : 2.0;  // site ground flash density (fl/km²/yr)
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
  const [loadSlots,setLoadSlots]     = useState(()=>initAllSlots(DEF)); // 48-slot time-of-day selections
  const loadDragRef  = useRef(null); // {pk, mode:'select'|'deselect', working:{[pk]:bool[]}}

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

  const handleLocationPick = useCallback((newLat, newLon, name, elev, cc) => {
    setInp(prev => {
      const countryPatch = applyCountryProfile(cc, prev);
      return {
        ...prev,
        ...countryPatch,
        lat:          newLat,
        lon:          newLon,
        locationName: name || "",
        elevationM:   elev ?? null,
        // Auto-fill address from reverse geocode only when blank or still factory default
        address: (!prev.address || prev.address === DEF.address)
          ? (name || prev.address)
          : prev.address,
      };
    });
    setShowLocationPicker(false);
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

 
 
 
 
      if (state.inp)      { setInp(state.inp); setLoadSlots(initAllSlots(state.inp)); }
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

  // -- Clear load-slot drag on global mouseup ---------------------------------
  useEffect(()=>{
    const up=()=>{ loadDragRef.current=null; };
    window.addEventListener('mouseup',up);
    return ()=>window.removeEventListener('mouseup',up);
  },[]);

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
  const cs   = inp.currencySymbol || "E£";  // active currency symbol
  const fmtE = v => cs + (v/1000).toFixed(0) + "K";
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

  // -- ☀ SOLAR TAB ------------------------------------------------

  const renderSolar = () => (
    <SolarTab r={r} inp={inp} upd={upd} panel={panel} yGen={yGen}
      pvgisStatus={pvgisStatus} pvgisData={pvgisData} pvgisMsg={pvgisMsg}
      handleFetchPVGIS={handleFetchPVGIS} setShowLocationPicker={setShowLocationPicker}
      yieldDist={yieldDist} nasaWarning={nasaWarning} sweepResult={sweepResult}
      showTip={showTip} hideTip={hideTip} />
  );


  // -- EQUIPMENT LIBRARY TAB -------------------------------- 
  const renderLibrary = () => (
    <LibraryTab
      r={r} inp={inp}
      panel={panel} inverter={inverter} battery={battery}
      selPanel={selPanel} setSelPanel={setSelPanel} panelLib={panelLib}
      selInv={selInv}     setSelInv={setSelInv}     invLib={invLib}
      selBat={selBat}     setSelBat={setSelBat}     batLib={batLib}
      fmtE={fmtE}
      handleFile={handleFile} uploadMsg={uploadMsg}
      showCmp={showCmp} setShowCmp={setShowCmp}
    />
  );

  // -- COVERAGE TAB ----------------------------------------- 
  const renderCoverage = () => (
    <CoverageTab r={r} inp={inp} upd={upd} panel={panel} yGen={yGen} fmtE={fmtE} warnings={warnings} />
  );

  // -- DASHBOARD -------------------------------------------- 
  const renderDashboard = () => (
    <DashboardTab r={r} inp={inp} panel={panel} inverter={inverter} battery={battery} cs={cs} yGen={yGen} fmtE={fmtE} />
  );

  // -- PHASE TABS -------------------------------------------- 
  const renderLoad=()=>(
    <LoadTab
      r={r} inp={inp} upd={upd} profile={profile} cs={cs}
      meterData={meterData} setMeterData={setMeterData}
      meterMsg={meterMsg} setMeterMsg={setMeterMsg}
      handleMeterCSV={handleMeterCSV}
      loadSlots={loadSlots} setLoadSlots={setLoadSlots}
      loadDragRef={loadDragRef}
    />
  );

  // E5: Optimal tilt sweep — uses monthly TMY PSH × days for annual yield estimate 


  const renderP3 = () => (
    <P3Tab r={r} panel={panel} inverter={inverter} inp={inp} yGen={yGen} warnings={warnings} />
  );

 
  const renderP4 = () => (
    <P4Tab r={r} battery={battery} inverter={inverter} inp={inp} />
  );

  const renderP5 = () => (
    <P5Tab r={r} inverter={inverter} panel={panel} battery={battery} />
  );

  const renderP6 = () => (
    <P6Tab r={r} inp={inp} />
  );


  // -- Optimizer NPV Card ------------------------------------------------------
  const renderOptimiser = () => (
    <OptimizerTab r={r} inp={inp} cs={cs} fmtE={fmtE} optData={optData} optimNpv={optimNpv} />
  );

  const renderFinancial = () => (
    <FinancialTab r={r} inp={inp} upd={upd} cs={cs} fmtE={fmtE} fmtU={fmtU} />
  );

  const renderInputs = () => (
    <InputsTab inp={inp} upd={upd} r={r} usdRateLive={usdRateLive} />
  );

  // -- RECOMMENDATIONS (unchanged logic, updated display) ---- 
  const renderRecommend = () => (
    <RecommendTab
      recommendations={recommendations} compatibleRecs={compatibleRecs} rejectedRecs={rejectedRecs}
      selPanel={selPanel} setSelPanel={setSelPanel} panelLib={panelLib}
      selInv={selInv}     setSelInv={setSelInv}     invLib={invLib}
      selBat={selBat}     setSelBat={setSelBat}     batLib={batLib}
      locked={locked} setLocked={setLocked}
      rankMode={rankMode} setRankMode={setRankMode}
      fmtE={fmtE}
    />
  );

  // -- 💾 PROJECTS 

  const renderProjects = () => (
    <ProjectsTab inp={inp} upd={upd} projects={projects} projName={projName} setProjName={setProjName}
      saveStatus={saveStatus} handleSaveProject={handleSaveProject}
      handleLoadProject={handleLoadProject} handleDeleteProject={handleDeleteProject} />
  );

  // -- 📐 SLD

  const renderSLD = () => (
    <SldTab r={r} inp={inp} inverter={inverter} battery={battery}
      sldMode={sldMode} setSldMode={setSldMode} spdResult={spdResult} />
  );

  // -- 📦 BOM

  const renderBOM = () => (
    <BomTab r={r} inp={inp} panel={panel} inverter={inverter} battery={battery} fmtE={fmtE} />
  );

  // -- 📄 PROPOSAL

  const renderProposal = () => (
    <ProposalTab r={r} inp={inp} yGen={yGen} propText={propText} propLoading={propLoading}
      inputHash={inputHash} handleGenerateProposal={handleGenerateProposal} />
  );

  // -- Router 



 
 
  // C4: Cable summary card for Ph6 Wiring tab 

  const renderers = { 
    projects:renderProjects, 
    library:renderLibrary, recommend:renderRecommend, coverage:renderCoverage, 
    dashboard:renderDashboard, solar:renderSolar,
    load:renderLoad, p3:renderP3, p4:renderP4, p5:renderP5, p6:renderP6,
    sld:renderSLD, bom:renderBOM, 
    optimizer:renderOptimiser, financial:renderFinancial, 

 
 
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

 
 
