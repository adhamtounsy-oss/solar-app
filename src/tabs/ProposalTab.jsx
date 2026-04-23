import { C } from "../constants/index.js";
import { cardS } from "../components/ui/primitives.jsx";

function QRHash({ inputHash }) {
  if (!inputHash) return null;
  return (
    <div style={{marginTop:16,padding:"10px 14px",background:C.card,borderRadius:8,
      border:`1px solid ${C.border}`,textAlign:"center"}}>
      <div style={{fontSize:10,color:C.muted,marginBottom:4}}>
        Input verification hash (SHA-256 truncated to 64 bits)
      </div>
      <div style={{fontFamily:"monospace",fontSize:14,fontWeight:700,
        color:C.accent,letterSpacing:2}}>{inputHash}</div>
      <div style={{fontSize:9,color:C.muted,marginTop:4}}>
        Share with client to verify design parameters have not changed after proposal delivery.
      </div>
    </div>
  );
}

export default function ProposalTab({ r, inp, yGen, propText, propLoading, inputHash, handleGenerateProposal }) {
  if (!r) return <div style={{color:C.muted,padding:20}}>Select components first.</div>;
  const sections = propText
    ? propText.split("###").filter(s => s.trim())
    : [];
  return (
    <div>
      <div style={cardS(C.pink)}>
        <div style={{padding:"12px 16px",color:"white",fontWeight:800,fontSize:13,
          display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>AI-Generated Client Proposal</span>
          <div style={{display:"flex",gap:8}}>
            <button onClick={handleGenerateProposal} disabled={propLoading}
              style={{padding:"7px 18px",background:propLoading?C.border:C.pink,
              color:propLoading?C.muted:"white",border:"none",borderRadius:8,
              fontWeight:800,fontSize:12,cursor:propLoading?"not-allowed":"pointer"}}>
              {propLoading ? "Generating..." : "Generate Proposal"}
            </button>
            {propText && (
              <button onClick={() => window.print()}
                style={{padding:"7px 14px",background:C.green + "22",
                border:"1px solid " + C.green,color:C.green,borderRadius:8,
                fontSize:12,fontWeight:700,cursor:"pointer"}}>
                Print / PDF
              </button>
            )}
          </div>
        </div>
        {!propText && !propLoading && (
          <div style={{padding:"30px",textAlign:"center",color:C.muted,fontSize:12}}>
            Click Generate Proposal to create an AI-written client proposal using your design data.
          </div>
        )}
        {propLoading && (
          <div style={{padding:"30px",textAlign:"center",color:C.pink,fontSize:13}}>
            Writing proposal using Claude AI...
          </div>
        )}
      </div>
      {propText && (
        <div style={{background:"white",borderRadius:12,padding:"40px",color:"#1a1a2e",
          fontFamily:"Georgia,serif",lineHeight:1.8}}>
          <div style={{borderBottom:"3px solid #22d3ee",paddingBottom:20,marginBottom:28}}>
            <div style={{fontSize:22,fontWeight:900,color:"#0a0f1e"}}>
              {inp.companyName || "SolarTech Egypt"}
            </div>
            <div style={{fontSize:11,color:"#64748b",marginTop:4,letterSpacing:1.5,
              textTransform:"uppercase"}}>Professional Solar Energy Solutions</div>
            <div style={{marginTop:16,display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
              <div>
                <div style={{fontSize:11,color:"#64748b",textTransform:"uppercase",letterSpacing:1}}>Prepared for</div>
                <div style={{fontSize:16,fontWeight:800,color:"#0a0f1e",marginTop:2}}>
                  {inp.clientName || "Client"}
                </div>
                <div style={{fontSize:12,color:"#475569",marginTop:2}}>{inp.address}</div>
                {(inp.lat||inp.lon) && (
                  <div style={{fontSize:10,color:"#94a3b8",marginTop:2}}>
                    {(inp.lat||0).toFixed(4)}°N, {(inp.lon||0).toFixed(4)}°E
                    {inp.elevationM != null && ` · ${Math.round(inp.elevationM)} m ASL`}
                  </div>
                )}
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:11,color:"#64748b",textTransform:"uppercase",letterSpacing:1}}>Prepared by</div>
                <div style={{fontSize:14,fontWeight:700,color:"#0a0f1e",marginTop:2}}>
                  {inp.engineer || "Engineer"}
                </div>
                <div style={{fontSize:12,color:"#475569",marginTop:2}}>Ref: {inp.projectRef}</div>
                <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>
                  {new Date().toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"})}
                </div>
              </div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,
            marginBottom:28,padding:14,background:"#f8fafc",borderRadius:8}}>
            {[
              {l:"System Size",     v:r.actKwp.toFixed(1) + " kWp"},
              {l:`Annual Yield (${inp.yieldMode==="p90"?"P90":"P50"})`, v:(yGen/1000).toFixed(1) + " MWh"},
              {l:"Self-Consumption",v:(r.annSCPct||r.profileSCPct||0).toFixed(0) + "%"},
              {l:"Payback Period",  v:r.pb ? r.pb + " Years" : ">25 Yrs"},
              {l:"25-Year IRR",     v:r.irr + "%"},
            ].map(k => (
              <div key={k.l} style={{textAlign:"center"}}>
                <div style={{fontSize:9,color:"#94a3b8",textTransform:"uppercase",letterSpacing:1}}>{k.l}</div>
                <div style={{fontSize:16,fontWeight:800,color:"#22d3ee",marginTop:2}}>{k.v}</div>
              </div>
            ))}
          </div>
          {sections.map((sec, i) => {
            const lines = sec.trim().split("\n");
            const title = lines[0].trim();
            const body  = lines.slice(1).join("\n").trim();
            return (
              <div key={i} style={{marginBottom:22}}>
                <div style={{fontSize:13,fontWeight:800,color:"#22d3ee",
                  textTransform:"uppercase",letterSpacing:1.5,marginBottom:8,
                  paddingBottom:6,borderBottom:"1px solid #e2e8f0"}}>
                  {title}
                </div>
                <div style={{fontSize:13,color:"#334155",whiteSpace:"pre-wrap"}}>{body}</div>
              </div>
            );
          })}
          <div style={{marginTop:36,paddingTop:18,borderTop:"2px solid #e2e8f0",
            display:"flex",justifyContent:"space-between",fontSize:10,color:"#94a3b8"}}>
            <span>{inp.companyName} · {inp.engineer}</span>
            <span>Ref: {inp.projectRef} · {new Date().toLocaleDateString()}</span>
            <span>EgyptERA Compliant · {r.actKwp.toFixed(1)} kWp</span>
          </div>
          <QRHash inputHash={inputHash} />
        </div>
      )}
    </div>
  );
}
