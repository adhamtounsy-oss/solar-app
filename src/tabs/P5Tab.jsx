import { C } from "../constants/index.js";
import { cardS, tbl, Row, Calc } from "../components/ui/primitives.jsx";

export default function P5Tab({ r, inverter, panel, battery }) {
  if (!r) return null;
  return (
    <div style={cardS(C.purple)}>
      <div style={{padding:"10px 14px",color:"white",fontWeight:800}}>
        🔌 Phase 5 — Inverter Checks ({inverter?.brand} {inverter?.model})
      </div>
      <table style={tbl}><thead><tr style={{borderBottom:`2px solid ${C.border}`}}>
        <th style={{padding:"8px 14px",textAlign:"left",color:C.muted,fontSize:11,width:"40%"}}>Check</th>
        <th style={{padding:"8px 12px",textAlign:"right",color:C.muted,fontSize:11}}>Requirement</th>
        <th style={{padding:"8px 12px",textAlign:"right",color:C.purple,fontSize:11}}>Result</th>
      </tr></thead><tbody>
        {[
          {l:"Inverter ≥ peak demand", req:`≥${r.peakDemandKW.toFixed(1)}kW`,                                          v:r.chkInvSize},
          {l:"DC/AC ratio",            req:r.dcAc.toFixed(2),                                                           v:r.chkDcAc   },
          {l:"Vmp ≥ MPPT min",         req:`${r.vmpSum.toFixed(1)}V≥${inverter?.mpptMin}V`,                             v:r.chkMpptMin},
          {l:"Voc ≤ Vdc max",          req:`${r.strVoc.toFixed(1)}V≤${inverter?.vdcMax}V`,                              v:r.chkMpptMax},
          {l:"Isc per MPPT",           req:`${(panel?.isc*r.strPerMppt).toFixed(1)}A≤${inverter?.iscPerMppt}A`,         v:r.chkIscMppt},
          {l:"Battery voltage range",  req:`${battery?.voltage}V in ${inverter?.batVoltMin||"—"}–${inverter?.batVoltMax||"—"}V`, v:r.chkBatVolt},
          {l:"Battery charge power",   req:`${inverter?.batChargeKW}kW`,                                                v:r.chkBatChg },
        ].map(({l,req,v},i) => (
          <Row key={l} label={l} shade={i%2===0}>
            <td style={{padding:"6px 12px",textAlign:"right",color:C.muted,fontSize:11}}>{req}</td>
            <Calc v={v} big/>
          </Row>
        ))}
      </tbody></table>
    </div>
  );
}
