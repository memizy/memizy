<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { UserGroupIcon, XMarkIcon } from '@heroicons/vue/20/solid';
import type { RelayPlayer } from '@memizy/protocol';

defineProps<{ players: RelayPlayer[]; hostName?: string | null }>();
defineEmits<{ kick: [string] }>();
const { t } = useI18n();
</script>

<template>
  <section class="card overflow-hidden">
    <div class="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
      <UserGroupIcon class="size-4 text-text-gray" />
      <span class="font-semibold">{{ t('host.players') }}</span>
      <span class="badge ml-auto bg-slate-200 font-mono text-text-gray">{{ players.length + (hostName ? 1 : 0) }}</span>
    </div>
    <ul v-if="players.length || hostName" class="flex flex-wrap gap-2 p-4">
      <li v-if="hostName" class="flex items-center gap-1.5 rounded-full bg-orange-50 py-1 pr-3 pl-2 text-sm font-semibold text-accent-orange-dark">
        <span class="size-2 rounded-full bg-emerald-500" /> {{ hostName }}
        <span class="text-xs font-normal">({{ t('lab.preview.host') }})</span>
      </li>
      <li v-for="p in players" :key="p.id" class="group flex items-center gap-1.5 rounded-full bg-slate-100 py-1 pr-1.5 pl-2 text-sm font-semibold">
        <span class="size-2 rounded-full" :class="p.connected ? 'bg-emerald-500' : 'bg-slate-300'" />
        <span :class="p.connected ? '' : 'text-text-gray'">{{ p.name }}</span>
        <button type="button" class="rounded-full p-0.5 text-slate-400 hover:bg-red-100 hover:text-red-600" :title="t('host.kick')" @click="$emit('kick', p.id)">
          <XMarkIcon class="size-3.5" />
        </button>
      </li>
    </ul>
    <p v-else class="flex flex-col items-center gap-2 py-8 text-sm text-text-gray">
      <span class="text-2xl">📡</span>
      {{ t('host.waitingPlayers') }}
    </p>
  </section>
</template>
