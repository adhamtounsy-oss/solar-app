import { C } from "../constants/index.js";
import { cardS, passColor } from "../components/ui/primitives.jsx";

export default function DashboardTab({ r, inp, panel, inverter, battery, cs, yGen, fmtE }) {
  if (!r) return <div style={{color:C.muted,padding:20}}>Select components first.</div>;

  const kpis = [
    {l:"Selected panel",      v:`${panel?.brand} ${panel?.wp}Wp`,                       c:C.yellow},
    {l:"Selected inverter",   v:`${inverter?.brand} ${inverter?.acKW}kW`,               c:C.purple},
    {l:"Selected battery",    v:`${battery?.brand} ${battery?.kwh}kWh`,                c:C.blue  },
    {l:"Array per villa",     v:`${r.actKwp.toFixed(1)} kWp (${r.totP} panels)`,       c:C.yellow},
    {l:"Coverage",            v:r.roofCapped
      ? `${r.coverageActual.toFixed(0)}% (roof-ltd)`
      : `${r.effPct.toFixed(0)}% offset`,                                               c:r.roofCapped?C.red:C.orange},
    {l:r.tmySource==="pvgis"
      ? `Annual yield ${inp.yieldMode==="p90"?"P90 ":""}(PVGIS ✓)`
      : `Annual yield ${inp.yieldMode==="p90"?"P90 ":""}(fallback)`,
     v:`${(yGen/1000).toFixed(2)} MWh/villa`,                                           c:r.tmySource==="pvgis"?C.green:C.yellow},
    {l:r.tmySource==="pvgis"?"SC rate (simulated)":"SC rate (approx)",
     v:`${r.annSCPct!=null?r.annSCPct.toFixed(1):r.profileSCPct.toFixed(1)}%`,         c:r.tmySource==="pvgis"?C.green:C.yellow},
    {l:"Cost per villa",       v:fmtE(r.sysC),                                          c:C.red   },
    {l:"3-villa total",        v:fmtE(r.totalSysC3),                                    c:C.red   },
    {l:"Payback",              v:r.pb?`${r.pb} yrs`:">25",                              c:C.accent},
    {l:"IRR / ROI",            v:`${r.irr}% / ${r.roi}%`,                              c:C.green },
    {l:"25yr net gain/villa",  v:fmtE(r.netGain),                                       c:C.green },
    {l:`NPV @${inp.discountRate||12}% discount`, v:fmtE(r.npvAtRate),                  c:r.npvAtRate>=0?C.green:C.red},
    {l:"LCOE",                 v:`${cs}${r.lcoe}/kWh`,                                 c:C.yellow},
    {l:"Specific yield (P50)", v:`${(r.annGenTMY/r.actKwp).toFixed(0)} kWh/kWp`,      c:C.accent},
    {l:"Specific yield (P90)", v:`${(r.annGenP90/r.actKwp).toFixed(0)} kWh/kWp`,      c:C.yellow},
    {l:"Performance Ratio",    v:r.perfRatio||"—",                                      c:C.accent},
    {l:"Clipping loss",        v:`${(r.clippingPct||0).toFixed(1)}%`,                  c:(r.clippingPct||0)>3?C.orange:C.green},
  ];

  const checks = [
    {l:"Inverter sizing",  v:r.chkInvSize}, {l:"DC/AC ratio",    v:r.chkDcAc   },
    {l:"MPPT min",         v:r.chkMpptMin}, {l:"MPPT max",       v:r.chkMpptMax},
    {l:"Isc per MPPT",     v:r.chkIscMppt}, {l:"String VD",      v:r.chkVdStr  },
    {l:"Feeder VD",        v:r.chkVdFdr  }, {l:"AC cable VD",    v:r.chkVdAC   },
    {l:"MDB busbar",       v:r.mdbCheck  }, {l:"<500kW NCEDC",   v:r.chkSize500},
    {l:"Roof fit",         v:r.roofFit?"PASS":"REVIEW"},
    {l:"Inter-row shading",v:r.chkRowShade},
    ...(r.noBat ? [] : [
      {l:"Battery voltage", v:r.chkBatVolt},
      {l:"Battery charge",  v:r.chkBatChg },
      {l:"Battery Circ.3",  v:r.chkBatRule},
    ]),
  ];
  const allPass = checks.every(c => c.v === "PASS");

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:14}}>
        {kpis.map(k => (
          <div key={k.l} style={{background:C.card,borderRadius:10,padding:"12px 14px",borderLeft:`4px solid ${k.c}`}}>
            <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>{k.l}</div>
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
          {checks.map((c,i) => (
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
            {l:"PV Array",   v:fmtE(r.arrayCostEGP), pct:r.arrayCostEGP/r.sysC*100, c:C.yellow},
            {l:"Inverter",   v:fmtE(r.invCostEGP),   pct:r.invCostEGP/r.sysC*100,   c:C.purple},
            {l:"Battery",    v:fmtE(r.batCostEGP),   pct:r.batCostEGP/r.sysC*100,   c:C.blue  },
            {l:"BoS/Install",v:fmtE(r.bos),          pct:r.bos/r.sysC*100,          c:C.orange},
            {l:"Engineering",v:fmtE(r.engCost),      pct:r.engCost/r.sysC*100,      c:C.muted },
          ].map(k => (
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
}
