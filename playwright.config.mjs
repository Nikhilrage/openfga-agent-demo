import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60000,
  expect: { timeout: 10000 },
  workers: 1,
  use: { actionTimeout: 10000, baseURL: "http://127.0.0.1:5173", viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure" },
});
