import { C } from "../constants/index.js";
import { cardS, tbl, SH, Row, Calc, TblHead } from "../components/ui/primitives.jsx";

export default function P4Tab({ r, battery, inverter, inp }) {
  if (!r || !battery) return null;
  return (
    <div style={cardS(C.blue)}>
      <div style={{padding:"10px 14px",color:"white",fontWeight:800}}>
        🔋 Phase 4 — Battery ({battery.brand} {battery.model})
      </div>
      <table style={tbl}><TblHead label="Value" calcCol={C.blue}/><tbody>
        <SH label="Profile-Based Sizing (Improvement 3)" color={C.accent}/>
        <Row label="Evening demand (17–23h)" shade={false} note="From Load Profile tab — actual battery target">
          <td/><Calc v={r.eveningDeficit} unit="kWh" big/>
        </Row>
        <Row label="Coverage target" shade={true}>
          <td/><Calc v={r.eveningDeficit*(inp.batEveningCovPct/100)} unit="kWh" big/>
        </Row>
        <Row label="Design energy (max of target/backup)" shade={false}>
          <td/><Calc v={r.designE} unit="kWh" big/>
        </Row>
        <Row label="▶ Usable battery capacity" shade={true}>
          <td/><Calc v={r.usableBat} unit="kWh" big/>
        </Row>
        <Row label="▶ Evening demand covered?" shade={false}>
          <td/><Calc v={r.usableBat>=r.eveningDeficit*(inp.batEveningCovPct/100)?"PASS":"UNDERSIZED"} big/>
        </Row>
        <Row label="▶ Autonomy @ 50% solar load" shade={true}>
          <td/><Calc v={r.autonomy} unit="hrs" dp={1} big/>
        </Row>
        <SH label="Solar Self-Consumption" color={C.green}/>
        <Row label={r.tmySource==="pvgis"?"Simulated SC rate (hourly dispatch)":"Profile SC rate (approx)"} shade={false}
          note={r.tmySource==="pvgis"?"8,760-hour dispatch simulation":"Fetch PVGIS for hourly simulation"}>
          <td style={{padding:"6px 12px",textAlign:"right",fontSize:10,color:r.tmySource==="pvgis"?C.green:C.yellow}}>
            {r.tmySource==="pvgis"?"✓ PVGIS":"↻ fallback"}
          </td>
          <Calc v={`${r.annSCPct!=null?r.annSCPct.toFixed(1):r.profileSCPct.toFixed(1)}%`} big/>
        </Row>
        {r.dispatch && <>
          <Row label="Annual battery cycles" shade={true} note="Simulated throughput ÷ usable capacity">
            <td/><Calc v={r.batCyclesYear.toFixed(0)} unit="cycles/yr"/>
          </Row>
          <Row label="Dec evening unmet demand" shade={false} note="Grid imports 17–22h in December">
            <td/><Calc v={r.dispatch.eveningDeficits[11].toFixed(1)} unit="kWh/day" big/>
          </Row>
          <Row label="Battery adequacy" shade={true}>
            <td/><Calc v={Math.max(...r.dispatch.eveningDeficits)<2?"PASS":"REVIEW"} big/>
          </Row>
        </>}
        <SH label="Regulatory Compliance" color={C.red}/>
        <Row label="Battery ↔ inverter voltage" shade={false}>
          <td/><Calc v={r.chkBatVolt} big/>
        </Row>
        <Row label="Battery rule (Circ.3/2023)" shade={true}>
          <td/><Calc v={r.chkBatRule} big/>
        </Row>
      </tbody></table>
    </div>
  );
}
