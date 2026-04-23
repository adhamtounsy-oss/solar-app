import { C } from "../constants/index.js";
import { passColor, cardS, tbl } from "../components/ui/primitives.jsx";

export default function RecommendTab({
  recommendations, compatibleRecs, rejectedRecs,
  selPanel, setSelPanel, panelLib,
  selInv,   setSelInv,   invLib,
  selBat,   setSelBat,   batLib,
  locked, setLocked,
  rankMode, setRankMode,
  fmtE,
}) {
  const top3      = compatibleRecs.slice(0, 3);
  const noCompat  = compatibleRecs.length === 0;
  const checkLabel = {
    invSizing:"Inv sizing", dcAcRatio:"DC/AC", mpptMin:"MPPT min", mpptMax:"MPPT max",
    iscPerMppt:"Isc/MPPT", batVoltage:"Bat voltage", batCharge:"Bat charge",
    batRule:"Bat rule (Circ.3)", roofFit:"Roof fit", vdStr:"DC VD", vdAC:"AC VD",
  };

  return (
    <div>
      <div style={cardS(C.pink)}>
        <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}>🔒 Lock Components</div>
        <div style={{padding:"14px 16px",fontSize:11,color:C.muted,marginBottom:8,lineHeight:1.6}}>
          Lock components already sourced. Engine recommends from <strong style={{color:C.pink}}>unlocked</strong> library entries.
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12,padding:"0 16px 16px"}}>
          {[
            {key:"panel",   icon:"☀", label:"PV Panel",  color:C.yellow, sel:selPanel, fn:setSelPanel, lib:panelLib, fmt:p=>`${p.brand} — ${p.model} (${p.wp}Wp)`},
            {key:"inverter",icon:"🔌",label:"Inverter",  color:C.purple, sel:selInv,   fn:setSelInv,   lib:invLib,   fmt:x=>`${x.brand} — ${x.model} (${x.acKW}kW)`},
            {key:"battery", icon:"🔋",label:"Battery",   color:C.blue,   sel:selBat,   fn:setSelBat,   lib:batLib,   fmt:x=>x.id==="B00"?`⚡ ${x.model}`:x.kwh?`${x.brand} — ${x.model} (${x.kwh}kWh)`:x.model},
          ].map(({key,icon,label,color,sel,fn,lib,fmt}) => {
            const isL = locked[key];
            return (
              <div key={key} style={{background:"#0f172a",borderRadius:10,padding:14,
                border:`2px solid ${isL?color:C.border}`,transition:"all .15s"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <span style={{fontWeight:800,color:isL?color:C.muted,fontSize:13}}>{icon} {label}</span>
                  <button onClick={() => setLocked(l => ({...l,[key]:!l[key]}))}
                    style={{padding:"4px 12px",borderRadius:20,cursor:"pointer",fontSize:11,fontWeight:700,
                    border:`1px solid ${isL?color:C.border}`,background:isL?`${color}22`:"transparent",
                    color:isL?color:C.muted}}>
                    {isL ? "🔒 LOCKED" : "🔓 Unlocked"}
                  </button>
                </div>
                <select value={sel} onChange={e => fn(e.target.value)}
                  style={{width:"100%",background:"#1e293b",border:`1px solid ${isL?color:C.border}`,
                  borderRadius:6,color:isL?color:C.muted,fontSize:11,padding:"6px 8px",
                  cursor:"pointer",opacity:isL?1:0.6}}>
                  {lib.map(x => <option key={x.id} value={x.id}>{fmt(x)}</option>)}
                </select>
                <div style={{marginTop:6,fontSize:10,color:isL?color:C.muted,fontWeight:isL?700:400}}>
                  {isL ? "✓ Fixed — system designed around this" : `Engine tries all ${lib.length} options`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        <span style={{fontSize:11,color:C.muted,alignSelf:"center"}}>Rank by:</span>
        {[{v:"electrical",l:"⚡ Electrical"},{v:"financial",l:"💰 Financial"},{v:"weighted",l:"🏆 Weighted (default)"}].map(m => (
          <button key={m.v} onClick={() => setRankMode(m.v)}
            style={{padding:"5px 14px",borderRadius:20,border:"none",cursor:"pointer",fontSize:11,fontWeight:700,
            background:rankMode===m.v?C.pink:C.card,color:rankMode===m.v?C.bg:C.muted}}>
            {m.l}
          </button>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:14}}>
        {[
          {l:"Combinations tested",v:recommendations.length,      c:C.accent},
          {l:"Compatible",         v:compatibleRecs.length,       c:C.green},
          {l:"Rejected",           v:rejectedRecs.length,         c:C.red},
          {l:"Locked",             v:`${Object.values(locked).filter(Boolean).length}/3`, c:C.pink},
        ].map(k => (
          <div key={k.l} style={{background:C.card,borderRadius:10,padding:"12px 14px",borderLeft:`4px solid ${k.c}`}}>
            <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>{k.l}</div>
            <div style={{fontSize:20,fontWeight:800,color:k.c}}>{k.v}</div>
          </div>
        ))}
      </div>

      {noCompat && (
        <div style={{padding:"16px 20px",background:`${C.red}18`,borderRadius:10,
          borderLeft:`4px solid ${C.red}`,marginBottom:14}}>
          <div style={{fontWeight:800,color:C.red,fontSize:14,marginBottom:8}}>⚠ No compatible combination in library</div>
          <div style={{fontSize:12,color:C.muted}}>Upload additional supplier data or unlock a component to widen the search.</div>
        </div>
      )}

      {top3.length > 0 && (
        <div style={cardS(C.pink)}>
          <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}>
            🏆 Top {top3.length} Recommendation{top3.length>1?"s":""}
          </div>
          {top3.map((rec, ri) => {
            const medals = ["🥇","🥈","🥉"];
            const isSel  = rec.p.id===selPanel && rec.inv.id===selInv && rec.bat.id===selBat;
            return (
              <div key={ri} style={{margin:"0 12px 12px",background:"#0f172a",borderRadius:10,
                padding:16,border:`2px solid ${ri===0?C.pink:C.border}`,position:"relative"}}>
                {isSel && (
                  <div style={{position:"absolute",top:10,right:14,fontSize:10,color:C.green,
                    fontWeight:800,background:`${C.green}22`,padding:"2px 8px",borderRadius:10}}>● ACTIVE</div>
                )}
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,flexWrap:"wrap"}}>
                  <span style={{fontSize:20}}>{medals[ri]}</span>
                  <div>
                    <div style={{fontWeight:800,color:ri===0?C.pink:C.text,fontSize:13}}>Recommendation #{ri+1}</div>
                    <div style={{fontSize:10,color:C.muted}}>
                      Score {rec.weighted.toFixed(0)}/100 · Elec {rec.elecScore.toFixed(0)} · {rec.pass}/{Object.keys(rec.checks).length} checks pass
                    </div>
                  </div>
                  <button onClick={() => {setSelPanel(rec.p.id); setSelInv(rec.inv.id); setSelBat(rec.bat.id);}}
                    style={{marginLeft:"auto",padding:"6px 16px",background:C.pink,color:C.bg,
                    border:"none",borderRadius:8,fontWeight:800,fontSize:12,cursor:"pointer"}}>
                    Apply →
                  </button>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:10,marginBottom:12}}>
                  {[
                    {icon:"☀",  label:"Panel",   color:C.yellow, name:`${rec.p.brand} ${rec.p.model}`,   specs:`${rec.p.wp}Wp · $${rec.p.costUSD}/W`},
                    {icon:"🔌", label:"Inverter", color:C.purple, name:`${rec.inv.brand} ${rec.inv.model}`,specs:`${rec.inv.acKW}kW · ${fmtE(rec.inv.costEGP)}`},
                    {icon:"🔋", label:"Battery",  color:C.blue,   name:`${rec.bat.brand} ${rec.bat.model}`,specs:`${rec.bat.kwh}kWh · ${fmtE(rec.bat.costEGP)}`},
                  ].map(({icon,label,color,name,specs}) => (
                    <div key={label} style={{background:C.card,borderRadius:8,padding:"10px 12px",borderLeft:`3px solid ${color}`}}>
                      <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>{icon} {label}</div>
                      <div style={{fontSize:12,fontWeight:700,color,marginBottom:3}}>{name}</div>
                      <div style={{fontSize:10,color:C.muted}}>{specs}</div>
                    </div>
                  ))}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:8,marginBottom:12}}>
                  {[
                    {l:"Array",       v:`${rec.r.actKwp.toFixed(1)} kWp`,       c:C.yellow},
                    {l:"Annual (TMY)",v:`${(rec.r.annGenTMY/1000).toFixed(1)} MWh`, c:C.green},
                    {l:"Cost",        v:fmtE(rec.r.sysC),                       c:C.red},
                    {l:"Payback",     v:rec.r.pb?`${rec.r.pb} yrs`:">25",       c:C.accent},
                    {l:"IRR",         v:`${rec.r.irr}%`,                         c:C.green},
                    {l:"25yr gain",   v:fmtE(rec.r.netGain),                    c:C.green},
                  ].map(k => (
                    <div key={k.l} style={{background:C.card,borderRadius:7,padding:"7px 10px",textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.muted,marginBottom:2}}>{k.l}</div>
                      <div style={{fontSize:13,fontWeight:800,color:k.c}}>{k.v}</div>
                    </div>
                  ))}
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                  {Object.entries(rec.checks).map(([k,v]) => (
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

      {rejectedRecs.length > 0 && (
        <div style={cardS(C.red)}>
          <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}>
            ❌ Rejected ({rejectedRecs.length}) — Incompatibility reasons
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{...tbl,fontSize:11}}>
              <thead><tr style={{borderBottom:`2px solid ${C.border}`}}>
                {["Panel","Inverter","Battery","Rejection reasons"].map(h => (
                  <th key={h} style={{padding:"7px 12px",textAlign:"left",color:C.muted,fontWeight:600}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {rejectedRecs.slice(0, 20).map((rec,i) => (
                  <tr key={i} style={{background:i%2===0?"transparent":"#070f1f",borderBottom:"1px solid #1e293b"}}>
                    <td style={{padding:"6px 12px",color:C.muted,fontSize:10}}>{rec.p.brand} {rec.p.wp}Wp</td>
                    <td style={{padding:"6px 12px",color:C.muted,fontSize:10}}>{rec.inv.brand} {rec.inv.acKW}kW</td>
                    <td style={{padding:"6px 12px",color:C.muted,fontSize:10}}>{rec.bat.brand} {rec.bat.kwh}kWh</td>
                    <td style={{padding:"6px 12px"}}>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                        {rec.rejectReasons.map(reason => (
                          <span key={reason} style={{fontSize:9,padding:"2px 7px",borderRadius:8,
                            background:`${C.red}22`,color:C.red,border:`1px solid ${C.red}44`,fontWeight:700}}>
                            {reason}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
                {rejectedRecs.length > 20 && (
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
}
