import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import Icons from 'unplugin-icons/vite';
import { defineConfig, type Plugin } from 'vite';
import VueDevTools from 'vite-plugin-vue-devtools';

/**
 * Gecko (Firefox/Waterfox) console hygiene. Two Tailwind-v4 artifacts are
 * harmless in Chromium but noisy in Gecko:
 *
 * 1. Preflight emits `-webkit-text-size-adjust: 100%` on `html, :host`.
 *    Gecko rejects the declaration and logs "Error in parsing value for
 *    '-webkit-text-size-adjust'. Declaration dropped." on every stylesheet
 *    load. The app's viewport meta already disables mobile text inflation,
 *    so the dead declaration is stripped from the compiled CSS (dev transform
 *    and build assets alike).
 * 2. Tailwind's default mono stack requests the locally installed
 *    "Liberation Mono", which Waterfox's font-visibility protection (level 2)
 *    blocks with a console warning. The stack is trimmed at the source in
 *    `tailwind.css`; this patch also removes the inert preflight fallback
 *    occurrence so the family name cannot reach any browser at all.
 */
const geckoConsoleHygiene = (): Plugin => {
  const patch = (css: string): string =>
    css
      .replace(/-webkit-text-size-adjust\s*:[^;{}]*;?/g, '')
      .replace(/(["'])Liberation Mono\1\s*,\s*/g, '');

  return {
    name: 'lk-gecko-console-hygiene',
    enforce: 'post',
    transform(code, id) {
      const file = id.split('?')[0] ?? '';
      if (file.endsWith('.css') && /-webkit-text-size-adjust|Liberation Mono/.test(code)) {
        return patch(code);
      }
      return null;
    },
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'asset' && file.fileName.endsWith('.css')) {
          const css =
            typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source);
          if (/-webkit-text-size-adjust|Liberation Mono/.test(css)) {
            file.source = patch(css);
          }
        }
      }
    },
  };
};

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    Icons({ compiler: 'vue3' }),
    VueDevTools(),
    geckoConsoleHygiene(),
  ],
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
