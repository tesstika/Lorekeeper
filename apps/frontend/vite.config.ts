import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vite';
import VueDevTools from 'vite-plugin-vue-devtools';

export default defineConfig({
  plugins: [vue(), tailwindcss(), Icons({ compiler: 'vue3' }), VueDevTools()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Vue 3.6-rc: Vapor helpers are only re-exported by the full esm-bundler build.
      vue: 'vue/dist/vue.esm-bundler.js',
    },
  },
  server: {
    // localhost binds can silently fail on some Windows IPv6 setups — pin IPv4.
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/media': 'http://127.0.0.1:3000',
    },
  },
});
