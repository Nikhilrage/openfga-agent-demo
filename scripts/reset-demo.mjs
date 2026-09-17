import pg from "pg";

const openfgaUrl = process.env.OPENFGA_API_URL ?? "http://localhost:8080";
const databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:55432/agent_demo";
const storeName = "openfga-agent-demo";

const storesResponse = await fetch(`${openfgaUrl}/stores`);
if (!storesResponse.ok) throw new Error("OpenFGA is not running. Run npm run setup first.");
const stores = await storesResponse.json();
const store = stores.stores?.find((candidate) => candidate.name === storeName);

if (store) {
  const deleted = await fetch(`${openfgaUrl}/stores/${store.id}`, { method: "DELETE" });
  if (!deleted.ok) throw new Error(`Could not reset OpenFGA store (${deleted.status})`);
  console.log("Removed the previous OpenFGA demo store.");
}

const db = new pg.Client({ connectionString: databaseUrl });
await db.connect();
await db.query("BEGIN");
try {
  await db.query("DELETE FROM sessions");
  await db.query("DELETE FROM authorization_audit");
  await db.query("DELETE FROM agent_tools");
  await db.query("DELETE FROM agents");
  await db.query("DELETE FROM projects WHERE id NOT IN ('sunrise-towers', 'lake-view', 'green-heights')");
  await db.query("UPDATE projects SET created_by_agent_id = NULL");
  await db.query("COMMIT");
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}

await import("./bootstrap-openfga.mjs");
await import("./setup-app-db.mjs");
console.log("Demo reset complete. Only the baseline users, organizations, tools, and projects remain.");
