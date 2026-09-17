import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
const mcpUrl = process.env.MCP_URL ?? "http://localhost:3006/mcp";

const loginResponse = await fetch(backendUrl + "/api/auth/login", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "aarav@myhomes.demo", password: "Demo@1234" }),
});
if (!loginResponse.ok) throw new Error("Could not sign in for MCP regression test.");
const cookie = loginResponse.headers.get("set-cookie").split(";")[0];
async function registerAgent(body) {
  const response = await fetch(`${backendUrl}/api/agents`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result.credentials;
}

async function connect(credentials) {
  const client = new Client({ name: "milestone-4-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: {
      headers: {
        "x-agent-id": credentials.agentId,
        "x-api-key": credentials.apiKey,
      },
    },
  });
  await client.connect(transport);
  return client;
}

function assert(name, condition, details) {
  console.log(`${condition ? "PASS" : "FAIL"} | ${name}`);
  if (!condition) {
    console.error(details);
    process.exitCode = 1;
  }
}

const createCredentials = await registerAgent({
  name: `MCP Create Agent ${Date.now()}`,
  type: "CREATE",
  organizationId: "my-homes",
});
const createClient = await connect(createCredentials);
const createTools = await createClient.listTools();
assert(
  "Create agent sees only create_project",
  createTools.tools.map((tool) => tool.name).join(",") === "create_project",
  createTools,
);
const creation = await createClient.callTool({
  name: "create_project",
  arguments: { name: `Created through MCP ${Date.now()}`, description: "Milestone 4" },
});
assert("Create agent creates a project through MCP", creation.isError !== true, creation);
await createClient.close();

const readCredentials = await registerAgent({
  name: `MCP Read Agent ${Date.now()}`,
  type: "READ",
  organizationId: "my-homes",
  projectIds: ["sunrise-towers"],
});
const readClient = await connect(readCredentials);
const readTools = await readClient.listTools();
assert(
  "Read agent sees only get_project",
  readTools.tools.map((tool) => tool.name).join(",") === "get_project",
  readTools,
);
const allowed = await readClient.callTool({ name: "get_project", arguments: { projectId: "sunrise-towers" } });
assert("Read agent fetches its assigned project through MCP", allowed.isError !== true, allowed);
const denied = await readClient.callTool({ name: "get_project", arguments: { projectId: "lake-view" } });
assert("OpenFGA denies another project in the same organization", denied.isError === true, denied);
await readClient.close();
