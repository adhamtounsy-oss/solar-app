import { C } from "../constants/index.js";
import { cardS, tbl } from "../components/ui/primitives.jsx";

export default function BomTab({ r, inp, panel, inverter, battery, fmtE }) {
  if (!r) return <div style={{color:C.muted,padding:20}}>Select components first.</div>;
  const BOM_ITEMS = [
    {cat:"DC Protection",  item:"DC String Fuse per string", unit:"ea", unitEGP:180,  qty:r.nStr},
    {cat:"DC Protection",  item:"DC SPD Type 2",             unit:"ea", unitEGP:950,  qty:1},
    {cat:"DC Protection",  item:"DC Isolator 1000V",         unit:"ea", unitEGP:650,  qty:1},
    {cat:"AC Protection",  item:"AC MCB Type C",             unit:"ea", unitEGP:420,  qty:1},
    {cat:"AC Protection",  item:"AC SPD Type 2",             unit:"ea", unitEGP:750,  qty:1},
    {cat:"AC Protection",  item:"AC RCD 30mA",               unit:"ea", unitEGP:580,  qty:1},
    {cat:"Cabling", item:`DC String Cable ${r.csaStr||4}mm² PV1-F (m)`,  unit:"m", unitEGP:r.csaStr>=10?38:r.csaStr>=6?25:18,  qty:Math.round(inp.lenStringM*(r.nStr||1)*2)},
    {cat:"Cabling", item:`DC Feeder Cable ${r.csaFdr||16}mm² PV1-F (m)`, unit:"m", unitEGP:r.csaFdr>=25?85:r.csaFdr>=16?55:35, qty:Math.round(inp.lenFeederM*2)},
    {cat:"Cabling", item:`AC Cable ${r.csaAC||10}mm² XLPE (m)`,          unit:"m", unitEGP:r.csaAC>=25?90:r.csaAC>=16?65:48,  qty:Math.round(inp.lenACM*3)},
    {cat:"Cabling", item:"Battery Cable 35mm² (m)",                       unit:"m", unitEGP:120, qty:Math.round(inp.lenBatteryM*2)},
    {cat:"Mounting",       item:"Roof Rail per 4m",          unit:"ea", unitEGP:480,  qty:Math.ceil(r.totP/4)},
    {cat:"Mounting",       item:"Clamp Set per 4 panels",    unit:"set",unitEGP:220,  qty:Math.ceil(r.totP/4)},
    {cat:"Monitoring",     item:"Monitoring Gateway",        unit:"ea", unitEGP:3500, qty:1},
    {cat:"Monitoring",     item:"CT Sensor per phase",       unit:"ea", unitEGP:280,  qty:3},
    {cat:"Civil",          item:"Cable Conduit (m)",         unit:"m",  unitEGP:45,   qty:Math.round(inp.lenStringM+inp.lenACM)},
    {cat:"Civil",          item:"Earthing Rod + Cable",      unit:"set",unitEGP:1200, qty:1},
    {cat:"Civil",          item:"Warning Labels",            unit:"set",unitEGP:350,  qty:1},
    {cat:"Grid",           item:"NCEDC Application Fee",     unit:"ea", unitEGP:8500, qty:1},
    {cat:"Grid",           item:"Smart Export Meter",        unit:"ea", unitEGP:4200, qty:1},
  ].map(x => ({...x, totalEGP: x.qty * x.unitEGP}));

  const bomTotal   = BOM_ITEMS.reduce((s,x) => s+x.totalEGP, 0);
  const grandTotal = bomTotal + r.arrayCostEGP + r.invCostEGP + r.batCostEGP;
  const cats = [...new Set(BOM_ITEMS.map(x => x.cat))];

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:14}}>
        {[
          {l:"PV Array",   v:fmtE(r.arrayCostEGP), c:C.yellow},
          {l:"Inverter",   v:fmtE(r.invCostEGP),   c:"#8b5cf6"},
          {l:"Battery",    v:fmtE(r.batCostEGP),   c:C.blue},
          {l:"BOM Items",  v:fmtE(bomTotal),         c:"#84cc16"},
          {l:"Grand Total",v:fmtE(grandTotal),       c:C.green},
          {l:"Per kWp",    v:fmtE(grandTotal/r.actKwp), c:C.muted},
        ].map(k => (
          <div key={k.l} style={{background:C.card,borderRadius:10,padding:"12px 14px",
            borderLeft:"4px solid " + k.c}}>
            <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>{k.l}</div>
            <div style={{fontSize:16,fontWeight:800,color:k.c}}>{k.v}</div>
          </div>
        ))}
      </div>
      <div style={cardS("#84cc16")}>
        <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13,
          display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
          <span>Bill of Materials — {inp.nVillas} Villa{inp.nVillas > 1 ? "s" : ""}</span>
          <span style={{fontWeight:400,fontSize:10,color:"rgba(255,255,255,0.7)"}}>
            {inp.address && <span>{inp.address}</span>}
            {inp.lat && <span> · {(inp.lat).toFixed(4)}°N, {(inp.lon||0).toFixed(4)}°E</span>}
            {inp.elevationM != null && <span> · {Math.round(inp.elevationM)} m ASL</span>}
          </span>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{...tbl,fontSize:11}}>
            <thead>
              <tr style={{borderBottom:"2px solid " + C.border}}>
                {["Category","Item","Qty","Unit","Unit EGP","Total EGP"].map(h => (
                  <th key={h} style={{padding:"7px 10px",textAlign:"right",color:C.muted,
                    fontWeight:600,whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr style={{background:C.yellow + "18"}}>
                <td colSpan={6} style={{padding:"5px 10px",color:C.yellow,fontWeight:800,
                  fontSize:10,textTransform:"uppercase"}}>Major Components</td>
              </tr>
              {[
                {item:(panel&&panel.brand) + " " + (panel&&panel.model), qty:r.totP, unit:"ea", unitEGP:Math.round(r.arrayCostEGP/r.totP), totalEGP:r.arrayCostEGP},
                {item:(inverter&&inverter.brand) + " " + (inverter&&inverter.model), qty:1, unit:"ea", unitEGP:r.invCostEGP, totalEGP:r.invCostEGP},
                {item:(battery&&battery.brand) + " " + (battery&&battery.model), qty:1, unit:"ea", unitEGP:r.batCostEGP, totalEGP:r.batCostEGP},
              ].map((b,i) => (
                <tr key={b.item} style={{background:i%2===0?"transparent":"#070f1f",
                  borderBottom:"1px solid " + C.border}}>
                  <td style={{padding:"5px 10px",color:C.muted,fontSize:10}}>Equipment</td>
                  <td style={{padding:"5px 10px",color:C.text,fontSize:11}}>{b.item}</td>
                  <td style={{padding:"5px 10px",textAlign:"right",color:C.text}}>{b.qty}</td>
                  <td style={{padding:"5px 10px",textAlign:"right",color:C.muted}}>{b.unit}</td>
                  <td style={{padding:"5px 10px",textAlign:"right",color:C.muted}}>{(b.unitEGP/1000).toFixed(1)}K</td>
                  <td style={{padding:"5px 10px",textAlign:"right",color:C.yellow,fontWeight:700}}>
                    {fmtE(b.totalEGP)}
                  </td>
                </tr>
              ))}
              {cats.flatMap(cat => [
                <tr key={"hdr-" + cat} style={{background:"#84cc1618"}}>
                  <td colSpan={6} style={{padding:"5px 10px",color:"#84cc16",fontWeight:800,
                    fontSize:10,textTransform:"uppercase"}}>{cat}</td>
                </tr>,
                ...BOM_ITEMS.filter(x => x.cat === cat).map((b,i) => (
                  <tr key={b.item} style={{background:i%2===0?"transparent":"#070f1f",
                    borderBottom:"1px solid " + C.border}}>
                    <td style={{padding:"5px 10px",color:C.muted,fontSize:10}}>{b.cat}</td>
                    <td style={{padding:"5px 10px",color:C.text,fontSize:11}}>{b.item}</td>
                    <td style={{padding:"5px 10px",textAlign:"right",color:C.accent}}>{b.qty}</td>
                    <td style={{padding:"5px 10px",textAlign:"right",color:C.muted}}>{b.unit}</td>
                    <td style={{padding:"5px 10px",textAlign:"right",color:C.muted}}>{b.unitEGP.toLocaleString()}</td>
                    <td style={{padding:"5px 10px",textAlign:"right",color:"#84cc16",fontWeight:600}}>
                      {(b.totalEGP/1000).toFixed(1)}K
                    </td>
                  </tr>
                )),
              ])}
              <tr style={{background:C.green + "18",borderTop:"2px solid " + C.green}}>
                <td colSpan={5} style={{padding:"9px 10px",color:C.green,fontWeight:800}}>
                  Grand Total (per villa)
                </td>
                <td style={{padding:"9px 10px",textAlign:"right",color:C.green,fontWeight:800,fontSize:14}}>
                  {fmtE(grandTotal)}
                </td>
              </tr>
              <tr style={{background:C.green + "08"}}>
                <td colSpan={5} style={{padding:"7px 10px",color:C.muted,fontSize:11}}>
                  {inp.nVillas} Villa{inp.nVillas > 1 ? "s" : ""} Total
                </td>
                <td style={{padding:"7px 10px",textAlign:"right",color:C.green,fontWeight:800,fontSize:13}}>
                  {fmtE(grandTotal * inp.nVillas)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
