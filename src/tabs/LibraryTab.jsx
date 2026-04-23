import { useState } from "react";
import { C } from "../constants/index.js";
import { passColor, cardS, tbl } from "../components/ui/primitives.jsx";
import { CEC_TOP200 } from "../data/cec_top200.js";

export default function LibraryTab({
  r, inp,
  panel, inverter, battery,
  selPanel, setSelPanel, panelLib, setPLib,
  selInv,   setSelInv,   invLib,
  selBat,   setSelBat,   batLib,
  fmtE,
  handleFile, uploadMsg,
  showCmp, setShowCmp,
}) {
  const [cecSearch, setCecSearch] = useState("");
  const [showCec, setShowCec]     = useState(false);

  const cecFiltered = CEC_TOP200.filter(p => {
    if (!cecSearch.trim()) return true;
    const q = cecSearch.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q) || String(p.wp).includes(q);
  }).slice(0, 50);

  function addCecPanel(p) {
    const full = {
      ...p,
      betaVoc: p.betaVoc_VperK != null ? +(p.betaVoc_VperK / p.voc * 100).toFixed(3) : -0.28,
      nInStr: 20,
      u0: 25.0, u1: 6.84, b0: 0.05,
      certifications: p.warranty25 ? "IEC 61215 · IEC 61730 · 25yr warranty" : "IEC 61215",
    };
    const exists = panelLib.some(x => x.id === full.id);
    if (!exists) setPLib(prev => [...prev, full]);
    setSelPanel(full.id);
  }

  return (
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
          {uploadMsg && (
            <div style={{marginTop:12,padding:"8px 14px",borderRadius:8,fontSize:12,fontWeight:600,
              background:uploadMsg.includes("✅")?"#dcfce7":"#fee2e2",
              color:uploadMsg.includes("✅")?"#166534":"#991b1b"}}>{uploadMsg}</div>
          )}
        </div>
      </div>

      {/* CEC Module Database search */}
      <div style={cardS(C.blue)}>
        <div style={{padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}
          onClick={() => setShowCec(!showCec)}>
          <span style={{color:"white",fontWeight:800,fontSize:13}}>🔬 NREL CEC Module Database — 200 Panels</span>
          <span style={{fontSize:11,color:"#93c5fd"}}>{showCec ? "▲ Collapse" : "▼ Search & Import"}</span>
        </div>
        {showCec && (
          <div style={{padding:"12px 16px"}}>
            <div style={{fontSize:10,color:C.muted,marginBottom:10,lineHeight:1.6}}>
              CEC certified one-diode parameters (NREL SAM database). Search by brand, model, or wattage.
              Click <strong style={{color:C.blue}}>Add &amp; Select</strong> to add to your library and activate.
            </div>
            <input
              type="text" placeholder="Search: JA Solar, LONGi, Trina, 545..."
              value={cecSearch} onChange={e => setCecSearch(e.target.value)}
              style={{width:"100%",boxSizing:"border-box",background:"#0f172a",
                border:`1.5px solid ${C.blue}`,borderRadius:8,color:C.text,fontSize:12,
                padding:"8px 12px",marginBottom:10,outline:"none"}}
            />
            <div style={{overflowX:"auto",maxHeight:320,overflowY:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead style={{position:"sticky",top:0,background:"#0f172a",zIndex:1}}>
                  <tr style={{borderBottom:`2px solid ${C.border}`}}>
                    {["Brand","Model","Wp","Voc","Vmp","Isc","γ%/°C","NOCT","Tech",""].map(h => (
                      <th key={h} style={{padding:"5px 8px",textAlign:"right",color:C.muted,fontWeight:600,whiteSpace:"nowrap",
                        ...(h===""?{textAlign:"center"}:{})}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cecFiltered.map((p, i) => {
                    const already = panelLib.some(x => x.id === p.id);
                    const isActive = selPanel === p.id;
                    return (
                      <tr key={p.id} style={{background: isActive ? `${C.blue}22` : i%2===0?"transparent":"#070f1f",
                        borderLeft: isActive ? `3px solid ${C.blue}` : "3px solid transparent"}}>
                        <td style={{padding:"5px 8px",color:C.muted,whiteSpace:"nowrap"}}>{p.brand}</td>
                        <td style={{padding:"5px 8px",color:C.text,whiteSpace:"nowrap"}}>{p.model}</td>
                        <td style={{padding:"5px 8px",textAlign:"right",color:C.yellow,fontWeight:700}}>{p.wp}</td>
                        <td style={{padding:"5px 8px",textAlign:"right",color:C.muted}}>{p.voc}V</td>
                        <td style={{padding:"5px 8px",textAlign:"right",color:C.muted}}>{p.vmp}V</td>
                        <td style={{padding:"5px 8px",textAlign:"right",color:C.muted}}>{p.isc}A</td>
                        <td style={{padding:"5px 8px",textAlign:"right",color:C.orange}}>{p.gammaPmax}</td>
                        <td style={{padding:"5px 8px",textAlign:"right",color:C.muted}}>{p.noct}°C</td>
                        <td style={{padding:"5px 8px",color:C.muted,fontSize:9}}>{p.bifacial?"Bifacial":"Mono"}</td>
                        <td style={{padding:"5px 8px",textAlign:"center"}}>
                          <button onClick={() => addCecPanel(p)}
                            style={{padding:"3px 10px",borderRadius:12,border:"none",cursor:"pointer",
                              fontSize:10,fontWeight:700,whiteSpace:"nowrap",
                              background: isActive ? C.green : already ? C.card : C.blue,
                              color: isActive ? C.bg : already ? C.muted : C.bg}}>
                            {isActive ? "✓ Active" : already ? "✓ In lib" : "Add & Select"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {cecFiltered.length === 0 && (
                    <tr><td colSpan={10} style={{padding:16,textAlign:"center",color:C.muted,fontSize:11}}>
                      No panels match "{cecSearch}"
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{fontSize:9,color:C.muted,marginTop:6}}>
              Showing {cecFiltered.length} of {CEC_TOP200.length} panels · Sorted by wattage
              {cecSearch && ` · Filter: "${cecSearch}"`}
            </div>
          </div>
        )}
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
          ].map(({lbl,sel,fn,lib,col,bg,fmt,det}) => {
            const item = lib.find(x => x.id === sel) || lib[0];
            return (
              <div key={lbl}>
                <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>{lbl}</div>
                <select value={sel} onChange={e => fn(e.target.value)}
                  style={{width:"100%",background:bg,border:`2px solid ${col}`,borderRadius:8,
                  color:col,fontSize:12,padding:"8px 10px",cursor:"pointer",fontWeight:700}}>
                  {lib.map(p => <option key={p.id} value={p.id}>{fmt(p)}</option>)}
                </select>
                {item && (
                  <div style={{marginTop:8,background:"#0f172a",borderRadius:8,padding:"10px 12px",fontSize:11}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"3px 12px"}}>
                      {det(item).map(([k,v]) => (
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

      {r && (
        <div style={cardS(r.allOk ? C.green : C.red)}>
          <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13,
            display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>⚙ Compatibility Checks</span>
            <span style={{color:r.allOk ? C.green : C.red}}>
              {r.allOk ? "✅ ALL COMPATIBLE" : "⚠ INCOMPATIBILITY DETECTED"}
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
            ].map(({l,v,d},i) => (
              <div key={l} style={{padding:"9px 14px",background:i%2===0?"transparent":"#070f1f",
                borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",
                alignItems:"center",gap:8}}>
                <div>
                  <div style={{fontSize:11,color:C.muted}}>{l}</div>
                  <div style={{fontSize:10,color:"#475569"}}>{d}</div>
                </div>
                <span style={{fontSize:11,fontWeight:800,color:passColor(v),padding:"2px 8px",
                  background:`${passColor(v)}18`,borderRadius:6,whiteSpace:"nowrap"}}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button onClick={() => setShowCmp(!showCmp)}
        style={{width:"100%",padding:"10px",background:C.card,border:`1px solid ${C.border}`,
        borderRadius:8,color:C.muted,fontSize:12,fontWeight:700,cursor:"pointer",marginBottom:12}}>
        {showCmp ? "▲ Hide" : "▼ Show"} Component Comparison View
      </button>

      {showCmp && (
        <div style={cardS(C.purple)}>
          <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}>🔍 All Library Components</div>
          {[
            {title:"☀ PV Panels",  color:C.yellow, lib:panelLib, sel:selPanel, fn:setSelPanel,
             cols:["","Brand","Model","Wp","Voc","Vmp","Isc","β","γ","$/W","Certs"], row:p=>[p.brand,p.model,p.wp,p.voc,p.vmp,p.isc,p.betaVoc,p.gammaPmax,p.costUSD,p.certifications]},
            {title:"🔌 Inverters", color:C.purple, lib:invLib,   sel:selInv,   fn:setSelInv,
             cols:["","Brand","Model","AC kW","Vdc","MPPT V","Bat V","Chg kW","η%","EGP"], row:x=>[x.brand,x.model,x.acKW,x.vdcMax,`${x.mpptMin}–${x.mpptMax}`,`${x.batVoltMin||"—"}–${x.batVoltMax||"—"}`,x.batChargeKW,`${x.eta}%`,fmtE(x.costEGP)]},
            {title:"🔋 Batteries", color:C.blue,   lib:batLib,   sel:selBat,   fn:setSelBat,
             cols:["","Brand","Model","kWh","V","DoD","η%","Cycles","Type","EGP"], row:x=>[x.brand,x.model,x.kwh,`${x.voltage}V`,`${x.dod}%`,`${x.eta}%`,x.cycleLife,x.chemistry,fmtE(x.costEGP)]},
          ].map(({title,color,lib,sel,fn,cols,row}) => (
            <div key={title}>
              <div style={{padding:"10px 16px",fontSize:11,color,fontWeight:700,
                textTransform:"uppercase",letterSpacing:1,borderTop:`1px solid ${C.border}`}}>{title}</div>
              <div style={{overflowX:"auto"}}>
                <table style={{...tbl,fontSize:11}}>
                  <thead><tr style={{borderBottom:`2px solid ${C.border}`}}>
                    {cols.map(h => <th key={h} style={{padding:"6px 10px",textAlign:"right",
                      color:C.muted,fontWeight:600,whiteSpace:"nowrap"}}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {lib.map((item,i) => (
                      <tr key={item.id} onClick={() => fn(item.id)} style={{cursor:"pointer",
                        background:item.id===sel?`${color}18`:i%2===0?"transparent":"#070f1f",
                        borderLeft:item.id===sel?`3px solid ${color}`:"3px solid transparent"}}>
                        <td style={{padding:"6px 8px",textAlign:"center",fontSize:10,color}}>
                          {item.id===sel ? "●" : ""}
                        </td>
                        {row(item).map((v,j) => (
                          <td key={j} style={{padding:"6px 10px",textAlign:"right",
                            color:item.id===sel?color:C.muted,
                            fontSize:j===1?10:11}}>
                            {typeof v==="number" ? v.toFixed(j>=6?2:1) : v}
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
}
