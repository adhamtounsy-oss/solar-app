import { C } from "../constants/index.js";
import { cardS, tbl, SH, Row, Calc, TblHead } from "../components/ui/primitives.jsx";

function CableSummary({ r, inp }) {
  return (
    <div style={{background:C.card,borderRadius:10,padding:"14px 16px",marginBottom:12,
      border:`1px solid ${C.border}`}}>
      <div style={{fontSize:11,color:C.green,textTransform:"uppercase",letterSpacing:1,
        fontWeight:700,marginBottom:10}}>🔌 Recommended Cable Sizes (IEC 60364-5-52 · E7)</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8,marginBottom:8}}>
        {[
          {l:"DC String",  v:`${r.csaStr||4} mm²`,  sub:`${r.nStr||1} run × ${Math.round((inp.lenStringM||25)*2)}m`,  c:C.yellow},
          {l:"DC Feeder",  v:`${r.csaFdr||16} mm²`, sub:`${Math.round((inp.lenFeederM||15)*2)}m total`,                c:C.orange},
          {l:"AC Output",  v:`${r.csaAC||10} mm²`,  sub:`${Math.round((inp.lenACM||20)*3)}m (3-ph)`,                  c:C.green},
          {l:"Battery DC", v:"35 mm²",               sub:`${Math.round((inp.lenBatteryM||3)*2)}m`,                     c:C.blue},
        ].map(k => (
          <div key={k.l} style={{background:"#0f172a",borderRadius:8,padding:"10px 12px",borderLeft:`3px solid ${k.c}`}}>
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

export default function P6Tab({ r, inp }) {
  if (!r) return null;
  return (
    <>
      <CableSummary r={r} inp={inp} />
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
    </>
  );
}
