import { execFileSync } from "node:child_process";

const openfgaUrl = process.env.OPENFGA_API_URL ?? "http://localhost:8080";

console.log("Starting PostgreSQL and OpenFGA...");
execFileSync("docker", ["compose", "up", "-d"], { stdio: "inherit" });

let healthy = false;
for (let attempt = 1; attempt <= 30; attempt += 1) {
  try {
    const response = await fetch(`${openfgaUrl}/healthz`);
    if (response.ok) {
      healthy = true;
      break;
    }
  } catch {
    // The container is still starting.
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

if (!healthy) throw new Error("OpenFGA did not become ready within 30 seconds");

await import("./bootstrap-openfga.mjs");
await import("./setup-app-db.mjs");
console.log("Demo infrastructure, authorization model, and data are ready.");
