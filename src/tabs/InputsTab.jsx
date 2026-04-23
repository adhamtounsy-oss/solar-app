import { C, DESIGN_PSH } from "../constants/index.js";
import { cardS, tbl, SH, Row, TblHead } from "../components/ui/primitives.jsx";

export default function InputsTab({ inp, upd, r, usdRateLive }) {
  return (
    <div>
      <div style={{padding:"10px 14px",background:`${C.yellow}18`,borderRadius:8,marginBottom:12,
        fontSize:11,color:C.yellow,borderLeft:`3px solid ${C.yellow}`}}>
        🟡 Component specs set in <strong>📚 Equipment Library</strong>.
        Design PSH is <strong>locked to December TMY ({DESIGN_PSH}h)</strong> — always sized for worst month.
        Appliance ratings and load fractions set in <strong>⚡ Load</strong> tab.
      </div>
      {[
        {title:"Site & Supply", color:C.blue, fields:[
          {l:"Roof area (m²)",           k:"roofAreaM2",            s:10},
          {l:"Obstructions (m²)",        k:"roofObstructionsM2",    s:5},
          {l:"Latitude (°N)",            k:"lat",                   s:0.01, note:"Used for PVGIS fetch"},
          {l:"Longitude (°E)",           k:"lon",                   s:0.01, note:"Used for PVGIS fetch"},
          {l:"Panel azimuth",            k:"azimuth",               s:5,    note:"0=South, -90=East, +90=West"},
          {l:"Roof depth N–S (m)",       k:"roofDepthM",            s:1,    note:"Used for inter-row shading calculation"},
          {l:"Ground area (m²)",         k:"groundAreaM2",          s:10,   note:"For hybrid/ground mount — set in Coverage tab"},
          {l:"No. of villas",            k:"nVillas",               s:1},
          {l:"MDB busbar (A)",           k:"mdbBusbarA",            s:25},
          {l:`Monthly bill (${inp.currency||"EGP"})`, k:"monthlyBillEGP", s:500},
        ]},
        {title:"Site Conditions", color:C.red, fields:[
          {l:"Max ambient °C", k:"tAmbMax", s:1,
            note:inp.elevationM!=null&&inp.elevationM!==74
              ? `Site elev. ${Math.round(inp.elevationM)}m — lapse-rate applied in TMY fallback` : ""},
          {l:"Min ambient °C", k:"tAmbMin", s:1},
          {l:"Tilt angle (°)", k:"tiltDeg", s:1, note:"Affects TMY yield and row spacing"},
          ...((r?.noBat ?? false) ? [] : [{l:"Backup hours", k:"backupHours", s:1}]),
        ]},
        {title:"Cable Lengths (m)", color:C.red, fields:[
          {l:"DC string run",      k:"lenStringM",  s:1},
          {l:"DC feeder run",      k:"lenFeederM",  s:1},
          {l:"Battery–inverter",   k:"lenBatteryM", s:1},
          {l:"Inverter–MDB",       k:"lenACM",      s:1},
        ]},
        {title:"Financial", color:C.green, fields:[
          {l:`Current tariff (${inp.currency||"EGP"}/kWh)`, k:"tariffNow",      s:0.05},
          {l:"Tariff escalation (%pa)",                      k:"tariffEsc",      s:1},
          {l:`Annual O&M/villa (${inp.currency||"EGP"})`,   k:"omPerYear",      s:500},
          {l:"O&M escalation (%pa)",                         k:"omEsc",          s:1,
            note:"3%=CPI-linked (standard), 10%=Egypt inflation"},
          {l:"Discount rate (%pa)",                          k:"discountRate",   s:1,
            note:"For NPV — 12% = typical Egypt project WACC"},
          {l:"Panel degradation (%pa)",                      k:"panelDeg",       s:0.05},
          {l:"Analysis period (yr)",                         k:"analysisPeriod", s:1},
          {l:"Battery replace yr",                           k:"batReplaceYear", s:1},
          {l:"USD rate" + (usdRateLive ? " (live ✅)" : " (manual)"), k:"usdRate", s:1,
            note: usdRateLive
              ? `Auto-updated from open.er-api.com — ${inp.currency||"EGP"} ${usdRateLive}/USD`
              : `Enter current ${inp.currency||"EGP"}/USD rate`},
        ]},
      ].map(({title,color,fields}) => (
        <div key={title} style={cardS(color)}>
          <div style={{padding:"10px 14px",color:"white",fontWeight:800,fontSize:13}}>{title}</div>
          <table style={tbl}><TblHead label="—" calcCol={color}/><tbody>
            {fields.map(({l,k,s,note},i) => (
              <Row key={k} label={l} note={note} shade={i%2===0}>
                <td style={{padding:"4px 8px"}}>
                  <input type="number" value={inp[k]} step={s}
                    onChange={e => upd(k, parseFloat(e.target.value)||0)}
                    style={{width:"100%",background:"#1c1800",border:`1px solid ${C.yellow}44`,
                    borderRadius:6,color:C.yellow,fontSize:12,padding:"5px 8px",textAlign:"right"}}/>
                </td>
                <td style={{padding:"6px 12px",color:"#334155",fontSize:11,textAlign:"right",fontStyle:"italic"}}>—</td>
              </Row>
            ))}
          </tbody></table>
        </div>
      ))}
    </div>
  );
}
