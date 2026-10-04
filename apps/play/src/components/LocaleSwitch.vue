<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { setLocale, type Locale } from '@/i18n';

const { locale, t } = useI18n();
const locales: Locale[] = ['cs', 'en'];
</script>

<template>
  <div class="flex rounded-xl border border-slate-200 bg-white p-0.5 text-xs font-semibold" role="group" :aria-label="t('common.language')">
    <button
      v-for="l in locales"
      :key="l"
      type="button"
      class="rounded-lg px-2 py-1 uppercase transition"
      :class="locale === l ? 'bg-primary-blue text-white' : 'text-text-gray hover:text-text-dark'"
      :aria-pressed="locale === l"
      @click="setLocale(l)"
    >
      {{ l }}
    </button>
  </div>
</template>
