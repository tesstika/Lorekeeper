import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vitest/config';

// Vue 3.6-rc ships Vapor helpers only in ESM builds; the test chain must use a
// single (ESM) set of runtime instances, so the identity-critical packages are
// aliased to their esm-bundler dist files and inlined into Vitest's transform.
const esm = (pkg: string) => `${pkg}/dist/${pkg.replace('@vue/', '')}.esm-bundler.js`;

export default defineConfig({
  plugins: [vue(), Icons({ compiler: 'vue3' })],
  resolve: {
    alias: [
      { find: /^vue$/, replacement: 'vue/dist/vue.esm-bundler.js' },
      { find: /^@vue\/runtime-dom$/, replacement: esm('@vue/runtime-dom') },
      { find: /^@vue\/runtime-core$/, replacement: esm('@vue/runtime-core') },
      { find: /^@vue\/runtime-vapor$/, replacement: esm('@vue/runtime-vapor') },
      { find: /^@vue\/reactivity$/, replacement: esm('@vue/reactivity') },
      { find: /^@vue\/shared$/, replacement: esm('@vue/shared') },
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
    ],
  },
  test: {
    environment: 'jsdom',
    pool: 'threads',
    include: ['src/**/*.test.ts'],
    server: {
      deps: {
        inline: ['vue', '@vue/test-utils'],
      },
    },
  },
});
