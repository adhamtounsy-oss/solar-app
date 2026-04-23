import { C, CAIRO_SOILING, SIGMA_TOT } from "../constants/index.js";
import { cardS, tbl } from "../components/ui/primitives.jsx";
import { computeEtaSys } from "../lib/profile.js";
import MiniMapPreview from "../components/MiniMapPreview.jsx";
import { perezAnnualPoa } from "../lib/irradiance.js";

function Tip({ text, showTip, hideTip }) {
  return (
    <span onMouseEnter={e=>showTip(e,text)} onMouseLeave={hideTip}
      style={{display:"inline-flex",alignItems:"center",justifyContent:"center",
        width:14,height:14,borderRadius:"50%",background:C.border,color:C.muted,
        fontSize:9,fontWeight:800,cursor:"help",marginLeft:4,flexShrink:0,
        verticalAlign:"middle",userSelect:"none"}}>
      ?
    </span>
  );
}

function SoilingEditor({ inp, upd }) {
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

function lossWaterfall(r, yGen, soilProfile) {
  if (!r) return [];
  const annPOA  = (r.tmyMonthly||[]).reduce((s,m)=>s+m.psh*m.days, 0);
  const stc     = r.actKwp * annPOA;
  const etaFixed= 0.98*0.98*0.99*0.99*0.98*0.98*0.98;
  const tempLoss= Math.max(0, stc * (1 - (r.etaSys||0.76) / etaFixed));
  const sp      = soilProfile || CAIRO_SOILING;
  const soilAvg = (r.tmyMonthly||[]).reduce((s,m,i)=>s+m.psh*m.days*(sp[i]||0.02),0)/Math.max(annPOA,1);
  const soilLoss= stc * soilAvg;
  const iamLoss2= stc * (1 - parseFloat(r.iamLoss||1));
  const fixedLoss= stc * (1 - 0.98*0.98*0.99*0.99*0.98*0.98);
  const shadeLoss= stc * (1 - parseFloat(r.shadeFactor||1)) * 0.8;
  const clipLoss = r.clippingKwh || 0;
  const delivered= yGen || 0;
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

// Perez 1990 anisotropic tilt sweep — south-facing (az=0), 0°…45° in 5° steps
// pvgisRef: parsed PVGIS result with .monthly[].{psh,days} for calibration
function optimalTiltYields(lat, pvgisRef) {
  const pvgisYield = pvgisRef?.monthly?.reduce((s, mo) => s + mo.psh * mo.days, 0) || null;
  const refPoa = perezAnnualPoa(lat, 22, 0, 1);
  const calib = pvgisYield && refPoa > 0 ? pvgisYield / refPoa : 1.0;
  return Array.from({ length: 10 }, (_, i) => {
    const tilt = i * 5;
    return { tilt, yield: Math.round(perezAnnualPoa(lat, tilt, 0, calib)) };
  });
}

export default function SolarTab({
  r, inp, upd, panel, yGen,
  pvgisStatus, pvgisData, pvgisMsg, handleFetchPVGIS,
  setShowLocationPicker,
  yieldDist, nasaWarning, sweepResult,
  showTip, hideTip,
}) {
  if (!r) return <div style={{color:C.muted,padding:20}}>Select components first.</div>;

  const maxGen  = Math.max(...r.monthlyGen.map(m=>m.gen));
  const worstMo = r.monthlyGen.reduce((a,b)=>b.gen<a.gen?b:a);
  const bestMo  = r.monthlyGen.reduce((a,b)=>b.gen>a.gen?b:a);
  const isHourly= r.tmySource==="pvgis" && r.dispatch;
  const pct     = (v,max) => Math.min(100,(v/max)*100);
  const MNAMES  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  const tip = (text) => <Tip text={text} showTip={showTip} hideTip={hideTip} />;

  // renderSolarAdditions helpers
  const wf       = lossWaterfall(r, yGen, inp.soilProfile);
  const maxVal   = wf[0]?.value || 1;
  const tiltSweep= optimalTiltYields(inp.lat||30.06, pvgisData);
  const optTilt  = tiltSweep.length ? tiltSweep.reduce((a,b)=>b.yield>a.yield?b:a,tiltSweep[0]) : null;

  // Loss waterfall SVG
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

  // Optimal tilt bar chart
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
          {' '}(current: {inp.tiltDeg}°{inp.tiltDeg===optTilt?.tilt?" ✓ optimal":""})
        </div>
      </div>
    </div>
  );

  // Obstacles card
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
            <button onClick={()=>upd("obstacles",(inp.obstacles||[]).filter((_,j)=>j!==i))}
              style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontSize:14}}>×</button>
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

  // Horizon card
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

  // Monte Carlo card
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
      </div>
    </div>
  ) : null;

  // NASA cross-check card
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

  // Tilt/azimuth sweep heatmap
  const sweepEl = sweepResult ? (() => {
    const {tilts, azimuths, grid, optTilt: sOptTilt, optAz, optYield} = sweepResult;
    const allVals = grid.flat();
    const minY = Math.min(...allVals), maxY2 = Math.max(...allVals);
    const cellW = 40, cellH = 24;
    const svgW  = azimuths.length * cellW + 60;
    const svgH  = tilts.length * cellH + 40;
    function heatColor(v) {
      const t = (v - minY) / Math.max(1, maxY2 - minY);
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
                  const isO = tilt===sOptTilt && az===optAz;
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
            Optimal: {sOptTilt}° tilt, {optAz}° azimuth → {optYield} kWh/kWp/yr
            {inp.tiltDeg===sOptTilt && (inp.azimuth||0)===optAz ? " ✓ current settings optimal" : ""}
          </div>
          <div style={{fontSize:10,color:C.muted,marginTop:2}}>
            Rows = tilt (0°–45°); Columns = azimuth from South (−=East, +=West).
            Klein (1977) isotropic sky model. Recalculates automatically when PVGIS data loads.
          </div>
        </div>
      </div>
    );
  })() : null;

  return (
    <div>
      {/* Location & PVGIS fetch */}
      <div style={cardS(C.accent)}>
        <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}>
          📡 Site Location & PVGIS Hourly Data Fetch
        </div>
        <div style={{padding:"14px 20px"}}>
          <div style={{display:"grid",gridTemplateColumns:"200px 1fr",gap:16,marginBottom:14,alignItems:"start"}}>
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
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10}}>
              {[
                {l:"Latitude (°N)",  k:"lat",     s:0.01, tip:"Decimal degrees north. Drives solar position, declination and air-mass calculations."},
                {l:"Longitude (°E)", k:"lon",     s:0.01, tip:"Decimal degrees east. Fetches site-specific PVGIS ERA5 hourly irradiance (auto on change)."},
                {l:"Tilt (°)",       k:"tiltDeg", s:1,    tip:"Inclination from horizontal. Optimal ≈ latitude × 0.76 for annual yield. Auto-updates with latitude."},
                {l:"Azimuth",        k:"azimuth", s:5,    tip:"0 = south-facing, −90 = east, +90 = west."},
              ].map(({l,k,s,tip:tipText})=>(
                <div key={k}>
                  <div style={{fontSize:10,color:C.muted,marginBottom:4,display:"flex",alignItems:"center"}}>
                    {l}{tipText&&tip(tipText)}
                  </div>
                  <input type="number" value={inp[k]||0} step={s}
                    onChange={e=>upd(k,parseFloat(e.target.value)||0)}
                    style={{width:"100%",background:"#0f172a",border:`2px solid ${C.accent}`,
                      borderRadius:8,color:C.accent,fontSize:15,fontWeight:800,
                      padding:"7px 10px",textAlign:"right",boxSizing:"border-box"}}/>
                </div>
              ))}
              {inp.elevationM != null && (
                <div>
                  <div style={{fontSize:10,color:C.muted,marginBottom:4}}>
                    Elevation (m) {tip("Site elevation above sea level — fetched automatically when you pick a location on the map.")}
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

      {/* KPI grid */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:14}}>
        {[
          {l:"Data source",       v:isHourly?"PVGIS hourly ✓":"Monthly fallback",   c:isHourly?C.green:C.yellow},
          {l:`Annual yield (${inp.yieldMode==="p90"?"P90":"P50"})`, v:`${(yGen/1000).toFixed(2)} MWh`, c:inp.yieldMode==="p90"?C.yellow:C.green},
          {l:"Self-consumption",  v:`${r.annSCPct!=null?r.annSCPct.toFixed(1):r.profileSCPct.toFixed(1)}%`, c:C.green},
          {l:"Grid import/yr",    v:isHourly?`${(r.dispatch.totalGridKwh/1000).toFixed(1)} MWh`:"—", c:C.blue},
          {l:"Export/yr",         v:isHourly?`${(r.dispatch.totalExportKwh/1000).toFixed(1)} MWh`:"—", c:C.muted},
          {l:"Bat cycles/yr",     v:isHourly?r.batCyclesYear.toFixed(0):"—",         c:C.purple},
        ].map(k=>(
          <div key={k.l} style={{background:C.card,borderRadius:10,padding:"12px 14px",borderLeft:`4px solid ${k.c}`}}>
            <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>{k.l}</div>
            <div style={{fontSize:14,fontWeight:800,color:k.c}}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Monthly generation bar chart */}
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
          <div style={{marginTop:12,padding:"8px 12px",background:"#0f172a",borderRadius:8,fontSize:10,color:C.muted,display:"flex",gap:20,flexWrap:"wrap",alignItems:"center"}}>
            <span><span style={{color:C.green}}>■</span> Best month</span>
            <span><span style={{color:C.orange}}>■</span> Design month</span>
            {isHourly&&<span><span style={{color:`${C.green}60`}}>■</span> Self-consumed (green overlay)</span>}
            <span style={{marginLeft:"auto",color:C.accent,fontWeight:700}}>
              Annual ({inp.yieldMode==="p90"?"P90":"P50"}): {(yGen/1000).toFixed(2)} MWh/yr
              {!isHourly&&<span style={{color:C.yellow}}> · Fetch PVGIS for soiling-corrected hourly simulation</span>}
            </span>
          </div>
        </div>
      </div>

      {/* Monthly table */}
      <div style={cardS(C.accent)}>
        <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}>
          {isHourly ? "📋 Monthly Energy & Site Summary" : "📋 Monthly Irradiance Table — Built-in TMY Fallback"}
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{...tbl,fontSize:11}}>
            <thead><tr style={{borderBottom:`2px solid ${C.border}`}}>
              {[
                "Month","Gen kWh",
                ...(isHourly?["SC kWh","SC%","Grid kWh","Export kWh"]:[]),
                "PSH h/day","T amb °C","T cell °C","η sys %","Soiling %","Cumul kWh"
              ].map(h=>(
                <th key={h} style={{padding:"7px 10px",textAlign:"right",color:C.muted,fontWeight:600,whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {r.monthlyGen.map((mo,mi)=>{
                const sc    = r.monthlySCArr?.[mi] || 0;
                const grid  = r.monthlyGridArr?.[mi] || 0;
                const exp   = Math.max(0, mo.gen - sc);
                const soil  = (CAIRO_SOILING[mi]*100).toFixed(0);
                const scP   = mo.gen>0?(sc/mo.gen*100).toFixed(0):"0";
                const tCell = (mo.tAmb+(panel.noct-20)*0.8);
                const etaMo = computeEtaSys(panel,mo.tAmb);
                const cumul = r.monthlyGen.slice(0,mi+1).reduce((s,m)=>s+m.gen,0);
                const isW   = mo.m===worstMo.m;
                const isB   = mo.m===bestMo.m;
                return(
                  <tr key={mo.m} style={{background:isW?`${C.orange}18`:mi%2===0?"transparent":"#070f1f",
                    borderLeft:isW?`3px solid ${C.orange}`:isB?`3px solid ${C.green}`:"3px solid transparent"}}>
                    <td style={{padding:"6px 10px",color:isW?C.orange:isB?C.green:C.text,fontWeight:isW||isB?700:400,whiteSpace:"nowrap"}}>
                      {mo.m}{isW?" ◄":""}
                    </td>
                    <td style={{padding:"6px 10px",textAlign:"right",color:C.yellow,fontWeight:600}}>{mo.gen.toFixed(0)}</td>
                    {isHourly&&<>
                      <td style={{padding:"6px 10px",textAlign:"right",color:C.green}}>{sc.toFixed(0)}</td>
                      <td style={{padding:"6px 10px",textAlign:"right",fontWeight:700,color:parseFloat(scP)>=70?C.green:parseFloat(scP)>=50?C.yellow:C.red}}>{scP}%</td>
                      <td style={{padding:"6px 10px",textAlign:"right",color:C.blue}}>{grid.toFixed(0)}</td>
                      <td style={{padding:"6px 10px",textAlign:"right",color:C.muted}}>{exp.toFixed(0)}</td>
                    </>}
                    <td style={{padding:"6px 10px",textAlign:"right",color:C.accent,fontWeight:600}}>{mo.psh}</td>
                    <td style={{padding:"6px 10px",textAlign:"right",color:C.muted}}>{mo.tAmb}</td>
                    <td style={{padding:"6px 10px",textAlign:"right",color:C.muted}}>{tCell.toFixed(1)}</td>
                    <td style={{padding:"6px 10px",textAlign:"right",color:C.muted}}>{(etaMo*100).toFixed(1)}</td>
                    <td style={{padding:"6px 10px",textAlign:"right",color:parseFloat(soil)>5?C.orange:C.muted}}>{soil}%</td>
                    <td style={{padding:"6px 10px",textAlign:"right",color:C.muted}}>{cumul.toFixed(0)}</td>
                  </tr>
                );
              })}
              <tr style={{background:`${C.yellow}15`,borderTop:`2px solid ${C.yellow}`}}>
                <td style={{padding:"8px 10px",color:C.yellow,fontWeight:800}}>ANNUAL</td>
                <td style={{padding:"8px 10px",textAlign:"right",color:C.yellow,fontWeight:800}}>{yGen.toFixed(0)}</td>
                {isHourly&&<>
                  <td style={{padding:"8px 10px",textAlign:"right",color:C.green,fontWeight:800}}>{r.dispatch.totalSCKwh.toFixed(0)}</td>
                  <td style={{padding:"8px 10px",textAlign:"right",color:C.green,fontWeight:800}}>{r.annSCPct.toFixed(1)}%</td>
                  <td style={{padding:"8px 10px",textAlign:"right",color:C.blue,fontWeight:800}}>{r.dispatch.totalGridKwh.toFixed(0)}</td>
                  <td style={{padding:"8px 10px",textAlign:"right",color:C.muted,fontWeight:800}}>{r.dispatch.totalExportKwh.toFixed(0)}</td>
                </>}
                <td style={{padding:"8px 10px"}}/><td style={{padding:"8px 10px"}}/><td style={{padding:"8px 10px"}}/><td style={{padding:"8px 10px"}}/>
                <td style={{padding:"8px 10px",textAlign:"right",color:C.muted,fontSize:10}}>avg {(CAIRO_SOILING.reduce((a,v)=>a+v,0)/12*100).toFixed(1)}%</td>
                <td style={{padding:"8px 10px",textAlign:"right",color:C.yellow,fontWeight:800}}>{yGen.toFixed(0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Battery dispatch summary */}
      {isHourly&&(
        <div style={cardS(C.purple)}>
          <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}>🔋 Battery Dispatch Summary</div>
          <div style={{padding:"12px 16px",display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
            {[
              {l:"Dec evening unmet", v:`${r.dispatch.eveningDeficits[11].toFixed(1)} kWh`, c:r.dispatch.eveningDeficits[11]<5?C.green:C.orange},
              {l:"Jul evening unmet", v:`${r.dispatch.eveningDeficits[6].toFixed(1)} kWh`,  c:r.dispatch.eveningDeficits[6]<5?C.green:C.orange},
              {l:"Battery adequate?", v:Math.max(...r.dispatch.eveningDeficits)<2?"YES ✓":"CHECK ⚠", c:Math.max(...r.dispatch.eveningDeficits)<2?C.green:C.orange},
            ].map(k=>(
              <div key={k.l} style={{background:"#0f172a",borderRadius:8,padding:"10px 12px"}}>
                <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",marginBottom:3}}>{k.l}</div>
                <div style={{fontSize:14,fontWeight:800,color:k.c}}>{k.v}</div>
              </div>
            ))}
          </div>
          <div style={{padding:"6px 16px 12px",fontSize:10,color:C.muted}}>
            Unmet evening demand = grid imports 17–22h. Cycles and throughput visible in monthly table above.
          </div>
        </div>
      )}

      {/* Solar additions: soiling editor, Monte Carlo, NASA, sweep heatmap, waterfall, tilt sweep, obstacles, horizon */}
      <SoilingEditor inp={inp} upd={upd} />
      {mcEl}
      {nasaEl}
      {sweepEl}
      {waterfallEl}
      {sweepEl ? null : tiltEl}
      {obstacleEl}
      {horizonEl}
    </div>
  );
}
