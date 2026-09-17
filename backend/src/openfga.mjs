import { config, loadOpenFgaState } from "./config.mjs";

async function getState() {
  return loadOpenFgaState();
}

async function request(path, options = {}) {
  const response = await fetch(`${config.openfgaApiUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`OpenFGA ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

export async function check(user, relation, object) {
  const current = await getState();
  const result = await request(`/stores/${current.storeId}/check`, {
    method: "POST",
    body: JSON.stringify({
      authorization_model_id: current.authorizationModelId,
      tuple_key: { user, relation, object },
    }),
  });
  return result.allowed;
}

export async function writeTuples(tupleKeys) {
  if (tupleKeys.length === 0) return;
  const current = await getState();
  await request(`/stores/${current.storeId}/write`, {
    method: "POST",
    body: JSON.stringify({
      authorization_model_id: current.authorizationModelId,
      writes: { tuple_keys: tupleKeys },
    }),
  });
}

export async function readTuples() {
  const current = await getState();
  const tuples = [];
  let continuation_token;
  do {
    const page = await request(`/stores/${current.storeId}/read`, {
      method: "POST", body: JSON.stringify({ page_size: 100, continuation_token }),
    });
    tuples.push(...(page.tuples ?? []).map(({ key }) => ({ user: key.user, relation: key.relation, object: key.object })));
    continuation_token = page.continuation_token;
  } while (continuation_token);
  return tuples;
}
