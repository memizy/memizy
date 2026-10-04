import { createRouter, createWebHistory } from 'vue-router';
import HomeView from './views/HomeView.vue';

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/lab', name: 'lab', component: () => import('./views/LabView.vue') },
    { path: '/join/:pin?', name: 'join', component: () => import('./views/SoonView.vue'), meta: { feature: 'join' } },
    { path: '/host', name: 'host', component: () => import('./views/SoonView.vue'), meta: { feature: 'host' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
