import { useEffect, useState } from "react";
import { api } from "./api";
import { Decision } from "./forms";
import "./graph.css";

const columns = ["user", "organization", "agent", "tool", "project"];
const colors = {user:"#496ac8",organization:"#986537",agent:"#007e73",tool:"#8857b3",project:"#2975a0"};
export function Graph({ org, agents, projects }) {
  const [data,setData]=useState(null),[error,setError]=useState(""),[focus,setFocus]=useState("");
  const [agentId,setAgentId]=useState(agents[0]?.id??""),[action,setAction]=useState("READ");
  const [projectId,setProjectId]=useState(projects[0]?.id??""),[target,setTarget]=useState(org.id);
  const [result,setResult]=useState(null),[busy,setBusy]=useState(false);
  async function refresh() {
    try {const d=await api("/authorization/graph/"+org.id);setData(d);setError("");}
    catch(e){setError(e.message);}
  }
  useEffect(()=>{
    let active=true;
    async function load(){try{const d=await api("/authorization/graph/"+org.id);if(active){setData(d);setError("");}}catch(e){if(active)setError(e.message);}}
    void load();const timer=setInterval(load,10000);return()=>{active=false;clearInterval(timer);};
  },[org.id]);
  async function check(e){
    e.preventDefault();setBusy(true);setResult(null);
    try{setResult(await api("/authorization/graph-check",{method:"POST",body:JSON.stringify({agentId,action,projectId,organizationId:action==="CREATE"?target:org.id})}));}
    catch(e){if(e.body?.allowed===false)setResult(e.body);else setError(e.message);}
    finally{setBusy(false);}
  }
  const nodes=(data?.nodes??[]).map(n=>({...n,x:25+columns.indexOf(n.type)*245,
    y:65+(data.nodes.filter(p=>p.type===n.type).findIndex(p=>p.id===n.id))*110}));
  const byId=new Map(nodes.map(n=>[n.id,n]));
  const edges=data?.tuples??[];
  const visibleEdges=focus?edges.filter(e=>e.user===focus||e.object===focus):edges;
  const connected=new Set(visibleEdges.flatMap(e=>[e.user,e.object]));
  const height=Math.max(390,...nodes.map(n=>n.y+110));
  return <section className="graph-page">
    <div className="graph-intro"><div><span className="eyebrow">LIVE RELATIONSHIPS · {org.name}</span><h2>The access behind every action</h2><p>Solid arrows are stored tuples. Permissions such as <code>can_update</code> are computed by OpenFGA from these relationships.</p></div><button className="secondary" onClick={refresh}>Refresh graph</button></div>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="graph-toolbar"><span>{nodes.length} entities · {edges.length} tuples</span><label>Focus entity<select value={focus} onChange={e=>setFocus(e.target.value)}><option value="">All relationships</option>{nodes.map(n=><option key={n.id} value={n.id}>{n.name} · {n.type}</option>)}</select></label><small>{data?"Updated "+new Date(data.refreshedAt).toLocaleTimeString():"Loading…"}</small></div>
    <div className="graph-canvas" aria-label="OpenFGA relationship graph">
      <svg viewBox={"0 0 1230 "+height} style={{width:"100%",minWidth:900,height:"auto"}} role="img" aria-label="Live organization authorization relationships">
        <defs><marker id="tuple-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#8498a8"/></marker></defs>
        {columns.map((type,i)=><text key={type} x={25+i*245} y="28" className="graph-column">{type.toUpperCase()}S</text>)}
        {visibleEdges.map((e,i)=>{
          const a=byId.get(e.user),b=byId.get(e.object);
          if(!a||!b)return null;
          const forward=b.x>a.x,x1=a.x+(forward?195:0),x2=b.x+(forward?0:195);
          const related=visibleEdges.filter(t=>t.user===e.user&&t.object===e.object);
          const offset=(related.findIndex(t=>t===e)-(related.length-1)/2)*22;
          const y1=a.y+34+offset,y2=b.y+34+offset;
          return <g key={e.user+e.relation+e.object}><path d={`M ${x1} ${y1} C ${x1+(forward?70:-70)} ${y1}, ${x2+(forward?-70:70)} ${y2}, ${x2} ${y2}`} fill="none" stroke="#8498a8" strokeWidth="1.4" markerEnd="url(#tuple-arrow)"/><text x={(x1+x2)/2} y={(y1+y2)/2-5} textAnchor="middle" className="graph-edge-label">{e.relation}</text></g>;
        })}
        {nodes.map(n=><g key={n.id} role="button" tabIndex="0" aria-label={n.name+" "+n.type} onClick={()=>setFocus(focus===n.id?"":n.id)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setFocus(focus===n.id?"":n.id);}}} opacity={!focus||connected.has(n.id)||focus===n.id?1:.22} className="graph-node">
          <title>{n.name+"\n"+n.id}</title><rect x={n.x} y={n.y} width="195" height="68" rx="12" fill="white" stroke={colors[n.type]} strokeWidth={focus===n.id?3:1.4}/>
          <text x={n.x+13} y={n.y+23} fill={colors[n.type]} className="graph-node-type">{n.type.toUpperCase()}</text><text x={n.x+13} y={n.y+47} className="graph-node-name">{n.name.length>23?n.name.slice(0,21)+"…":n.name}</text>
        </g>)}
      </svg>
    </div>
    <div className="graph-bottom"><section className="graph-check"><span className="eyebrow">ASK THE AUTHORIZATION ENGINE</span><h3>Can this agent do that?</h3><p>Checks the human, tool, organization, and resource. This does not execute a tool.</p>
      <form onSubmit={check}><label>Check agent<select aria-label="Check agent" required value={agentId} onChange={e=>{setAgentId(e.target.value);setResult(null);}}><option value="">Choose agent</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>Permission<select aria-label="Permission" value={action} onChange={e=>{setAction(e.target.value);setResult(null);}}><option value="READ">Read project</option><option value="UPDATE">Update project</option><option value="CREATE">Create project</option></select></label>
      {action==="CREATE"?<label>Target organization<select aria-label="Target organization" value={target} onChange={e=>{setTarget(e.target.value);setResult(null);}}><option value="my-homes">My Homes</option><option value="green-builders">Green Builders</option></select></label>:<label>Target project<select aria-label="Target project" required value={projectId} onChange={e=>{setProjectId(e.target.value);setResult(null);}}><option value="">Choose project</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      <button className="primary" disabled={busy||!agentId||(action!=="CREATE"&&!projectId)}>{busy?"Checking…":"Check permission"}</button></form><Decision result={result}/>
    </section><section className="graph-explainer"><span className="eyebrow">HOW TO READ THIS</span><h3>Relationships, not role guesses</h3><p><b>owner</b> connects a person to their agent. <b>executor</b> grants access to a tool.</p><p><b>viewer</b> grants read access to one project. <b>editor</b> grants update access to one project. Being in the same organization alone is not enough.</p><p>{data?.storage}</p><details><summary>Stored tuples {focus?"· focused entity":""}</summary><div className="tuple-table">{visibleEdges.map((e,i)=><p key={i}><code>{e.user}</code><b>{e.relation}</b><code>{e.object}</code></p>)}</div></details></section></div>
  </section>;
}
