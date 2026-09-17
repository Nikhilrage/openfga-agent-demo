import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1", port: 5174, strictPort: true,
    proxy: {
      "/api/mcp": { target: "http://127.0.0.1:3006", rewrite: path => path.replace(/^\/api\/mcp/, "/mcp/platform") },
      "/api": "http://127.0.0.1:4000",
    },
  },
});
