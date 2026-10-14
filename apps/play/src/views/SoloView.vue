<script setup lang="ts">
import { settingsForMode, resolveSettings, type SettingValue } from '@memizy/protocol';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  ArrowLeftIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  BookOpenIcon,
  PauseIcon,
  PlayIcon,
  PuzzlePieceIcon,
  RocketLaunchIcon,
  StopIcon,
  TrashIcon,
} from '@heroicons/vue/20/solid';
import { LocalSession, loadPluginFromHtml, prepareSetForPlugin, type LoadedPlugin } from '@memizy/host-sdk';
import AppLogo from '@/components/AppLogo.vue';
import LocaleSwitch from '@/components/LocaleSwitch.vue';
import PluginFrame from '@/components/PluginFrame.vue';
import SettingsForm from '@/components/SettingsForm.vue';
import { generateName } from '@/lib/names';
import { persisted, setUnsaved } from '@/lib/persisted';
import { EXAMPLE_PLUGINS, exampleKey, findPlugin, fetchPluginHtml, withSdkSource, type PluginChoice } from '@/lib/plugins';
import { applyLinkSettings, findSetKey, readLinkParams, type LinkProblem } from '@/lib/linkParams';
import { BUILTIN_SETS, NO_SET_KEY, loadSetFromUrl, loadStoredSets, noSet, type StudySet } from '@/lib/sets';
import { PersistentSnapshotStorage } from '@/lib/hostGame';
import { deleteSavedGame, listSavedGames, saveGame, type SavedGame } from '@/lib/savedGames';
import { useFocusMode } from '@/lib/focusMode';

/**
 * Playing alone: choose a game and a set, play, and continue later. A running solo game
 * is kept in the saved games right away (and paused when the page is hidden), so a closed
 * tab can be continued; "End game" asks whether to keep it.
 */

type Phase = 'setup' | 'running' | 'ended';

const { t, locale } = useI18n();
const PLAYER_ID = 'me';
const focus = useFocusMode();

// --- choice (a link may preselect it for this visit: lib/linkParams.ts) ----------------------
const link = readLinkParams(useRoute().query);
const linkProblems = ref<LinkProblem[]>([...link.problems]);
let linkSettings = link.settings;
const sets = shallowRef<StudySet[]>(BUILTIN_SETS);
const linkSetName = link.set && 'name' in link.set ? link.set.name : null;
const setKey = persisted('solo-set', BUILTIN_SETS[0].key, linkSetName ? (findSetKey(linkSetName, BUILTIN_SETS) ?? linkSetName) : undefined);
const choice = persisted<PluginChoice>('solo-plugin', { kind: 'example', key: EXAMPLE_PLUGINS[0].key }, link.plugin ?? undefined);
if (choice.value.kind === 'example' && exampleKey(choice.value.key) !== choice.value.key) choice.value = { kind: 'example', key: exampleKey(choice.value.key) };
const pluginUrl = ref(choice.value.kind === 'url' ? choice.value.url : '');
const pluginRaw = ref<string | null>(null);
const plugin = shallowRef<LoadedPlugin | null>(null);
const pluginErrors = ref<string[]>([]);
const settings = ref<Record<string, SettingValue>>({});

const setMode = computed(() => plugin.value?.runtime.set ?? 'required');
const emptySet = computed(() => noSet(t('host.noSet'), locale.value));
const studySet = computed(() =>
  setMode.value === 'none' || (setMode.value === 'optional' && setKey.value === NO_SET_KEY)
    ? emptySet.value
    : (sets.value.find((s) => s.key === setKey.value) ?? null),
);
const prepared = computed(() => (plugin.value && studySet.value ? prepareSetForPlugin(studySet.value.file, plugin.value.manifest) : null));

function labCode(): string {
  try {
    return JSON.parse(localStorage.getItem('memizy-play:lab-code') ?? '""') as string;
  } catch {
    return '';
  }
}
const labAvailable = labCode().trim().length > 0;

async function loadChoice(): Promise<void> {
  const c = choice.value;
  pluginErrors.value = [];
  let raw = '';
  try {
    if (c.kind === 'example') raw = findPlugin(c.key)?.html ?? EXAMPLE_PLUGINS[0].html;
    else if (c.kind === 'lab') raw = labCode();
    else if (c.url) raw = await fetchPluginHtml(c.url);
  } catch (error) {
    pluginErrors.value = [(error as Error).message];
  }
  if (!raw.trim()) {
    plugin.value = null;
    pluginRaw.value = null;
    if (c.kind === 'lab') pluginErrors.value = [t('host.fromLabMissing')];
    return;
  }
  const result = loadPluginFromHtml(withSdkSource(raw, 'local'));
  pluginRaw.value = raw;
  plugin.value = result.success ? result.plugin : null;
  pluginErrors.value = result.success ? (result.plugin.runtime.solo ? [] : [t('solo.soloOnly')]) : result.errors;
  if (result.success) {
    settings.value = resolveSettings(result.plugin.runtime.settings, {}).values;
    if (linkSettings) {
      const applied = applyLinkSettings(result.plugin.runtime.settings, settings.value, linkSettings);
      settings.value = applied.values;
      if (applied.rejected.length) linkProblems.value = [...linkProblems.value, { kind: 'settings', value: applied.rejected.join(', ') }];
      linkSettings = null;
    }
  }
}
watch(choice, loadChoice, { deep: true, immediate: true });

function useUrl(): void {
  if (pluginUrl.value.trim()) choice.value = { kind: 'url', url: pluginUrl.value.trim() };
}

const blocker = computed(() => {
  if (!plugin.value || pluginErrors.value.length || !studySet.value) return t('host.needSetup');
  if (!prepared.value?.set.items.length && studySet.value.key !== NO_SET_KEY) return t('host.noItems', { types: (plugin.value.manifest.capabilities.types as string[] | undefined)?.join(', ') ?? '' });
  return null;
});

// --- the game -----------------------------------------------------------------------------
const phase = ref<Phase>('setup');
const game = shallowRef<LocalSession | null>(null);
const current = shallowRef<SavedGame | null>(null);
const paused = ref(false);
const endDialog = ref(false);
const error = ref<string | null>(null);
// shallowRef: a reactive proxy of a saved set could not be sent to the game (structuredClone)
const savedGames = shallowRef<SavedGame[]>([]);

async function refreshSaved(): Promise<void> {
  savedGames.value = await listSavedGames('solo');
}

/** Keeps the running game in the saved games (with its pauses so far). */
async function store(): Promise<void> {
  const session = game.value;
  const record = current.value;
  if (!session || !record || phase.value !== 'running') return;
  record.savedAt = Date.now();
  record.clock = { pausedMs: session.clock.pausedMs ?? 0, pausedAt: session.clock.pausedAt ?? null };
  await saveGame(record).catch((e) => console.warn('[memizy play] could not save the game:', e));
}

function run(record: SavedGame, resume: boolean): void {
  const loaded = loadPluginFromHtml(withSdkSource(record.pluginHtml, 'local'));
  if (!loaded.success || !loaded.plugin.runtime.solo) {
    error.value = t('host.saved.broken');
    return;
  }
  error.value = null;
  const session = new LocalSession({
    plugin: loaded.plugin,
    set: record.set,
    mode: 'solo',
    players: record.players.map(({ id, name }) => ({ id, name })),
    settings: record.settings,
    locale: locale.value,
    sessionId: record.id,
    shuffleSeed: record.shuffleSeed,
    storage: new PersistentSnapshotStorage(),
    restore: resume,
    // A saved game was paused when it was left; it continues right away (below).
    clock: resume ? { pausedMs: record.clock.pausedMs, pausedAt: record.clock.pausedAt ?? record.savedAt } : undefined,
  });
  session.on((e) => {
    if (e.type === 'paused') {
      paused.value = e.paused;
      void store();
    } else if (e.type === 'result') {
      phase.value = 'ended';
      endDialog.value = false;
      // A finished game is not continued again.
      void deleteSavedGame(record.id).then(refreshSaved);
    }
  });
  current.value = record;
  game.value = session;
  phase.value = 'running';
  if (resume) session.resume();
  paused.value = session.paused;
  void store();
}

function start(): void {
  const p = plugin.value;
  const raw = pluginRaw.value;
  const set = studySet.value;
  if (blocker.value || !p || !raw || !set) return;
  run(
    {
      id: `solo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'solo',
      appName: p.manifest.appName,
      setTitle: set.key === NO_SET_KEY ? t('host.noSet') : set.title,
      savedAt: Date.now(),
      pluginHtml: raw,
      set: set.file,
      settings: settings.value,
      players: [{ id: PLAYER_ID, name: generateName(), isHost: true }],
      shuffleSeed: Math.random().toString(36).slice(2, 10),
      clock: { pausedMs: 0, pausedAt: null },
    },
    false,
  );
}

function togglePause(): void {
  const session = game.value;
  if (!session) return;
  if (session.paused) session.resume();
  else session.pause();
}

async function saveForLater(): Promise<void> {
  const session = game.value;
  if (!session) return;
  session.pause();
  await store();
  await session.end('closed'); // stores the last snapshot
  leaveGame();
}

async function discard(): Promise<void> {
  const session = game.value;
  endDialog.value = false;
  if (!session) return;
  await session.end('closed').catch(() => {});
  await deleteSavedGame(session.id);
  leaveGame();
}

function leaveGame(): void {
  focus.exit();
  endDialog.value = false;
  game.value = null;
  current.value = null;
  phase.value = 'setup';
  void refreshSaved();
}

async function removeSaved(saved: SavedGame): Promise<void> {
  if (!confirm(t('host.saved.confirmDelete', { name: saved.appName }))) return;
  await deleteSavedGame(saved.id);
  await refreshSaved();
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Leaving the tab pauses the game and saves it (phones close background tabs). */
function onVisibility(): void {
  if (document.visibilityState === 'hidden' && game.value && phase.value === 'running') {
    game.value.pause();
    void store();
  }
}

watch(locale, () => game.value?.setConfig({ locale: locale.value }));

/** The set of a link: a set from a URL (for this visit, not stored) or a stored set by its ID. */
async function applyLinkSet(): Promise<void> {
  if (!link.set) return;
  if ('url' in link.set) {
    const loaded = await loadSetFromUrl(link.set.url);
    if (!loaded.success) {
      linkProblems.value = [...linkProblems.value, { kind: 'set', value: link.set.url }];
      return;
    }
    sets.value = [...sets.value.filter((s) => s.key !== loaded.set.key), loaded.set];
    setUnsaved(setKey, loaded.set.key);
  } else {
    const key = findSetKey(link.set.name, sets.value);
    if (key) setUnsaved(setKey, key);
    else linkProblems.value = [...linkProblems.value, { kind: 'set', value: link.set.name }];
  }
}

onMounted(async () => {
  document.addEventListener('visibilitychange', onVisibility);
  sets.value = [...BUILTIN_SETS, ...(await loadStoredSets())];
  await applyLinkSet();
  await refreshSaved();
});

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibility);
  const session = game.value;
  if (session && phase.value === 'running') {
    session.pause();
    void store().then(() => session.end('closed'));
  }
});
</script>

<template>
  <div class="min-h-dvh">
    <!-- Running game -->
    <div v-if="game && phase !== 'setup'" class="flex h-dvh flex-col bg-slate-900">
      <div class="flex items-center gap-3 bg-white text-sm shadow-sm" :class="focus.focused.value ? 'px-3 py-0.5' : 'px-4 py-2'">
        <AppLogo v-if="!focus.focused.value" class="hidden sm:flex" />
        <span class="truncate font-semibold" :class="focus.focused.value ? 'text-xs text-text-gray' : ''">{{ current?.appName }}</span>
        <span class="ml-auto flex gap-2">
          <button
            type="button"
            :class="focus.focused.value ? 'btn-ghost px-2 py-1 text-xs' : 'btn-ghost'"
            :title="focus.focused.value ? t('focus.exit') : t('focus.enter')"
            @click="focus.toggle()"
          >
            <component :is="focus.focused.value ? ArrowsPointingInIcon : ArrowsPointingOutIcon" class="size-4" />
            <span :class="focus.focused.value ? '' : 'hidden sm:inline'">{{ focus.focused.value ? t('focus.exit') : t('focus.enter') }}</span>
          </button>
          <template v-if="!focus.focused.value">
          <button v-if="phase === 'running'" type="button" class="btn-secondary" @click="togglePause">
            <component :is="paused ? PlayIcon : PauseIcon" class="size-4" /> {{ paused ? t('host.resume') : t('host.pause') }}
          </button>
          <button v-if="phase === 'ended'" type="button" class="btn-primary" @click="leaveGame">{{ t('solo.back') }}</button>
          <button v-else type="button" class="btn-danger" @click="endDialog = true"><StopIcon class="size-4" /> {{ t('host.endGame') }}</button>
          </template>
        </span>
      </div>
      <div class="relative min-h-0 flex-1">
        <div class="size-full bg-white">
          <PluginFrame :key="game.id" :session="game" :address="PLAYER_ID" />
        </div>
      </div>
    </div>
    <div v-if="endDialog && game" class="fixed inset-0 z-50 grid place-items-center bg-slate-900/70 p-6">
      <div class="card w-full max-w-md p-6">
        <p class="text-lg font-bold">{{ t('host.endDialog.title') }}</p>
        <p class="mt-2 text-sm text-text-gray">{{ t('solo.endText') }}</p>
        <div class="mt-5 flex flex-col gap-2">
          <button type="button" class="btn-primary" @click="saveForLater">{{ t('host.endDialog.save') }}</button>
          <button type="button" class="btn-danger" @click="discard">{{ t('host.endDialog.discard') }}</button>
          <button type="button" class="btn-ghost" @click="endDialog = false">{{ t('host.endDialog.cancel') }}</button>
        </div>
      </div>
    </div>

    <!-- Setup -->
    <template v-if="phase === 'setup'">
      <header class="border-b border-slate-200 bg-white">
        <div class="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <RouterLink to="/" class="btn-ghost -ml-2 px-2" :aria-label="t('common.back')"><ArrowLeftIcon class="size-5" /></RouterLink>
          <h1 class="text-lg font-bold">{{ t('solo.title') }}</h1>
          <span class="ml-auto" />
          <LocaleSwitch />
        </div>
      </header>

      <main class="mx-auto grid max-w-6xl gap-5 px-4 py-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div v-if="linkProblems.length" class="flex items-start gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 lg:col-span-2" role="status">
          <ul class="flex-1">
            <li v-for="(p, i) in linkProblems" :key="i">{{ t(`link.${p.kind}`, { value: p.value }) }}</li>
          </ul>
          <button type="button" class="btn-ghost px-2 py-1 text-xs" @click="linkProblems = []">{{ t('common.close') }}</button>
        </div>
        <!-- Left: saved games -->
        <div class="flex flex-col gap-5">
          <section class="card p-5">
            <h2 class="card-title"><PlayIcon class="size-4 text-text-gray" /> {{ t('host.saved.title') }}</h2>
            <p v-if="!savedGames.length" class="mt-2 text-sm text-text-gray">{{ t('solo.noSaved') }}</p>
            <ul v-else class="mt-3 flex flex-col gap-2">
              <li v-for="s in savedGames" :key="s.id" class="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm font-semibold">{{ s.appName }} · {{ s.setTitle }}</div>
                  <div class="text-xs text-text-gray">{{ formatDate(s.savedAt) }}</div>
                </div>
                <button type="button" class="btn-secondary shrink-0 py-1.5" @click="run(s, true)">{{ t('host.saved.continue') }}</button>
                <button type="button" class="btn-ghost shrink-0 px-2" :aria-label="t('host.saved.delete')" :title="t('host.saved.delete')" @click="removeSaved(s)">
                  <TrashIcon class="size-4" />
                </button>
              </li>
            </ul>
            <p class="mt-3 text-xs text-text-gray">{{ t('solo.savedHint') }}</p>
          </section>
        </div>

        <!-- Right: new game -->
        <div class="flex flex-col gap-5">
          <section class="card p-5">
            <h2 class="card-title"><BookOpenIcon class="size-4 text-text-gray" /> {{ t('host.set') }}</h2>
            <p v-if="setMode === 'none'" class="mt-3 text-sm text-text-gray">{{ t('host.noSetNeeded') }}</p>
            <select v-else v-model="setKey" class="input mt-3">
              <option v-if="setMode === 'optional'" :value="NO_SET_KEY">{{ t('host.noSet') }}</option>
              <option v-for="s in sets" :key="s.key" :value="s.key">{{ s.title }}</option>
            </select>
            <p v-if="studySet && studySet.key !== NO_SET_KEY && prepared" class="mt-2 text-xs" :class="prepared.set.items.length ? 'text-emerald-700' : 'text-accent-orange-dark'">
              {{ t('host.compatible', { n: prepared.set.items.length }) }}
            </p>
          </section>

          <section class="card p-5">
            <h2 class="card-title"><PuzzlePieceIcon class="size-4 text-text-gray" /> {{ t('host.game') }}</h2>
            <div class="mt-3 flex flex-col gap-2">
              <label
                v-for="ex in EXAMPLE_PLUGINS"
                :key="ex.key"
                class="flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2"
                :class="choice.kind === 'example' && choice.key === ex.key ? 'border-accent-orange bg-orange-50/60' : 'border-slate-200 hover:bg-slate-50'"
              >
                <input type="radio" class="accent-accent-orange" :checked="choice.kind === 'example' && choice.key === ex.key" @change="choice = { kind: 'example', key: ex.key }" />
                <span class="text-sm font-semibold">{{ ex.title }}</span>
              </label>
              <label
                class="flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2"
                :class="choice.kind === 'lab' ? 'border-accent-orange bg-orange-50/60' : 'border-slate-200 hover:bg-slate-50'"
              >
                <input type="radio" class="accent-accent-orange" :checked="choice.kind === 'lab'" :disabled="!labAvailable" @change="choice = { kind: 'lab' }" />
                <span class="text-sm font-semibold" :class="labAvailable ? '' : 'text-text-gray'">{{ t('host.fromLab') }}</span>
                <span v-if="!labAvailable" class="text-xs text-text-gray">– {{ t('host.fromLabMissing') }}</span>
              </label>
              <form class="flex gap-2" @submit.prevent="useUrl">
                <input v-model="pluginUrl" type="url" class="input" :placeholder="t('lab.code.urlPlaceholder')" />
                <button type="submit" class="btn-secondary shrink-0" :disabled="!pluginUrl">{{ t('common.load') }}</button>
              </form>
            </div>
            <ul v-if="pluginErrors.length" class="mt-3 rounded-xl bg-red-50 p-3 text-xs text-red-700">
              <li v-for="(e, i) in pluginErrors" :key="i">{{ e }}</li>
            </ul>
          </section>

          <section v-if="plugin && !pluginErrors.length && settingsForMode(plugin.runtime.settings, 'solo').length" class="card p-5">
            <h2 class="card-title">{{ t('host.settings') }}</h2>
            <div class="mt-3">
              <SettingsForm v-model="settings" :definitions="settingsForMode(plugin.runtime.settings, 'solo')" />
            </div>
          </section>

          <div>
            <button type="button" class="btn-primary w-full py-4 text-lg" :disabled="!!blocker" @click="start">
              <RocketLaunchIcon class="size-5" /> {{ t('solo.start') }}
            </button>
            <p v-if="blocker" class="mt-2 text-center text-xs text-accent-orange-dark">{{ blocker }}</p>
            <p v-if="error" class="mt-2 text-center text-xs text-red-600">{{ error }}</p>
          </div>
        </div>
      </main>
    </template>
  </div>
</template>
