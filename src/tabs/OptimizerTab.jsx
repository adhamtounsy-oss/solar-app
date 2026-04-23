import { C } from "../constants/index.js";
import { cardS, tbl, Bar } from "../components/ui/primitives.jsx";

export default function OptimizerTab({ r, inp, cs, fmtE, optData, optimNpv }) {
  if (!optData.length) return <div style={{color:C.muted,padding:20}}>Select components first.</div>;

  const maxGain = Math.max(...optData.map(d => d.netGain));
  const sweet   = optData.reduce((a,b) => b.netGain/b.cost > a.netGain/a.cost ? b : a);

  return (
    <div>
      {optimNpv && (() => {
        const {costEGP, extraYieldPct, deltaNPV, netBenefit, paybackYr, worthIt} = optimNpv;
        return (
          <div style={{marginBottom:14}}>
            <div style={cardS(worthIt ? C.green : C.orange)}>
              <div style={{padding:"10px 14px",color:"white",fontWeight:800,fontSize:13}}>
                🔧 DC Optimizer / Micro-Inverter NPV (NREL Deline 2013, η=0.75)
              </div>
              <div style={{padding:"8px 14px 14px"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <tbody>
                    {[
                      ["Shading loss assumption",      (inp.shadingLossFraction||0.05)*100 + "%"],
                      ["MLPE recovery efficiency",     "75% (NREL Deline 2013)"],
                      ["Extra yield recovered",        extraYieldPct + "%"],
                      ["Optimizer cost",               "EGP " + costEGP.toLocaleString()],
                      ["Discounted extra savings NPV", cs + deltaNPV.toLocaleString()],
                      ["Net benefit (NPV − cost)",     cs + netBenefit.toLocaleString()],
                      ["Payback on optimizer",         paybackYr ? paybackYr + " yrs" : ">25 yrs"],
                      ["Recommendation",               worthIt ? "Worth it — positive NPV" : "Marginal — only if shade is significant"],
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
                  ${inp.costPerOptimizerUSD||30}/panel at {cs}{inp.usdRate||55}/USD.
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10,marginBottom:14}}>
        {[
          {l:"★ Optimal offset",    v:`${sweet.pct}%`,           c:C.purple},
          {l:"Cost per villa",      v:fmtE(sweet.costPerVilla),  c:C.red   },
          {l:`Total (${inp.nVillas||1} villas)`,v:fmtE(sweet.cost3Villa),c:C.red},
          {l:"Payback",             v:`${sweet.payback} yrs`,    c:C.accent},
          {l:"25yr gain/villa",     v:fmtE(sweet.netGain),       c:C.green },
          {l:"3-villa total gain",  v:fmtE(sweet.netGain3),      c:C.green },
        ].map(k => (
          <div key={k.l} style={{background:C.card,borderRadius:10,padding:"12px 14px",borderLeft:`4px solid ${k.c}`}}>
            <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>{k.l}</div>
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
              {["Offset","kWp","Panels","Cost/Villa",`Total (${inp.nVillas||1}x)`,"Payback","IRR","25yr Gain/Villa","Total Gain"].map(h => (
                <th key={h} style={{padding:"7px 10px",textAlign:"right",color:C.muted,fontWeight:600,minWidth:90}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {optData.map((d,i) => {
                const isSw  = d.pct === sweet.pct;
                const isCur = Math.abs(d.pct - (r?.effPct||0)) < 3;
                return (
                  <tr key={d.pct} style={{
                    background:isSw?`${C.purple}22`:isCur?`${C.orange}18`:i%2===0?"transparent":"#070f1f",
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
                    <td style={{padding:"7px 10px",textAlign:"right",color:C.red,fontWeight:600}}>{cs}{(d.cost3Villa/1000).toFixed(0)}K</td>
                    <td style={{padding:"7px 10px",textAlign:"right",fontWeight:700,
                      color:d.payback<=8?C.green:d.payback<=12?C.yellow:C.red}}>
                      {d.payback===26?">25":d.payback} yrs
                    </td>
                    <td style={{padding:"7px 10px",textAlign:"right",color:C.purple,fontWeight:700}}>{d.irr.toFixed(1)}%</td>
                    <td style={{padding:"7px 10px",textAlign:"right"}}>
                      <Bar val={d.netGain/1000} max={maxGain/1000} color={C.green} width={45}/>
                    </td>
                    <td style={{padding:"7px 10px",textAlign:"right",color:C.green,fontWeight:600}}>{cs}{(d.netGain3/1000).toFixed(0)}K</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
