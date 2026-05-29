import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isDev = process.env?.NODE_ENV !== 'production';
const PROXY = process.env.PROXY_PORT || '3001';

export default defineConfig({
  plugins: [react()],
  server: {
    open: true,
    port: 3000,
    host: '0.0.0.0',
    proxy: isDev ? {
      '/api': `http://localhost:${PROXY}`,
       "/socket.io": {
            target: `ws://localhost:${PROXY}`,
            ws: true,
          },
    } : {}
  },
});