import pg from "pg";
import { readFile } from "node:fs/promises";
import { hashPassword } from "../backend/src/passwords.mjs";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:55432/agent_demo";
const db = new pg.Client({ connectionString: databaseUrl });
await db.connect();

await db.query(`
  CREATE TABLE IF NOT EXISTS organizations (
    id text PRIMARY KEY,
    name text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY,
    name text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS memberships (
    user_id text NOT NULL REFERENCES users(id),
    organization_id text NOT NULL REFERENCES organizations(id),
    role text NOT NULL,
    PRIMARY KEY (user_id, organization_id)
  );
  CREATE TABLE IF NOT EXISTS tools (
    id text PRIMARY KEY,
    name text NOT NULL,
    description text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agents (
    id text PRIMARY KEY,
    name text NOT NULL,
    type text NOT NULL CHECK (type IN ('CREATE', 'READ')),
    organization_id text NOT NULL REFERENCES organizations(id),
    owner_user_id text NOT NULL REFERENCES users(id),
    api_key_hash text NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE',
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS agent_tools (
    agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    tool_id text NOT NULL REFERENCES tools(id),
    PRIMARY KEY (agent_id, tool_id)
  );
  CREATE TABLE IF NOT EXISTS projects (
    id text PRIMARY KEY,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    organization_id text NOT NULL REFERENCES organizations(id),
    created_by_agent_id text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
`);

await db.query(`
  INSERT INTO organizations (id, name) VALUES
    ('my-homes', 'My Homes'),
    ('green-builders', 'Green Builders')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

  INSERT INTO users (id, name) VALUES
    ('admin-1', 'Aarav Sharma'),
    ('admin-2', 'Meera Nair'),
    ('viewer-1', 'Riya Patel')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

  INSERT INTO memberships (user_id, organization_id, role) VALUES
    ('admin-1', 'my-homes', 'ADMIN'),
    ('admin-2', 'green-builders', 'ADMIN'),
    ('viewer-1', 'my-homes', 'VIEWER')
  ON CONFLICT (user_id, organization_id) DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO tools (id, name, description) VALUES
    ('create-project', 'Create Project', 'Create a project in the agent organization'),
    ('read-project', 'Read Project', 'Read explicitly assigned projects')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

  INSERT INTO projects (id, name, description, organization_id) VALUES
    ('sunrise-towers', 'Sunrise Towers', 'Residential tower project', 'my-homes'),
    ('lake-view', 'Lake View', 'Lakeside residential project', 'my-homes'),
    ('green-heights', 'Green Heights', 'Green Builders flagship project', 'green-builders')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
    organization_id = EXCLUDED.organization_id;
`);

await db.query(`
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email text UNIQUE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by_user_id text REFERENCES users(id);
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY, user_id text REFERENCES users(id) NOT NULL, expires_at timestamptz NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agent_projects (
    agent_id text REFERENCES agents(id) ON DELETE CASCADE,
    project_id text REFERENCES projects(id) ON DELETE CASCADE,
    PRIMARY KEY (agent_id, project_id)
  );
  CREATE TABLE IF NOT EXISTS authorization_audit (
    id bigserial PRIMARY KEY, actor text NOT NULL, organization_id text,
    checks jsonb NOT NULL, allowed boolean NOT NULL, action text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
`);
for (const [id, email] of [
  ["admin-1", "aarav@myhomes.demo"],
  ["admin-2", "meera@greenbuilders.demo"],
  ["viewer-1", "riya@myhomes.demo"]
]) {
  const existing = await db.query("SELECT password_hash FROM users WHERE id=$1", [id]);
  await db.query("UPDATE users SET email=$1, password_hash=$2 WHERE id=$3",
    [email, existing.rows[0].password_hash ?? await hashPassword("Demo@1234"), id]);
}
// Recover the readable-project mappings for agents registered by earlier milestones.
const state = JSON.parse(await readFile(new URL("../.openfga-state.json", import.meta.url)));
let continuation_token;
do {
  const response = await fetch(state.apiUrl + "/stores/" + state.storeId + "/read", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ page_size: 100, continuation_token }),
  });
  if (!response.ok) throw new Error("Could not synchronize existing OpenFGA project assignments.");
  const page = await response.json();
  for (const { key } of page.tuples ?? []) {
    if (key.user.startsWith("agent:") && key.object.startsWith("project:") && key.relation === "viewer")
      await db.query(`INSERT INTO agent_projects (agent_id,project_id)
        SELECT a.id,p.id FROM agents a JOIN projects p ON a.organization_id=p.organization_id
        WHERE a.id=$1 AND p.id=$2 ON CONFLICT DO NOTHING`,[key.user.slice(6),key.object.slice(8)]);
  }
  continuation_token = page.continuation_token;
} while (continuation_token);
await db.end();
await import("./migrate-capabilities.mjs");
console.log("Application database schema and demo data are ready.");
