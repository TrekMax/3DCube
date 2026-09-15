import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
  plugins: [vue()],
  worker: { format: 'es' },
  build: {
    rollupOptions: { output: { manualChunks: { three: ['three'], icons: ['@lucide/vue'] } } },
  },
});
