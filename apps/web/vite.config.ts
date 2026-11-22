import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
    // Vite blocks unknown Host headers by default — tunnels (cloudflared/ngrok) need this.
    allowedHosts: true,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
});
