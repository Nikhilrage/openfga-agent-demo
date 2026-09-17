import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
const port = Number(process.env.MCP_PORT ?? 3006);
const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:4000";
async function request(path, headers, options = {}) {
  const response = await fetch(backendUrl + path, {
    ...options, headers: { "content-type": "application/json", ...headers },
    signal: AbortSignal.timeout(15000),
  });
  return { ok: response.ok, status: response.status, body: await response.json() };
}
function result(response) {
  return { isError: !response.ok, content: [{ type: "text", text: JSON.stringify(response.body) }] };
}
async function buildServer(req, human) {
  const agentId = req.header("x-agent-id") ?? "";
  if (!agentId) throw Object.assign(new Error("Select an agent."), { status: 401 });
  // Human mode uses the verified session. Raw user ID headers are never trusted.
  const headers = human ? { cookie: req.headers.cookie ?? "" } :
    { "x-agent-id": agentId, "x-api-key": req.header("x-api-key") ?? "" };
  const base = human ? "/api/agents/" + encodeURIComponent(agentId) : "/api/agent";
  const profile = await request(base + (human ? "/mcp-profile" : "/me"), headers);
  if (!profile.ok) throw Object.assign(new Error(profile.body.message), { status: profile.status, body: profile.body });
  const allowed = new Set(profile.body.tools.map(t => t.id));
  const server = new McpServer({ name: "openfga-agent-demo", version: "1.1.0" });
  if (allowed.has("create-project")) server.registerTool("create_project", {
    description: "Create a project. Defaults to this agent's organization; an explicit target is authorized by OpenFGA.",
    inputSchema: {
      name: z.string().trim().min(1).max(150),
      description: z.string().optional(),
      organizationId: z.string().optional().describe("Target organization identifier; default is agent organization"),
    },
  }, async args => result(await request(base + "/projects", headers, { method: "POST", body: JSON.stringify(args) })));
  if (allowed.has("read-project")) server.registerTool("get_project", {
    description: "Read a project by its exact name or ID. Every read requires OpenFGA project permission.",
    inputSchema: {
      projectId: z.string().optional(),
      projectName: z.string().optional(),
      organizationId: z.string().optional(),
    },
  }, async ({ projectId, projectName, organizationId }) => {
    if (!projectName && !projectId) return result({ ok: false, body: { message: "Provide a project name or ID." } });
    if (projectId && !projectName && !organizationId)
      return result(await request(base + "/projects/" + encodeURIComponent(projectId), headers));
    const query = new URLSearchParams({ projectName: projectName ?? projectId });
    if (organizationId) query.set("organizationId", organizationId);
    return result(await request(base + "/project-lookup?" + query, headers));
  });
  if (allowed.has("update-project")) server.registerTool("update_project", {
    description: "Update the name or description of an assigned project. OpenFGA checks both the tool and exact project. Organization and ownership cannot be changed.",
    inputSchema: {
      projectName: z.string().trim().min(1).describe("Exact current project name or ID"),
      name: z.string().trim().min(1).max(150).optional().describe("New project name"),
      description: z.string().optional().describe("New description"),
      organizationId: z.string().optional(),
    },
  }, async args => result(await request(base + "/project-update", headers, { method:"PATCH", body:JSON.stringify(args) })));
  return server;
}
const app = express();
const origins = ["http://localhost:5173","http://127.0.0.1:5173","http://localhost:5174","http://127.0.0.1:5174"];
app.use(cors({ origin: origins, credentials: true,
  allowedHeaders: ["content-type","mcp-protocol-version","mcp-session-id","x-agent-id","x-api-key"],
  exposedHeaders: ["mcp-session-id"],
}));
app.use(express.json());
app.use((req,res,next) => {
  if (req.headers.origin && !origins.includes(req.headers.origin))
    return res.status(403).json({ message: "Origin not allowed" });
  next();
});
app.get("/health", (_req,res) => res.json({ status: "ok", protocol: "MCP Streamable HTTP" }));
for (const [path,human] of [["/mcp",false],["/mcp/platform",true]]) {
  app.post(path, async(req,res) => {
    try {
      const server = await buildServer(req,human);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { void server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req,res,req.body);
    } catch(error) {
      if(!res.headersSent) res.status(error.status ?? 503).json(error.body ?? {message:error.message});
    }
  });
  app.get(path, (_req,res) => res.status(405).json({message:"Stateless MCP uses POST"}));
  app.delete(path, (_req,res) => res.status(405).json({message:"No sessions to terminate"}));
}
app.listen(port,"127.0.0.1",()=>console.log("MCP server running at http://localhost:"+port+"/mcp"));
