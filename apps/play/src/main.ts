import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { i18n } from './i18n';
import './styles/main.css';

document.documentElement.lang = i18n.global.locale.value;

createApp(App).use(createPinia()).use(router).use(i18n).mount('#app');
