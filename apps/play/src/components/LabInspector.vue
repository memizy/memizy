<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronUpIcon } from '@heroicons/vue/20/solid';

export interface LogEntry {
  id: number;
  time: Date;
  kind: 'traffic' | 'error' | 'info';
  text: string;
  data?: unknown;
}

const props = defineProps<{ entries: LogEntry[] }>();
defineEmits<{ clear: [] }>();
const { t } = useI18n();

const open = ref(false);
const filter = ref<'all' | 'error'>('all');
const errors = computed(() => props.entries.filter((e) => e.kind === 'error').length);
const shown = computed(() => [...(filter.value === 'error' ? props.entries.filter((e) => e.kind === 'error') : props.entries)].reverse().slice(0, 150));
const expanded = ref(new Set<number>());

function toggle(id: number): void {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

function preview(data: unknown): string {
  const text = JSON.stringify(data);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

const time = (d: Date) => d.toLocaleTimeString([], { hour12: false });
</script>

<template>
  <div class="border-t border-slate-200 bg-white">
    <button type="button" class="flex w-full items-center gap-2 px-4 py-2 text-sm font-semibold" @click="open = !open">
      {{ t('lab.preview.inspector') }}
      <span class="badge bg-slate-100 text-text-gray">{{ entries.length }}</span>
      <span v-if="errors" class="badge bg-red-100 text-red-700">{{ errors }} {{ t('lab.inspector.errors') }}</span>
      <ChevronUpIcon class="ml-auto size-5 text-text-gray transition" :class="open ? 'rotate-180' : ''" />
    </button>
    <div v-if="open" class="border-t border-slate-100">
      <div class="flex items-center gap-2 px-4 py-2 text-xs">
        <button type="button" class="badge" :class="filter === 'all' ? 'bg-primary-blue text-white' : 'bg-slate-100'" @click="filter = 'all'">
          {{ t('lab.inspector.traffic') }}
        </button>
        <button type="button" class="badge" :class="filter === 'error' ? 'bg-red-600 text-white' : 'bg-slate-100'" @click="filter = 'error'">
          {{ t('lab.inspector.errors') }}
        </button>
        <button type="button" class="ml-auto text-text-gray hover:text-text-dark" @click="$emit('clear')">{{ t('lab.inspector.clear') }}</button>
      </div>
      <ol class="max-h-64 overflow-auto px-4 pb-3 font-mono text-xs">
        <li v-if="!shown.length" class="py-2 text-text-gray">{{ t('lab.inspector.empty') }}</li>
        <li
          v-for="entry in shown"
          :key="entry.id"
          class="border-b border-slate-50 py-1"
          :class="entry.kind === 'error' ? 'text-red-600' : entry.kind === 'info' ? 'text-text-gray' : ''"
        >
          <button type="button" class="w-full text-left" :disabled="entry.data === undefined" @click="toggle(entry.id)">
            <span class="text-slate-400">{{ time(entry.time) }}</span>
            {{ entry.text }}
            <span v-if="entry.data !== undefined && !expanded.has(entry.id)" class="text-slate-400">{{ preview(entry.data) }}</span>
          </button>
          <pre v-if="expanded.has(entry.id)" class="mt-1 overflow-auto rounded-lg bg-slate-50 p-2 whitespace-pre-wrap">{{ JSON.stringify(entry.data, null, 2) }}</pre>
        </li>
      </ol>
    </div>
  </div>
</template>
