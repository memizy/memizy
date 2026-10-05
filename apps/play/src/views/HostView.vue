<script setup lang="ts">
import { settingsForMode } from '@memizy/protocol';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowsPointingOutIcon,
  BookOpenIcon,
  PuzzlePieceIcon,
  RocketLaunchIcon,
  StopIcon,
  UserGroupIcon,
} from '@heroicons/vue/20/solid';
import {
  LocalSession,
  RelayHost,
  SETTINGS_ADDRESS,
  loadPluginFromHtml,
  prepareSetForPlugin,
  type LoadedPlugin,
  type RelayHostEvent,
} from '@memizy/host-sdk';
import type { HostAs, RelayPlayer, SettingValue } from '@memizy/protocol';
import { resolveSettings } from '@memizy/protocol';
import AppLogo from '@/components/AppLogo.vue';
import LocaleSwitch from '@/components/LocaleSwitch.vue';
import JoinInfo from '@/components/JoinInfo.vue';
import PlayerList from '@/components/PlayerList.vue';
import PluginFrame from '@/components/PluginFrame.vue';
import SettingsForm from '@/components/SettingsForm.vue';
import StartScreen from '@/components/StartScreen.vue';
import { RELAY_URL } from '@/lib/config';
import { generateName } from '@/lib/names';
import { persisted } from '@/lib/persisted';
import { EXAMPLE_PLUGINS, fetchPluginHtml, withSdkSource } from '@/lib/plugins';
import { BUILTIN_SETS, loadStoredSets, type StudySet } from '@/lib/sets';
import { PersistentSnapshotStorage, clearHostGame, loadHostGame, saveHostGame } from '@/lib/hostGame';
import type { OQSEFile } from '@memizy/oqse';

type Phase = 'lobby' | 'starting' | 'running' | 'ended' | 'closed';
type PluginChoice = { kind: 'example'; key: string } | { kind: 'lab' } | { kind: 'url'; url: string };

const { t, locale } = useI18n();
const route = useRoute();

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

const ROOM_KEY = 'memizy-play:host-room';
const room = shallowRef<RelayHost | null>(null);
const roomStatus = ref<string>('connecting');
const roomError = ref<string | null>(null);
const players = ref<RelayPlayer[]>([]);
let stopRoom: (() => void) | null = null;

function onRoomEvent(event: RelayHostEvent): void {
  if (event.type === 'status') roomStatus.value = event.status;
  else if (event.type === 'players') players.value = event.players;
  else if (event.type === 'error' && event.code === 'ROOM_NOT_FOUND') {
    // The saved room expired: start a new one.
    sessionStorage.removeItem(ROOM_KEY);
    void openRoom(true);
  } else if (event.type === 'closed') {
    phase.value = 'closed';
  }
}

/** Opens (or re-attaches to) the room; returns whether an existing room was resumed. */
async function openRoom(fresh = false): Promise<boolean> {
  stopRoom?.();
  roomError.value = null;
  roomStatus.value = 'connecting';
  try {
    const saved = fresh ? null : sessionStorage.getItem(ROOM_KEY);
    const next = saved
      ? RelayHost.resume({ serverUrl: RELAY_URL }, JSON.parse(saved))
      : await RelayHost.create({ serverUrl: RELAY_URL });
    sessionStorage.setItem(ROOM_KEY, JSON.stringify({ pin: next.pin, hostToken: next.hostToken }));
    stopRoom = next.on(onRoomEvent);
    room.value = next;
    uploadedKey = '';
    phase.value = 'lobby';
    scheduleUpload();
    return saved !== null;
  } catch (error) {
    roomError.value = error instanceof TypeError ? t('host.serverDown', { url: RELAY_URL }) : (error as Error).message;
    return false;
  }
}

function endSession(): void {
  if (!confirm(t('host.confirmEnd'))) return;
  void game.value?.end('closed').catch(() => {});
  game.value = null;
  if (room.value) void clearHostGame(room.value.pin);
  room.value?.close();
  sessionStorage.removeItem(ROOM_KEY);
  phase.value = 'closed';
}

// ---------------------------------------------------------------------------
// Set and game
// ---------------------------------------------------------------------------

const sets = shallowRef<StudySet[]>(BUILTIN_SETS);
const setKey = persisted('host-set', typeof route.query.set === 'string' ? route.query.set : BUILTIN_SETS[0].key);
if (typeof route.query.set === 'string') setKey.value = route.query.set;
const studySet = computed(() => sets.value.find((s) => s.key === setKey.value) ?? null);

const choice = persisted<PluginChoice>('host-plugin', { kind: 'example', key: EXAMPLE_PLUGINS[0].key });
if (route.query.plugin === 'lab') choice.value = { kind: 'lab' };
const pluginUrl = ref(choice.value.kind === 'url' ? choice.value.url : '');
const pluginRaw = ref<string | null>(null);
const plugin = shallowRef<LoadedPlugin | null>(null);
const pluginErrors = ref<string[]>([]);

function labCode(): string {
  try {
    return JSON.parse(localStorage.getItem('memizy-play:lab-code') ?? '""') as string;
  } catch {
    return '';
  }
}
const labAvailable = computed(() => labCode().trim().length > 0);

async function loadChoice(): Promise<void> {
  const c = choice.value;
  pluginErrors.value = [];
  let raw = '';
  try {
    if (c.kind === 'example') raw = EXAMPLE_PLUGINS.find((p) => p.key === c.key)?.html ?? EXAMPLE_PLUGINS[0].html;
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
  pluginErrors.value = result.success ? (result.plugin.runtime.multiplayer ? [] : [t('host.multiplayerOnly')]) : result.errors;
}
watch(choice, loadChoice, { deep: true, immediate: true });

const multi = computed(() => (pluginErrors.value.length ? null : plugin.value?.runtime.multiplayer ?? null));
const hostAs = persisted<HostAs>('host-as', 'presenter');
watch(multi, (m) => {
  if (m && !m.hostAs.includes(hostAs.value)) hostAs.value = m.hostAs[0];
});
// Random like the players' nicknames (no real names).
const hostName = ref(generateName());

const prepared = computed(() => (plugin.value && studySet.value ? prepareSetForPlugin(studySet.value.file, plugin.value.manifest) : null));
const unsupported = computed(() => {
  const types = new Set<string>(studySet.value?.file.items.map((i) => i.type));
  const declared = plugin.value?.manifest.capabilities.types as string[] | undefined;
  return declared?.filter((type) => !types.has(type)) ?? [];
});

// ---------------------------------------------------------------------------
// Settings (host form, or the plugin's own settings screen)
// ---------------------------------------------------------------------------

const settings = ref<Record<string, SettingValue>>({});
const settingsValid = ref(true);
const lobbySession = shallowRef<LocalSession | null>(null);

watch([plugin, studySet, hostAs, hostName, locale], () => {
  lobbySession.value?.end('closed').catch(() => {});
  lobbySession.value = null;
  const p = plugin.value;
  if (!p || !multi.value || !studySet.value) return;
  settings.value = resolveSettings(p.runtime.settings, settings.value).values;
  settingsValid.value = true;
  if (!p.runtime.settingsScreen) return;
  try {
    const session = new LocalSession({
      plugin: p,
      set: studySet.value.file,
      mode: 'multiplayer',
      hostAs: hostAs.value,
      players: hostAs.value === 'player' ? [{ id: 'host', name: hostName.value, isHost: true }] : [],
      settings: settings.value,
      config: { locale: locale.value, theme: 'light' },
    });
    session.on((e) => {
      if (e.type !== 'settings') return;
      settingsValid.value = e.valid;
      if (e.valid) settings.value = e.values as Record<string, SettingValue>;
    });
    lobbySession.value = session;
  } catch (error) {
    pluginErrors.value = [(error as Error).message];
  }
}, { immediate: true });

// ---------------------------------------------------------------------------
// Upload the game to the server (players download it once)
// ---------------------------------------------------------------------------

let uploadedKey = '';
let uploading: Promise<void> = Promise.resolve();
let uploadTimer: ReturnType<typeof setTimeout> | undefined;
const uploadError = ref<string | null>(null);

function scheduleUpload(): void {
  clearTimeout(uploadTimer);
  uploadTimer = setTimeout(() => void ensureUploaded(), 400);
}

function ensureUploaded(): Promise<void> {
  uploading = uploading.then(async () => {
    const r = room.value;
    const raw = pluginRaw.value;
    const set = prepared.value?.set;
    if (!r || !raw || !set || !multi.value) return;
    const key = `${r.pin}|${raw.length}|${raw.slice(0, 200)}|${studySet.value?.key}|${set.items.length}`;
    if (key === uploadedKey) return;
    try {
      await r.uploadBundle(raw, set);
      uploadedKey = key;
      uploadError.value = null;
      r.setState({ appName: plugin.value?.manifest.appName ?? null });
    } catch (error) {
      uploadError.value = t('host.uploadFailed', { error: (error as Error).message });
    }
  });
  return uploading;
}
watch([pluginRaw, prepared, () => roomStatus.value], scheduleUpload);

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

const phase = ref<Phase>('lobby');
const game = shallowRef<LocalSession | null>(null);
const startError = ref<string | null>(null);
const countdown = ref<number | null>(null);
const readyAddresses = ref<string[]>([]);
const showPlayers = ref(false);
const stage = ref<HTMLElement | null>(null);

const connectedPlayers = computed(() => players.value.filter((p) => p.connected));
const playerCount = computed(() => connectedPlayers.value.length + (hostAs.value === 'player' ? 1 : 0));
const blocker = computed(() => {
  if (!room.value || roomStatus.value !== 'online') return t('host.status.connecting');
  if (!plugin.value || !studySet.value || !multi.value) return t('host.needSetup');
  if (!prepared.value?.set.items.length) return t('host.noItems', { types: (plugin.value.manifest.capabilities.types as string[] | undefined)?.join(', ') ?? '' });
  const { min, max } = multi.value.players;
  if (playerCount.value < min || playerCount.value > max) return t('host.playerCount', { min, max, n: playerCount.value });
  if (!settingsValid.value) return t('settingsForm.invalid');
  return null;
});

async function start(): Promise<void> {
  const r = room.value;
  const p = plugin.value;
  if (blocker.value || !r || !p || !studySet.value) return;
  startError.value = null;
  phase.value = 'starting';
  try {
    await ensureUploaded();
    if (uploadError.value) throw new Error(uploadError.value);
    lobbySession.value?.end('closed').catch(() => {});
    lobbySession.value = null;
    const roster = [
      ...(hostAs.value === 'player' ? [{ id: 'host', name: hostName.value, isHost: true }] : []),
      ...connectedPlayers.value.map((pl) => ({ id: pl.id, name: pl.name, isHost: false })),
    ];
    const session = launch(p, studySet.value.file, roster, `${r.pin}-${Date.now().toString(36)}`, false);
    await nextTick(); // mounts the local board / host controller
    await session.start();
  } catch (error) {
    startError.value = (error as Error).message;
    backToLobby();
  }
}

/**
 * Creates the game session and connects the room to it. The authority's snapshots
 * and a record of the game go to IndexedDB, so a reload of this page resumes it.
 */
function launch(p: LoadedPlugin, file: OQSEFile, roster: { id: string; name: string; isHost: boolean }[], sessionId: string, resume: boolean): LocalSession {
  const r = room.value!;
  const session = new LocalSession({
    plugin: p,
    set: file,
    mode: 'multiplayer',
    hostAs: hostAs.value,
    players: roster,
    settings: settings.value,
    config: { locale: locale.value, theme: 'light' },
    sessionId,
    storage: new PersistentSnapshotStorage(),
    resume,
  });
  const pluginHtml = pluginRaw.value!;
  const record = () =>
    saveHostGame(r.pin, {
      sessionId,
      pluginHtml,
      setKey: setKey.value,
      hostAs: hostAs.value,
      hostName: hostName.value,
      settings: settings.value,
      players: session.players.map(({ id, name, isHost }) => ({ id, name, isHost })),
    });
  void record();
  countdown.value = null;
  readyAddresses.value = [];
  session.on((e) => {
    if (e.type === 'ready') readyAddresses.value = [...new Set([...readyAddresses.value, e.address])];
    else if (e.type === 'countdown') countdown.value = e.secondsLeft;
    else if (e.type === 'started') {
      countdown.value = null;
      phase.value = 'running';
    }
    else if (e.type === 'players') void record();
    else if (e.type === 'ended') {
      phase.value = 'ended';
      void clearHostGame(r.pin);
    }
  });
  game.value = session;
  r.setOpen(p.runtime.multiplayer!.lateJoin);
  r.attach(session);
  return session;
}

/** After a reload of this page: continue the game that was running in this room. */
async function restoreGame(): Promise<void> {
  const r = room.value;
  if (!r) return;
  const record = await loadHostGame(r.pin);
  if (!record) return;
  const set = sets.value.find((s) => s.key === record.setKey);
  const loaded = loadPluginFromHtml(withSdkSource(record.pluginHtml, 'local'));
  if (!set || !loaded.success || !loaded.plugin.runtime.multiplayer) {
    await clearHostGame(r.pin);
    return;
  }
  setKey.value = record.setKey;
  hostAs.value = record.hostAs;
  hostName.value = record.hostName;
  settings.value = record.settings;
  pluginRaw.value = record.pluginHtml;
  plugin.value = loaded.plugin;
  pluginErrors.value = [];
  phase.value = 'starting';
  try {
    await r.whenHosting();
    await ensureUploaded();
    lobbySession.value?.end('closed').catch(() => {});
    lobbySession.value = null;
    launch(loaded.plugin, set.file, record.players, record.sessionId, true);
    r.setState({ phase: 'running' });
    phase.value = 'running';
  } catch (error) {
    startError.value = (error as Error).message;
    backToLobby();
  }
}

async function endGame(): Promise<void> {
  await game.value?.end('closed').catch(() => {});
  phase.value = 'ended';
}

function backToLobby(): void {
  if (room.value) void clearHostGame(room.value.pin);
  room.value?.detach();
  room.value?.setState({ phase: 'lobby', result: undefined, countdown: undefined });
  room.value?.setOpen(true);
  game.value = null;
  phase.value = 'lobby';
  // Recreate the settings screen session.
  plugin.value = plugin.value ? { ...plugin.value } : null;
}

function kick(id: string): void {
  room.value?.kick(id);
}

function fullscreen(): void {
  void stage.value?.requestFullscreen?.().catch(() => {});
}

function useUrl(): void {
  if (pluginUrl.value.trim()) choice.value = { kind: 'url', url: pluginUrl.value.trim() };
}

onMounted(async () => {
  sets.value = [...BUILTIN_SETS, ...(await loadStoredSets())];
  if (await openRoom()) await restoreGame();
});

onBeforeUnmount(() => {
  stopRoom?.();
  clearTimeout(uploadTimer);
  void game.value?.end('closed').catch(() => {});
  void lobbySession.value?.end('closed').catch(() => {});
  // Close our connection (otherwise this page and the next one would fight over the
  // room); the room stays on the server for a reload (sessionStorage) and expires otherwise.
  room.value?.disconnect();
});

const statusClass = computed(() =>
  roomStatus.value === 'online' ? 'bg-emerald-100 text-emerald-700' : roomStatus.value === 'closed' ? 'bg-slate-100 text-text-gray' : 'bg-amber-100 text-amber-700',
);
</script>

<template>
  <div class="min-h-dvh">
    <div v-if="roomStatus === 'replaced'" class="fixed inset-0 z-50 grid place-items-center bg-slate-900/80 p-6">
      <div class="card max-w-md p-6 text-center">
        <p class="text-lg font-bold">{{ t('host.replaced') }}</p>
        <p class="mt-2 text-sm text-text-gray">{{ t('host.replacedText') }}</p>
        <button type="button" class="btn-primary mt-4" @click="openRoom()">{{ t('host.takeOver') }}</button>
      </div>
    </div>
    <!-- Running game -->
    <StartScreen
      v-if="game && (phase === 'starting' || countdown)"
      :countdown="countdown"
      :ready="readyAddresses.filter((a) => game!.addresses().includes(a)).length"
      :total="game.addresses().length"
    />
    <div v-if="game && phase !== 'lobby'" class="flex h-dvh flex-col bg-slate-900">
      <div class="flex items-center gap-3 bg-white px-4 py-2 text-sm shadow-sm">
        <AppLogo class="hidden sm:flex" />
        <span class="font-mono text-lg font-black tracking-widest text-accent-orange">{{ room?.pin }}</span>
        <span class="badge" :class="statusClass">{{ t(`host.status.${roomStatus}`) }}</span>
        <button type="button" class="badge bg-slate-100 py-1 text-text-dark hover:bg-slate-200" @click="showPlayers = !showPlayers">
          <UserGroupIcon class="size-4" /> {{ t('host.playersOnline', { n: game.players.filter((p) => p.connected).length }) }}
        </button>
        <span class="ml-auto flex gap-2">
          <button v-if="hostAs === 'presenter'" type="button" class="btn-ghost" :title="t('host.fullscreen')" @click="fullscreen">
            <ArrowsPointingOutIcon class="size-4" />
          </button>
          <button v-if="phase === 'ended'" type="button" class="btn-primary" @click="backToLobby">{{ t('host.backToLobby') }}</button>
          <button v-else type="button" class="btn-danger" @click="endGame"><StopIcon class="size-4" /> {{ t('host.endGame') }}</button>
        </span>
      </div>
      <div class="relative min-h-0 flex-1">
        <div ref="stage" class="mx-auto size-full bg-white" :class="hostAs === 'player' ? 'max-w-md' : ''">
          <PluginFrame :session="game" :address="hostAs === 'presenter' ? 'board' : 'host'" :overlays="false" />
        </div>
        <div v-if="showPlayers" class="absolute top-2 right-2 w-80 max-w-[90vw]">
          <PlayerList :players="players" @kick="kick" />
        </div>
      </div>
    </div>

    <!-- Lobby -->
    <template v-else>
      <header class="border-b border-slate-200 bg-white">
        <div class="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <RouterLink to="/" class="btn-ghost -ml-2 px-2" :aria-label="t('common.back')"><ArrowLeftIcon class="size-5" /></RouterLink>
          <h1 class="text-lg font-bold">{{ t('host.title') }}</h1>
          <span class="ml-auto badge" :class="statusClass">{{ t(`host.status.${roomStatus}`) }}</span>
          <button v-if="room && phase !== 'closed'" type="button" class="btn-danger py-1.5" @click="endSession">
            <StopIcon class="size-4" /> {{ t('host.endSession') }}
          </button>
          <LocaleSwitch />
        </div>
      </header>

      <main v-if="phase === 'closed'" class="flex flex-col items-center gap-4 py-24 text-center">
        <p class="text-xl font-semibold">{{ t('host.closed') }}</p>
        <button type="button" class="btn-primary" @click="openRoom(true)">{{ t('host.newRoom') }}</button>
      </main>

      <main v-else-if="roomError" class="mx-auto flex max-w-md flex-col items-center gap-4 py-24 text-center">
        <p class="text-red-700">{{ roomError }}</p>
        <button type="button" class="btn-primary" @click="openRoom()">{{ t('host.retry') }}</button>
      </main>

      <main v-else class="mx-auto grid max-w-6xl gap-5 px-4 py-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <!-- Left: joining and players -->
        <div class="flex flex-col gap-5">
          <JoinInfo :pin="room?.pin ?? null" />
          <PlayerList :players="players" :host-name="hostAs === 'player' ? hostName : null" @kick="kick" />
        </div>

        <!-- Right: set, game, settings, start -->
        <div class="flex flex-col gap-5">
          <section class="card p-5">
            <h2 class="card-title"><BookOpenIcon class="size-4 text-text-gray" /> {{ t('host.set') }}</h2>
            <select v-model="setKey" class="input mt-3">
              <option v-for="s in sets" :key="s.key" :value="s.key">{{ s.title }}</option>
            </select>
            <p v-if="studySet" class="mt-2 flex flex-wrap gap-x-3 text-xs">
              <span class="text-emerald-700">✓ {{ t('host.setSummary', { total: studySet.file.items.length }) }}</span>
              <span v-if="prepared" :class="prepared.set.items.length ? 'text-emerald-700' : 'text-accent-orange-dark'">
                {{ t('host.compatible', { n: prepared.set.items.length }) }}
              </span>
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
            <div v-if="plugin && multi" class="mt-3 rounded-xl bg-slate-50 p-3 text-xs">
              <div class="font-semibold">{{ plugin.manifest.appName }} <span class="font-normal text-text-gray">{{ plugin.manifest.pluginVersion }}</span></div>
              <div class="mt-1 font-mono text-[11px] text-text-gray">{{ (plugin.manifest.capabilities.types as string[] | undefined)?.join(' · ') }}</div>
              <div v-if="unsupported.length === (plugin.manifest.capabilities.types as string[] | undefined)?.length" class="mt-1 text-accent-orange-dark">
                {{ t('host.noItems', { types: unsupported.join(', ') }) }}
              </div>
            </div>
            <ul v-if="pluginErrors.length" class="mt-3 rounded-xl bg-red-50 p-3 text-xs text-red-700">
              <li v-for="(e, i) in pluginErrors" :key="i">{{ e }}</li>
            </ul>

            <div v-if="multi && multi.hostAs.length" class="mt-4">
              <div class="section-label mb-2">{{ t('host.hostRole') }}</div>
              <div class="grid gap-2 sm:grid-cols-2">
                <label
                  v-for="role in multi.hostAs"
                  :key="role"
                  class="flex cursor-pointer flex-col rounded-xl border px-3 py-2"
                  :class="hostAs === role ? 'border-primary-blue bg-blue-50/60' : 'border-slate-200 hover:bg-slate-50'"
                >
                  <span class="flex items-center gap-2 text-sm font-semibold">
                    <input v-model="hostAs" type="radio" :value="role" class="accent-primary-blue" />
                    {{ t(`host.${role}`) }}
                  </span>
                  <span class="text-xs text-text-gray">{{ t(`host.${role}Text`) }}</span>
                </label>
              </div>
              <div v-if="hostAs === 'player'" class="mt-3 flex items-center gap-2 text-sm">
                <span class="text-text-gray">{{ t('host.myName') }}:</span>
                <span class="font-bold">{{ hostName }}</span>
                <button type="button" class="badge bg-orange-50 py-1 text-accent-orange-dark hover:bg-orange-100" @click="hostName = generateName()">
                  <ArrowPathIcon class="size-3.5" /> {{ t('join.another') }}
                </button>
              </div>
            </div>
          </section>

          <section v-if="plugin && multi && (lobbySession || settingsForMode(plugin.runtime.settings, 'multiplayer').length)" class="card overflow-hidden">
            <h2 class="card-title border-b border-slate-100 px-5 py-3">{{ t('host.settings') }}</h2>
            <div v-if="lobbySession" class="bg-white" :class="plugin.runtime.settingsScreen?.size === 'large' ? 'h-[480px]' : 'h-[300px]'">
              <PluginFrame :key="lobbySession.id" :session="lobbySession" :address="SETTINGS_ADDRESS" />
            </div>
            <div v-else class="p-5">
              <SettingsForm v-model="settings" :definitions="settingsForMode(plugin.runtime.settings, 'multiplayer')" />
            </div>
          </section>

          <div>
            <button type="button" class="btn-primary w-full py-4 text-lg" :disabled="!!blocker || phase === 'starting'" @click="start">
              <RocketLaunchIcon class="size-5" />
              {{ phase === 'starting' ? t('host.starting') : t('host.start') }}
            </button>
            <p v-if="blocker" class="mt-2 text-center text-xs text-accent-orange-dark">{{ blocker }}</p>
            <p v-if="uploadError" class="mt-2 text-center text-xs text-red-600">{{ uploadError }}</p>
            <p v-if="startError" class="mt-2 text-center text-xs text-red-600">{{ startError }}</p>
          </div>
        </div>
      </main>
    </template>
  </div>
</template>
