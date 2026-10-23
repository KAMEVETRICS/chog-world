import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Landing and Soul are served by the API. City includes Cult in its own UI at /city/. In development, `vite`
// proxies /api to a running API server.
export default defineConfig({
  root: page("."),
  base: "/",
  plugins: [react()],
  build: {
    outDir: "dist", emptyOutDir: true,
    rollupOptions: { input: { home: page("index.html"), soul: page("soul/index.html") } },
  },
  server: { host: "127.0.0.1", port: 5173, proxy: { "/api": "http://127.0.0.1:8787" } },
});
