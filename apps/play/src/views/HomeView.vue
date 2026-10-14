<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import {
  ArrowTopRightOnSquareIcon,
  BeakerIcon,
  DevicePhoneMobileIcon,
  PresentationChartBarIcon,
  PresentationChartLineIcon,
  UserIcon,
} from '@heroicons/vue/24/outline';
import AppLogo from '@/components/AppLogo.vue';
import LocaleSwitch from '@/components/LocaleSwitch.vue';

const { t } = useI18n();

const cards = [
  { to: '/join', key: 'join', icon: DevicePhoneMobileIcon, accent: 'bg-orange-50 text-accent-orange' },
  { to: '/host', key: 'host', icon: PresentationChartBarIcon, accent: 'bg-blue-50 text-primary-blue' },
  { to: '/solo', key: 'solo', icon: UserIcon, accent: 'bg-emerald-50 text-emerald-600' },
  { to: '/lab', key: 'lab', icon: BeakerIcon, accent: 'bg-violet-50 text-violet-600' },
] as const;

// docs/presentation, copied into the build by vite.config.ts
const presentationUrl = `${import.meta.env.BASE_URL}presentation/`;
</script>

<template>
  <div class="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-6">
    <header class="flex items-center justify-between">
      <AppLogo />
      <LocaleSwitch />
    </header>

    <main class="flex flex-1 flex-col justify-center py-12">
      <h1 class="text-shadow text-center text-4xl font-black tracking-tight sm:text-5xl">
        Memizy <span class="text-accent-orange">Play</span>
      </h1>
      <p class="mt-3 text-center text-lg text-text-gray">{{ t('home.tagline') }}</p>

      <div class="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <RouterLink
          v-for="card in cards"
          :key="card.key"
          :to="card.to"
          class="card group flex flex-col gap-3 p-6 transition hover:-translate-y-0.5 hover:shadow-soft-hover"
        >
          <span class="grid size-12 place-items-center rounded-2xl" :class="card.accent">
            <component :is="card.icon" class="size-6" />
          </span>
          <span class="text-lg font-bold group-hover:text-accent-orange">{{ t(`home.${card.key}.title`) }}</span>
          <span class="text-sm text-text-gray">{{ t(`home.${card.key}.text`) }}</span>
        </RouterLink>
      </div>

      <a
        :href="presentationUrl"
        target="_blank"
        rel="noopener"
        class="group mx-auto mt-8 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-text-gray transition hover:bg-white hover:text-accent-orange hover:shadow-soft"
      >
        <PresentationChartLineIcon class="size-5" />
        {{ t('home.presentation') }}
        <ArrowTopRightOnSquareIcon class="size-4 opacity-0 transition group-hover:opacity-100" />
      </a>
    </main>
  </div>
</template>
