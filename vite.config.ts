import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflareHeadersPlugin } from './scripts/securityHeaders.ts';

export default defineConfig({
  plugins: [react(), cloudflareHeadersPlugin()],
});
