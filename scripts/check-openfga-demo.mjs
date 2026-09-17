import { readFile } from "node:fs/promises";

const state = JSON.parse(await readFile(new URL("../.openfga-state.json", import.meta.url)));

const scenarios = [
  ["Create Agent 1 can execute create-project tool", "agent:create-agent-1", "can_execute", "tool:create-project", true],
  ["Read Agent 1 cannot execute create-project tool", "agent:read-agent-1", "can_execute", "tool:create-project", false],
  ["Read Agent 1 can execute read-project tool", "agent:read-agent-1", "can_execute", "tool:read-project", true],
  ["Create Agent 1 can create in My Homes", "agent:create-agent-1", "can_create_project", "organization:my-homes", true],
  ["Create Agent 2 cannot create in My Homes", "agent:create-agent-2", "can_create_project", "organization:my-homes", false],
  ["Read Agent 1 can read Sunrise Towers", "agent:read-agent-1", "can_view", "project:sunrise-towers", true],
  ["Read Agent 1 cannot read Lake View", "agent:read-agent-1", "can_view", "project:lake-view", false]
];

let failed = false;
for (const [name, user, relation, object, expected] of scenarios) {
  const response = await fetch(`${state.apiUrl}/stores/${state.storeId}/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      authorization_model_id: state.authorizationModelId,
      tuple_key: { user, relation, object },
    }),
  });
  const result = await response.json();
  const passed = response.ok && result.allowed === expected;
  failed ||= !passed;
  console.log(`${passed ? "PASS" : "FAIL"} | expected=${expected} actual=${result.allowed} | ${name}`);
}

if (failed) process.exitCode = 1;

