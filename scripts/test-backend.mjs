import assert from "node:assert/strict";
const base = process.env.BACKEND_URL ?? "http://127.0.0.1:4000";
let count=0;
function pass(name){console.log("PASS | "+name);count++;}
async function request(path,{cookie,body,method,headers={}}={}){
  const response=await fetch(base+"/api"+path,{method:method??(body?"POST":"GET"),
    headers:{"content-type":"application/json",...(cookie?{cookie}:{}),...headers},body:body?JSON.stringify(body):undefined});
  return {status:response.status,body:await response.json(),cookie:response.headers.get("set-cookie")?.split(";")[0]};
}
async function login(email){
  const r=await request("/auth/login",{body:{email,password:"Demo@1234"}});
  assert.equal(r.status,200);return r.cookie;
}
const spoof=await request("/agents",{headers:{"x-user-id":"admin-1"}});
assert.equal(spoof.status,401);pass("Forged user ID cannot authenticate");
assert.equal((await request("/auth/login",{body:{email:"aarav@myhomes.demo",password:"incorrect"}})).status,401);pass("Wrong password denied");
const aarav=await login("aarav@myhomes.demo"),meera=await login("meera@greenbuilders.demo"),riya=await login("riya@myhomes.demo");
assert.equal((await request("/auth/me",{cookie:aarav})).body.user.name,"Aarav Sharma");pass("Session resolves verified user identity");
assert.equal((await request("/organizations/green-builders/projects",{cookie:aarav})).status,403);pass("Human cannot browse another organization");
const viewerProjects=await request("/organizations/my-homes/projects",{cookie:riya});
assert.deepEqual(viewerProjects.body.map(p=>p.id),["sunrise-towers"]);pass("Viewer sees only assigned project");
assert.equal((await request("/projects",{cookie:riya,body:{name:"Forbidden",organizationId:"my-homes"}})).status,403);pass("Viewer cannot create projects");
for(const [cookie,org,other] of [[aarav,"my-homes","green-builders"],[meera,"green-builders","my-homes"]]){
  assert.equal((await request("/projects",{cookie,body:{name:"API human project "+Date.now(),organizationId:org}})).status,201);pass("Human project creation in "+org);
  assert.equal((await request("/projects",{cookie,body:{name:"Forbidden",organizationId:other}})).status,403);pass("Human cross-organization creation denied");
  assert.equal((await request("/agents",{cookie,body:{name:"Forbidden",type:"CREATE",organizationId:other}})).status,403);pass("Cross-organization agent registration denied");
  const creator=await request("/agents",{cookie,body:{name:"API create agent "+Date.now(),type:"CREATE",organizationId:org}});
  assert.equal(creator.status,201);assert.ok(creator.body.mcpConfiguration);pass("Agent registration and configuration");
  const agentId=creator.body.agent.id;
  assert.equal((await request("/agents/"+agentId+"/projects",{cookie,body:{name:"API agent project "+Date.now(),organizationId:org}})).status,201);pass("Human + own create agent + own organization allowed");
  const denied=await request("/agents/"+agentId+"/projects",{cookie,body:{name:"Forbidden",organizationId:other}});
  assert.equal(denied.status,403);assert.equal(denied.body.allowed,false);pass("Human + create agent + other organization denied");
  assert.equal((await request("/agents/"+agentId+"/projects",{cookie:cookie===aarav?meera:aarav,body:{name:"Forbidden",organizationId:org}})).status,403);pass("Another human cannot use this agent");
  const credentials=creator.body.credentials;
  assert.equal((await request("/agent/projects",{headers:{"x-agent-id":credentials.agentId,"x-api-key":credentials.apiKey},body:{name:"Forbidden",organizationId:other}})).status,403);pass("Agent API cannot override its organization");
}
assert.equal((await request("/agents",{cookie:aarav,body:{name:"Bad read",type:"READ",organizationId:"my-homes",projectIds:["green-heights"]}})).status,400);pass("Cannot assign another organization's project");
assert.equal((await request("/agents",{cookie:aarav,body:{name:"Bad read",type:"READ",organizationId:"my-homes",projectIds:["does-not-exist"]}})).status,400);pass("Nonexistent project assignment rejected");
const reader=await request("/agents",{cookie:aarav,body:{name:"API read agent "+Date.now(),type:"READ",organizationId:"my-homes",projectIds:["sunrise-towers"]}});
assert.equal(reader.status,201);
const id=reader.body.agent.id;
assert.equal((await request("/agents/"+id+"/projects/sunrise-towers",{cookie:aarav})).status,200);pass("Assigned project allowed");
assert.equal((await request("/agents/"+id+"/projects/lake-view",{cookie:aarav})).status,403);pass("Unassigned project in same organization denied");
assert.equal((await request("/agents/"+id+"/projects",{cookie:aarav,body:{name:"Forbidden",organizationId:"my-homes"}})).status,403);pass("Read agent cannot create projects");
const mappings=await request("/agents",{cookie:aarav});
assert.equal(mappings.body.find(a=>a.id===id).projects[0].name,"Sunrise Towers");pass("Mappings return readable project names");
await request("/auth/logout",{cookie:aarav,method:"POST"});
assert.equal((await request("/auth/me",{cookie:aarav})).status,401);pass("Logout invalidates server session");
await request("/auth/logout",{cookie:meera,method:"POST"});
await request("/auth/logout",{cookie:riya,method:"POST"});
console.log(count+" backend checks passed.");
