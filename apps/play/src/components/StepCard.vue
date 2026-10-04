<script setup lang="ts">
import { CheckIcon, ChevronDownIcon } from '@heroicons/vue/20/solid';

defineProps<{ step: number; title: string; done?: boolean; open: boolean; summary?: string }>();
defineEmits<{ toggle: [] }>();
</script>

<template>
  <section class="card shrink-0 overflow-hidden" :class="open ? 'ring-2 ring-orange-100' : ''">
    <button type="button" class="flex w-full items-center gap-3 px-4 py-3 text-left" :aria-expanded="open" @click="$emit('toggle')">
      <span
        class="grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold"
        :class="done ? 'bg-emerald-500 text-white' : open ? 'btn-primary-gradient text-white' : 'bg-slate-100 text-text-gray'"
      >
        <CheckIcon v-if="done" class="size-4" />
        <template v-else>{{ step }}</template>
      </span>
      <span class="min-w-0 flex-1">
        <span class="block font-semibold">{{ title }}</span>
        <span v-if="summary && !open" class="block truncate text-xs text-text-gray">{{ summary }}</span>
      </span>
      <ChevronDownIcon class="size-5 shrink-0 text-text-gray transition" :class="open ? 'rotate-180' : ''" />
    </button>
    <div v-if="open" class="border-t border-slate-100 px-4 pt-3 pb-4">
      <slot />
    </div>
  </section>
</template>
