import { readFile, writeFile } from "node:fs/promises";

const apiUrl = process.env.OPENFGA_API_URL ?? "http://localhost:8080";
const storeName = "openfga-agent-demo";

async function request(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  return body;
}

const stores = await request("/stores");
let store = stores.stores?.find((candidate) => candidate.name === storeName);
if (!store) {
  store = await request("/stores", {
    method: "POST",
    body: JSON.stringify({ name: storeName }),
  });
}

const model = JSON.parse(await readFile(new URL("../openfga/model.json", import.meta.url)));
const writtenModel = await request(`/stores/${store.id}/authorization-models`, {
  method: "POST",
  body: JSON.stringify(model),
});

const tuples = JSON.parse(await readFile(new URL("../openfga/demo-tuples.json", import.meta.url)));
const existing = { tuples: [] };
let continuation_token;
do {
  const page = await request(`/stores/${store.id}/read`, {
    method: "POST", body: JSON.stringify({ page_size: 100, continuation_token }),
  });
  existing.tuples.push(...(page.tuples ?? []));
  continuation_token = page.continuation_token;
} while (continuation_token);
const tupleId = ({ user, relation, object }) => user + "|" + relation + "|" + object;
const existingIds = new Set((existing.tuples ?? []).map(({ key }) => tupleId(key)));
// Preserve create capabilities registered before project_creator was introduced.
for (const { key } of existing.tuples) {
  if (key.relation === "executor" && key.object === "tool:create-project") {
    for (const { key: scope } of existing.tuples) {
      if (scope.user === key.user && scope.relation === "assigned_agent")
        tuples.writes.tuple_keys.push({ user: key.user, relation: "project_creator", object: scope.object });
    }
  }
}
const missingTuples = [...new Map(tuples.writes.tuple_keys.map(key => [tupleId(key), key])).values()].filter((tuple) => !existingIds.has(tupleId(tuple)));

if (missingTuples.length > 0) {
  await request(`/stores/${store.id}/write`, {
    method: "POST",
    body: JSON.stringify({
      authorization_model_id: writtenModel.authorization_model_id,
      writes: { tuple_keys: missingTuples },
    }),
  });
}

const state = {
  apiUrl,
  storeId: store.id,
  authorizationModelId: writtenModel.authorization_model_id,
};
await writeFile(new URL("../.openfga-state.json", import.meta.url), `${JSON.stringify(state, null, 2)}\n`);
console.log(JSON.stringify(state, null, 2));
