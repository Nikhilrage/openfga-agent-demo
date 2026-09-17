import { useEffect, useRef, useState } from "react";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Login, Brand } from "../../platform-app/src/App.jsx";
import { api } from "../../platform-app/src/api.js";
import { conversationTurn, explainResult, decodeResult } from "./prompts.mjs";
import { labelChecks } from "./check-labels.mjs";

function Console({ user, changeUser }) {
  const [agents,setAgents]=useState([]),[selected,setSelected]=useState(""),[loading,setLoading]=useState(true);
  const [status,setStatus]=useState("Disconnected"),[tools,setTools]=useState([]),[prompt,setPrompt]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[messages,setMessages]=useState([]),[events,setEvents]=useState([]);
  const [pending,setPending]=useState(null),[lastProject,setLastProject]=useState(null);
  const [visibleProjects,setVisibleProjects]=useState([]);
  const ref=useRef(null),end=useRef(null);
  const agent=agents.find(a=>a.id===selected);
  const platformUrl=window.location.protocol+"//"+window.location.hostname+":5173";
  const orgNames={"my-homes":"My Homes","green-builders":"Green Builders"};
  useEffect(()=>{end.current?.scrollIntoView({behavior:"smooth",block:"nearest"});},[messages,busy]);
  useEffect(()=>()=>{void ref.current?.close();ref.current=null;},[]);
  async function validateSession() {
    const session=await api("/auth/me");
    if(session.user.id!==user.id) {changeUser(session.user);throw new Error("Account changed. Choose an agent for your new account.");}
    return session.user;
  }
  async function loadAgents() {
    setLoading(true);setError("");
    try {
      await validateSession();
      const items=await api("/agents");setAgents(items);
      const directories=await Promise.all(user.organizations.map(org=>api("/organizations/"+encodeURIComponent(org.id)+"/projects")));
      setVisibleProjects(directories.flat());
      setSelected(current=>items.some(a=>a.id===current)?current:items[0]?.id??"");
    } catch(err) {if(err.status===401)changeUser(null);else setError(err.message);}
    finally{setLoading(false);}
  }
  useEffect(()=>{void loadAgents();},[]);
  useEffect(()=>{
    const focus=()=>{void validateSession().catch(err=>{if(err.status===401)changeUser(null);});};
    window.addEventListener("focus",focus);return()=>window.removeEventListener("focus",focus);
  },[]);
  function log(label,kind="info"){setEvents(items=>[{label,kind,time:new Date().toLocaleTimeString()},...items].slice(0,12));}
  async function disconnect() {
    const current=ref.current;ref.current=null;
    setStatus("Disconnected");setTools([]);setPending(null);setLastProject(null);
    await current?.close();
  }
  async function choose(value) {
    await disconnect();setSelected(value);setMessages([]);setEvents([]);setError("");
  }
  async function connect() {
    if(!agent)return;
    setStatus("Connecting");setError("");
    let candidate;
    try {
      await validateSession();
      await ref.current?.close();ref.current=null;
      candidate=new Client({name:"northstar-browser-client",version:"1.1.0"});
      const transport=new StreamableHTTPClientTransport(new URL("/api/mcp",window.location.origin), {
        requestInit:{credentials:"include",headers:{"x-agent-id":agent.id}},
      });
      await candidate.connect(transport);
      const discovered=await candidate.listTools();
      ref.current=candidate;setTools(discovered.tools);setStatus("Connected");
      log("MCP connected · "+discovered.tools.length+" tool discovered");
      setMessages([{role:"assistant",message:agent.name+" is ready in "+agent.organizationName+". Tell me what you want to do. I can ask for missing details and will confirm before creating or updating a project.",status:"READY"}]);
    } catch(err) {
      await candidate?.close();setStatus("Disconnected");setTools([]);
      setError(err.message);log("Connection failed","error");
      if(err.status===401)changeUser(null);
    }
  }
  async function submit(e) {
    e.preventDefault();if(busy||!ref.current||!prompt.trim())return;
    const text=prompt.trim();setPrompt("");setMessages(items=>[...items,{role:"user",message:text}]);setBusy(true);
    try {
      await validateSession();
      const turn=conversationTurn(text,pending,{tools:tools.map(t=>t.name),organizationId:agent.organizationId,organizationName:agent.organizationName,lastProject});
      setPending(turn.state);
      if(!turn.call){setMessages(items=>[...items,{role:"assistant",status:turn.status,message:turn.reply}]);return;}
      const call=turn.call;
      if(!tools.some(tool=>tool.name===call.name)){
        const message="This agent does not expose "+call.name+". Select an agent with this tool permission. No tool was called.";
        setMessages(items=>[...items,{role:"assistant",status:"TOOL UNAVAILABLE",message}]);log("Tool unavailable · "+call.name);return;
      }
      log("MCP tools/call · "+call.name);
      const response=await ref.current.callTool(call,undefined,{timeout:20000});
      const result=decodeResult(response);
      result.message=explainResult(result,call);
      result.checks=labelChecks(result.checks,{user,agents,projects:visibleProjects,project:result.project});
      if(result.status==="ALLOWED"&&result.project){
        setLastProject(result.project);
        setVisibleProjects(items=>[...items.filter(p=>p.id!==result.project.id),result.project]);
        setAgents(items=>items.map(a=>({...a,projects:a.projects.map(p=>p.id===result.project.id?{...p,...result.project}:p)})));
      }
      setMessages(items=>[...items,{role:"assistant",...result,call}]);
      log(call.name+" · "+result.status,result.status==="DENIED"?"deny":result.status==="ALLOWED"?"allow":"error");
    } catch(err) {
      if(err.status===401){changeUser(null);return;}
      setMessages(items=>[...items,{role:"assistant",status:"ERROR",message:err.message}]);log("Request failed","error");
    } finally {setBusy(false);}
  }
  async function signOut(){try{await api("/auth/logout",{method:"POST"});await disconnect();changeUser(null);}catch(err){setError(err.message);}}
  const suggestions=agent?.type==="CREATE"?[
    'Create project "Aurora Heights" in '+agent.organizationName,
    'Create project "Boundary Test" in '+(agent.organizationId==="my-homes"?"Green Builders":"My Homes"),
  ]:agent?.type==="UPDATE"?[
    'Can you update project "'+(agent.projects[0]?.name??"Sunrise Towers")+'"?',
    'Update project "Lake View" with description "Updated plan"',
    'Read project "'+(agent.projects[0]?.name??"Sunrise Towers")+'"',
  ]:[
    'Read project "'+(agent?.projects[0]?.name??"Sunrise Towers")+'"',
    'Read project "Lake View"',
    'Read project "Green Heights" in Green Builders',
  ];
  return <div className="workspace-shell mcp-console">
    <aside className="sidebar"><Brand/><div className="sidebar-org"><span className="avatar">✦</span><div><small>MCP WORKSPACE</small><b>Agent console</b></div></div><nav><button className="active" aria-current="page"><span>⌁</span>Conversation</button></nav><a className="platform-link" href={platformUrl} target="_blank" rel="noreferrer">Open platform ↗</a><div className="sidebar-bottom"><span className="engine-mark">◇</span><div><b></b><small>Local MCP tool execution</small></div></div></aside>
    <div className="workspace-main"><header className="topbar"><div className="breadcrumb">MCP <span>/</span> Agent console</div><div className="signed-in"><span className="avatar">{user.name.split(" ").map(s=>s[0]).join("")}</span><div><b>{user.name}</b><small>{user.organizations.map(o=>o.name).join(", ")}</small></div><button className="quiet" disabled={busy} onClick={signOut}>Sign out</button></div></header>
    <main className="page"><div className="page-heading"><div><span className="eyebrow">HUMAN → AGENT → TOOL → RESOURCE</span><h1>Work through your agent</h1><p>Use a project name. See the tool call and the access decision behind every request.</p></div><span className={"connection-state "+status.toLowerCase()}>{status}</span></div>
    <section className="connection-panel"><div className="connection-title"><h2>Select an agent</h2><span>Signed in as {user.name}</span></div><div className="agent-connection"><label>Agent<select aria-label="Agent" disabled={busy||status==="Connecting"} value={selected} onChange={e=>void choose(e.target.value)}><option value="">Choose your agent</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name} · {a.organizationName} · {a.type==="READ"?"Read":a.type==="UPDATE"?"Read + Update":"Create"}</option>)}</select></label><button className="secondary" disabled={busy||loading||status==="Connecting"} onClick={loadAgents}>Refresh agents</button>{status==="Connected"?<button className="secondary" disabled={busy} onClick={disconnect}>Disconnect</button>:<button className="primary" disabled={!agent||busy||status==="Connecting"} onClick={connect}>{status==="Connecting"?"Connecting…":"Connect agent"}</button>}</div>
    {agent&&<div className="connection-scope"><span><b>Organization</b>{agent.organizationName}</span><span><b>Capability</b>{agent.type==="READ"?"Read selected projects":agent.type==="UPDATE"?"Read and update selected projects":"Create projects"}</span><span><b>Project scope</b>{agent.type!=="CREATE"?agent.projects.map(p=>p.name).join(", ")||"No assignments":"New projects in "+agent.organizationName}</span></div>}
    {!loading&&!agents.length&&<p className="info-banner">No agents are available for this account. Register one in the Platform, then click Refresh agents. Viewers cannot register or use an administrator's agents.</p>}{error&&<div role="alert" className="error">{error}</div>}</section>
    <div className="console-grid"><section className="conversation"><div className="conversation-title"><h2>Conversation</h2><small>Local guided conversation · no external AI</small></div><div className="conversation-messages" role="log" aria-label="Conversation">
      {!messages.length&&<div className="chat-empty"><span>✦</span><h3>Your agent, with clear boundaries.</h3><p>Choose an agent and connect to discover its tools.<br/>Then type a request or try a suggested prompt.</p></div>}
      {messages.map((m,i)=><article key={i} className={"chat-message "+m.role}><div className="message-avatar">{m.role==="user"?"You":"✦"}</div><div className="message-content">{m.role!=="user"&&<span className={"result-label "+(m.status==="ALLOWED"?"allow":m.status==="DENIED"?"deny":"")}>{m.status}{["ALLOWED","DENIED"].includes(m.status)?" · OpenFGA":""}</span>}<p>{m.message}</p>{m.project&&<div className="returned-project"><b>{m.project.name}</b><small>{m.project.organizationName??orgNames[m.project.organizationId]??m.project.organizationId}</small>{m.project.description&&<p>{m.project.description}</p>}</div>}{m.call&&<details className="tool-trace"><summary>{m.call.name} · view request and checks</summary>{m.checks?.map((check,j)=><div className="check" key={j}><b>{check.allowed?"✓":"×"}</b><span>{check.userLabel} → <code>{check.relation}</code> → {check.objectLabel}</span></div>)}<details className="technical-checks"><summary>Technical details · IDs and request</summary><pre>{JSON.stringify(m.call.arguments,null,2)}</pre>{m.checks?.map((check,j)=><div className="check" key={j}><b>{check.allowed?"✓":"×"}</b><code>{check.user} → {check.relation} → {check.object}</code></div>)}</details></details>}</div></article>)}
      {busy&&<div className="request-pending" role="status">Calling MCP and checking access…</div>}<div ref={end}/></div>
      {status==="Connected"&&<div className="prompt-suggestions">{suggestions.map(s=><button key={s} disabled={busy} onClick={()=>setPrompt(s)}>{s}</button>)}</div>}
      <form className="prompt-form" onSubmit={submit}><label className="sr-only" htmlFor="request-prompt">Prompt</label><input id="request-prompt" value={prompt} onChange={e=>setPrompt(e.target.value)} disabled={status!=="Connected"||busy} placeholder={status==="Connected"?'Read project "Sunrise Towers"':'Connect an agent to start'} autoComplete="off"/><button className="primary" disabled={status!=="Connected"||busy||!prompt.trim()} aria-label="Send prompt">Send ↑</button></form>
    </section><aside className="console-inspector"><section><h2>Available tools</h2>{tools.length?tools.map(t=><div className="discovered-tool" key={t.name}><span>⌘</span><div><b>{t.name}</b><p>{t.description}</p></div></div>):<p>Connect to run MCP tool discovery.</p>}</section><section><h2>Request activity</h2>{events.length?events.map((event,i)=><div className="request-event" key={i}><span className={"event-dot "+event.kind}/><div><b>{event.label}</b><small>{event.time}</small></div></div>):<p>No requests yet.</p>}</section><section><h2>Prompt guide</h2><p>Ask to <b>read</b>, <b>create</b>, or <b>update a project</b>. I’ll ask for any missing details. For updates, change the <b>name</b> or <b>description</b>. Say <b>yes</b> to confirm, or <b>cancel</b>.</p><p>For example: “Can you update project Sunrise Towers?” → “description” → “Construction starts in October” → “yes”.</p><small>This demo uses a local prompt parser. No LLM or external AI service is called.</small></section></aside></div></main></div>
  </div>;
}
export default function App(){
  const [user,setUser]=useState(null),[ready,setReady]=useState(false);
  useEffect(()=>{let active=true;api("/auth/me").then(data=>{if(active)setUser(data.user);}).catch(()=>{}).finally(()=>{if(active)setReady(true);});return()=>{active=false;};},[]);
  if(!ready)return <div className="app-loading">Opening agent console…</div>;
  return user?<Console key={user.id} user={user} changeUser={setUser}/>:<Login onLogin={setUser}/>;
}
