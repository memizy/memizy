<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { SparklesIcon } from '@heroicons/vue/20/solid';
import type { LoadedPlugin } from '@memizy/host-sdk';
import { formatOQSEIssues } from '@memizy/oqse';
import { AI_TYPES, buildAiPrompt, defaultAiTypes, normalizeAiAnswer, type AiType } from '@/lib/aiSets';
import { importSetText, type LoadSetResult } from '@/lib/sets';
import { useCopy } from '@/lib/clipboard';

const props = defineProps<{ plugin: LoadedPlugin | null }>();
const emit = defineEmits<{ saved: [LoadSetResult] }>();
const { t, locale } = useI18n();
const { copied, copy } = useCopy();

const open = ref(false);
const topic = ref('');
const count = ref(20);
const language = ref(locale.value === 'en' ? 'en' : 'cs');
const types = ref<AiType[]>([]);
const answer = ref('');
const errors = ref<string[]>([]);
const warnings = ref<string[]>([]);
const busy = ref(false);

// Prefilled from what the game plays (again when another game is loaded).
watch(
  () => props.plugin?.manifest.capabilities.types,
  (pluginTypes) => (types.value = defaultAiTypes(pluginTypes as string[] | null | undefined)),
  { immediate: true },
);

const ready = computed(() => topic.value.trim().length > 2 && types.value.length > 0 && count.value >= 1);
const prompt = computed(() => buildAiPrompt({ topic: topic.value, count: Math.min(Math.max(count.value, 1), 100), language: language.value, types: types.value }));

function toggle(type: AiType): void {
  types.value = types.value.includes(type) ? types.value.filter((x) => x !== type) : AI_TYPES.filter((x) => x === type || types.value.includes(x));
}

async function save(): Promise<void> {
  errors.value = [];
  warnings.value = [];
  const normalized = normalizeAiAnswer(answer.value, { topic: topic.value || t('lab.ai.untitled'), language: language.value });
  if (!normalized.success) {
    errors.value = [normalized.error === 'no-json' || normalized.error === 'no-items' ? t(`lab.ai.${normalized.error}`) : t('lab.ai.badJson', { error: normalized.error })];
    return;
  }
  busy.value = true;
  const result = await importSetText(normalized.json, 'ai.oqse.json');
  busy.value = false;
  if (!result.success) {
    errors.value = result.errors;
    return;
  }
  const usable = result.set.file.items.length;
  if (usable < normalized.count || normalized.dropped) warnings.value.push(t('lab.ai.dropped', { n: normalized.count + normalized.dropped - usable }));
  warnings.value.push(...formatOQSEIssues(result.set.warnings).slice(0, 6));
  answer.value = '';
  emit('saved', result);
}
</script>

<template>
  <div class="rounded-xl border border-violet-200 bg-violet-50/40">
    <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-violet-800" @click="open = !open">
      <SparklesIcon class="size-4" /> {{ t('lab.ai.title') }}
      <span class="ml-auto text-xs font-normal text-text-gray">{{ open ? '▲' : '▼' }}</span>
    </button>
    <div v-if="open" class="flex flex-col gap-3 border-t border-violet-200 px-3 py-3 text-sm">
      <p class="text-xs text-text-gray">{{ t('lab.ai.intro') }}</p>

      <div class="section-label">1. {{ t('lab.ai.step1') }}</div>
      <input v-model="topic" class="input" :placeholder="t('lab.ai.topicPlaceholder')" />
      <div class="flex flex-wrap items-center gap-3">
        <label class="flex items-center gap-2 text-xs">
          {{ t('lab.ai.count') }}
          <input v-model.number="count" type="number" min="1" max="100" class="input w-20 py-1" />
        </label>
        <label class="flex items-center gap-2 text-xs">
          {{ t('lab.ai.language') }}
          <select v-model="language" class="input w-auto py-1">
            <option value="cs">čeština</option>
            <option value="en">English</option>
            <option value="sk">slovenčina</option>
            <option value="de">Deutsch</option>
          </select>
        </label>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="type in AI_TYPES"
          :key="type"
          type="button"
          class="rounded-full border px-2.5 py-1 text-xs"
          :class="types.includes(type) ? 'border-violet-500 bg-violet-100 font-semibold text-violet-800' : 'border-slate-200 text-text-gray hover:bg-slate-50'"
          @click="toggle(type)"
        >
          {{ type }}
        </button>
      </div>

      <div class="section-label">2. {{ t('lab.ai.step2') }}</div>
      <button type="button" class="btn-secondary self-start" :disabled="!ready" @click="copy(prompt, 'prompt')">
        {{ copied === 'prompt' ? t('common.copied') : t('lab.ai.copyPrompt') }}
      </button>
      <details v-if="ready" class="text-xs text-text-gray">
        <summary class="cursor-pointer">{{ t('lab.ai.showPrompt') }}</summary>
        <pre class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-2">{{ prompt }}</pre>
      </details>

      <div class="section-label">3. {{ t('lab.ai.step3') }}</div>
      <textarea v-model="answer" rows="5" class="input font-mono text-xs" placeholder='{"title": "…", "items": [ … ]}'></textarea>
      <button type="button" class="btn-primary self-start" :disabled="busy || !answer.trim()" @click="save">{{ t('lab.ai.save') }}</button>

      <ul v-if="errors.length" class="rounded-xl bg-red-50 p-3 text-xs text-red-700">
        <li v-for="(e, i) in errors.slice(0, 8)" :key="i">{{ e }}</li>
      </ul>
      <ul v-if="warnings.length" class="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
        <li v-for="(w, i) in warnings" :key="i">{{ w }}</li>
      </ul>
    </div>
  </div>
</template>
