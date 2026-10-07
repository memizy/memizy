import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { i18n } from './i18n';
import './styles/main.css';

document.documentElement.lang = i18n.global.locale.value;

// No pinch zoom: iOS Safari ignores user-scalable=no, so stop its gestures (the games'
// iframes do the same through the SDK).
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => e.touches.length > 1 && e.preventDefault(), { passive: false });

createApp(App).use(createPinia()).use(router).use(i18n).mount('#app');
