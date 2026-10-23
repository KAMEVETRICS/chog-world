import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// One multi-page build served by the API: / (landing), /soul/ and /cult/. Chog City's own UI (../city) serves /city/. In development, `vite`
// proxies /api to a running API server.
export default defineConfig({
  root: page("."),
  base: "/",
  plugins: [react()],
  build: {
    outDir: "dist", emptyOutDir: true,
    rollupOptions: { input: { home: page("index.html"), soul: page("soul/index.html"), cult: page("cult/index.html") } },
  },
  server: { host: "127.0.0.1", port: 5173, proxy: { "/api": "http://127.0.0.1:8787" } },
});
