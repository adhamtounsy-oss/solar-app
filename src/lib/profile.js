import { WIN_HRS } from "../constants/index.js";

// 48 half-hour slots: night 0-11, morning 12-19, day 20-33, evening 34-45, night 46-47
export const PROF_SLOT_WIN = [{start:12,count:8},{start:20,count:14},{start:34,count:12}];
export const PROF_KEYS_ALL = ["prof_AC","prof_Light","prof_WH","prof_Kitchen","prof_Laundry","prof_Pool","prof_Misc"];

export function slotsFromFractions(fr) {
  const s = new Array(48).fill(false);
  PROF_SLOT_WIN.forEach(({start,count},wi) => {
    const n = Math.round((fr[wi]||0) * count);
    for (let i = 0; i < n; i++) s[start+i] = true;
  });
  return s;
}

export function fractionsFromSlots(slots) {
  return PROF_SLOT_WIN.map(({start,count}) =>
    slots.slice(start, start+count).filter(Boolean).length / count
  );
}

export function initAllSlots(inp) {
  return Object.fromEntries(PROF_KEYS_ALL.map(pk => [pk, slotsFromFractions(inp[pk]||[0,0,0])]));
}

export function computeLoadProfile(inp, billScale, seasonalAcScale) {
  const bs  = billScale       != null ? billScale       : 1;
  const acs = seasonalAcScale != null ? seasonalAcScale : 1;
  // kW ratings
  const kws = {
    AC:      inp.acUnits * inp.acTonnage * (3.517 / (inp.acCOP||3.0)),  // 3.517 kW/ton ÷ COP
// (IEC 62548; COP 3.0 = older split, 4.5 = inverter-driven)
    Light:   (inp.lightingAreaM2 * 8) / 1000,  // 8 W/m² LED standard (Egyptian EEC 2016)
    WH:      inp.whKW,
    Kitchen: inp.kitchenW / 1000,
    Laundry: inp.laundryW / 1000,
    Pool:    inp.poolKW,
    Misc:    inp.miscKW,
  };
  const keys     = ["AC","Light","WH","Kitchen","Laundry","Pool","Misc"];
  const profKeys = ["prof_AC","prof_Light","prof_WH","prof_Kitchen","prof_Laundry","prof_Pool","prof_Misc"];

  // Build 24h demand (kW per hour)
  // Fix 5: AC uses seasonalAcScale independently; all loads use billScale
  const demand = Array(24).fill(0);



  for (let h = 0; h < 24; h++) {
    const win = h>=6&&h<=9 ? 0 : h>=10&&h<=16 ? 1 : h>=17&&h<=22 ? 2 : -1;
    if (win===-1) continue;
    keys.forEach((k, ki) => {
      const scale = k==="AC" ? acs*bs : bs;
      demand[h] += kws[k] * inp[profKeys[ki]][win] * scale;
    });
  }

  // Solar generation shape — sin bell 7-17h (unchanged)
  const solarShape = Array(24).fill(0);
  for (let h=7; h<=17; h++) solarShape[h] = Math.sin(Math.PI*(h-7)/10);

  // Daily kWh per window (for display)
  const morningKwh = keys.reduce((s,k,ki)=>{
    const scale = k==="AC" ? acs*bs : bs;
    return s + kws[k]*inp[profKeys[ki]][0]*WIN_HRS[0]*scale;
  }, 0);
  const dayKwh = keys.reduce((s,k,ki)=>{
    const scale = k==="AC" ? acs*bs : bs;
    return s + kws[k]*inp[profKeys[ki]][1]*WIN_HRS[1]*scale;
  }, 0);
  const eveningKwh = keys.reduce((s,k,ki)=>{
    const scale = k==="AC" ? acs*bs : bs;
    return s + kws[k]*inp[profKeys[ki]][2]*WIN_HRS[2]*scale;
  }, 0);

  return { demand, solarShape, morningKwh, dayKwh, eveningKwh,
           totalKwh: morningKwh+dayKwh+eveningKwh, kws };
}

export function seasonalAcScale(inp, monthIdx) {
  const summerM = new Set([5,6,7,8]);
  const winterM = new Set([11,0,1]);
  const acFr = inp.prof_AC || [0.3,0.8,0.6];
  const profileImpliedHrs = acFr.reduce((s,f,i)=>s+f*WIN_HRS[i], 0) || 1;
  const actualHrs = summerM.has(monthIdx) ? inp.acHrsSummer
                  : winterM.has(monthIdx) ? inp.acHrsWinter
                  : (inp.acHrsSummer + inp.acHrsWinter) / 2;
  return actualHrs / profileImpliedHrs;
}

export function computeEtaSys(panel, tAmb) {
  const eta_wire     = 0.98;  // DC wiring ohmic losses (IEC 62548 §8.3, 1–2%)
  const eta_mismatch = 0.98;  // String/module mismatch (IEC 62548 §8.4, 1–3%)
  const eta_lid      = 0.99;  // LID/LETID — conservative 1% for PERC/TOPCon
  const eta_avail    = 0.99;  // Availability / scheduled downtime
  const tCell    = tAmb + (panel.noct - 20) * 0.8;
  const eta_temp = 1 + (panel.gammaPmax / 100) * (tCell - 25);
  // Soiling applied separately per-month; inverter eta in monthlyGen/hourly dispatch
  return Math.max(0.65, Math.min(0.92,
    eta_wire * eta_mismatch * eta_lid * eta_avail * eta_temp
  ));
}
