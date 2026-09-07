import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/chats' },
    { path: '/chats', component: () => import('@/pages/ChatsListPage.vue') },
    { path: '/chats/:id', component: () => import('@/pages/ChatPage.vue') },
    { path: '/characters', component: () => import('@/pages/CharactersPage.vue') },
    { path: '/characters/new', component: () => import('@/pages/CharacterEditorPage.vue') },
    { path: '/characters/:id', component: () => import('@/pages/CharacterEditorPage.vue') },
    { path: '/personas/new', component: () => import('@/pages/PersonaEditorPage.vue') },
    { path: '/personas/:id', component: () => import('@/pages/PersonaEditorPage.vue') },
    { path: '/settings', component: () => import('@/pages/SettingsPage.vue') },
  ],
});
