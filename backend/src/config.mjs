import { readFile } from "node:fs/promises";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@localhost:55432/agent_demo",
  openfgaApiUrl: process.env.OPENFGA_API_URL ?? "http://localhost:8080",
  mcpUrl: process.env.MCP_URL ?? "http://localhost:3006/mcp",
};

export async function loadOpenFgaState() {
  const raw = await readFile(
    new URL("../../.openfga-state.json", import.meta.url),
    "utf8",
  );
  return JSON.parse(raw);
}
