import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: { include: ['@testwise/shared'] },
  build: { commonjsOptions: { include: [/shared/, /node_modules/] } },
  server: { port: 5173 },
});
