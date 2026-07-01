import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5184,
    strictPort: true,
    watch: { ignored: ['**/devlog.txt', '**/addon/**', '**/src-tauri/**', '**/dist/**'] },
  },
  build: { chunkSizeWarningLimit: 800 },
});
