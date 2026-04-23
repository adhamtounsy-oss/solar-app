import { C } from "../constants/index.js";
import { cardS } from "../components/ui/primitives.jsx";

export default function ProjectsTab({
  inp, upd,
  projects, projName, setProjName, saveStatus,
  handleSaveProject, handleLoadProject, handleDeleteProject,
}) {
  return (
    <div>
      <div style={cardS("#14b8a6")}>
        <div style={{padding:"12px 16px",color:"white",fontWeight:800,fontSize:13}}>
          Project Save / Load
        </div>
        <div style={{padding:"16px 20px"}}>
          <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:12,flexWrap:"wrap"}}>
            <input value={projName} onChange={e => setProjName(e.target.value)}
              style={{flex:1,minWidth:160,background:"#0f172a",border:"2px solid #14b8a6",
              borderRadius:8,color:"#14b8a6",fontSize:14,fontWeight:700,padding:"7px 12px"}}/>
            <button onClick={handleSaveProject}
              style={{padding:"8px 20px",background:"#14b8a6",color:C.bg,border:"none",
              borderRadius:8,fontWeight:800,fontSize:13,cursor:"pointer"}}>
              Save Design
            </button>
          </div>
          {saveStatus && (
            <div style={{padding:"7px 12px",borderRadius:6,fontSize:12,fontWeight:600,marginBottom:10,
              background:"#10b98120",color:C.green,borderLeft:"3px solid "+C.green}}>
              {saveStatus}
            </div>
          )}
          <div style={{fontSize:11,color:C.muted,marginBottom:12}}>
            Projects stored in artifact cloud storage — persist across browser sessions.
          </div>
          {projects.length === 0
            ? <div style={{color:C.muted,fontSize:12,padding:16,textAlign:"center"}}>No saved projects yet.</div>
            : (
              <div style={{display:"grid",gap:8}}>
                {projects.map(name => (
                  <div key={name} style={{display:"flex",alignItems:"center",gap:10,
                    padding:"10px 14px",background:"#0f172a",borderRadius:8,
                    border:"1px solid "+C.border}}>
                    <span style={{flex:1,color:C.text,fontWeight:600,fontSize:12}}>{name}</span>
                    <button onClick={() => handleLoadProject(name)}
                      style={{padding:"4px 12px",background:"#14b8a620",border:"1px solid #14b8a6",
                      borderRadius:6,color:"#14b8a6",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                      Load
                    </button>
                    <button onClick={() => handleDeleteProject(name)}
                      style={{padding:"4px 10px",background:C.red+"20",border:"1px solid "+C.red,
                      borderRadius:6,color:C.red,fontSize:11,cursor:"pointer"}}>
                      Del
                    </button>
                  </div>
                ))}
              </div>
            )
          }
        </div>
      </div>
      <div style={cardS(C.blue)}>
        <div style={{padding:"12px 16px",color:"white",fontWeight:800,fontSize:13}}>
          Project Details
        </div>
        <div style={{padding:"16px 20px",display:"grid",
          gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:12}}>
          {[
            {l:"Project Ref",  k:"projectRef"},
            {l:"Client Name", k:"clientName"},
            {l:"Villa / Unit",k:"villaRef"},
            {l:"Address",     k:"address"},
            {l:"Engineer",    k:"engineer"},
            {l:"Company",     k:"companyName"},
          ].map(({l,k}) => (
            <div key={k}>
              <div style={{fontSize:10,color:C.muted,marginBottom:4}}>{l}</div>
              <input value={inp[k]||""} onChange={e => upd(k, e.target.value)}
                style={{width:"100%",background:"#0f172a",border:"1px solid "+C.border,
                borderRadius:6,color:C.text,fontSize:12,padding:"7px 10px"}}/>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
