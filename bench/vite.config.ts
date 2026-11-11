import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3200,
    proxy: {
      '/api': 'http://localhost:3201',
    },
  },
  css: {
    preprocessorOptions: {
      scss: { api: 'modern-compiler' },
    },
  },
});
