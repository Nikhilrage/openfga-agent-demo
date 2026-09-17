import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { db } from "../../backend/src/db.mjs";
import { hashPassword } from "../../backend/src/passwords.mjs";
import { readTuples, writeTuples } from "../../backend/src/openfga.mjs";
import { config, loadOpenFgaState } from "../../backend/src/config.mjs";

const tag="verify-"+randomUUID().slice(0,8), password="Test-demo-123!";
const people=[{id:tag+"-admin",org:"my-homes",role:"admin"},{id:tag+"-other",org:"green-builders",role:"admin"},{id:tag+"-viewer",org:"my-homes",role:"member"}];
const cookies={}, projects={}, agents={};
let initialProjects, initialAgents;
async function request(path,{cookie=cookies[people[0].id],headers={},method="GET",body}={}){
  const response=await fetch("http://127.0.0.1:4000/api"+path,{method,headers:{"content-type":"application/json",...(cookie?{cookie}:{}),...headers},body:body?JSON.stringify(body):undefined});
  return {status:response.status,body:await response.json(),cookie:response.headers.get("set-cookie")?.split(";")[0]};
}
async function createAgent(type,ids=[]){
  const r=await request("/agents",{method:"POST",body:{name:tag+" "+type,type,organizationId:"my-homes",projectIds:ids}});
  expect(r.status).toBe(201);return r.body;
}
test.beforeAll(async()=>{
  initialProjects=(await db.query("SELECT id FROM projects ORDER BY id")).rows;
  initialAgents=(await db.query("SELECT id FROM agents ORDER BY id")).rows;
  for(const p of people){
    await db.query("INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)",[p.id,p.id,p.id+"@test.demo",await hashPassword(password)]);
    await db.query("INSERT INTO memberships(user_id,organization_id,role) VALUES($1,$2,$3)",[p.id,p.org,p.role==="admin"?"ADMIN":"VIEWER"]);
    await writeTuples([{user:"user:"+p.id,relation:p.role,object:"organization:"+p.org}]);
    const r=await request("/auth/login",{cookie:null,method:"POST",body:{email:p.id+"@test.demo",password}});
    expect(r.status).toBe(200);cookies[p.id]=r.cookie;
  }
  for(const [key,org,person] of [["a","my-homes",0],["b","my-homes",0],["c","green-builders",1]]){
    const r=await request("/projects",{cookie:cookies[people[person].id],method:"POST",body:{name:tag+" "+key.toUpperCase(),description:"Original "+key,organizationId:org}});
    expect(r.status).toBe(201);projects[key]=r.body.project;
  }
  agents.read=await createAgent("READ",[projects.a.id]);
  agents.update=await createAgent("UPDATE",[projects.a.id]);
  agents.create=await createAgent("CREATE");
});
test.afterAll(async()=>{
  // Delete only IDs owned by the test accounts; preserve all real demo data.
  const userIds=people.map(p=>p.id);
  const agentIds=(await db.query("SELECT id FROM agents WHERE owner_user_id=ANY($1::text[])",[userIds])).rows.map(r=>r.id);
  const projectIds=(await db.query("SELECT id FROM projects WHERE created_by_user_id=ANY($1::text[]) OR created_by_agent_id=ANY($2::text[])",[userIds,agentIds])).rows.map(r=>r.id);
  const targets=new Set([...userIds.map(id=>"user:"+id),...agentIds.map(id=>"agent:"+id),...projectIds.map(id=>"project:"+id)]);
  const keys=(await readTuples()).filter(k=>targets.has(k.user)||targets.has(k.object));
  const state=await loadOpenFgaState();
  for(let i=0;i<keys.length;i+=100){
    const r=await fetch(config.openfgaApiUrl+"/stores/"+state.storeId+"/write",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({authorization_model_id:state.authorizationModelId,deletes:{tuple_keys:keys.slice(i,i+100)}})});
    expect(r.ok).toBeTruthy();
  }
  await db.query("DELETE FROM projects WHERE id=ANY($1::text[])",[projectIds]);
  await db.query("DELETE FROM agents WHERE id=ANY($1::text[])",[agentIds]);
  await db.query("DELETE FROM authorization_audit WHERE actor=ANY($1::text[])",[[...userIds.map(id=>"user:"+id),...agentIds.map(id=>"agent:"+id)]]);
  await db.query("DELETE FROM sessions WHERE user_id=ANY($1::text[])",[userIds]);
  await db.query("DELETE FROM memberships WHERE user_id=ANY($1::text[])",[userIds]);
  await db.query("DELETE FROM users WHERE id=ANY($1::text[])",[userIds]);
  expect((await db.query("SELECT id FROM projects ORDER BY id")).rows).toEqual(initialProjects);
  expect((await db.query("SELECT id FROM agents ORDER BY id")).rows).toEqual(initialAgents);
  await db.end();
});
test("API and real MCP: exact project update grants, org boundaries, graph isolation",async()=>{
  const update="/agents/"+agents.update.agent.id;
  expect((await request(update+"/projects/"+projects.a.id,{method:"PATCH",body:{description:"API updated"}})).status).toBe(200);
  for(const p of [projects.b,projects.c]){
    const r=await request(update+"/projects/"+p.id,{method:"PATCH",body:{description:"Must not change"}});
    expect(r.status).toBe(403);expect(r.body.allowed).toBe(false);
  }
  const readDenied=await request("/agents/"+agents.read.agent.id+"/projects/"+projects.a.id,{method:"PATCH",body:{name:"Must not rename"}});
  expect(readDenied.status).toBe(403);
  expect(readDenied.body.checks.find(c=>c.object==="tool:update-project").allowed).toBe(false);
  expect((await request(update+"/projects/"+projects.a.id,{method:"PATCH",body:{owner_user_id:people[1].id}})).status).toBe(400);
  expect((await request(update+"/projects/"+projects.a.id,{cookie:cookies[people[1].id],method:"PATCH",body:{description:"Wrong human"}})).status).toBe(403);
  expect((await request("/agents",{method:"POST",body:{name:"invalid",type:"UPDATE",organizationId:"my-homes",projectIds:[projects.c.id]}})).status).toBe(400);
  expect((await request("/authorization/graph/my-homes",{cookie:null})).status).toBe(401);
  expect((await request("/authorization/graph/my-homes",{cookie:cookies[people[2].id]})).status).toBe(403);
  expect((await request("/authorization/graph/green-builders")).status).toBe(403);
  const graph=await request("/authorization/graph/my-homes");
  expect(graph.status).toBe(200);
  expect(graph.body.nodes.some(n=>n.id==="project:"+projects.c.id)).toBe(false);
  expect(graph.body.tuples).toContainEqual({user:"agent:"+agents.update.agent.id,relation:"editor",object:"project:"+projects.a.id});
  const graphBefore=(await db.query("SELECT * FROM projects WHERE id=$1",[projects.a.id])).rows[0];
  for(const [projectId,allowed] of [[projects.a.id,true],[projects.b.id,false]]){
    const r=await request("/authorization/graph-check",{method:"POST",body:{agentId:agents.update.agent.id,action:"UPDATE",projectId,organizationId:"my-homes"}});
    expect(r.body.allowed).toBe(allowed);
  }
  expect((await db.query("SELECT * FROM projects WHERE id=$1",[projects.a.id])).rows[0]).toEqual(graphBefore);
  for(const human of [false,true]){
    const client=new Client({name:"enhancement-test",version:"1"});
    const headers=human?{cookie:cookies[people[0].id],"x-agent-id":agents.update.agent.id}:{"x-agent-id":agents.update.agent.id,"x-api-key":agents.update.credentials.apiKey};
    await client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:3006/mcp"+(human?"/platform":"")),{requestInit:{headers}}));
    try{
      expect((await client.listTools()).tools.map(t=>t.name).sort()).toEqual(["get_project","update_project"]);
      const call=async(args)=>JSON.parse((await client.callTool({name:"update_project",arguments:args})).content[0].text);
      expect((await call({projectName:projects.a.name,description:"MCP updated"})).allowed).toBe(true);
      expect((await call({projectName:projects.b.name,description:"Forbidden"})).allowed).toBe(false);
      expect((await call({projectName:projects.c.name,organizationId:"green-builders",description:"Forbidden"})).allowed).toBe(false);
    }finally{await client.close();}
  }
  expect((await db.query("SELECT description FROM projects WHERE id=$1",[projects.b.id])).rows[0].description).toBe("Original b");
  expect((await db.query("SELECT description FROM projects WHERE id=$1",[projects.c.id])).rows[0].description).toBe("Original c");
});
test("Platform Graph, Update registration and multi-turn MCP conversation",async({page,context})=>{
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email address").fill(people[0].id+"@test.demo");
  await page.getByLabel("Password",{exact:true}).fill(password);
  await page.getByRole("button",{name:"Sign in →"}).click();
  await page.getByRole("button",{name:"Agents",exact:true}).click();
  await page.getByRole("button",{name:"+ Register agent",exact:true}).click();
  await page.getByLabel("Agent name").fill(tag+" UI editor");
  await page.getByRole("button",{name:"Continue →"}).click();
  await page.getByRole("button",{name:/Update projects/}).click();
  await page.getByRole("button",{name:"Continue →"}).click();
  await page.getByLabel(new RegExp(projects.a.name)).check();
  await page.getByRole("button",{name:"Continue →"}).click();
  await page.getByRole("button",{name:"Register agent",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Your agent is ready"})).toBeVisible();
  await page.getByRole("button",{name:"Back to agents"}).click();
  const uiAgent=(await db.query("SELECT id FROM agents WHERE name=$1",[tag+" UI editor"])).rows[0].id;
  await page.getByRole("button",{name:"Graph",exact:true}).click();
  await expect(page.getByRole("img",{name:"Live organization authorization relationships"})).toBeVisible();
  await page.getByLabel("Check agent").selectOption(uiAgent);
  await page.getByLabel("Permission",{exact:true}).selectOption("UPDATE");
  await page.getByLabel("Target project").selectOption(projects.a.id);
  await page.getByRole("button",{name:"Check permission"}).click();
  await expect(page.getByText("✓ Access allowed by OpenFGA")).toBeVisible();
  await page.getByLabel("Target project").selectOption(projects.b.id);
  await page.getByRole("button",{name:"Check permission"}).click();
  await expect(page.getByText("× Access denied by OpenFGA")).toBeVisible();
  await page.screenshot({path:"test-results/graph.png",fullPage:true});
  const chat=await context.newPage();chat.on("pageerror",e=>errors.push(e.message));
  await chat.goto("http://127.0.0.1:5174");
  await chat.getByLabel("Agent",{exact:true}).selectOption(uiAgent);
  await chat.getByRole("button",{name:"Connect agent"}).click();
  await expect(chat.locator(".connection-state")).toHaveText("Connected");
  const send=async(text)=>{await chat.getByLabel("Prompt",{exact:true}).fill(text);await chat.getByRole("button",{name:"Send prompt"}).click();await expect(chat.getByLabel("Prompt",{exact:true})).toBeEnabled();};
  const last=()=>chat.locator(".chat-message.assistant").last();
  await send("Can you update project "+projects.a.name+"?");
  await expect(last()).toContainText("What would you like to change");
  await send("description");await expect(last()).toContainText("new description");
  await send("Construction starts in October");await expect(last()).toContainText("CONFIRMATION");
  expect((await db.query("SELECT description FROM projects WHERE id=$1",[projects.a.id])).rows[0].description).toBe("MCP updated");
  await send("yes");await expect(last()).toContainText("ALLOWED");
  expect((await db.query("SELECT description FROM projects WHERE id=$1",[projects.a.id])).rows[0].description).toBe("Construction starts in October");
  await send('Update project "'+projects.b.name+'" with description "Forbidden"');
  await expect(last()).toContainText("CONFIRMATION");
  await send("yes");await expect(last()).toContainText("DENIED");
  await send('Rename project "'+projects.a.name+'" to "'+tag+' Renamed"');
  await send("yes");await expect(last()).toContainText("ALLOWED");
  await send("read it");await expect(last()).toContainText(tag+" Renamed");
  await chat.screenshot({path:"test-results/conversation.png",fullPage:true});
  await chat.getByLabel("Agent",{exact:true}).selectOption(agents.read.agent.id);
  await chat.getByRole("button",{name:"Connect agent"}).click();
  await expect(chat.locator(".connection-state")).toHaveText("Connected");
  await send("Update project "+projects.a.name);await expect(last()).toContainText("TOOL UNAVAILABLE");
  await chat.getByLabel("Agent",{exact:true}).selectOption(agents.create.agent.id);
  await chat.getByRole("button",{name:"Connect agent"}).click();
  await expect(chat.locator(".connection-state")).toHaveText("Connected");
  await send("I want to create a project");await expect(last()).toContainText("project name");
  await send(tag+" Created");await expect(last()).toContainText("description");
  await send("A new residential project");await expect(last()).toContainText("CONFIRMATION");
  await send("cancel");await expect(last()).toContainText("CANCELLED");
  expect((await db.query("SELECT id FROM projects WHERE name=$1",[tag+" Created"])).rowCount).toBe(0);
  await send('Create project "'+tag+' Created" with description "Residential"');
  await send("yes");await expect(last()).toContainText("ALLOWED");
  await send('Create project "'+tag+' Wrong org" in Green Builders with description "Forbidden"');
  await send("yes");await expect(last()).toContainText("DENIED");
  expect(errors).toEqual([]);
});
