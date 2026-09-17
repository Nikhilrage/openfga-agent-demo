import { randomUUID, randomBytes } from "node:crypto";
import cors from "cors";
import express from "express";
import { config } from "./config.mjs";
import { requireAgent, requireUser, login, logout } from "./auth.mjs";
import { digest } from "./passwords.mjs";
import { db, transaction } from "./db.mjs";
import { check, writeTuples, readTuples } from "./openfga.mjs";

const app = express();
const origins = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174"];
app.use(cors({ origin: origins, credentials: true }));
app.use(express.json());
app.use((req, res, next) => {
  if (req.headers.origin && !origins.includes(req.headers.origin))
    return res.status(403).json({ message: "Origin not allowed" });
  next();
});
const route = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
const fail = (status, message) => Object.assign(new Error(message), { status });
const validName = name => typeof name === "string" && name.trim().length > 0 && name.length <= 150;

async function decision(actor, organizationId, action, tuples) {
  const checks = await Promise.all(tuples.map(async ({ user, relation, object }) =>
    ({ user, relation, object, allowed: await check(user, relation, object) })));
  const allowed = checks.every(item => item.allowed);
  await db.query("INSERT INTO authorization_audit (actor, organization_id, checks, allowed, action) VALUES ($1,$2,$3,$4,$5)",
    [actor, organizationId, JSON.stringify(checks), allowed, action]);
  return { allowed, checks };
}
const tuple = (user, relation, object) => ({ user, relation, object });
async function enforce(req, organizationId, action, tuples) {
  const result = await decision("user:" + req.userId, organizationId, action, tuples);
  if (!result.allowed) throw Object.assign(fail(403, "OpenFGA denied this action."), { decision: result });
  return result;
}
async function publicUser(req) {
  const { rows } = await db.query(`SELECT o.id, o.name, m.role FROM organizations o
    JOIN memberships m ON m.organization_id=o.id WHERE m.user_id=$1 ORDER BY o.name`, [req.userId]);
  const organizations = [];
  for (const org of rows) {
    if (await check("user:" + req.userId, "can_view", "organization:" + org.id)) organizations.push({
      ...org,
      canRegisterAgent: await check("user:" + req.userId, "can_register_agent", "organization:" + org.id),
      canCreateProject: await check("user:" + req.userId, "can_create_project", "organization:" + org.id),
    });
  }
  return { ...req.user, organizations };
}
app.get("/health", route(async (_req, res) => {
  await db.query("SELECT 1");
  const fga = await fetch(config.openfgaApiUrl + "/healthz");
  res.status(fga.ok ? 200 : 503).json({ status: fga.ok ? "ok" : "degraded", postgres: true, openfga: fga.ok });
}));
app.post("/api/auth/login", route(login));
app.post("/api/auth/logout", route(logout));
app.get("/api/auth/me", requireUser, route(async (req, res) => res.json({ user: await publicUser(req) })));
app.get("/api/organizations", requireUser, route(async (req, res) => res.json((await publicUser(req)).organizations)));
app.get("/api/tools", requireUser, route(async (_req, res) =>
  res.json((await db.query("SELECT * FROM tools ORDER BY name")).rows)));

app.get("/api/organizations/:organizationId/projects", requireUser, route(async (req, res) => {
  const org = req.params.organizationId;
  await enforce(req, org, "Browse projects", [tuple("user:" + req.userId, "can_view", "organization:" + org)]);
  const { rows } = await db.query(`SELECT p.id,p.name,p.description,p.organization_id AS "organizationId",
    o.name AS "organizationName",p.created_at AS "createdAt",
    CASE WHEN p.created_by_agent_id IS NOT NULL THEN 'Agent' ELSE 'Person' END AS "creatorType",
    COALESCE(a.name,u.name,'Demo seed') AS "creatorName"
    FROM projects p JOIN organizations o ON o.id=p.organization_id
    LEFT JOIN agents a ON a.id=p.created_by_agent_id LEFT JOIN users u ON u.id=p.created_by_user_id
    WHERE p.organization_id=$1 ORDER BY p.created_at DESC,p.name`, [org]);
  const visible = [];
  for (const project of rows) if (await check("user:" + req.userId, "can_view", "project:" + project.id)) visible.push(project);
  res.json(visible);
}));

async function persistProject({ name, description = "", organizationId }, agent, userId) {
  if (!validName(name) || typeof description !== "string") throw fail(400, "Enter a project name and valid description.");
  const id = randomUUID();
  return transaction(async client => {
    const { rows } = await client.query(`INSERT INTO projects (id,name,description,organization_id,created_by_agent_id,created_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,name,description,organization_id AS "organizationId"`,
      [id, name.trim(), description, organizationId, agent?.id ?? null, agent ? null : userId]);
    await writeTuples([
      tuple("organization:" + organizationId, "organization", "project:" + id),
      tuple(agent ? "agent:" + agent.id : "user:" + userId, "creator", "project:" + id),
    ]);
    return rows[0];
  });
}
app.post("/api/projects", requireUser, route(async (req, res) => {
  const { organizationId } = req.body;
  if (typeof organizationId !== "string") throw fail(400, "Select an organization.");
  const result = await enforce(req, organizationId, "Create project as person",
    [tuple("user:" + req.userId, "can_create_project", "organization:" + organizationId)]);
  const project = await persistProject(req.body, null, req.userId);
  res.status(201).json({ ...result, project });
}));

async function agentDetails(agent) {
  const [tools, projects] = await Promise.all([
    db.query("SELECT t.id,t.name,t.description FROM tools t JOIN agent_tools a ON a.tool_id=t.id WHERE a.agent_id=$1", [agent.id]),
    db.query("SELECT p.id,p.name,p.description FROM projects p JOIN agent_projects a ON a.project_id=p.id WHERE a.agent_id=$1 ORDER BY p.name", [agent.id]),
  ]);
  return { ...agent, tools: tools.rows, projects: projects.rows };
}
app.get("/api/agents", requireUser, route(async (req, res) => {
  const { rows } = await db.query(`SELECT a.id,a.name,a.type,a.status,a.organization_id AS "organizationId",
    o.name AS "organizationName",a.created_at AS "createdAt" FROM agents a
    JOIN organizations o ON o.id=a.organization_id WHERE a.owner_user_id=$1 ORDER BY a.created_at DESC`, [req.userId]);
  const visible = [];
  for (const agent of rows) if (await check("user:" + req.userId, "can_manage", "agent:" + agent.id)) visible.push(await agentDetails(agent));
  res.json(visible);
}));
app.post("/api/agents", requireUser, route(async (req, res) => {
  const { name, type, organizationId, projectIds = [] } = req.body;
  if (!validName(name) || !["CREATE", "READ", "UPDATE"].includes(type) || typeof organizationId !== "string" ||
      !Array.isArray(projectIds) || !projectIds.every(id => typeof id === "string"))
    throw fail(400, "Provide a name, capability, organization, and valid project selection.");
  const ids = [...new Set(projectIds)];
  if (type !== "CREATE" && !ids.length) throw fail(400, "Select at least one assigned project.");
  if (type === "CREATE" && ids.length) throw fail(400, "Create agents do not receive read-project assignments.");
  const registrationDecision = await enforce(req, organizationId, "Register agent", [
    tuple("user:" + req.userId, "can_register_agent", "organization:" + organizationId),
  ]);
  if (ids.length) {
    const valid = await db.query("SELECT id FROM projects WHERE id=ANY($1::text[]) AND organization_id=$2", [ids, organizationId]);
    if (valid.rowCount !== ids.length) throw fail(400, "Select projects belonging to this organization.");
    await enforce(req, organizationId, "Assign project access", ids.map(id => tuple("user:" + req.userId, type === "UPDATE" ? "can_update" : "can_view", "project:" + id)));
  }
  const id = randomUUID(), apiKey = "fga_demo_" + randomBytes(24).toString("base64url");
  const toolId = type === "CREATE" ? "create-project" : type === "UPDATE" ? "update-project" : "read-project";
  const toolIds = type === "UPDATE" ? ["read-project", "update-project"] : [toolId];
  const agent = await transaction(async client => {
    const { rows } = await client.query(`INSERT INTO agents(id,name,type,organization_id,owner_user_id,api_key_hash)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,type,status,organization_id AS "organizationId"`,
      [id,name.trim(),type,organizationId,req.userId,digest(apiKey)]);
    for (const assignedTool of toolIds) await client.query("INSERT INTO agent_tools(agent_id,tool_id) VALUES($1,$2)",[id,assignedTool]);
    for (const projectId of ids) await client.query("INSERT INTO agent_projects(agent_id,project_id) VALUES($1,$2)",[id,projectId]);
    const tuples = [
      tuple("agent:" + id, "assigned_agent", "organization:" + organizationId),
      tuple("user:" + req.userId, "owner", "agent:" + id),
      tuple("organization:" + organizationId, "organization", "agent:" + id),
      ...toolIds.map(assignedTool => tuple("agent:" + id, "executor", "tool:" + assignedTool)),
      ...ids.map(projectId => tuple("agent:" + id,type === "UPDATE" ? "editor" : "viewer","project:" + projectId)),
    ];
    if(type === "CREATE") tuples.push(tuple("agent:" + id,"project_creator","organization:" + organizationId));
    await writeTuples(tuples);
    return rows[0];
  });
  res.status(201).json({
    decision: registrationDecision, agent: { ...await agentDetails(agent), toolId, projectIds: ids },
    credentials: { agentId: id, apiKey, shownOnlyOnce: true },
    mcpConfiguration: { mcpServers: { openfgaAgentDemo: { url: config.mcpUrl, headers: { "x-agent-id": id,"x-api-key": apiKey } } } },
  });
}));

async function ownedAgent(req) {
  const { rows } = await db.query('SELECT id,name,type,status,organization_id AS "organizationId" FROM agents WHERE id=$1', [req.params.agentId]);
  if (!rows[0]) throw fail(404,"Agent not found.");
  const agent = rows[0];
  await enforce(req, agent.organizationId, "Use agent", [tuple("user:" + req.userId,"can_use","agent:" + agent.id)]);
  if (agent.status !== "ACTIVE") throw fail(403,"This agent is inactive.");
  return agent;
}
async function agentCreate(agent, body, userId) {
  const organizationId = body.organizationId ?? agent.organizationId;
  if (typeof organizationId !== "string") throw fail(400, "Select an organization.");
  const tuples = [
    tuple("agent:" + agent.id,"can_execute","tool:create-project"),
    tuple("agent:" + agent.id,"can_create_project","organization:" + organizationId),
  ];
  if (userId) tuples.unshift(tuple("user:" + userId,"can_use","agent:" + agent.id),
    tuple("user:" + userId,"can_create_project","organization:" + organizationId));
  const result = await decision(userId ? "user:" + userId : "agent:" + agent.id, agent.organizationId,"Create project as agent",tuples);
  if (!result.allowed) throw Object.assign(fail(403,"OpenFGA denied project creation."),{decision:result});
  return { ...result, project: await persistProject({ ...body, organizationId }, agent) };
}
async function agentRead(agent, id, userId) {
  const tuples = [tuple("agent:" + agent.id,"can_execute","tool:read-project"),tuple("agent:" + agent.id,"can_view","project:" + id)];
  if(userId) tuples.unshift(tuple("user:" + userId,"can_use","agent:" + agent.id));
  const result = await decision(userId ? "user:" + userId : "agent:" + agent.id,agent.organizationId,"Read project as agent",tuples);
  if(!result.allowed) throw Object.assign(fail(403,"OpenFGA denied project access."),{decision:result});
  const { rows } = await db.query('SELECT p.id,p.name,p.description,o.name AS "organizationName",p.organization_id AS "organizationId" FROM projects p JOIN organizations o ON o.id=p.organization_id WHERE p.id=$1',[id]);
  if(!rows[0]) throw fail(404,"Project not found.");
  return { ...result, project: rows[0] };
}
app.post("/api/agents/:agentId/projects",requireUser,route(async(req,res) =>
  res.status(201).json(await agentCreate(await ownedAgent(req),req.body,req.userId))));
app.get("/api/agents/:agentId/projects/:projectId",requireUser,route(async(req,res) =>
  res.json(await agentRead(await ownedAgent(req),req.params.projectId,req.userId))));
app.get("/api/agent/me",requireAgent,route(async(req,res) => {
  const profile = await agentDetails(req.agent);
  const tools=[];
  for(const tool of profile.tools) if(await check("agent:"+req.agent.id,"can_execute","tool:"+tool.id)) tools.push(tool);
  res.json({agent:req.agent,tools});
}));
app.post("/api/agent/projects",requireAgent,route(async(req,res) => res.status(201).json(await agentCreate(req.agent,req.body))));
app.get("/api/agent/projects/:projectId",requireAgent,route(async(req,res) => res.json(await agentRead(req.agent,req.params.projectId))));


async function agentLookup(agent, query, userId) {
  const organizationId = query.organizationId ?? agent.organizationId;
  const projectName = query.projectName;
  if (typeof projectName !== "string" || !projectName.trim() || typeof organizationId !== "string")
    throw fail(400, "Provide the project name and a valid organization.");
  const checks = [
    tuple("agent:" + agent.id, "can_execute", "tool:read-project"),
    tuple("agent:" + agent.id, "assigned_agent", "organization:" + organizationId),
  ];
  if (userId) checks.unshift(tuple("user:" + userId, "can_use", "agent:" + agent.id));
  const scope = await decision(userId ? "user:" + userId : "agent:" + agent.id,
    agent.organizationId, "Look up project as agent", checks);
  if (!scope.allowed) throw Object.assign(fail(403, "OpenFGA denied access to this organization or tool."), { decision: scope });
  const { rows } = await db.query(
    "SELECT id FROM projects WHERE organization_id=$1 AND (lower(name)=lower($2) OR id=$2)", [organizationId, projectName.trim()]);
  if (!rows.length) throw fail(404, "No project with that exact name was found in this organization.");
  if (rows.length > 1) throw fail(409, "Multiple projects have this name. Use the project ID from the platform's Technical reference.");
  const result = await agentRead(agent, rows[0].id, userId);
  return { ...result, checks: [...scope.checks, ...result.checks] };
}
app.get("/api/agents/:agentId/mcp-profile", requireUser, route(async(req,res) => {
  const agent = await ownedAgent(req);
  const profile = await agentDetails(agent);
  const tools = [];
  for (const tool of profile.tools) if (await check("agent:" + agent.id, "can_execute", "tool:" + tool.id)) tools.push(tool);
  res.json({ agent, tools });
}));
app.get("/api/agents/:agentId/project-lookup", requireUser, route(async(req,res) =>
  res.json(await agentLookup(await ownedAgent(req), req.query, req.userId))));
app.get("/api/agent/project-lookup", requireAgent, route(async(req,res) =>
  res.json(await agentLookup(req.agent, req.query))));

function updateFields(body) {
  const supported = ["name", "description", "projectName", "organizationId"];
  if (Object.keys(body).some(key => !supported.includes(key)))
    throw fail(400, "Only project name and description can be updated. Organization and ownership cannot be changed.");
  if (body.name === undefined && body.description === undefined) throw fail(400, "Provide a new name or description.");
  if (body.name !== undefined && !validName(body.name)) throw fail(400, "Enter a valid project name.");
  if (body.description !== undefined && typeof body.description !== "string") throw fail(400, "Enter a valid description.");
  return { name: body.name?.trim(), description: body.description };
}
async function saveProjectUpdate(id, fields) {
  const { rows } = await db.query(`UPDATE projects SET name=COALESCE($2,name),description=COALESCE($3,description)
    WHERE id=$1 RETURNING id,name,description,organization_id AS "organizationId"`, [id, fields.name, fields.description]);
  if (!rows[0]) throw fail(404, "Project not found.");
  return rows[0];
}
async function agentUpdate(agent, id, body, userId) {
  const fields = updateFields(body);
  const checks = [
    tuple("agent:" + agent.id, "can_execute", "tool:update-project"),
    tuple("agent:" + agent.id, "can_update", "project:" + id),
  ];
  if (userId) checks.unshift(tuple("user:" + userId, "can_use", "agent:" + agent.id));
  const result = await decision(userId ? "user:" + userId : "agent:" + agent.id, agent.organizationId, "Update project as agent", checks);
  if (!result.allowed) throw Object.assign(fail(403, "OpenFGA denied project update."), { decision: result });
  // The organization is immutable; an explicit target must match the resource.
  if (body.organizationId !== undefined) {
    const project = await db.query("SELECT organization_id FROM projects WHERE id=$1", [id]);
    if (project.rows[0]?.organization_id !== body.organizationId) throw fail(400, "The target organization does not match this project.");
  }
  return { ...result, project: await saveProjectUpdate(id, fields) };
}
async function updateByName(agent, body, userId) {
  updateFields(body);
  const organizationId = body.organizationId ?? agent.organizationId;
  if (typeof body.projectName !== "string" || !body.projectName.trim() || typeof organizationId !== "string")
    throw fail(400, "Provide a project name and valid organization.");
  const checks = [
    tuple("agent:" + agent.id, "can_execute", "tool:update-project"),
    tuple("agent:" + agent.id, "assigned_agent", "organization:" + organizationId),
  ];
  if (userId) checks.unshift(tuple("user:" + userId, "can_use", "agent:" + agent.id));
  const scope = await decision(userId ? "user:" + userId : "agent:" + agent.id, agent.organizationId, "Locate project to update", checks);
  if (!scope.allowed) throw Object.assign(fail(403, "OpenFGA denied access to this organization or tool."), { decision: scope });
  const { rows } = await db.query("SELECT id FROM projects WHERE organization_id=$1 AND (lower(name)=lower($2) OR id=$2)",
    [organizationId, body.projectName.trim()]);
  if (!rows.length) throw fail(404, "No project with that exact name was found in this organization.");
  if (rows.length > 1) throw fail(409, "Multiple projects match. Use the project ID.");
  const result = await agentUpdate(agent, rows[0].id, body, userId);
  return { ...result, checks: [...scope.checks, ...result.checks] };
}
app.patch("/api/projects/:projectId", requireUser, route(async(req,res) => {
  const fields = updateFields(req.body);
  const project = (await db.query("SELECT organization_id FROM projects WHERE id=$1", [req.params.projectId])).rows[0];
  const result = await enforce(req, project?.organization_id, "Update project as person",
    [tuple("user:" + req.userId, "can_update", "project:" + req.params.projectId)]);
  if (req.body.organizationId !== undefined && req.body.organizationId !== project?.organization_id)
    throw fail(400, "Organization cannot be changed.");
  res.json({ ...result, project: await saveProjectUpdate(req.params.projectId, fields) });
}));
app.patch("/api/agents/:agentId/projects/:projectId", requireUser, route(async(req,res) =>
  res.json(await agentUpdate(await ownedAgent(req), req.params.projectId, req.body, req.userId))));
app.patch("/api/agent/projects/:projectId", requireAgent, route(async(req,res) =>
  res.json(await agentUpdate(req.agent, req.params.projectId, req.body))));
app.patch("/api/agents/:agentId/project-update", requireUser, route(async(req,res) =>
  res.json(await updateByName(await ownedAgent(req), req.body, req.userId))));
app.patch("/api/agent/project-update", requireAgent, route(async(req,res) =>
  res.json(await updateByName(req.agent, req.body))));

// Admin-scoped graph: never return another organization's tuples or credentials.
app.get("/api/authorization/graph/:organizationId", requireUser, route(async(req,res) => {
  const org = req.params.organizationId;
  await enforce(req, org, "View relationship graph",
    [tuple("user:" + req.userId, "can_register_agent", "organization:" + org)]);
  const nodes = [];
  const groups = [
    ["organization", "SELECT id,name FROM organizations WHERE id=$1"],
    ["user", "SELECT u.id,u.name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.organization_id=$1"],
    ["agent", "SELECT id,name FROM agents WHERE organization_id=$1"],
    ["project", "SELECT id,name FROM projects WHERE organization_id=$1"],
  ];
  for (const [type, sql] of groups) {
    for (const item of (await db.query(sql, [org])).rows) nodes.push({ id:type + ":" + item.id, type, name:item.name });
  }
  for (const item of (await db.query("SELECT id,name FROM tools")).rows) nodes.push({ id:"tool:" + item.id, type:"tool", name:item.name });
  const ids = new Set(nodes.map(n => n.id));
  const tuples = (await readTuples()).filter(t => ids.has(t.user) && ids.has(t.object));
  res.json({ nodes, tuples, refreshedAt:new Date().toISOString(),
    storage:"PostgreSQL relationship tuples; permissions are evaluated by OpenFGA, not inferred by this drawing." });
}));
app.post("/api/authorization/graph-check", requireUser, route(async(req,res) => {
  const { agentId, action, projectId, organizationId } = req.body;
  if (!["READ","CREATE","UPDATE"].includes(action) || typeof agentId !== "string" || typeof organizationId !== "string" ||
      (action !== "CREATE" && typeof projectId !== "string")) throw fail(400, "Select an agent, action and target.");
  req.params.agentId = agentId;
  const agent = await ownedAgent(req);
  const checks = [
    tuple("user:" + req.userId, "can_use", "agent:" + agent.id),
    tuple("agent:" + agent.id, "can_execute", "tool:" + {READ:"read-project",CREATE:"create-project",UPDATE:"update-project"}[action]),
    tuple("agent:" + agent.id, "assigned_agent", "organization:" + organizationId),
    tuple("agent:" + agent.id, action === "READ" ? "can_view" : action === "UPDATE" ? "can_update" : "can_create_project",
      action === "CREATE" ? "organization:" + organizationId : "project:" + projectId),
  ];
  if (action === "CREATE") checks.push(tuple("user:" + req.userId,"can_create_project","organization:" + organizationId));
  if (action !== "CREATE") {
    // Require graph-view rights before exposing local project identity.
    await enforce(req, organizationId, "Inspect graph target", [tuple("user:" + req.userId,"can_register_agent","organization:" + organizationId)]);
    const p = (await db.query("SELECT id FROM projects WHERE id=$1 AND organization_id=$2", [projectId,organizationId])).rows[0];
    if (!p) throw fail(404, "Project not found in this organization.");
  }
  res.json({ ...await decision("user:" + req.userId,agent.organizationId,"Graph check (no data changed)",checks),
    message:"Permission check only. No project was created or changed." });
}));

app.get("/api/authorization/activity",requireUser,route(async(req,res) => {
  const user = await publicUser(req);
  const orgs=user.organizations.filter(o=>o.canRegisterAgent).map(o=>o.id);
  const {rows}=await db.query(`SELECT id,actor,action,checks,allowed,created_at AS "createdAt" FROM authorization_audit
    WHERE organization_id=ANY($1::text[]) OR actor=$2 ORDER BY id DESC LIMIT 40`,[orgs,"user:"+req.userId]);
  res.json(rows);
}));
app.use((error,_req,res,_next) => {
  console.error(error.message);
  res.status(error.status ?? 500).json({ message:error.status ? error.message : "Service unavailable. Check the backend logs.",
    ...(error.decision ? { allowed:false,checks:error.decision.checks } : {}) });
});
app.listen(config.port,"127.0.0.1",()=>console.log("Backend running at http://localhost:"+config.port));
