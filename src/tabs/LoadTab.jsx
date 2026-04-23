import { C, WIN_HRS } from "../constants/index.js";
import { cardS, tbl } from "../components/ui/primitives.jsx";
import { fractionsFromSlots, PROF_KEYS_ALL } from "../lib/profile.js";

const BAND_LABELS = [
  {l:"Night 00–06h",  c:"#47556930", n:12},
  {l:"Morning 06–10h",c:`${C.yellow}30`, n:8},
  {l:"Day 10–17h",    c:`${C.accent}30`, n:14},
  {l:"Evening 17–23h",c:`${C.purple}30`, n:12},
  {l:"Night 23–24h",  c:"#47556930", n:2},
];

const APPLIANCES = [
  {pk:"prof_AC",     icon:"❄", label:"Air Conditioning"},
  {pk:"prof_Light",  icon:"💡", label:"Lighting"},
  {pk:"prof_WH",     icon:"🚿", label:"Water Heater"},
  {pk:"prof_Kitchen",icon:"🍳", label:"Kitchen"},
  {pk:"prof_Laundry",icon:"👗", label:"Laundry"},
  {pk:"prof_Pool",   icon:"🏊", label:"Pool Pump"},
  {pk:"prof_Misc",   icon:"🔌", label:"Miscellaneous"},
];

const METHOD_OPTS = [
  {
    id:"bill", icon:"🧾", title:"Bill-Based Estimate",
    accuracy:25, accuracyLabel:"±25–35%", accuracyColor:C.orange,
    desc:"Enter your monthly electricity bill. The engine back-calculates daily consumption from tariff. Fast — no appliance breakdown needed.",
    unlocks:"Array sizing only. Battery sizing and self-consumption are approximate.",
    limits:true,
  },
  {
    id:"profile", icon:"🕐", title:"Time-of-Day Profile",
    accuracy:90, accuracyLabel:"±8–12%", accuracyColor:C.green,
    desc:"Set the fraction of each appliance active in morning, daytime, and evening windows. Produces a real 24h demand curve.",
    unlocks:"Enables full hourly dispatch simulation, accurate battery sizing, and real self-consumption calculation.",
    limits:false,
  },
];

export default function LoadTab({
  r, inp, upd, profile, cs,
  meterData, setMeterData, meterMsg, setMeterMsg, handleMeterCSV,
  loadSlots, setLoadSlots, loadDragRef,
}) {
  if (!r) return <div style={{color:C.muted,padding:20}}>Select components first.</div>;

  const method = inp.loadMethod || "profile";
  const {demand, solarShape, totalKwh} = profile;

  const totalSolarGen = r.actKwp * r.etaSys * inp.pshDesign;
  const genNorm = solarShape.reduce((s,v) => s+v, 0);
  const hourlyGenDisp = solarShape.map(s => genNorm > 0 ? (totalSolarGen*s)/genNorm : 0);
  const scH = demand.map((d,h) => Math.min(d, hourlyGenDisp[h]));
  const totalSC = scH.reduce((s,v) => s+v, 0);
  const scPct = r.annSCPct != null ? r.annSCPct.toFixed(0)
              : (totalSolarGen > 0 ? ((totalSC/totalSolarGen)*100).toFixed(0) : "0");
  const eveningDef = demand.slice(17,23).reduce((s,v) => s+v, 0);
  const maxY = Math.max(...demand, ...hourlyGenDisp, 0.1);

  const sI = {width:"52px",background:"#0f172a",border:`1px solid ${C.border}`,
    borderRadius:5,color:C.text,fontSize:11,padding:"3px 6px",textAlign:"right"};

  function applyRange(pk, slots, lo, hi, nv) {
    const cur = loadDragRef.current?.working?.[pk] || slots;
    const next = [...cur];
    let changed = false;
    for (let i = lo; i <= hi; i++) { if (next[i] !== nv) { next[i] = nv; changed = true; } }
    if (!changed) return;
    const newAll = {...(loadDragRef.current?.working || loadSlots), [pk]: next};
    if (loadDragRef.current) loadDragRef.current.working = newAll;
    setLoadSlots(newAll);
    upd(pk, fractionsFromSlots(next));
  }

  return (
    <div>
      {/* Smart Meter CSV import */}
      <div style={cardS("#14b8a6")}>
        <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13,
          display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>Smart Meter CSV Import <span style={{fontSize:10,fontWeight:400,color:"#14b8a6cc"}}>(optional — overrides profile demand)</span></span>
          {meterData && <span style={{fontSize:11,color:C.green,fontWeight:700}}>Loaded</span>}
        </div>
        <div style={{padding:"12px 16px"}}>
          <div style={{fontSize:11,color:C.muted,marginBottom:10}}>
            Upload a smart meter CSV export with hourly kWh readings. Accepted column headers: kwh, energy, consumption, usage, import.
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            <label style={{padding:"7px 16px",background:"#14b8a6",color:C.bg,border:"none",
              borderRadius:8,fontWeight:800,fontSize:12,cursor:"pointer",display:"inline-block"}}>
              Choose CSV File
              <input type="file" accept=".csv,.txt" onChange={handleMeterCSV} style={{display:"none"}}/>
            </label>
            {meterData && (
              <button onClick={() => { setMeterData(null); setMeterMsg(""); }}
                style={{padding:"7px 12px",background:C.red+"22",color:C.red,
                  border:"1px solid "+C.red,borderRadius:8,fontSize:11,cursor:"pointer"}}>
                Clear
              </button>
            )}
          </div>
          {meterMsg && (
            <div style={{marginTop:10,fontSize:11,padding:"7px 12px",borderRadius:6,
              background:meterData?C.green+"18":C.red+"18",
              color:meterData?C.green:C.red,
              borderLeft:"3px solid "+(meterData?C.green:C.red)}}>
              {meterMsg}
            </div>
          )}
        </div>
      </div>

      {/* Method selector */}
      <div style={{marginBottom:16}}>
        <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1.2,
          fontWeight:700,marginBottom:10}}>⚡ Consumption Input Method</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          {METHOD_OPTS.map(m => {
            const active = method === m.id;
            return (
              <div key={m.id} onClick={() => upd("loadMethod", m.id)}
                style={{background:active?`${m.accuracyColor}10`:C.card,borderRadius:12,
                  padding:"16px 18px",cursor:"pointer",
                  border:`2px solid ${active?m.accuracyColor:C.border}`,
                  transition:"all 0.15s",position:"relative"}}>
                {active && <div style={{position:"absolute",top:12,right:14,
                  width:8,height:8,borderRadius:"50%",background:m.accuracyColor}}/>}
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                  <span style={{fontSize:22}}>{m.icon}</span>
                  <div>
                    <div style={{fontWeight:800,fontSize:13,color:active?m.accuracyColor:C.text}}>{m.title}</div>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginTop:4}}>
                      <div style={{width:80,background:C.border,borderRadius:4,height:5}}>
                        <div style={{width:`${m.accuracy}%`,background:m.accuracyColor,borderRadius:4,height:5}}/>
                      </div>
                      <span style={{fontSize:10,color:m.accuracyColor,fontWeight:700}}>{m.accuracyLabel}</span>
                    </div>
                  </div>
                </div>
                <div style={{fontSize:11,color:C.muted,lineHeight:1.6,marginBottom:8}}>{m.desc}</div>
                <div style={{fontSize:10,padding:"5px 8px",borderRadius:6,
                  background:m.limits?`${C.orange}18`:`${C.green}18`,
                  color:m.limits?C.orange:C.green,lineHeight:1.5}}>
                  {m.limits?"⚠ ":"✓ "}{m.unlocks}
                </div>
              </div>
            );
          })}
        </div>

        {method === "bill" && (
          <div style={cardS(C.orange)}>
            <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}>🧾 Monthly Bill Input</div>
            <div style={{padding:"16px 20px"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,alignItems:"center",marginBottom:14}}>
                <div>
                  <div style={{fontSize:12,color:C.muted,marginBottom:6}}>Monthly electricity bill ({inp.currency||"EGP"})</div>
                  <input type="number" value={inp.monthlyBillEGP} step={500} min={0}
                    onChange={e => upd("monthlyBillEGP", parseFloat(e.target.value)||0)}
                    style={{width:"100%",background:"#0f172a",border:`2px solid ${C.orange}`,
                      borderRadius:8,color:C.orange,fontSize:22,fontWeight:800,
                      padding:"10px 14px",textAlign:"right"}}/>
                  <div style={{fontSize:10,color:C.muted,marginTop:4}}>
                    Current tariff: {cs}{inp.tariffNow}/kWh · Set in Financial inputs
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  {[
                    {l:"Est. daily consumption",   v:`${r.billDailyKwh!=null?r.billDailyKwh.toFixed(1):"—"} kWh`,     c:C.orange},
                    {l:"Est. monthly consumption", v:`${r.billDailyKwh!=null?(r.billDailyKwh*30.5).toFixed(0):"—"} kWh`,c:C.orange},
                    {l:"Profile baseline",         v:`${r.profileDailyKwh!=null?r.profileDailyKwh.toFixed(1):"—"} kWh/day`,c:C.muted},
                    {l:"Bill scale factor",        v:`${r.billScale!=null?r.billScale.toFixed(2):"—"}×`,
                      c:r.billScale&&(r.billScale>2||r.billScale<0.3)?C.red:C.muted},
                  ].map(k => (
                    <div key={k.l} style={{background:"#0f172a",borderRadius:8,padding:"8px 10px"}}>
                      <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",marginBottom:2}}>{k.l}</div>
                      <div style={{fontSize:13,fontWeight:800,color:k.c}}>{k.v}</div>
                    </div>
                  ))}
                </div>
              </div>
              {r.billScale && (r.billScale > 2.5 || r.billScale < 0.4) && (
                <div style={{padding:"8px 12px",background:`${C.red}18`,borderRadius:8,
                  fontSize:11,color:C.red,borderLeft:`3px solid ${C.red}`}}>
                  ⚠ Bill scale factor is {r.billScale.toFixed(2)}× — the appliance list and bill
                  are very mismatched. Check that the tariff is correct and appliances are representative.
                  Consider switching to Time-of-Day Profile for better accuracy.
                </div>
              )}
              <div style={{marginTop:10,padding:"8px 12px",background:"#0f172a",borderRadius:8,
                fontSize:10,color:C.muted,lineHeight:1.6,borderLeft:`3px solid ${C.orange}`}}>
                <strong style={{color:C.orange}}>How this works:</strong> The engine uses your
                appliance list to determine the <em>shape</em> of consumption (which loads run when),
                then scales all loads proportionally so the daily total matches your bill.
                Accuracy improves significantly if you also set the profile fractions below —
                but the bill total overrides the profile total.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Profile section */}
      <div style={{opacity:method==="bill"?0.6:1,transition:"opacity 0.2s"}}>
        {method === "bill" && (
          <div style={{fontSize:11,color:C.muted,marginBottom:8,
            padding:"6px 12px",background:C.card,borderRadius:8,
            borderLeft:`3px solid ${C.orange}`}}>
            ℹ Appliance fractions below determine <em>when</em> consumption happens
            (morning / day / evening split). The total is set by your bill above.
          </div>
        )}

        {/* KPI strip */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:14}}>
          {[
            {l:"Daily consumption",   v:`${r.loadTot.toFixed(1)} kWh`,          c:C.orange, note:method==="bill"?"from bill":"from profile"},
            {l:"Evening demand",      v:`${eveningDef.toFixed(1)} kWh`,          c:C.blue,   note:"17–23h"},
            {l:"Solar self-consumed", v:`${scPct}%`,                             c:C.green,  note:"of generation"},
            {l:"Battery target",      v:`${r.eveningDeficit.toFixed(1)} kWh`,    c:C.accent, note:"deficit to cover"},
            {l:"Peak demand",         v:`${r.peakKW.toFixed(1)} kW`,             c:C.yellow, note:"coincident"},
            {l:"Annual load",         v:`${(r.loadTot*365/1000).toFixed(1)} MWh`,c:C.muted,  note:"est."},
          ].map(k => (
            <div key={k.l} style={{background:C.card,borderRadius:10,padding:"12px 14px",borderLeft:`4px solid ${k.c}`}}>
              <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>{k.l}</div>
              <div style={{fontSize:14,fontWeight:800,color:k.c}}>{k.v}</div>
              <div style={{fontSize:9,color:C.muted,marginTop:2}}>{k.note}</div>
            </div>
          ))}
        </div>

        {/* 24h chart */}
        <div style={cardS(C.orange)}>
          <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}>
            24-Hour Demand vs Solar Generation
            {method === "bill" && <span style={{fontSize:10,color:C.orange,marginLeft:8,fontWeight:600}}>(shape from profile · total from bill)</span>}
          </div>
          <div style={{padding:"14px 20px"}}>
            <div style={{display:"flex",gap:16,marginBottom:8,flexWrap:"wrap",fontSize:10,color:C.muted}}>
              <span><span style={{color:C.orange}}>—</span> Demand</span>
              <span><span style={{color:C.yellow}}>—</span> Solar gen</span>
              <span><span style={{color:C.green}}>—</span> Self-consumed</span>
              <span style={{color:`${C.blue}cc`}}>— Evening 17–23h</span>
            </div>
            <div style={{display:"flex",gap:2,alignItems:"flex-end",height:96,
              borderBottom:`1px solid ${C.border}`,paddingBottom:2}}>
              {Array.from({length:24},(_,h) => {
                const d=demand[h], g=hourlyGenDisp[h], sc=scH[h];
                const isEve = h>=17&&h<=22;
                const bH = v => `${Math.round((v/maxY)*92)}px`;
                return (
                  <div key={h} style={{flex:1,display:"flex",alignItems:"flex-end",gap:1,
                    position:"relative",background:isEve?`${C.blue}12`:"transparent",borderRadius:2}}>
                    <div style={{flex:1,height:bH(d),background:`${C.orange}80`,borderRadius:"2px 2px 0 0",minHeight:d>0?2:0}}/>
                    <div style={{flex:1,height:bH(g),background:`${C.yellow}80`,borderRadius:"2px 2px 0 0",minHeight:g>0?2:0}}/>
                    <div style={{position:"absolute",bottom:0,left:0,width:"50%",
                      height:bH(sc),background:`${C.green}70`,borderRadius:"2px 2px 0 0"}}/>
                  </div>
                );
              })}
            </div>
            <div style={{display:"flex",gap:2,marginTop:3}}>
              {Array.from({length:24},(_,h) => (
                <div key={h} style={{flex:1,textAlign:"center",fontSize:8,
                  color:h%6===0?C.muted:"transparent"}}>{h}</div>
              ))}
            </div>
          </div>
        </div>

        {/* Appliance grid */}
        <div style={cardS(C.accent)}>
          <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}>
            ⚡ Appliance Ratings & Time-of-Day Profile
            <span style={{fontSize:10,fontWeight:400,color:`${C.accent}cc`,marginLeft:10}}>
              click or drag to select active hours
            </span>
          </div>
          {APPLIANCES.map(({pk,icon,label},li) => {
            const slots = loadSlots[pk] || new Array(48).fill(false);
            const fr = fractionsFromSlots(slots);
            const kw = [
              inp.acUnits*inp.acTonnage*(3.517/(inp.acCOP||3.0)),
              (inp.lightingAreaM2*8)/1000,
              inp.whKW, inp.kitchenW/1000, inp.laundryW/1000, inp.poolKW, inp.miscKW,
            ][li];
            const dailyKwh = fr.reduce((s,f,i) => s+f*WIN_HRS[i], 0) * kw * (method==="bill" ? r.billScale : 1);

            function applySlot(si, nv) {
              const cur = loadDragRef.current?.working?.[pk] || slots;
              if (cur[si] === nv) return;
              const next = [...cur]; next[si] = nv;
              const newAll = {...(loadDragRef.current?.working||loadSlots), [pk]: next};
              if (loadDragRef.current) loadDragRef.current.working = newAll;
              setLoadSlots(newAll);
              upd(pk, fractionsFromSlots(next));
            }

            function onMove(clientX, rect) {
              if (!loadDragRef.current || loadDragRef.current.pk !== pk) return;
              const si = Math.min(47, Math.max(0, Math.floor((clientX - rect.left) / 15)));
              const last = loadDragRef.current.lastSlot ?? si;
              applyRange(pk, slots, Math.min(si,last), Math.max(si,last), loadDragRef.current.mode==='select');
              loadDragRef.current.lastSlot = si;
            }

            return (
              <div key={pk} style={{padding:"8px 16px",borderBottom:`1px solid ${C.border}`}}>
                {/* Row 1: name left | specs + kWh/day right */}
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,marginBottom:8,flexWrap:"wrap"}}>
                  <div style={{fontSize:12,fontWeight:700,color:C.text,flexShrink:0}}>{icon} {label}</div>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
                    {li===0 && <>
                      {[{l:"Units",k:"acUnits",s:1,min:1},{l:"Tons",k:"acTonnage",s:0.5,min:0.5},{l:"COP",k:"acCOP",s:0.5,min:1},
                        {l:"Summer h",k:"acHrsSummer",s:0.5,min:0,max:24},{l:"Winter h",k:"acHrsWinter",s:0.5,min:0,max:24}]
                        .map(({l,k,s,min,max}) => (
                          <div key={k} style={{textAlign:"center"}}>
                            <div style={{fontSize:8,color:C.muted,marginBottom:2}}>{l}</div>
                            <input type="number" value={inp[k]} step={s} min={min} max={max}
                              onChange={e => upd(k, parseFloat(e.target.value)||min)} style={sI}/>
                          </div>
                        ))}
                      <div style={{fontSize:9,color:C.accent}}>{kw.toFixed(2)} kW</div>
                    </>}
                    {li===1 && <>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontSize:8,color:C.muted,marginBottom:2}}>Area m²</div>
                        <input type="number" value={inp.lightingAreaM2} step={10} min={0}
                          onChange={e => upd("lightingAreaM2", parseFloat(e.target.value)||0)} style={sI}/>
                      </div>
                      <div style={{fontSize:9,color:C.accent}}>{kw.toFixed(2)} kW</div>
                    </>}
                    {li===2 && <div style={{textAlign:"center"}}>
                      <div style={{fontSize:8,color:C.muted,marginBottom:2}}>kW</div>
                      <input type="number" value={inp.whKW} step={0.5} min={0}
                        onChange={e => upd("whKW", parseFloat(e.target.value)||0)} style={sI}/>
                    </div>}
                    {li===3 && <>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontSize:8,color:C.muted,marginBottom:2}}>Watts</div>
                        <input type="number" value={inp.kitchenW} step={100} min={0}
                          onChange={e => upd("kitchenW", parseFloat(e.target.value)||0)} style={sI}/>
                      </div>
                      <div style={{fontSize:9,color:C.accent}}>{kw.toFixed(2)} kW</div>
                    </>}
                    {li===4 && <>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontSize:8,color:C.muted,marginBottom:2}}>Watts</div>
                        <input type="number" value={inp.laundryW} step={100} min={0}
                          onChange={e => upd("laundryW", parseFloat(e.target.value)||0)} style={sI}/>
                      </div>
                      <div style={{fontSize:9,color:C.accent}}>{kw.toFixed(2)} kW</div>
                    </>}
                    {li===5 && <div style={{textAlign:"center"}}>
                      <div style={{fontSize:8,color:C.muted,marginBottom:2}}>kW</div>
                      <input type="number" value={inp.poolKW} step={0.5} min={0}
                        onChange={e => upd("poolKW", parseFloat(e.target.value)||0)} style={sI}/>
                    </div>}
                    {li===6 && <div style={{textAlign:"center"}}>
                      <div style={{fontSize:8,color:C.muted,marginBottom:2}}>kW</div>
                      <input type="number" value={inp.miscKW} step={0.5} min={0}
                        onChange={e => upd("miscKW", parseFloat(e.target.value)||0)} style={sI}/>
                    </div>}
                    <div style={{textAlign:"right",borderLeft:`1px solid ${C.border}`,paddingLeft:8,flexShrink:0}}>
                      <div style={{fontSize:18,fontWeight:800,color:C.yellow}}>{dailyKwh.toFixed(1)}</div>
                      <div style={{fontSize:9,color:C.muted}}>kWh/day</div>
                    </div>
                  </div>
                </div>

                {/* Row 2: 48-slot grid */}
                <div style={{overflowX:"auto"}}>
                  <div style={{minWidth:719}}>
                    {/* Band labels */}
                    <div style={{display:"flex",gap:1,marginBottom:3}}>
                      {BAND_LABELS.map(({l,c,n},i) => (
                        <div key={i} style={{width:15*n-1,flexShrink:0,boxSizing:"border-box",
                          background:c,borderRadius:2,padding:"1px 3px",fontSize:8,
                          fontWeight:700,color:C.muted,textAlign:"center",height:14,lineHeight:"12px",
                          overflow:"hidden",whiteSpace:"nowrap"}}>{l}</div>
                      ))}
                    </div>
                    {/* Slot boxes */}
                    <div style={{display:"flex",gap:1,userSelect:"none"}}
                      onMouseMove={e => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
                      onTouchMove={e => { e.preventDefault(); onMove(e.touches[0].clientX, e.currentTarget.getBoundingClientRect()); }}
                      onTouchEnd={() => { if (loadDragRef.current?.pk===pk) loadDragRef.current=null; }}
                    >
                      {Array.from({length:48},(_,si) => {
                        const active = (slots||[])[si] || false;
                        const inM=si>=12&&si<20, inD=si>=20&&si<34, inE=si>=34&&si<46;
                        const bg = active
                          ? (inM?C.yellow:inD?C.accent:inE?C.purple:"#475569")
                          : (inM?`${C.yellow}28`:inD?`${C.accent}28`:inE?`${C.purple}28`:"#0f172a");
                        return (
                          <div key={si} data-slot={si} data-pk={pk}
                            style={{width:14,height:20,borderRadius:2,background:bg,cursor:"pointer",flexShrink:0,
                              boxShadow:active?`0 0 4px ${inM?C.yellow:inD?C.accent:inE?C.purple:"#475569"}60`:undefined}}
                            onMouseDown={e => {
                              e.preventDefault();
                              const nv = !active;
                              loadDragRef.current = {pk, mode:nv?'select':'deselect', working:{...loadSlots}, lastSlot:si};
                              applySlot(si, nv);
                            }}
                            onTouchStart={e => {
                              e.preventDefault();
                              const nv = !active;
                              loadDragRef.current = {pk, mode:nv?'select':'deselect', working:{...loadSlots}, lastSlot:si};
                              applySlot(si, nv);
                            }}
                          />
                        );
                      })}
                    </div>
                    {/* Time labels */}
                    <div style={{position:"relative",height:14,marginTop:3}}>
                      {[[0,"00:00"],[12,"06:00"],[20,"10:00"],[34,"17:00"],[46,"23:00"]].map(([slot,time]) => (
                        <div key={slot} style={{position:"absolute",left:`${slot*15}px`,
                          fontSize:8,color:C.muted,transform:"translateX(-50%)",whiteSpace:"nowrap"}}>
                          {time}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Load breakdown table */}
        <div style={cardS(C.yellow)}>
          <div style={{padding:"10px 16px",color:"white",fontWeight:800,fontSize:13}}>
            ⚡ Load Breakdown
            {method==="bill" && <span style={{fontSize:10,fontWeight:600,color:C.orange,marginLeft:8}}>
              scaled {r.billScale?.toFixed(2)}× to match bill
            </span>}
          </div>
          <table style={tbl}><thead><tr style={{borderBottom:`2px solid ${C.border}`}}>
            <th style={{padding:"8px 14px",textAlign:"left",color:C.muted,fontSize:11,width:"28%"}}>Load</th>
            <th style={{padding:"8px 10px",textAlign:"right",color:C.yellow,fontSize:11}}>kW</th>
            <th style={{padding:"8px 10px",textAlign:"right",color:C.orange,fontSize:11}}>kWh/day</th>
            <th style={{padding:"8px 10px",textAlign:"right",color:C.muted,fontSize:11}}>Eff. hrs</th>
            <th style={{padding:"8px 10px",textAlign:"center",color:C.orange,fontSize:11}}>Supply</th>
          </tr></thead><tbody>
            {Object.entries(r.loadMap).map(([n,{kWh,kW,solar}],i) => (
              <tr key={n} style={{background:i%2===0?"transparent":"#070f1f",borderBottom:`1px solid #1e293b`}}>
                <td style={{padding:"6px 14px",color:C.muted,fontSize:11}}>{n}</td>
                <td style={{padding:"6px 10px",textAlign:"right",color:C.text,fontSize:12}}>{kW.toFixed(2)}</td>
                <td style={{padding:"6px 10px",textAlign:"right",color:C.text,fontSize:12}}>{kWh.toFixed(2)}</td>
                <td style={{padding:"6px 10px",textAlign:"right",color:C.muted,fontSize:11}}>
                  {kW>0?(kWh/kW).toFixed(1):"—"}h
                </td>
                <td style={{padding:"6px 10px",textAlign:"center"}}>
                  <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:10,
                    background:inp.coverageMode==="percentage"?C.border:solar?`${C.orange}22`:C.border,
                    color:inp.coverageMode==="percentage"?C.muted:solar?C.orange:C.muted}}>
                    {inp.coverageMode==="percentage"?"BLENDED":solar?"☀ SOLAR":"🔌 GRID"}
                  </span>
                </td>
              </tr>
            ))}
            <tr style={{background:`${C.orange}12`,borderTop:`2px solid ${C.orange}`}}>
              <td style={{padding:"8px 14px",fontWeight:800,color:C.orange,fontSize:12}}>TOTAL</td>
              <td style={{padding:"8px 10px",textAlign:"right",fontWeight:800,color:C.yellow}}>{r.peakKW.toFixed(2)}</td>
              <td style={{padding:"8px 10px",textAlign:"right",fontWeight:800,color:C.orange}}>{r.loadTot.toFixed(2)}</td>
              <td style={{padding:"8px 10px",textAlign:"right",color:C.muted,fontSize:11}}>
                {r.peakKW>0?(r.loadTot/r.peakKW).toFixed(1):"—"}h avg
              </td>
              <td style={{padding:"8px 10px",textAlign:"center",color:C.orange,fontSize:11,fontWeight:700}}>
                {r.effPct.toFixed(0)}% solar
              </td>
            </tr>
          </tbody></table>
        </div>
      </div>
    </div>
  );
}
