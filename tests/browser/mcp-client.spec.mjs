import { test, expect } from "@playwright/test";
const platform="http://127.0.0.1:5173",client="http://127.0.0.1:5174";
async function login(page,person) {
  await page.goto(platform);
  await page.getByRole("button",{name:new RegExp(person)}).click();
  await page.getByLabel("Password",{exact:true}).fill("Demo@1234");
  await page.getByRole("button",{name:"Sign in →",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Your projects",exact:true})).toBeVisible();
}
async function register(page,name,type,project) {
  await page.getByRole("button",{name:"Agents",exact:true}).click();
  await page.getByRole("button",{name:"+ Register agent",exact:true}).click();
  await page.getByLabel("Agent name",{exact:true}).fill(name);
  await page.getByRole("button",{name:"Continue →",exact:true}).click();
  await page.getByRole("button",{name:new RegExp(type)}).click();
  await page.getByRole("button",{name:"Continue →",exact:true}).click();
  if(project) {
    await page.getByLabel("Search projects").fill(project);
    await page.getByRole("checkbox",{name:new RegExp(project)}).check();
  }
  await page.getByRole("button",{name:"Continue →",exact:true}).click();
  const response=page.waitForResponse(r=>r.url().endsWith("/api/agents")&&r.request().method()==="POST");
  await page.getByRole("button",{name:"Register agent",exact:true}).click();
  const body=await (await response).json();
  await expect(page.getByRole("heading",{name:"Your agent is ready"})).toBeVisible();
  await page.getByRole("button",{name:"Back to agents",exact:true}).click();
  return body.agent.id;
}
async function connect(page,id) {
  await page.getByLabel("Agent",{exact:true}).selectOption(id);
  await page.getByRole("button",{name:"Connect agent",exact:true}).click();
  await expect(page.locator(".connection-state")).toHaveText("Connected");
}
async function prompt(page,text,status) {
  const count=await page.locator(".chat-message.assistant").count();
  await page.getByLabel("Prompt",{exact:true}).fill(text);
  await page.getByRole("button",{name:"Send prompt",exact:true}).click();
  await expect(page.locator(".chat-message.assistant")).toHaveCount(count+1);
  const last=page.locator(".chat-message.assistant").last();
  if(["ALLOWED","DENIED"].includes(status) && /^Create/i.test(text)){
    if((await last.locator(".result-label").innerText()).includes("INPUT NEEDED")){
      await prompt(page,"skip","CONFIRMATION");
    }
    await prompt(page,"yes",status);
    return;
  }
  await expect(last.locator(".result-label")).toContainText(status);
}
test("Platform registration → signed-in MCP client → named projects → real allowed and denied tool calls",async({page})=>{
  const errors=[];page.on("pageerror",err=>errors.push(err.message));
  const toolCalls=[];
  page.on("request",req=>{if(req.url().endsWith("/api/mcp")&&req.method()==="POST"){
    const data=req.postDataJSON();if(data?.method==="tools/call")toolCalls.push(data.params);
  }});
  await login(page,"Aarav Sharma");
  const reader=await register(page,"MCP Sunrise Reader "+Date.now(),"Read projects","Sunrise Towers");
  const creator=await register(page,"MCP My Homes Creator "+Date.now(),"Create projects");
  await page.goto(client);
  await expect(page.getByRole("heading",{name:"Work through your agent"})).toBeVisible();
  await connect(page,reader);
  await expect(page.locator(".discovered-tool")).toContainText("get_project");
  await expect(page.locator(".discovered-tool")).not.toContainText("create_project");
  await prompt(page,"Read project Sunrise Towers","ALLOWED");
  await expect(page.locator(".returned-project").last()).toContainText("Sunrise Towers");
  await prompt(page,"Read project Lake View","DENIED");
  await prompt(page,"Read project Green Heights in Green Builders","DENIED");
  const before=toolCalls.length;
  await prompt(page,"Create project Not Allowed","TOOL UNAVAILABLE");
  expect(toolCalls.length).toBe(before);
  await prompt(page,"Read project Missing House 987654321","ERROR");
  await page.screenshot({path:"test-results/mcp-read-decisions.png",fullPage:true});
  await connect(page,creator);
  const project="MCP Harbor "+Date.now();
  await prompt(page,'Create project "'+project+'" in My Homes with description "Created by a real MCP call"',"ALLOWED");
  await expect(page.locator(".returned-project").last()).toContainText("My Homes");
  await prompt(page,'Create project "Forbidden Cross Org" in Green Builders',"DENIED");
  await page.locator(".chat-message.assistant").last().getByText("create_project · view request and checks").click();
  await expect(page.locator(".chat-message.assistant").last()).toContainText("user:admin-1");
  await expect(page.locator(".chat-message.assistant").last()).toContainText("can_create_project");
  await page.screenshot({path:"test-results/mcp-create-decisions.png",fullPage:true});
  await connect(page,reader);
  await prompt(page,'Read project "'+project+'"',"DENIED");
  await page.goto(platform);
  await expect(page.getByRole("heading",{name:project,exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Sign out",exact:true}).click();
  await login(page,"Meera Nair");
  const meera=await register(page,"MCP Green Creator "+Date.now(),"Create projects");
  await page.goto(client);
  await expect(page.getByLabel("Agent",{exact:true}).locator('option[value="'+creator+'"]')).toHaveCount(0);
  // A tampered selected-agent header is rejected even with a valid other-admin session.
  const unauthorized=await page.request.post(client+"/api/mcp",{headers:{"x-agent-id":creator},data:{
    jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"test",version:"1"}}
  }});
  expect(unauthorized.status()).toBe(403);
  await connect(page,meera);
  await prompt(page,'Create project "MCP Green Terrace '+Date.now()+'" in Green Builders',"ALLOWED");
  await prompt(page,'Create project "Forbidden My Homes" in My Homes',"DENIED");
  await page.getByRole("button",{name:"Sign out",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Sign in to Northstar"})).toBeVisible();
  expect((await page.request.post(client+"/api/mcp",{headers:{"x-agent-id":meera},data:{}})).status()).toBe(401);
  expect(toolCalls.some(c=>c.name==="get_project"&&c.arguments.projectName==="Sunrise Towers")).toBe(true);
  expect(toolCalls.some(c=>c.name==="create_project"&&c.arguments.organizationId==="green-builders")).toBe(true);
  expect(errors).toEqual([]);
});
test("MCP client login fits a narrow screen",async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto(client);
  await expect(page.getByRole("heading",{name:"Sign in to Northstar"})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
