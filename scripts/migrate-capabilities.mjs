// Upgrade the schema/model without seeding agents or projects.
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../backend/src/db.mjs";
import { config, loadOpenFgaState } from "../backend/src/config.mjs";

try {
  const state = await loadOpenFgaState();
  const model = JSON.parse(await readFile(new URL("../openfga/model.json", import.meta.url), "utf8"));
  const base = config.openfgaApiUrl + "/stores/" + state.storeId + "/authorization-models";
  const current = await fetch(base + "/" + state.authorizationModelId);
  if (!current.ok) throw new Error("Cannot read the current OpenFGA model.");
  const existing = (await current.json()).authorization_model;
  // OpenFGA normalizes empty metadata, so use the new relation as the migration marker.
  if (!existing.type_definitions.find(t => t.type === "project")?.relations.editor) {
    const response = await fetch(base, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(model),
    });
    if (!response.ok) throw new Error("OpenFGA model migration failed: " + await response.text());
    state.authorizationModelId = (await response.json()).authorization_model_id;
    await writeFile(new URL("../.openfga-state.json", import.meta.url), JSON.stringify(state, null, 2) + "\n");
  }
  await db.query(`
    BEGIN;
    ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_type_check;
    ALTER TABLE agents ADD CONSTRAINT agents_type_check CHECK (type IN ('CREATE','READ','UPDATE'));
    INSERT INTO tools(id,name,description) VALUES
      ('update-project','Update Project','Update only explicitly assigned projects')
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description;
    COMMIT;
  `);
  console.log("Update capability ready. Existing users, agents, projects, and tuples preserved.");
} finally { await db.end(); }
