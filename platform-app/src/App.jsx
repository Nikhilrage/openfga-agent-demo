import { useEffect, useState } from "react";
import { ProjectEdit } from "./ProjectEdit";
import { Graph } from "./Graph";
import { api } from "./api";
import { Registration, ProjectForm, AgentInspector, Dialog } from "./forms";

export const accounts = [
  { name:"Aarav Sharma", initials:"AS", email:"aarav@myhomes.demo", organization:"My Homes", role:"Administrator" },
  { name:"Meera Nair", initials:"MN", email:"meera@greenbuilders.demo", organization:"Green Builders", role:"Administrator" },
  { name:"Riya Patel", initials:"RP", email:"riya@myhomes.demo", organization:"My Homes", role:"Project viewer" },
];
export function Brand() { return <div className="brand"><span className="brand-mark">N</span><b>northstar<span className="brand-dot">.</span></b></div>; }
export function Login({ onLogin }) {
  const [email,setEmail]=useState(""),[password,setPassword]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[show,setShow]=useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError("");
    try { await api("/auth/login",{method:"POST",body:JSON.stringify({email,password})}); onLogin((await api("/auth/me")).user); }
    catch(err) {setError(err.message);} finally {setBusy(false);}
  }
  return <main className="login">
    <section className="login-story"><Brand/><div className="story-copy"><span className="eyebrow">YOUR WORKSPACE. YOUR BOUNDARIES.</span><h1>Give every agent<br/>the right access.</h1><p>Bring your people, projects, and agents together.<br/>Keep every permission in the right hands.</p>
      <div className="permission-illustration" aria-hidden="true"><div className="illustration-org"><span>⌂</span><div><small>ORGANIZATION</small><b>My Homes</b></div><em>Protected</em></div><div className="illustration-line"/><div className="illustration-agent"><span>✦</span><div><b>Project assistant</b><small>Read access · assigned projects only</small></div></div><div className="illustration-line"/><div className="illustration-projects"><div><span className="dot yes"/>Sunrise Towers <b>Allowed</b></div><div><span className="dot no"/>Lake View <b>Denied</b></div></div></div>
    </div><footer><span className="dot yes"/> Powered by OpenFGA <span>LOCAL DEMO</span></footer></section>
    <section className="login-form"><div className="signin-card"><span className="eyebrow">WELCOME BACK</span><h2>Sign in to Northstar</h2><p>Access your organization's workspace.</p><form onSubmit={submit}>
      <label>Email address<input autoComplete="username" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@organization.demo" required/></label>
      <label>Password<div className="password-input"><input aria-label="Password" autoComplete="current-password" type={show?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter your password" required/><button type="button" onClick={()=>setShow(!show)} aria-label={show?"Hide password":"Show password"}>{show?"Hide":"Show"}</button></div></label>
      {error&&<p role="alert" className="error">{error}</p>}<button className="primary wide" disabled={busy}>{busy?"Signing in…":"Sign in →"}</button>
    </form><div className="demo-accounts"><div className="section-label">EXPLORE THE DEMO</div><p>Select an account to fill its email. Password: <code>Demo@1234</code></p>{accounts.map(a=><button key={a.email} className={"account "+(email===a.email?"selected":"")} onClick={()=>{setEmail(a.email);setError("");}}><span className="avatar">{a.initials}</span><span><b>{a.name}</b><small>{a.organization} · {a.role}</small></span><span>→</span></button>)}</div><p className="login-note">Credentials are verified locally. Access is checked by OpenFGA.</p></div></section>
  </main>;
}
function Workspace({ user, onLogout }) {
  const [page,setPage]=useState("Projects"),[orgId,setOrgId]=useState(user.organizations[0]?.id ?? ""),[projects,setProjects]=useState([]),[agents,setAgents]=useState([]),[activity,setActivity]=useState([]),[modal,setModal]=useState(null),[error,setError]=useState(""),[loading,setLoading]=useState(true),[success,setSuccess]=useState("");
  const org=user.organizations.find(o=>o.id===orgId);
  async function refresh() {
    if(!org) {setLoading(false);return;}
    setError(""); setLoading(true);
    try {
      const [p,a,log]=await Promise.all([api("/organizations/"+org.id+"/projects"),api("/agents"),api("/authorization/activity")]);
      setProjects(p);setAgents(a);setActivity(log);
    } catch(err) { if(err.status===401) onLogout(); else setError(err.message); } finally {setLoading(false);}
  }
  useEffect(()=>{let active=true; async function load(){if(active) await refresh();} void load();return()=>{active=false;};},[orgId]);
  async function signOut(){try{await api("/auth/logout",{method:"POST"});onLogout();}catch(err){setError(err.message);}}
  const ownAgents=agents.filter(a=>a.organizationId===orgId);
  const titles={Projects:["Your projects","A shared workspace for people and authorized agents."],Agents:["Your AI agents","Choose what each agent can do, and exactly where it can do it."],Permissions:["Permission mappings","See how people, agents, and tools connect to your projects."],Graph:["Relationship graph","Explore live OpenFGA tuples and test permissions without changing projects."],Activity:["Access decisions","Real OpenFGA checks from actions in your workspace."]};
  const [heading,subtitle]=titles[page];
  return <div className="workspace-shell"><aside className="sidebar"><Brand/><div className="sidebar-org"><span className="avatar">{org?.name.slice(0,1)??"—"}</span><div><small>WORKSPACE</small><b>{org?.name??"No organization"}</b></div></div><span className="section-label">WORKSPACE</span><nav>{[["Projects","▦"],["Agents","✦"],["Permissions","◇"],...(org?.canRegisterAgent?[["Graph","⌘"]]:[]),["Activity","≋"]].map(([label,icon])=><button aria-label={label} key={label} className={page===label?"active":""} onClick={()=>{setPage(label);setSuccess("");}}><span>{icon}</span>{label}</button>)}</nav><div className="sidebar-bottom"><span className="engine-mark">◇</span><div><b></b><small>Local authorization engine</small></div></div></aside>
    <div className="workspace-main"><header className="topbar"><div className="breadcrumb">Workspace <span>/</span> {page}</div><div className="signed-in"><span className="avatar">{user.name.split(" ").map(n=>n[0]).join("")}</span><div><b>{user.name}</b><small>{org?.canRegisterAgent?"Administrator":"Project viewer"}</small></div><button className="quiet" onClick={signOut}>Sign out</button></div></header>
    <main className="page"><div className="page-heading"><div><span className="eyebrow">{org?.name??"YOUR ORGANIZATION"}</span><h1>{heading}</h1><p>{subtitle}</p></div><div className="heading-actions"><button className="secondary" onClick={refresh} disabled={loading}>↻ Refresh</button>{page==="Projects"&&org?.canCreateProject&&<button className="primary" onClick={()=>setModal({kind:"project"})}>+ Create project</button>}{page==="Agents"&&org?.canRegisterAgent&&<button className="primary" onClick={()=>setModal({kind:"register"})}>+ Register agent</button>}</div></div>
    {user.organizations.length>1&&<label>Organization<select value={orgId} onChange={e=>setOrgId(e.target.value)}>{user.organizations.map(o=><option value={o.id} key={o.id}>{o.name}</option>)}</select></label>}
    {error&&<div role="alert" className="error">{error}</div>}{success&&<div role="status" className="success-banner">{success}</div>}
    <div className="stats-row"><div><span>PROJECTS YOU CAN VIEW</span><b>{projects.length}</b></div><div><span>REGISTERED AGENTS</span><b>{ownAgents.length}</b></div><div><span>YOUR ORGANIZATION</span><b className="org-stat">{org?.name??"—"}</b></div></div>
    {loading?<div className="empty">Loading your workspace…</div>:<>
    {page==="Projects"&&<><div className="section-heading"><h2>Project directory</h2><span>{projects.length} projects</span></div><div className="project-grid">{projects.map((p,index)=><article className="project-card" key={p.id}><div className={"project-cover cover-"+index%3}><div className="building b1"/><div className="building b2"/><div className="building b3"/><span>{p.organizationName}</span></div><div className="project-content"><span className="eyebrow">PROJECT</span><h3>{p.name}</h3><p>{p.description||"No description added yet."}</p><div className="project-meta"><span>{p.creatorType==="Agent"?"✦":"○"} {p.creatorName}</span><span>{p.creatorType}</span></div><button className="text-button" onClick={()=>setModal({kind:"details",project:p})}>View project →</button>{org?.canCreateProject&&<button className="text-button" onClick={()=>setModal({kind:"edit",project:p})}>Update project</button>}</div></article>)}</div>{!projects.length&&<div className="empty"><h3>No projects to show</h3><p>Create a project or ask your administrator for access.</p></div>}</>}
    {page==="Agents"&&<><div className="info-banner"><span>✦</span><p><b>Every agent has its own permissions.</b> Read and update agents work only on assigned projects. A create agent works within {org?.name}.</p></div><div className="agent-grid">{ownAgents.map(a=><article className="agent-card" key={a.id}><div className="agent-card-top"><span className="agent-symbol">{a.type==="CREATE"?"+":"◉"}</span><span className="badge">{a.status}</span></div><h3>{a.name}</h3><p>{a.type==="CREATE"?"Creates projects in "+a.organizationName:(a.type==="UPDATE"?"Reads and updates selected projects in ":"Reads selected projects in ")+a.organizationName}</p><div className="chips">{a.tools.map(t=><span key={t.id}>{t.name}</span>)}</div><div className="assigned"><small>{a.type!=="CREATE"?"ASSIGNED PROJECTS":"ORGANIZATION"}</small><b>{a.type!=="CREATE"?(a.projects.map(p=>p.name).join(", ")||"No project assignments"):a.organizationName}</b></div><button className="secondary wide" onClick={()=>setModal({kind:"agent",agent:a})}>View permissions & test access →</button></article>)}</div>{!ownAgents.length&&<div className="empty"><h3>No agents yet</h3><p>Register an agent to choose its capability and project access.</p>{org?.canRegisterAgent&&<button className="primary" onClick={()=>setModal({kind:"register"})}>Register your first agent</button>}</div>}</>}
    {page==="Permissions"&&<div className="table-panel"><div className="section-heading"><h2>Who can do what?</h2><span>{ownAgents.length} agents</span></div><table><thead><tr><th>Owner</th><th>Agent</th><th>Tool permission</th><th>Organization</th><th>Project access</th></tr></thead><tbody>{ownAgents.map(a=><tr key={a.id}><td>{user.name}</td><td><button className="text-button" onClick={()=>setModal({kind:"agent",agent:a})}>{a.name}</button></td><td>{a.tools.map(t=>t.name).join(", ")}</td><td>{a.organizationName}</td><td>{a.type!=="CREATE"?a.projects.map(p=>p.name).join(", "):"Create new projects"}</td></tr>)}</tbody></table>{!ownAgents.length&&<p className="empty">Register an agent to see its mappings here.</p>}</div>}
    {page==="Graph"&&org?.canRegisterAgent&&<Graph org={org} agents={ownAgents} projects={projects}/>}
    {page==="Activity"&&<div className="activity-list">{activity.map(item=><details key={item.id}><summary><span className={"decision-badge "+(item.allowed?"allow":"deny")}>{item.allowed?"Allowed":"Denied"}</span><b>{item.action}</b><span>{new Date(item.createdAt).toLocaleTimeString()}</span></summary><div className="check-list">{item.checks.map((c,i)=><div key={i}><span>{c.allowed?"✓":"×"}</span><code>{c.user}</code><b>{c.relation}</b><code>{c.object}</code></div>)}</div></details>)}{!activity.length&&<div className="empty">Create a project or register an agent to see its authorization checks.</div>}</div>}
    </>}</main></div>
    {modal?.kind==="register"&&<Registration org={org} projects={projects} close={()=>setModal(null)} saved={refresh}/>}
    {modal?.kind==="project"&&<ProjectForm org={org} agents={ownAgents} close={()=>setModal(null)} saved={async result=>{setModal(null);await refresh();setSuccess('“'+result.project.name+'” was created in '+org.name+'.');}}/>}
    {modal?.kind==="agent"&&<AgentInspector agent={modal.agent} projects={projects} close={()=>setModal(null)} refresh={refresh}/>}
    {modal?.kind==="edit"&&<ProjectEdit project={modal.project} close={()=>setModal(null)} saved={async()=>{setModal(null);await refresh();setSuccess("Project updated.");}}/>}
    {modal?.kind==="details"&&<Dialog title={modal.project.name} close={()=>setModal(null)}><div className="detail-project"><span className="badge">{modal.project.organizationName}</span><p>{modal.project.description||"No description added."}</p><dl><dt>Created by</dt><dd>{modal.project.creatorName} · {modal.project.creatorType}</dd><dt>Created</dt><dd>{new Date(modal.project.createdAt).toLocaleDateString()}</dd></dl><details><summary>Technical reference</summary><code>{modal.project.id}</code></details></div></Dialog>}
  </div>;
}
export default function App() {
  const [user,setUser]=useState(null),[ready,setReady]=useState(false);
  useEffect(()=>{let active=true;api("/auth/me").then(data=>{if(active)setUser(data.user);}).catch(()=>{}).finally(()=>{if(active)setReady(true);});return()=>{active=false;};},[]);
  if(!ready)return <div className="app-loading">Opening your workspace…</div>;
  return user?<Workspace key={user.id} user={user} onLogout={()=>setUser(null)}/>:<Login onLogin={setUser}/>;
}
