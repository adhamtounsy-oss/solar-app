import { C } from "../constants/index.js";
import { cardS } from "../components/ui/primitives.jsx";
import { COUNTRY_DATA } from "../data/countryData.js";

function SPDCard({ spdResult, inp }) {
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
          {note}. Site Ng={(inp.ng??2.0).toFixed(1)} fl/km²/yr (IEC 62305-2 Annex A
          {COUNTRY_DATA[inp.countryCode] ? ` · ${COUNTRY_DATA[inp.countryCode].name}` : ""}).
          Coordinate with MEP engineer for Type 1 Class I surge arrester installation.
        </div>
      </div>
    </div>
  );
}

export default function SldTab({ r, inp, inverter, battery, sldMode, setSldMode, spdResult }) {
  if (!r) return <div style={{color:C.muted,padding:20}}>Select components first.</div>;
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
              <text x="65" y="106" textAnchor="middle" fill={C.accent} fontSize="8">{r.nStr}S x {r.nSel}P</text>
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
              <text x="210" y="122" textAnchor="middle" fill={C.muted} fontSize="7">Eta {inverter&&inverter.eta}%</text>
              {/* Battery */}
              <rect x="160" y="195" width="100" height="70" rx="8" fill="#1a2840" stroke={C.blue} strokeWidth="2.5" />
              <text x="210" y="218" textAnchor="middle" fill={C.blue} fontSize="9" fontWeight="800">BATTERY</text>
              <text x="210" y="232" textAnchor="middle" fill={C.text} fontSize="8">{battery&&battery.brand}</text>
              <text x="210" y="245" textAnchor="middle" fill={C.text} fontSize="8">{battery&&battery.kwh}kWh</text>
              <text x="210" y="258" textAnchor="middle" fill={C.accent} fontSize="8">DoD {battery&&battery.dod}%</text>
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
                  <text x="27" y="17" textAnchor="middle" fill={C.yellow} fontSize="8">PV String {i+1}</text>
                  <text x="27" y="29" textAnchor="middle" fill={C.muted} fontSize="7">{r.nSel}S x 1P</text>
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
              <text x="445" y="120" textAnchor="middle" fill={C.muted} fontSize="6">+ RCD 30mA</text>
              <rect x="520" y="55" width="85" height="80" rx="4" fill="#1a2840" stroke={C.green} strokeWidth="2" />
              <text x="562" y="78" textAnchor="middle" fill={C.green} fontSize="9" fontWeight="800">MDB</text>
              <text x="562" y="92" textAnchor="middle" fill={C.text} fontSize="7">{inp.mdbBusbarA}A Busbar</text>
              <text x="562" y="104" textAnchor="middle" fill={C.text} fontSize="7">{inp.supplyPhase}-phase</text>
              <text x="562" y="116" textAnchor="middle" fill={C.muted} fontSize="6">{inp.supplyAmps}A supply</text>
              <text x="562" y="127" textAnchor="middle" fill={C.muted} fontSize="6">+ Smart export meter</text>
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
      <SPDCard spdResult={spdResult} inp={inp} />
    </div>
  );
}
