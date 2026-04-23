import { C } from "../constants/index.js";
import { cardS, tbl } from "../components/ui/primitives.jsx";
import { EGYPT_TARIFF_TIERS } from "../lib/financial.js";
import { COUNTRY_DATA } from "../data/countryData.js";

function SensitivityChart({ r, inp, cs, fmtE }) {
  if (!r?.sensitivity) return null;
  const s      = r.sensitivity;
  const base25 = r.netGain;
  const bars   = [
    { label:"Tariff ±20%",    lo:s.tariff.lo,   hi:s.tariff.hi,  c:C.yellow },
    { label:"O&M ±20%",      lo:s.omCost.lo,   hi:s.omCost.hi,  c:C.red    },
    { label:"Degradation ±",  lo:s.panelDeg.hi, hi:s.panelDeg.lo,c:C.orange },
  ];
  const allVals = bars.flatMap(b=>[b.lo,b.hi,base25]).filter(v=>!isNaN(v)&&isFinite(v));
  if (!allVals.length) return null;
  const minV  = Math.min(...allVals);
  const maxV  = Math.max(...allVals);
  const range = maxV - minV || 1;
  const toX   = v => Math.round(((v-minV)/range)*420);
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
          {bars.map((b,i) => {
            const x1 = 20+Math.min(toX(b.lo),toX(b.hi));
            const x2 = 20+Math.max(toX(b.lo),toX(b.hi));
            return (
              <g key={i} transform={`translate(0,${i*44+8})`}>
                <text x={0} y={16} fill="#94a3b8" fontSize={11}>{b.label}</text>
                <rect x={x1} y={22} width={Math.max(6,x2-x1)} height={14}
                  rx={3} fill={b.c} opacity={0.75}/>
                <text x={x1-4} y={33} textAnchor="end" fill="#94a3b8" fontSize={9}>{fmtE(Math.round(b.lo))}</text>
                <text x={x2+4}  y={33}                  fill="#94a3b8" fontSize={9}>{fmtE(Math.round(b.hi))}</text>
              </g>
            );
          })}
        </svg>
        <div style={{fontSize:10,color:"#94a3b8",marginTop:4}}>
          NPV @ {inp.discountRate||12}% discount:{" "}
          <strong style={{color:r.npvAtRate>=0?"#10b981":"#ef4444"}}>{fmtE(r.npvAtRate)}</strong>
          {" · "}LCOE: <strong style={{color:"#f59e0b"}}>{cs}{r.lcoe}/kWh</strong>
          {" · "}Grid tariff today: <strong style={{color:"#e2e8f0"}}>{cs}{inp.tariffNow}/kWh</strong>
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

export default function FinancialTab({ r, inp, upd, cs, fmtE, fmtU }) {
  if (!r) return null;
  const yieldDisplay = inp.yieldMode==="p90" ? r.annGenP90 : r.annGenTMY;

  return (
    <div>
      <SensitivityChart r={r} inp={inp} cs={cs} fmtE={fmtE} />

      {/* Tariff mode toggle */}
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontSize:11,color:C.muted}}>Tariff:</span>
        {[{v:"tiered",l:"Tiered EgyptERA"},{v:"flat",l:"Flat rate"}].map(m => (
          <button key={m.v} onClick={() => upd("tariffMode", m.v)}
            style={{padding:"5px 14px",borderRadius:20,border:"none",cursor:"pointer",
            fontSize:11,fontWeight:700,
            background:inp.tariffMode===m.v?"#14b8a6":C.card,
            color:inp.tariffMode===m.v?C.bg:C.muted}}>
            {m.l}
          </button>
        ))}
      </div>
      {inp.tariffMode==="tiered" && (() => {
        const tiers = inp.tariffTiers || EGYPT_TARIFF_TIERS;
        return (
          <div style={{padding:"8px 14px",background:"#14b8a618",borderRadius:8,marginBottom:10,
            fontSize:11,color:"#14b8a6",borderLeft:"3px solid #14b8a6"}}>
            Tiered savings: displaced kWh valued at highest blocks first.{" "}
            {tiers.map((t,i) => (
              <span key={i}>{i>0?" · ":""}{t.label.replace(/\(.*\)/,"").trim()}: {cs}{t.rate}</span>
            ))}
          </div>
        );
      })()}
      {inp.tariffEsc===0 && inp.omEsc>0 && (
        <div style={{padding:"8px 14px",background:`${C.red}18`,borderRadius:8,marginBottom:10,
          fontSize:11,color:C.red,borderLeft:`3px solid ${C.red}`}}>
          ⚠ <strong>Tariff escalation is 0%</strong> but O&amp;M escalates at {inp.omEsc}%/yr.
          O&amp;M will eventually exceed savings — payback may exceed 25 years even on a viable system.
          Set a realistic tariff escalation (Egypt historical: 15–20%/yr) or reduce O&amp;M escalation to ~3%/yr (CPI-linked).
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
          <button onClick={() => upd("netMeteringEnabled", !inp.netMeteringEnabled)}
            style={{padding:"3px 12px",borderRadius:12,border:"none",cursor:"pointer",
              fontSize:10,fontWeight:700,
              background:inp.netMeteringEnabled?C.green:C.card,
              color:inp.netMeteringEnabled?C.bg:C.muted}}>
            {inp.netMeteringEnabled ? "ON" : "OFF"}
          </button>
        </div>
        {inp.netMeteringEnabled && (
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:10,color:C.muted}}>Export rate ({inp.currency||"EGP"}/kWh):</span>
            <input type="number" min="0" max="5" step="0.05"
              value={inp.netMeteringRate||0.50}
              onChange={e => upd("netMeteringRate", parseFloat(e.target.value)||0.50)}
              style={{width:70,background:C.card,border:`1px solid ${C.green}`,
                borderRadius:6,color:C.green,fontSize:12,padding:"4px 6px",textAlign:"right"}}/>
            <span style={{fontSize:9,color:C.muted}}>
              {COUNTRY_DATA[inp.countryCode]?.netMeteringEnabled
                ? `Typical: ${cs}${COUNTRY_DATA[inp.countryCode].netMeteringRate}/kWh`
                : "Check local utility net metering policy"}
            </span>
          </div>
        )}
      </div>

      {/* TOU peak export rate — visible only when both TOU and net metering are on */}
      {inp.touEnabled && inp.netMeteringEnabled && (
        <div style={{padding:"10px 14px",background:`${C.yellow}10`,borderRadius:8,
          marginBottom:10,border:`1px solid ${C.yellow}44`}}>
          <div style={{fontSize:11,fontWeight:700,color:C.yellow,marginBottom:6}}>⏰ TOU Peak Export Rate</div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span style={{fontSize:10,color:C.muted}}>Peak hours ({inp.touPeakStart||17}:00–{inp.touPeakEnd||22}:00) rate ({inp.currency||"EGP"}/kWh):</span>
            <input type="number" min="0" max="10" step="0.05"
              value={inp.touPeakExportRate||0.68}
              onChange={e => upd("touPeakExportRate", parseFloat(e.target.value)||0.68)}
              style={{width:70,background:C.card,border:`1px solid ${C.yellow}`,
                borderRadius:6,color:C.yellow,fontSize:12,padding:"4px 6px",textAlign:"right"}}/>
            <span style={{fontSize:9,color:C.muted}}>Off-peak exports credited at base net metering rate ({inp.netMeteringRate||0.50} {inp.currency||"EGP"}/kWh)</span>
          </div>
        </div>
      )}

      {/* Connection fee */}
      <div style={{padding:"10px 14px",background:`${C.muted}10`,borderRadius:8,
        marginBottom:10,border:`1px solid ${C.border}`}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:inp.connectionFeeEnabled?6:0}}>
          <span style={{fontSize:11,fontWeight:700,color:C.muted}}>🔌 Grid Connection Fee</span>
          <button onClick={() => upd("connectionFeeEnabled", !inp.connectionFeeEnabled)}
            style={{padding:"3px 12px",borderRadius:12,border:"none",cursor:"pointer",
              fontSize:10,fontWeight:700,
              background:inp.connectionFeeEnabled?C.accent:C.card,
              color:inp.connectionFeeEnabled?C.bg:C.muted}}>
            {inp.connectionFeeEnabled ? "ON" : "OFF"}
          </button>
        </div>
        {inp.connectionFeeEnabled && (
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span style={{fontSize:10,color:C.muted}}>One-time connection fee ({inp.currency||"EGP"}):</span>
            <input type="number" min="0" step="500"
              value={inp.connectionFeeEGP||0}
              onChange={e => upd("connectionFeeEGP", parseFloat(e.target.value)||0)}
              style={{width:100,background:C.card,border:`1px solid ${C.accent}`,
                borderRadius:6,color:C.accent,fontSize:12,padding:"4px 6px",textAlign:"right"}}/>
            <span style={{fontSize:9,color:C.muted}}>Added to system cost for payback/IRR/NPV</span>
          </div>
        )}
      </div>

      <div style={{padding:"8px 14px",background:`${C.green}18`,borderRadius:8,marginBottom:12,
        borderLeft:`3px solid ${C.green}`,fontSize:11,color:C.green}}>
        {r.tmySource==="pvgis"
          ? <span>PVGIS hourly — {(r.annGenTMY/1000).toFixed(2)} MWh/yr · PR {r.perfRatio} · SC {(r.annSCPct||0).toFixed(1)}% · Clipping {(r.clippingPct||0).toFixed(1)}%</span>
          : <span>Monthly TMY fallback — {(r.annGenTMY/1000).toFixed(2)} MWh/yr · PR {r.perfRatio} · Fetch PVGIS for hourly dispatch</span>}
      </div>

      {/* 25-Year Yield & Cash Flow Chart */}
      {r.cfYears && r.cfYears.length > 0 && (() => {
        const W=680, H=220, PAD={t:24,r:16,b:36,l:64};
        const cw=W-PAD.l-PAD.r, ch=H-PAD.t-PAD.b;
        const years = r.cfYears.map(y => y.yr);
        const gens  = r.cfYears.map((_,i) => {
          const deg = Math.pow(1 - inp.panelDeg/100, i);
          return r.annGenTMY * deg * (inp.yieldMode==="p90"?0.92:1) / 1000;
        });
        const cums   = r.cfYears.map(y => y.cum/1000);
        const sysK   = r.sysC/1000;
        const maxGen = Math.max(...gens)*1.15;
        const minCum = Math.min(Math.min(...cums)-20, -sysK*1.1);
        const maxCum = Math.max(...cums)*1.05;
        const xS     = i  => PAD.l + i/(years.length-1)*cw;
        const yGenFn = v  => PAD.t + ch*(1-v/maxGen);
        const yFinR  = maxCum - minCum;
        const yCum   = v  => PAD.t + ch*(1-(v-minCum)/yFinR);
        const yZero  = yCum(0);
        const pbX    = r.pb ? xS(r.pb-1) : null;
        const genPts = gens.map((v,i) => `${xS(i).toFixed(1)},${yGenFn(v).toFixed(1)}`).join(' ');
        const cumPts = cums.map((v,i) => `${xS(i).toFixed(1)},${yCum(v).toFixed(1)}`).join(' ');
        const genAreaPts = `${xS(0)},${PAD.t+ch} ${genPts} ${xS(years.length-1)},${PAD.t+ch}`;
        return (
          <div style={{background:C.card,borderRadius:12,padding:"14px 16px",marginBottom:14,
            border:`1px solid ${C.border}`}}>
            <div style={{fontSize:12,fontWeight:800,color:C.text,marginBottom:8}}>📈 25-Year Yield &amp; Cash Flow</div>
            <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{overflow:"visible"}}>
              {[0,0.25,0.5,0.75,1].map(f => {
                const y = PAD.t+f*ch;
                return <line key={f} x1={PAD.l} x2={PAD.l+cw} y1={y} y2={y} stroke={C.border} strokeWidth="0.5" strokeDasharray="3,3"/>;
              })}
              {yZero>=PAD.t && yZero<=PAD.t+ch &&
                <line x1={PAD.l} x2={PAD.l+cw} y1={yZero} y2={yZero} stroke={C.muted} strokeWidth="1" strokeDasharray="4,2"/>}
              {pbX && <line x1={pbX} x2={pbX} y1={PAD.t} y2={PAD.t+ch} stroke={C.green} strokeWidth="1.5" strokeDasharray="5,3" opacity="0.7"/>}
              {pbX && <text x={pbX+3} y={PAD.t+10} fill={C.green} fontSize="9" fontWeight="700">Payback yr {r.pb}</text>}
              <polygon points={genAreaPts} fill={C.yellow} opacity="0.12"/>
              <polyline points={genPts} fill="none" stroke={C.yellow} strokeWidth="2" strokeLinejoin="round"/>
              <polyline points={cumPts} fill="none" stroke={C.green}  strokeWidth="2.5" strokeLinejoin="round"/>
              <line x1={PAD.l} x2={PAD.l}    y1={PAD.t} y2={PAD.t+ch} stroke={C.border} strokeWidth="1"/>
              <line x1={PAD.l} x2={PAD.l+cw} y1={PAD.t+ch} y2={PAD.t+ch} stroke={C.border} strokeWidth="1"/>
              {[0,0.5,1].map(f => (
                <text key={f} x={PAD.l-4} y={PAD.t+ch*(1-f)+4} textAnchor="end" fill={C.yellow} fontSize="8">{(maxGen*f).toFixed(1)}</text>
              ))}
              <text x={PAD.l-30} y={PAD.t+ch/2} fill={C.yellow} fontSize="8"
                transform={`rotate(-90,${PAD.l-38},${PAD.t+ch/2})`} textAnchor="middle">Yield MWh/yr</text>
              {[0,0.5,1].map(f => (
                <text key={f} x={PAD.l+cw+4} y={PAD.t+ch*(1-f)+4} textAnchor="start" fill={C.green} fontSize="8">
                  {((minCum+yFinR*f)/1000).toFixed(0)}k
                </text>
              ))}
              {[1,5,10,15,20,25].filter(y => y<=years.length).map(y => (
                <text key={y} x={xS(y-1)} y={PAD.t+ch+14} textAnchor="middle" fill={C.muted} fontSize="8">yr{y}</text>
              ))}
              <rect x={PAD.l+cw-120} y={PAD.t} width="120" height="32" rx="4" fill={C.bg} opacity="0.85"/>
              <line x1={PAD.l+cw-115} x2={PAD.l+cw-100} y1={PAD.t+10}  y2={PAD.t+10}  stroke={C.yellow} strokeWidth="2"/>
              <text x={PAD.l+cw-97} y={PAD.t+13} fill={C.yellow} fontSize="8">Annual yield</text>
              <line x1={PAD.l+cw-115} x2={PAD.l+cw-100} y1={PAD.t+24}  y2={PAD.t+24}  stroke={C.green}  strokeWidth="2.5"/>
              <text x={PAD.l+cw-97} y={PAD.t+27} fill={C.green}  fontSize="8">Cumulative savings</text>
            </svg>
            <div style={{fontSize:10,color:C.muted,marginTop:4,display:"flex",gap:16}}>
              <span style={{color:C.yellow}}>■ Yield (left axis, MWh/yr) — declines at {inp.panelDeg}%/yr degradation</span>
              <span style={{color:C.green}}>■ Cumulative net savings (right axis)</span>
              {r.pb && <span style={{color:C.green}}>· Payback crossover: year {r.pb}</span>}
            </div>
          </div>
        );
      })()}

      {/* KPI grid */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:14}}>
        {[
          {l:"Cost/villa",    v:fmtE(r.sysC),        s:fmtU(r.sysC),        c:C.red   },
          {l:"3-villa total", v:fmtE(r.totalSysC3),  s:fmtU(r.totalSysC3),  c:C.red   },
          {l:"Payback",       v:r.pb?`${r.pb} yrs`:">25", s:"Cash payback",  c:C.accent},
          {l:"IRR",           v:`${r.irr}%`,           s:"25-year",           c:C.green },
          {l:"NPV",           v:fmtE(r.npvAtRate),    s:`@ ${inp.discountRate||12}% discount`, c:r.npvAtRate>=0?C.green:C.red},
          {l:"LCOE",          v:`${cs}${r.lcoe}/kWh`, s:"Levelised cost",    c:C.yellow},
          {l:"25yr net gain", v:fmtE(r.netGain),      s:fmtU(r.netGain),     c:C.green },
          {l:"ROI",           v:`${r.roi}%`,           s:"25-year",           c:C.purple},
        ].map(k => (
          <div key={k.l} style={{background:C.card,borderRadius:10,padding:"12px 14px",borderLeft:`4px solid ${k.c}`}}>
            <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>{k.l}</div>
            <div style={{fontSize:18,fontWeight:800,color:k.c}}>{k.v}</div>
            <div style={{fontSize:10,color:C.muted,marginTop:2}}>{k.s}</div>
          </div>
        ))}
      </div>

      {/* 25-year cashflow table */}
      <div style={cardS(C.green)}>
        <div style={{padding:"10px 14px",color:"white",fontWeight:800}}>25-Year Cashflow ({inp.currency||"EGP"} per villa)</div>
        <div style={{overflowX:"auto"}}>
          <table style={{...tbl,fontSize:11}}>
            <thead><tr style={{borderBottom:`2px solid ${C.border}`}}>
              {["Year","Tariff","Savings","O&M","Bat","Net","Cumulative","Net Pos"].map(h => (
                <th key={h} style={{padding:"6px 10px",textAlign:"right",color:C.muted,fontWeight:600,minWidth:75}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {r.cfYears.map((y,i) => {
                const isB = y.yr === r.pb;
                return (
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
                      {y.bat>0 ? `${(y.bat/1000).toFixed(0)}K` : "—"}
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
}
