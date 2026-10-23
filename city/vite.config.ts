import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Never read the parent workspace's .env (root signer keys live there).
  envDir: 'env-fixture',
  // Server mode in development (`dev:server`): the Chog server answers /api on its default port.
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  test: {
    globals: true,
    setupFiles: ['./test/setup.ts'],
  },
});
