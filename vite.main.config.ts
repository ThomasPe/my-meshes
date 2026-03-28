import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['better-sqlite3', 'electron-log', 'electron-log/main', 'js-yaml', 'chokidar', 'jszip'],
    },
  },
});
