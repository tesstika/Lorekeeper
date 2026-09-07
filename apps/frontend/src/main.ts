import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { createPinia } from 'pinia';
import { createApp, vaporInteropPlugin } from 'vue';
import App from './App.vue';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/source-serif-4';
import './styles/tailwind.css';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// vaporInteropPlugin wires Vapor↔VDOM interop for the mixed-mode app (decision D4).
createApp(App)
  .use(vaporInteropPlugin)
  .use(createPinia())
  .use(router)
  .use(VueQueryPlugin, { queryClient })
  .mount('#app');
