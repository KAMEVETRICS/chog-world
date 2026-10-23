import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Node tests in test/, component tests (jsdom) in web/src/**/*.test.tsx.
export default defineConfig({
  plugins: [react()],
  test: { include: ["test/**/*.test.ts", "web/src/**/*.test.tsx"] },
});
