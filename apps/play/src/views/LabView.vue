<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ArrowUpTrayIcon,
  CheckCircleIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
  MinusCircleIcon,
  XCircleIcon,
} from '@heroicons/vue/20/solid';
import { loadPluginFromHtml, type LoadedPlugin } from '@memizy/host-sdk';
import type { OQSEFile } from '@memizy/oqse';
import AppLogo from '@/components/AppLogo.vue';
import LocaleSwitch from '@/components/LocaleSwitch.vue';
import StepCard from '@/components/StepCard.vue';
import SetPicker from '@/components/SetPicker.vue';
import LabStage from '@/components/LabStage.vue';
import { EXAMPLE_PLUGINS, fetchPluginHtml, withSdkSource, type SdkSource } from '@/lib/plugins';
import { buildCreatePrompt, buildFixPrompt } from '@/lib/prompt';
import { runLabTests, type LabTestResult } from '@/lib/labTests';
import { persisted } from '@/lib/persisted';
import { useCopy } from '@/lib/clipboard';
import type { StudySet } from '@/lib/sets';

const { t } = useI18n();
const { copied, copy } = useCopy();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const openSteps = persisted<number[]>('lab-open-steps', [1, 2, 3]);
const idea = persisted('lab-idea', '');
const code = persisted('lab-code', '');
const sdkSource = persisted<SdkSource>('lab-sdk', 'local');
const setKey = persisted('lab-set', '');
const studySet = shallowRef<StudySet | null>(null);
const setFile = computed<OQSEFile | null>(() => studySet.value?.file ?? null);

const plugin = shallowRef<LoadedPlugin | null>(null);
const pluginErrors = ref<string[]>([]);
const pluginUrl = ref('');
const urlError = ref<string | null>(null);
const showPrompt = ref(false);

const testResults = ref<LabTestResult[] | null>(null);
/** What the live preview has shown (the hidden tests cannot click inside the sandboxed plugin). */
const played = ref({ answer: false, end: false });
const testing = ref<string | null>(null);
const testBox = ref<HTMLElement | null>(null);

function toggleStep(step: number): void {
  openSteps.value = openSteps.value.includes(step) ? openSteps.value.filter((s) => s !== step) : [...openSteps.value, step];
}

// ---------------------------------------------------------------------------
// Plugin code
// ---------------------------------------------------------------------------

let parseTimer: ReturnType<typeof setTimeout> | undefined;
function parsePlugin(): void {
  testResults.value = null;
  played.value = { answer: false, end: false };
  if (!code.value.trim()) {
    plugin.value = null;
    pluginErrors.value = [];
    return;
  }
  const result = loadPluginFromHtml(withSdkSource(code.value, sdkSource.value));
  plugin.value = result.success ? result.plugin : null;
  pluginErrors.value = result.success ? [] : result.errors;
}
watch(code, () => {
  clearTimeout(parseTimer);
  parseTimer = setTimeout(parsePlugin, 500);
});
watch(sdkSource, parsePlugin);
parsePlugin();

async function onPluginFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) code.value = await file.text();
}

async function onPluginUrl(): Promise<void> {
  urlError.value = null;
  try {
    code.value = await fetchPluginHtml(pluginUrl.value.trim());
  } catch (error) {
    urlError.value = (error as Error).message;
  }
}

function insertExample(): void {
  code.value = EXAMPLE_PLUGINS[0].html;
}

const pluginSummary = computed(() => {
  const p = plugin.value;
  if (!p) return null;
  const modes: string[] = [];
  if (p.runtime.solo) modes.push(t('lab.code.solo'));
  if (p.runtime.multiplayer?.hostAs.includes('presenter')) modes.push(t('lab.code.presenter'));
  if (p.runtime.multiplayer?.hostAs.includes('player')) modes.push(t('lab.code.hostPlays'));
  const players = p.runtime.multiplayer?.players;
  return {
    name: p.manifest.appName,
    version: p.manifest.version,
    modes: modes.join(', ') + (players ? ` (${players.min}–${players.max})` : ''),
    types: (p.manifest.capabilities.types as string[] | undefined)?.join(', ') ?? '–',
    settings: p.runtime.settings.map((s) => s.id).join(', ') || '–',
  };
});

// ---------------------------------------------------------------------------
// Prompt and tests
// ---------------------------------------------------------------------------

const prompt = computed(() => buildCreatePrompt(idea.value, setFile.value));

async function runTests(): Promise<void> {
  if (!plugin.value || !setFile.value || !testBox.value) return;
  testResults.value = null;
  testing.value = '…';
  try {
    testResults.value = await runLabTests({
      plugin: plugin.value,
      set: setFile.value,
      container: testBox.value,
      onProgress: (_done, _total, current) => (testing.value = current || '…'),
    });
  } finally {
    testing.value = null;
  }
}

const testProblems = computed(() => testResults.value?.filter((r) => r.status === 'fail' || r.status === 'warn') ?? []);
const testsPassed = computed(() => !!testResults.value && !testResults.value.some((r) => r.status === 'fail'));
const statusIcon = { pass: CheckCircleIcon, warn: ExclamationTriangleIcon, fail: XCircleIcon, skip: MinusCircleIcon };
const statusColor = { pass: 'text-emerald-600', warn: 'text-amber-600', fail: 'text-red-600', skip: 'text-slate-400' };
</script>

<template>
  <div class="grid h-dvh grid-rows-[auto_1fr] lg:grid-cols-[minmax(380px,460px)_1fr] lg:grid-rows-1">
    <!-- Left: the steps -->
    <aside class="flex flex-col gap-3 overflow-y-auto border-slate-200 p-4 lg:border-r">
      <header class="flex items-center gap-3 pb-1">
        <AppLogo />
        <span class="badge bg-violet-100 text-violet-700">Lab</span>
        <LocaleSwitch class="ml-auto" />
      </header>

      <!-- 1. Idea and prompt -->
      <StepCard :step="1" :title="t('lab.steps.idea')" :done="!!idea.trim()" :open="openSteps.includes(1)" :summary="idea" @toggle="toggleStep(1)">
        <textarea v-model="idea" class="input min-h-24 resize-y" :placeholder="t('lab.idea.placeholder')" />
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" class="btn-primary" @click="copy(prompt, 'prompt')">
            <ClipboardDocumentIcon class="size-4" />
            {{ copied === 'prompt' ? t('common.copied') : t('lab.idea.copyPrompt') }}
          </button>
          <button type="button" class="btn-ghost" @click="showPrompt = !showPrompt">
            {{ showPrompt ? t('lab.idea.hidePrompt') : t('lab.idea.showPrompt') }}
          </button>
        </div>
        <p class="mt-2 text-xs text-text-gray">{{ t('lab.idea.hint') }}</p>
        <pre v-if="showPrompt" class="mt-3 max-h-72 overflow-auto rounded-xl bg-slate-50 p-3 font-mono text-[11px] whitespace-pre-wrap">{{ prompt }}</pre>
      </StepCard>

      <!-- 2. Plugin code -->
      <StepCard
        :step="2"
        :title="t('lab.steps.code')"
        :done="!!plugin"
        :open="openSteps.includes(2)"
        :summary="pluginSummary ? `${pluginSummary.name} ${pluginSummary.version}` : pluginErrors.length ? t('lab.code.invalid') : t('lab.code.empty')"
        @toggle="toggleStep(2)"
      >
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <label class="btn-secondary cursor-pointer">
            <ArrowUpTrayIcon class="size-4" /> {{ t('common.upload') }}
            <input type="file" class="hidden" accept=".html,text/html" @change="onPluginFile" />
          </label>
          <button type="button" class="btn-secondary" @click="insertExample">{{ t('lab.code.example') }}</button>
          <button v-if="code" type="button" class="btn-ghost ml-auto" @click="code = ''">{{ t('common.clear') }}</button>
        </div>
        <textarea v-model="code" class="input min-h-56 resize-y font-mono text-xs" spellcheck="false" :placeholder="t('lab.code.placeholder')" />
        <form class="mt-2 flex gap-2" @submit.prevent="onPluginUrl">
          <input v-model="pluginUrl" type="url" class="input" :placeholder="t('lab.code.urlPlaceholder')" />
          <button type="submit" class="btn-secondary shrink-0" :disabled="!pluginUrl">{{ t('common.load') }}</button>
        </form>
        <p v-if="urlError" class="mt-1 text-xs text-red-600">{{ urlError }}</p>

        <div v-if="pluginSummary" class="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs">
          <div class="mb-1 flex items-center gap-1.5 font-semibold text-emerald-700">
            <CheckCircleIcon class="size-4" /> {{ t('lab.code.valid') }}
          </div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <dt class="text-text-gray">{{ t('lab.code.modes') }}</dt>
            <dd>{{ pluginSummary.modes }}</dd>
            <dt class="text-text-gray">{{ t('lab.code.types') }}</dt>
            <dd class="break-words">{{ pluginSummary.types }}</dd>
            <dt class="text-text-gray">{{ t('lab.code.settings') }}</dt>
            <dd>{{ pluginSummary.settings }}</dd>
          </dl>
        </div>
        <div v-else-if="pluginErrors.length" class="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <div class="mb-1 flex items-center gap-1.5 font-semibold"><XCircleIcon class="size-4" /> {{ t('lab.code.invalid') }}</div>
          <ul class="list-disc pl-4">
            <li v-for="(e, i) in pluginErrors" :key="i">{{ e }}</li>
          </ul>
        </div>

        <label class="mt-3 flex items-center gap-2 text-xs text-text-gray">
          {{ t('lab.code.sdk') }}
          <select v-model="sdkSource" class="rounded-lg border border-slate-200 bg-white px-2 py-1">
            <option value="local">{{ t('lab.code.sdkLocal') }}</option>
            <option value="cdn">{{ t('lab.code.sdkCdn') }}</option>
          </select>
        </label>
      </StepCard>

      <!-- 3. Study set -->
      <StepCard :step="3" :title="t('lab.steps.data')" :done="!!studySet" :open="openSteps.includes(3)" :summary="studySet?.title" @toggle="toggleStep(3)">
        <SetPicker v-model="setKey" :plugin="plugin" @change="studySet = $event" />
      </StepCard>

      <!-- 4. Tests -->
      <StepCard
        :step="4"
        :title="t('lab.steps.tests')"
        :done="testsPassed"
        :open="openSteps.includes(4)"
        :summary="testResults ? `${testResults.filter((r) => r.status === 'pass').length}/${testResults.length} ✓` : undefined"
        @toggle="toggleStep(4)"
      >
        <p class="text-xs text-text-gray">{{ t('lab.tests.intro') }}</p>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" class="btn-primary" :disabled="!plugin || !setFile || !!testing" @click="runTests">
            {{ testing ? t('lab.tests.running', { current: testing }) : t('lab.tests.run') }}
          </button>
          <button v-if="testProblems.length" type="button" class="btn-secondary" @click="copy(buildFixPrompt(code, testResults!), 'fix')">
            <ClipboardDocumentIcon class="size-4" />
            {{ copied === 'fix' ? t('common.copied') : t('lab.tests.copyFix') }}
          </button>
        </div>
        <p v-if="!plugin" class="mt-2 text-xs text-text-gray">{{ t('lab.tests.needCode') }}</p>
        <div v-if="plugin" class="mt-3 rounded-xl bg-slate-50 p-3 text-xs">
          <div class="mb-1 font-semibold">{{ t('lab.tests.played') }}</div>
          <div v-for="key in (['answer', 'end'] as const)" :key="key" class="flex items-center gap-2">
            <component :is="played[key] ? CheckCircleIcon : MinusCircleIcon" class="size-4" :class="played[key] ? 'text-emerald-600' : 'text-slate-400'" />
            {{ t(`lab.tests.played_${key}`) }}
          </div>
          <div v-if="!played.answer || !played.end" class="mt-1 text-text-gray">{{ t('lab.tests.playedHint') }}</div>
        </div>
        <p v-if="testResults && !testProblems.length" class="mt-3 text-sm font-semibold text-emerald-700">{{ t('lab.tests.allPassed') }}</p>
        <ul v-if="testResults" class="mt-3 flex flex-col gap-1.5">
          <li v-for="r in testResults" :key="r.id" class="flex gap-2 text-xs">
            <component :is="statusIcon[r.status]" class="mt-px size-4 shrink-0" :class="statusColor[r.status]" />
            <div>
              <div>{{ r.summary }}</div>
              <div v-for="(d, i) in r.details" :key="i" class="text-text-gray">{{ d }}</div>
            </div>
          </li>
        </ul>
      </StepCard>
    </aside>

    <!-- Right: the simulation -->
    <main class="min-h-[80dvh] p-4 lg:min-h-0">
      <LabStage
        :plugin="plugin"
        :set="setFile"
        :live-to="`/host?plugin=lab&set=${encodeURIComponent(setKey)}`"
        @played="played[$event] = true"
      />
    </main>

    <!-- Hidden devices of the automatic tests -->
    <div ref="testBox" aria-hidden="true" class="pointer-events-none fixed top-0 -left-[20000px] h-0 w-0 overflow-hidden" />
  </div>
</template>
