<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import AppLogo from '@/components/AppLogo.vue';
import LocaleSwitch from '@/components/LocaleSwitch.vue';

const { t } = useI18n();
const route = useRoute();
const feature = computed(() => (route.meta.feature === 'host' ? 'host' : 'join'));
</script>

<template>
  <div class="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-6">
    <header class="flex items-center justify-between">
      <AppLogo />
      <LocaleSwitch />
    </header>
    <main class="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <span class="badge bg-orange-100 text-accent-orange-dark">{{ t('common.soon') }}</span>
      <h1 class="text-3xl font-black">{{ t(`home.${feature}.title`) }}</h1>
      <p class="text-text-gray">{{ t(`soon.${feature}`) }}</p>
      <div class="flex gap-2">
        <RouterLink to="/" class="btn-secondary">{{ t('common.back') }}</RouterLink>
        <RouterLink to="/lab" class="btn-primary">{{ t('soon.toLab') }}</RouterLink>
      </div>
    </main>
  </div>
</template>
