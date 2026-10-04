<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/** The blue "loading players / starting in 3…" screen (like the original Memizy multiplayer). */
defineProps<{ countdown?: number | null; ready?: number; total?: number; text?: string }>();
const { t } = useI18n();
</script>

<template>
  <div class="fixed inset-0 z-30 flex flex-col items-center justify-center bg-[#1760FF] px-6 text-center text-white">
    <template v-if="countdown">
      <h2 class="text-3xl font-black">{{ t('start.startingIn') }}</h2>
      <Transition name="pop" mode="out-in">
        <div :key="countdown" class="mt-4 text-[10rem] leading-none font-black drop-shadow-lg">{{ countdown }}</div>
      </Transition>
    </template>
    <template v-else>
      <div class="animate-float text-6xl">⏳</div>
      <h2 class="mt-4 text-3xl font-black">{{ text ?? t('start.waitingPlayers') }}</h2>
      <p v-if="total" class="mt-2 text-lg font-medium opacity-90">{{ t('start.ready', { n: ready ?? 0, total }) }}</p>
    </template>
  </div>
</template>

<style scoped>
.pop-enter-active {
  transition: transform 0.35s cubic-bezier(0.2, 1.6, 0.4, 1), opacity 0.2s;
}
.pop-leave-active {
  transition: transform 0.2s ease-in, opacity 0.2s;
}
.pop-enter-from {
  transform: scale(0.3);
  opacity: 0;
}
.pop-leave-to {
  transform: scale(1.6);
  opacity: 0;
}
</style>
