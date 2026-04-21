import { C } from "../../constants/index.js";

export const passColor = v =>
  v==="PASS"      ? C.green  :
  v==="FAIL"      ? C.red    :
  v==="REVIEW"    ? C.yellow :
  v?.includes("INCOMPATIBLE")||v?.includes("UPGRADE")||
  v?.includes("EXCEEDS")||v?.includes("UNDER") ? C.red : C.muted;

export const cardS = color => ({background:C.card,borderRadius:10,overflow:"hidden",
                          marginBottom:12,borderTop:`3px solid ${color}`});
export const tbl = {width:"100%",borderCollapse:"collapse",fontSize:12};

export const SH = ({label,color}) => (
  <tr><td colSpan={3} style={{padding:"7px 14px",background:`${color}18`,color,
    fontWeight:800,fontSize:11,letterSpacing:1.2,textTransform:"uppercase",




    borderLeft:`4px solid ${color}`,borderTop:`1px solid ${C.border}`}}>{label}</td></tr> );
export const Row = ({label,note,children,shade}) => (
  <tr style={{background:shade?"#070f1f":"transparent",borderBottom:`1px solid #1e293b`}}>
    <td style={{padding:"6px 14px",color:C.muted,fontSize:11,width:"40%",verticalAlign:"top"}}>
      {label}
      {note && <div style={{fontSize:9,color:"#475569",marginTop:1}}>{note}</div>}
    </td>
    {children}
  </tr> );
export const Calc = ({v,unit="",dp=1,big}) => {
  const isStr = typeof v==="string";
  const col   = isStr ? passColor(v) : (big ? C.accent : C.text);
  const disp  = isStr ? v : typeof v==="number"
    ? (Math.abs(v)>=10000 ? `${(v/1000).toFixed(1)}K` : v.toFixed(dp)) : v;
  return (
    <td style={{padding:"6px 12px",textAlign:"right",color:col,
      fontWeight:isStr||big?700:400,fontSize:isStr?11:12}}>
      {disp}{unit&&!isStr?` ${unit}`:""}
    </td>
  );
};
export function Bar({val,max,color,width=70}) {
  const pct = max>0 ? Math.min(100,(val/max)*100) : 0;
  return (
    <div style={{display:"flex",alignItems:"center",gap:6}}>
      <div style={{width,background:C.border,borderRadius:4,height:7,flexShrink:0}}>
        <div style={{width:`${pct}%`,background:color,borderRadius:4,height:7,transition:"width .3s"}}/>
      </div>
      <span style={{fontSize:11,color,fontWeight:700,minWidth:38}}>
        {typeof val==="number" ? val.toFixed(val>100?0:1) : val}
      </span>
    </div>
  );
}
export function TblHead({label,calcCol}) {
  return (
    <thead><tr style={{borderBottom:`2px solid ${C.border}`}}>
      <th style={{padding:"9px 14px",textAlign:"left",color:C.muted,fontSize:11,fontWeight:700,width:"40%"}}>Parameter</th>
      <th style={{padding:"9px 12px",textAlign:"right",color:C.yellow,fontSize:11,fontWeight:700}}>Input</th>

      <th style={{padding:"9px 12px",textAlign:"right",color:calcCol||C.accent,fontSize:11,fontWeight:700}}>{label||"Calculated"}</th>
    </tr></thead>
  );
}
