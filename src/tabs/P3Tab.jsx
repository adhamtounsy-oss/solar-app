import { C } from "../constants/index.js";
import { cardS, tbl, SH, Row, Calc, TblHead, WarnBanner } from "../components/ui/primitives.jsx";

export default function P3Tab({ r, panel, inverter, inp, yGen, warnings }) {
  if (!r || !panel || !inverter) return null;
  return (
    <div>
      <WarnBanner warnings={warnings} scope="array" />
      <WarnBanner warnings={warnings} scope="sizing" />
      <div style={cardS(C.yellow)}>
        <div style={{padding:"10px 14px",color:"white",fontWeight:800}}>
          🔆 Phase 3 — Array Design ({panel.brand} {panel.model})
        </div>
        <table style={tbl}><thead><tr style={{borderBottom:`2px solid ${C.border}`}}>
          <th style={{padding:"8px 14px",textAlign:"left",color:C.muted,fontSize:11,width:"45%"}}>Parameter</th>
          <th style={{padding:"8px 12px",textAlign:"right",color:C.muted,fontSize:11}}>Formula</th>
          <th style={{padding:"8px 12px",textAlign:"right",color:C.yellow,fontSize:11}}>Value</th>
        </tr></thead><tbody>
          <SH label="Temp-Corrected Voltages" color={C.orange}/>
          <Row label="Voc corrected — winter" shade={false}><td style={{padding:"6px 12px",textAlign:"right",color:C.muted,fontSize:10}}>Voc×[1+β×(Tmin−25)]</td><Calc v={r.vocWin} unit="V"/></Row>
          <Row label="Vmp corrected — summer" shade={true}><td style={{padding:"6px 12px",textAlign:"right",color:C.muted,fontSize:10}}>Vmp×[1+β×(Tmax−25)]</td><Calc v={r.vmpSum} unit="V"/></Row>
          <Row label="Pmax corrected — summer" shade={false}><td style={{padding:"6px 12px",textAlign:"right",color:C.muted,fontSize:10}}>Pmax×[1+γ×(Tmax−25)]</td><Calc v={r.pmaxSum} unit="Wp"/></Row>
          <SH label="String Configuration" color={C.yellow}/>
          <Row label="N_max / N_min" shade={true}><td/><Calc v={`${r.nMax} / ${r.nMin}`}/></Row>
          <Row label="▶ Selected modules / string" shade={false}><td/><Calc v={r.nSel} dp={0} big/></Row>
          <Row label="▶ Number of strings" shade={true}><td/><Calc v={r.nStr} dp={0} big/></Row>
          <Row label="▶ Total panels" shade={false}><td/><Calc v={r.totP} dp={0} big/></Row>
          <Row label="▶ Actual array (kWp)" shade={true}><td/><Calc v={r.actKwp} unit="kWp" dp={2} big/></Row>
          <Row label="DC/AC ratio" shade={false}><td/><Calc v={r.dcAc} dp={2}/></Row>
          <Row label={`Annual yield — ${inp.yieldMode==="p90"?"P90 (×0.92)":"TMY P50"}`} shade={true} note="12 months × temp-corrected η">
            <td style={{padding:"6px 12px",textAlign:"right",color:C.green,fontSize:10}}>{inp.yieldMode==="p90"?"P90":"P50"}</td>
            <Calc v={yGen} unit="kWh/yr" dp={0} big/>
          </Row>
          <Row label="Annual yield — flat PSH" shade={false} note="Legacy single-PSH estimate">
            <td/><Calc v={r.annGenFlat} unit="kWh/yr" dp={0}/>
          </Row>
          <Row label="Roof feasibility" shade={true}><td/><Calc v={r.roofFit?"PASS — fits roof":"REVIEW — check roof"}/></Row>
          {r.roofCapped && (
            <Row label="⚠ Array roof-capped" shade={false} note={`Needed ${r.cappedKwp.toFixed(1)} kWp, limited to ${r.actKwp.toFixed(1)} kWp by roof`}>
              <td/>
              <Calc v={`${r.coverageActual.toFixed(0)}% actual vs ${r.effPct.toFixed(0)}% target`}/>
            </Row>
          )}
        </tbody></table>
      </div>

      <div style={cardS(r.rowShadeOk ? C.green : C.orange)}>
        <div style={{padding:"10px 14px",color:"white",fontWeight:800,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>📐 Inter-Row Shading Analysis — Dec 21, 9am (Solar alt. {r.solarAltDeg != null ? r.solarAltDeg.toFixed(1) : "18.0"}°, lat {(inp.lat||30).toFixed(1)}°)</span>
          <span style={{fontSize:10,padding:"3px 10px",borderRadius:12,fontWeight:700,
            background:`${inp.mountMode==="ground"?C.yellow:inp.mountMode==="hybrid"?C.green:C.accent}22`,
            color:inp.mountMode==="ground"?C.yellow:inp.mountMode==="hybrid"?C.green:C.accent}}>
            {inp.mountMode==="ground"?"🌱 Ground Mount":inp.mountMode==="hybrid"?"🏠+🌱 Hybrid":"🏠 Rooftop"}
          </span>
        </div>
        <table style={tbl}><TblHead label="Result" calcCol={r.rowShadeOk?C.green:C.orange}/><tbody>
          <SH label="Panel Geometry" color={C.yellow}/>
          <Row label="Tilt angle" shade={false}><td/><Calc v={inp.tiltDeg} unit="°" dp={0}/></Row>
          <Row label="Panel vertical projection" shade={true} note="L × sin(tilt)">
            <td style={{padding:"6px 12px",textAlign:"right",color:C.muted,fontSize:10}}>L·sin(tilt)</td>
            <Calc v={r.panelVertM} unit="m" dp={2}/>
          </Row>
          <Row label="Panel base (horizontal)" shade={false} note="L × cos(tilt)">
            <td style={{padding:"6px 12px",textAlign:"right",color:C.muted,fontSize:10}}>L·cos(tilt)</td>
            <Calc v={r.panelBaseM} unit="m" dp={2}/>
          </Row>
          <SH label="Minimum Row Pitch" color={C.orange}/>
          <Row label="Solar altitude (design)" shade={false} note="Dec 21, 9am — conservative">
            <td/><Calc v="18°"/>
          </Row>
          <Row label="▶ Min pitch (no shading)" shade={true} note="base + vert/tan(18°)">
            <td style={{padding:"6px 12px",textAlign:"right",color:C.muted,fontSize:10}}>base+vert/tan(18°)</td>
            <Calc v={r.minPitch} unit="m" dp={2} big/>
          </Row>
          <SH label="Roof Capacity Check" color={r.rowShadeOk?C.green:C.orange}/>
          <Row label="Roof depth (N–S)" shade={false} note="Set in Other Inputs">
            <td/><Calc v={inp.roofDepthM||12} unit="m" dp={0}/>
          </Row>
          <Row label="▶ Max rows without shading" shade={true}><td/><Calc v={r.maxRows} dp={0} big/></Row>
          <Row label="▶ Panels per row" shade={false}><td/><Calc v={r.panelsPerRow} dp={0}/></Row>
          <Row label="▶ Max panels (shade-free)" shade={true}><td/><Calc v={r.maxPanelsNoShade} dp={0} big/></Row>
          <Row label="▶ Designed panel count" shade={false}><td/><Calc v={r.totP} dp={0}/></Row>
          <Row label="Row spacing status" shade={true}><td/><Calc v={r.rowShadeOk?"PASS":"REVIEW — reduce or respace"} big/></Row>
          <Row label="Est. inter-row shading loss" shade={false}><td/><Calc v={r.rowShadeOk?0:r.interRowLossPct} unit="%" dp={1}/></Row>
        </tbody></table>
        {!r.rowShadeOk && (
          <div style={{padding:"10px 16px",background:`${C.orange}15`,borderLeft:`4px solid ${C.orange}`,
            fontSize:11,color:C.orange,margin:"0 0 8px"}}>
            ⚠ Array ({r.totP} panels) exceeds shade-free limit ({r.maxPanelsNoShade} panels) for {inp.roofDepthM||12}m
            roof depth at {inp.tiltDeg}° tilt. Either reduce panel count to {r.maxPanelsNoShade},
            increase row pitch, or increase roof depth in Other Inputs.
          </div>
        )}
      </div>
    </div>
  );
}
