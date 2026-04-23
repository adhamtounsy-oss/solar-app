import { C } from "../constants/index.js";
import { cardS, WarnBanner } from "../components/ui/primitives.jsx";

export default function CoverageTab({ r, inp, upd, panel, yGen, fmtE, warnings }) {
  const mm = inp.mountMode || "roof";

  const MOUNT_MODES = [
    {
      id:"roof", icon:"🏠", title:"Rooftop Only",
      desc:"Array limited to available roof area after obstructions and row-spacing constraints.",
      color:C.accent,
      detail: r ? `Cap: ${r.roofPanelCap} panels · ${((r.roofPanelCap*(panel?.wp||580))/1000).toFixed(1)} kWp` : null,
    },
    {
      id:"hybrid", icon:"🏠+🌱", title:"Roof + Ground Mount",
      desc:"Roof panels supplemented by additional ground-mounted array on site. Specify ground area below.",
      color:C.green,
      detail: r ? `Roof: ${r.roofPanelCap}p + Ground: ${r.groundPanelCap}p = ${r.totalPanelCap}p total` : null,
    },
    {
      id:"ground", icon:"🌱", title:"Ground Mount Only",
      desc:"No rooftop constraint. Array sized freely against available ground area. Row spacing still enforced.",
      color:C.yellow,
      detail: r ? `Ground cap: ${r.groundPanelCap} panels · ${((r.groundPanelCap*(panel?.wp||580))/1000).toFixed(1)} kWp` : null,
    },
  ];

  return (
    <div>
      <WarnBanner warnings={warnings} scope="sizing" />

      {/* Mount Mode Selector */}
      <div style={{marginBottom:16}}>
        <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1.2,
          fontWeight:700,marginBottom:10}}>⚙ System Configuration — Panel Placement</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:10}}>
          {MOUNT_MODES.map(m => {
            const active = mm === m.id;
            return (
              <div key={m.id} onClick={() => upd("mountMode", m.id)}
                style={{background:active?`${m.color}14`:C.card,borderRadius:12,padding:"14px 16px",
                cursor:"pointer",border:`2px solid ${active?m.color:C.border}`,
                transition:"all 0.15s",position:"relative"}}>
                {active && <div style={{position:"absolute",top:10,right:12,width:8,height:8,
                  borderRadius:"50%",background:m.color}}/>}
                <div style={{fontSize:20,marginBottom:6}}>{m.icon}</div>
                <div style={{fontWeight:800,fontSize:13,color:active?m.color:C.text,marginBottom:5}}>{m.title}</div>
                <div style={{fontSize:11,color:C.muted,lineHeight:1.5,marginBottom:m.detail?8:0}}>{m.desc}</div>
                {m.detail && active && (
                  <div style={{fontSize:10,color:m.color,fontWeight:700,marginTop:4,
                    padding:"4px 8px",background:`${m.color}18`,borderRadius:6,display:"inline-block"}}>
                    {m.detail}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {(mm==="hybrid" || mm==="ground") && (
          <div style={{marginTop:12,padding:"14px 16px",background:C.card,borderRadius:10,
            border:`2px solid ${mm==="hybrid"?C.green:C.yellow}`}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,alignItems:"center"}}>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:mm==="hybrid"?C.green:C.yellow,marginBottom:4}}>
                  {mm==="hybrid" ? "🌱 Additional Ground Area" : "🌱 Total Ground Area"}
                </div>
                <div style={{fontSize:11,color:C.muted,lineHeight:1.5}}>
                  {mm==="hybrid"
                    ? "Extra area beyond the roof — garden, driveway, or side yard (m²)"
                    : "Total available ground area for the array (m²)"}
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <input type="number" value={inp.groundAreaM2||0} min={0} step={10}
                  onChange={e => upd("groundAreaM2", parseFloat(e.target.value)||0)}
                  style={{width:"100%",background:"#0f172a",
                  border:`2px solid ${mm==="hybrid"?C.green:C.yellow}`,
                  borderRadius:8,color:mm==="hybrid"?C.green:C.yellow,
                  fontSize:18,fontWeight:800,padding:"10px 14px",textAlign:"right"}}/>
                <span style={{color:C.muted,fontSize:12,flexShrink:0}}>m²</span>
              </div>
            </div>
            {r && inp.groundAreaM2 > 0 && (
              <div style={{marginTop:10,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:8}}>
                {[
                  {l:"Ground rows",  v:`${r.gMaxRows??0}`,                                                c:mm==="hybrid"?C.green:C.yellow},
                  {l:"Panels/row",   v:`${r.gPanelsPerRow??0}`,                                           c:mm==="hybrid"?C.green:C.yellow},
                  {l:"Ground cap",   v:`${r.groundPanelCap} panels`,                                      c:mm==="hybrid"?C.green:C.yellow},
                  {l:"Ground kWp",   v:`${((r.groundPanelCap*(panel?.wp||580))/1000).toFixed(1)} kWp`,    c:mm==="hybrid"?C.green:C.yellow},
                ].map(k => (
                  <div key={k.l} style={{background:"#0f172a",borderRadius:8,padding:"8px 10px"}}>
                    <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",marginBottom:2}}>{k.l}</div>
                    <div style={{fontSize:13,fontWeight:800,color:k.c}}>{k.v}</div>
                  </div>
                ))}
              </div>
            )}
            {mm==="hybrid" && r && (
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
            {mm==="ground" && r && (
              <div style={{marginTop:10,padding:"8px 12px",background:"#0f172a",borderRadius:8,
                fontSize:11,color:C.muted,borderLeft:`3px solid ${C.yellow}`}}>
                Row spacing enforced: min pitch <strong style={{color:C.yellow}}>{r.minPitch?.toFixed(2)}m</strong>
                &nbsp;→&nbsp;<strong style={{color:C.yellow}}>{r.maxRows} rows × {r.panelsPerRow} panels</strong>.
                Increase ground area to accommodate more rows.
              </div>
            )}
          </div>
        )}

        {mm==="roof" && r && r.roofCapped && (
          <div style={{marginTop:10,padding:"12px 14px",background:`${C.red}12`,borderRadius:10,
            border:`2px solid ${C.red}44`,display:"flex",justifyContent:"space-between",
            alignItems:"center",flexWrap:"wrap",gap:10}}>
            <div>
              <div style={{fontWeight:800,color:C.red,fontSize:12,marginBottom:3}}>
                ⚠ Roof limits array to {r.actKwp.toFixed(1)} kWp — target was {r.cappedKwp.toFixed(1)} kWp
              </div>
              <div style={{fontSize:11,color:C.muted}}>
                Actual coverage: <strong style={{color:C.orange}}>{r.coverageActual.toFixed(0)}%</strong>
                &nbsp;vs requested <strong>{r.effPct.toFixed(0)}%</strong>
                &nbsp;· Switch to <strong>Roof + Ground</strong> to meet your target
              </div>
            </div>
            <button onClick={() => upd("mountMode","hybrid")}
              style={{padding:"7px 16px",background:C.green,color:"white",border:"none",
              borderRadius:8,fontWeight:800,fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}>
              + Add Ground Area →
            </button>
          </div>
        )}
        {mm==="roof" && r && !r.roofCapped && (
          <div style={{marginTop:10,padding:"8px 12px",background:`${C.green}12`,borderRadius:8,
            fontSize:11,color:C.green,borderLeft:`3px solid ${C.green}`}}>
            ✓ Target array fits within roof — {r.maxPanelsNoShade} panels available, {r.totP} designed
          </div>
        )}
      </div>

      <div style={{marginBottom:14,padding:"1px 0"}}/>

      {/* Coverage Target Selector */}
      <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1.2,
        fontWeight:700,marginBottom:10}}>🎯 Solar Coverage Target</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
        {[
          {mode:"percentage", title:"📊 Percentage Offset",       desc:"Cover a % of total consumption."},
          {mode:"loadbased",  title:"⚡ Specific Load Coverage",  desc:"Choose which appliances run on solar."},
        ].map(m => (
          <div key={m.mode} onClick={() => upd("coverageMode", m.mode)}
            style={{background:C.card,borderRadius:10,padding:14,cursor:"pointer",
            border:`2px solid ${inp.coverageMode===m.mode?C.orange:C.border}`}}>
            <div style={{fontWeight:800,color:inp.coverageMode===m.mode?C.orange:C.text,marginBottom:6}}>{m.title}</div>
            <div style={{fontSize:11,color:C.muted}}>{m.desc}</div>
          </div>
        ))}
      </div>

      {inp.coverageMode==="percentage" && (
        <div style={cardS(C.orange)}>
          <div style={{padding:"10px 16px",color:"white",fontWeight:800}}>Solar Offset Target</div>
          <div style={{padding:"16px 20px"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <span style={{color:C.muted,fontSize:12}}>Offset %</span>
              <span style={{fontSize:26,fontWeight:900,color:C.orange}}>{inp.offsetPct}%</span>
            </div>
            <input type="range" min={20} max={100} step={5} value={inp.offsetPct}
              onChange={e => upd("offsetPct", parseInt(e.target.value))}
              style={{width:"100%",accentColor:C.orange}}/>
            <div style={{display:"flex",gap:8,marginTop:8,flexWrap:"wrap"}}>
              {[20,40,60,80,100].map(p => (
                <button key={p} onClick={() => upd("offsetPct", p)}
                  style={{padding:"4px 12px",borderRadius:6,cursor:"pointer",fontSize:12,
                  border:`1px solid ${inp.offsetPct===p?C.orange:C.border}`,
                  background:inp.offsetPct===p?`${C.orange}22`:"transparent",
                  color:inp.offsetPct===p?C.orange:C.muted,fontWeight:inp.offsetPct===p?700:400}}>{p}%</button>
              ))}
            </div>
            {r && (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8,marginTop:14}}>
                {[
                  {l:r.roofCapped?"Roof-limited ⚠":"Solar-supplied", v:r.roofCapped?`${r.coverageActual.toFixed(0)}% coverage`:`${r.solarKwh.toFixed(0)} kWh/d`, c:r.roofCapped?C.red:C.orange},
                  {l:"Grid-supplied",v:`${(r.loadTot-r.solarKwh).toFixed(0)} kWh/d`,      c:C.blue},
                  {l:"Array",        v:`${r.actKwp.toFixed(1)} kWp`,                       c:C.yellow},
                  {l:`Annual (${inp.yieldMode==="p90"?"P90":"P50"})`,v:`${(yGen/1000).toFixed(1)} MWh`, c:inp.yieldMode==="p90"?C.yellow:C.green},
                  {l:"Payback",      v:r.pb?`${r.pb} yrs`:">25",                           c:C.green},
                  {l:"25yr gain",    v:fmtE(r.netGain),                                    c:C.green},
                ].map(k => (
                  <div key={k.l} style={{background:"#0f172a",borderRadius:8,padding:"10px 12px",borderLeft:`3px solid ${k.c}`}}>
                    <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>{k.l}</div>
                    <div style={{fontSize:15,fontWeight:800,color:k.c}}>{k.v}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {inp.coverageMode==="loadbased" && (
        <div style={cardS(C.orange)}>
          <div style={{padding:"10px 16px",color:"white",fontWeight:800}}>Select Solar-Priority Loads</div>
          <div style={{padding:"16px 20px",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:8}}>
            {[
              {k:"solarAC",l:"❄ AC"},{k:"solarLighting",l:"💡 Lighting"},
              {k:"solarWH",l:"🚿 Water Heating"},{k:"solarKitchen",l:"🍳 Kitchen"},
              {k:"solarLaundry",l:"👗 Laundry"},{k:"solarPool",l:"🏊 Pool"},{k:"solarMisc",l:"🔌 Misc"},
            ].map(({k,l}) => {
              const on  = inp[k];
              const kwh = r?.loadMap?.[l.replace(/^[^ ]+ /,"")]?.kWh || 0;
              return (
                <div key={k} onClick={() => upd(k, !on)}
                  style={{background:"#0f172a",borderRadius:10,padding:"12px 14px",cursor:"pointer",
                  border:`2px solid ${on?C.orange:C.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <span style={{fontWeight:700,color:on?C.orange:C.muted,fontSize:12}}>{l}</span>
                    <div style={{width:18,height:18,borderRadius:5,background:on?C.orange:C.border,
                      display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"white"}}>{on?"✓":""}</div>
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
            onChange={e => upd("batEveningCovPct", parseInt(e.target.value))}
            style={{width:"100%",accentColor:C.blue}}/>
          {r && (
            <div style={{marginTop:10,padding:"8px 12px",background:"#0f172a",borderRadius:8,fontSize:11,color:C.muted}}>
              Profile evening deficit: <strong style={{color:C.blue}}>{r.eveningDeficit.toFixed(1)} kWh</strong>
              &nbsp;·&nbsp;Battery target: <strong style={{color:C.accent}}>{(r.eveningDeficit*(inp.batEveningCovPct/100)).toFixed(1)} kWh</strong>
              &nbsp;·&nbsp;Available: <strong style={{color:r.usableBat>=r.eveningDeficit*(inp.batEveningCovPct/100)?C.green:C.red}}>{r.usableBat.toFixed(1)} kWh</strong>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
