<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ArrowUpTrayIcon, TrashIcon } from '@heroicons/vue/20/solid';
import type { LoadedPlugin } from '@memizy/host-sdk';
import { BUILTIN_SETS, importSetFile, importSetFromUrl, loadStoredSets, removeStoredSet, type LoadSetResult, type StudySet } from '@/lib/sets';

const props = defineProps<{ plugin: LoadedPlugin | null }>();
const selected = defineModel<string>({ required: true });
const emit = defineEmits<{ change: [StudySet | null] }>();
const { t } = useI18n();

const stored = ref<StudySet[]>([]);
const url = ref('');
const errors = ref<string[]>([]);
const busy = ref(false);

const all = computed(() => [...BUILTIN_SETS, ...stored.value]);
const current = computed(() => all.value.find((s) => s.key === selected.value) ?? null);

function select(key: string): void {
  selected.value = key;
  emit('change', all.value.find((s) => s.key === key) ?? null);
}

onMounted(async () => {
  stored.value = await loadStoredSets();
  if (!current.value) select(BUILTIN_SETS[0].key);
  else emit('change', current.value);
});

async function finish(result: LoadSetResult): Promise<void> {
  if (!result.success) {
    errors.value = result.errors;
    return;
  }
  errors.value = [];
  stored.value = [...stored.value.filter((s) => s.key !== result.set.key), result.set];
  select(result.set.key);
}

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  busy.value = true;
  await finish(await importSetFile(file));
  busy.value = false;
}

async function onUrl(): Promise<void> {
  if (!url.value.trim()) return;
  busy.value = true;
  await finish(await importSetFromUrl(url.value.trim()));
  busy.value = false;
}

async function remove(set: StudySet): Promise<void> {
  await removeStoredSet(set.key);
  stored.value = stored.value.filter((s) => s.key !== set.key);
  if (selected.value === set.key) select(BUILTIN_SETS[0].key);
}

/** Which items of a set the current plugin declares. */
function coverage(set: StudySet): { usable: number; total: number; unsupported: string[] } | null {
  const types = props.plugin?.manifest.capabilities.types;
  if (!types) return null;
  const all = (types as string[]).includes('*');
  const unsupported = new Set<string>();
  let usable = 0;
  for (const item of set.file.items) {
    if (all || (types as string[]).includes(item.type)) usable++;
    else unsupported.add(item.type);
  }
  return { usable, total: set.file.items.length, unsupported: [...unsupported] };
}

const groups = computed(() => [
  { label: t('lab.data.builtin'), sets: BUILTIN_SETS },
  { label: t('lab.data.mine'), sets: stored.value },
]);
</script>

<template>
  <div class="flex flex-col gap-3">
    <template v-for="group in groups" :key="group.label">
      <div v-if="group.sets.length" class="flex flex-col gap-1.5">
        <div class="section-label">{{ group.label }}</div>
        <label
          v-for="set in group.sets"
          :key="set.key"
          class="flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2 transition"
          :class="selected === set.key ? 'border-accent-orange bg-orange-50/60' : 'border-slate-200 hover:bg-slate-50'"
        >
          <input type="radio" name="lab-set" class="mt-1 accent-accent-orange" :checked="selected === set.key" @change="select(set.key)" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold">{{ set.title }}</span>
            <span class="block text-xs text-text-gray">
              {{ set.file.meta.language }} · {{ t('common.items', set.file.items.length) }}
              <template v-if="coverage(set)">
                · <span :class="coverage(set)!.usable === 0 ? 'text-red-600' : coverage(set)!.unsupported.length ? 'text-amber-700' : 'text-emerald-700'">
                  {{ t('lab.data.compatible', coverage(set)!) }}
                </span>
              </template>
            </span>
            <span v-if="selected === set.key && coverage(set)?.unsupported.length" class="block text-xs text-amber-700">
              {{ t('lab.data.unsupported', { types: coverage(set)!.unsupported.join(', ') }) }}
            </span>
          </span>
          <button v-if="set.source !== 'builtin'" type="button" class="text-text-gray hover:text-red-600" :title="t('lab.data.remove')" @click.prevent="remove(set)">
            <TrashIcon class="size-4" />
          </button>
        </label>
      </div>
    </template>

    <div class="flex flex-wrap items-center gap-2">
      <label class="btn-secondary cursor-pointer" :class="busy ? 'pointer-events-none opacity-50' : ''">
        <ArrowUpTrayIcon class="size-4" /> {{ t('common.upload') }}
        <input type="file" class="hidden" accept=".json,.md,application/json,text/markdown" @change="onFile" />
      </label>
      <span class="text-xs text-text-gray">{{ t('lab.data.uploadHint') }}</span>
    </div>
    <form class="flex gap-2" @submit.prevent="onUrl">
      <input v-model="url" type="url" class="input" placeholder="https://…/set.oqse.json" />
      <button type="submit" class="btn-secondary shrink-0" :disabled="busy || !url">{{ t('common.load') }}</button>
    </form>
    <ul v-if="errors.length" class="rounded-xl bg-red-50 p-3 text-xs text-red-700">
      <li v-for="(e, i) in errors.slice(0, 8)" :key="i">{{ e }}</li>
    </ul>
  </div>
</template>
