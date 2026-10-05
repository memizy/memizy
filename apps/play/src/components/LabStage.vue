<script setup lang="ts">
import { settingsForMode } from '@memizy/protocol';
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ArrowPathIcon,
  PlayIcon,
  PlusIcon,
  SignalIcon,
  SignalSlashIcon,
  TrashIcon,
  WifiIcon,
} from '@heroicons/vue/20/solid';
import type { OQSEFile } from '@memizy/oqse';
import type { Player, SettingValue } from '@memizy/protocol';
import { LocalSession, SETTINGS_ADDRESS, type LoadedPlugin, type SessionEvent } from '@memizy/host-sdk';
import { generateName, generateNames } from '@/lib/names';
import PluginFrame from './PluginFrame.vue';
import SettingsForm from './SettingsForm.vue';
import LabInspector, { type LogEntry } from './LabInspector.vue';

type StageMode = 'solo' | 'presenter' | 'player';
type Phase = 'lobby' | 'countdown' | 'running' | 'ended';

const props = defineProps<{ plugin: LoadedPlugin | null; set: OQSEFile | null; liveTo?: string | null }>();
const emit = defineEmits<{ played: ['answer' | 'end'] }>();
const { t, locale } = useI18n();
/** What the plugin gets: app language or a test language, light or dark theme. */
const previewLocale = ref<'app' | 'cs' | 'en'>('app');
const previewTheme = ref<'light' | 'dark'>('light');
const pluginConfig = computed(() => ({ locale: previewLocale.value === 'app' ? locale.value : previewLocale.value, theme: previewTheme.value }));
const frameBg = computed(() => (previewTheme.value === 'dark' ? 'bg-slate-900' : 'bg-white'));

const mode = ref<StageMode>('solo');
const session = shallowRef<LocalSession | null>(null);
const players = ref<Player[]>([]);
const phase = ref<Phase>('lobby');
const countdown = ref(0);
const settings = ref<Record<string, SettingValue>>({});
const log = shallowRef<LogEntry[]>([]);
const notice = ref<string | null>(null);
const generation = ref(0);
let stopListening: (() => void) | null = null;
let nextPlayer = 1;
let nextLog = 1;

const runtime = computed(() => props.plugin?.runtime ?? null);
const modes = computed(() => {
  const r = runtime.value;
  if (!r) return [] as StageMode[];
  return [...(r.solo ? (['solo'] as const) : []), ...(r.multiplayer?.hostAs ?? [])] as StageMode[];
});
const modeLabels: Record<StageMode, string> = { solo: 'lab.preview.solo', presenter: 'lab.preview.presenter', player: 'lab.preview.hostPlays' };
const wide = computed(() => runtime.value?.orientation === 'landscape');
const soloWide = computed(() => runtime.value?.orientation !== 'portrait');
const showSettingsScreen = computed(() => mode.value !== 'solo' && !!runtime.value?.settingsScreen && phase.value === 'lobby');
/** Settings for this mode (`modes` in the manifest); in solo they stay visible – a change restarts the game. */
const modeSettings = computed(() => (runtime.value ? settingsForMode(runtime.value.settings, mode.value === 'solo' ? 'solo' : 'multiplayer') : []));
const showSettingsForm = computed(() => !showSettingsScreen.value && modeSettings.value.length > 0 && (mode.value === 'solo' || phase.value === 'lobby'));

function addLog(entry: Omit<LogEntry, 'id' | 'time'>): void {
  const next = [...log.value, { ...entry, id: nextLog++, time: new Date() }];
  log.value = next.length > 300 ? next.slice(-300) : next;
}

function handle(event: SessionEvent): void {
  switch (event.type) {
    case 'countdown':
      phase.value = 'countdown';
      countdown.value = event.secondsLeft;
      break;
    case 'started':
      phase.value = 'running';
      addLog({ kind: 'info', text: t('lab.preview.started') });
      break;
    case 'ended':
      emit('played', 'end');
      phase.value = 'ended';
      addLog({ kind: 'info', text: `${t('lab.preview.ended')}: ${JSON.stringify(event.result)}` });
      break;
    case 'players':
      players.value = event.players;
      break;
    case 'ready':
      addLog({ kind: 'info', text: `${event.address}: ready` });
      break;
    case 'traffic':
      addLog({ kind: 'traffic', text: `${event.from} → ${event.to} (${event.bytes} B)`, data: event.data });
      break;
    case 'rejected':
      addLog({ kind: 'error', text: `${event.address}: ${event.method} → ${event.code}: ${event.message}` });
      break;
    case 'pluginError':
      addLog({ kind: 'error', text: `${event.address}: ${event.code}: ${event.message}`, data: event.context });
      break;
    case 'settings':
      if (event.valid) settings.value = event.values as Record<string, SettingValue>;
      addLog({ kind: event.valid ? 'info' : 'error', text: `settings: ${JSON.stringify(event.values)}${event.message ? ` – ${event.message}` : ''}` });
      break;
    case 'answer':
      emit('played', 'answer');
      addLog({ kind: 'info', text: `${event.playerId}: answer ${event.answer.itemId} ${event.answer.isCorrect ? '✓' : '✗'}`, data: event.answer });
      break;
    case 'authority':
      addLog({ kind: 'info', text: `authority ${event.connected ? 'connected' : 'disconnected'}` });
      break;
    case 'exit':
      addLog({ kind: 'info', text: `${event.address}: exit` });
      break;
    case 'resize':
      break;
  }
}

function teardown(): void {
  stopListening?.();
  stopListening = null;
  const old = session.value;
  session.value = null;
  if (old) void old.end('closed').catch(() => {});
}

function initialPlayers(): Player[] {
  if (mode.value === 'solo') return [{ id: 'me', name: generateName(), isHost: true, connected: true }];
  const limits = runtime.value!.multiplayer!.players;
  const count = Math.max(limits.min, Math.min(limits.max, limits.recommended ?? 3, 4));
  return generateNames(count).map((name, i) => ({ id: `p${i + 1}`, name, isHost: mode.value === 'player' && i === 0, connected: true }));
}

function build(): void {
  teardown();
  notice.value = null;
  phase.value = 'lobby';
  log.value = [];
  if (!props.plugin || !props.set || !modes.value.includes(mode.value)) return;
  const roster = initialPlayers();
  nextPlayer = roster.length + 1;
  try {
    const next = new LocalSession({
      plugin: props.plugin,
      set: props.set,
      mode: mode.value === 'solo' ? 'solo' : 'multiplayer',
      hostAs: mode.value === 'solo' ? undefined : mode.value,
      players: roster,
      settings: settings.value,
      config: pluginConfig.value,
    });
    stopListening = next.on(handle);
    players.value = next.players;
    session.value = next;
    generation.value++;
  } catch (error) {
    notice.value = (error as Error).message;
  }
}

watch(modes, (available) => {
  if (!available.includes(mode.value) && available.length) mode.value = available[0];
}, { immediate: true });

watch(
  () => props.plugin,
  (plugin, old) => {
    // A new manifest may declare other settings: start from its defaults.
    if (plugin?.manifest.id !== old?.manifest.id || JSON.stringify(plugin?.runtime.settings) !== JSON.stringify(old?.runtime.settings)) settings.value = {};
  },
);
watch([() => props.plugin, () => props.set, mode], build, { immediate: true });
watch(pluginConfig, (config) => session.value?.setConfig(config));
onBeforeUnmount(teardown);

let settingsTimer: ReturnType<typeof setTimeout> | undefined;
function applySettings(values: Record<string, SettingValue>): void {
  settings.value = values;
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(build, 500);
}

async function start(): Promise<void> {
  notice.value = null;
  try {
    await session.value?.start();
  } catch (error) {
    notice.value = (error as Error).message;
  }
}

function addPlayer(): void {
  if (!session.value) return;
  notice.value = null;
  try {
    session.value.addPlayer({ id: `p${nextPlayer}`, name: generateName() });
    nextPlayer++;
  } catch (error) {
    notice.value = (error as Error).message;
  }
}

function removePlayer(id: string): void {
  try {
    session.value?.removePlayer(id);
  } catch (error) {
    notice.value = (error as Error).message;
  }
}

function toggleConnection(player: Player): void {
  session.value?.setConnected(player.id, !player.connected);
}

function isConnected(address: string): boolean {
  return players.value.find((p) => p.id === address)?.connected ?? true;
}

async function reload(address: string): Promise<void> {
  try {
    await session.value?.reload(address);
  } catch (error) {
    notice.value = (error as Error).message;
  }
}

function frameError(message: string): void {
  addLog({ kind: 'error', text: message });
}

const phaseLabel = computed(() => {
  if (phase.value === 'countdown') return String(countdown.value);
  if (phase.value === 'running') return t('lab.preview.started');
  if (phase.value === 'ended') return t('lab.preview.ended');
  return t('lab.preview.waitingStart');
});
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
      <h2 class="font-bold">{{ t('lab.preview.title') }}</h2>
      <span
        v-if="session"
        class="badge"
        :class="phase === 'running' ? 'bg-emerald-100 text-emerald-700' : phase === 'ended' ? 'bg-slate-100 text-text-gray' : 'bg-amber-100 text-amber-700'"
      >
        {{ phaseLabel }}
      </span>

      <div class="flex items-center gap-1 text-xs" :title="t('lab.preview.configHint')">
        <select v-model="previewLocale" class="rounded-lg border border-slate-200 bg-white px-2 py-1 font-semibold">
          <option value="app">{{ t('lab.preview.localeApp') }}</option>
          <option value="cs">CS</option>
          <option value="en">EN</option>
        </select>
        <button type="button" class="rounded-lg border border-slate-200 bg-white px-2 py-1 font-semibold" @click="previewTheme = previewTheme === 'light' ? 'dark' : 'light'">
          {{ previewTheme === 'light' ? '☀️' : '🌙' }}
        </button>
      </div>

      <div v-if="modes.length" class="flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-sm">
        <button
          v-for="m in modes"
          :key="m"
          type="button"
          class="rounded-lg px-3 py-1 font-medium transition"
          :class="mode === m ? 'bg-white text-primary-blue shadow-sm' : 'text-text-gray hover:text-text-dark'"
          @click="mode = m"
        >
          {{ t(modeLabels[m]) }}
        </button>
      </div>

      <div class="ml-auto flex flex-wrap items-center gap-2">
        <button v-if="session && mode !== 'solo'" type="button" class="btn-secondary" @click="addPlayer">
          <PlusIcon class="size-4" /> {{ t('lab.preview.addPlayer') }}
        </button>
        <button v-if="session" type="button" class="btn-secondary" @click="build">
          <ArrowPathIcon class="size-4" /> {{ t('lab.preview.restart') }}
        </button>
        <button v-if="session && mode !== 'solo'" type="button" class="btn-primary" :disabled="phase !== 'lobby'" @click="start">
          <PlayIcon class="size-4" /> {{ t('lab.preview.start') }}
        </button>
        <RouterLink v-if="liveTo && plugin?.runtime.multiplayer" :to="liveTo" class="btn-secondary" :title="t('lab.preview.playLiveHint')">
          <WifiIcon class="size-4" /> {{ t('lab.preview.playLive') }}
        </RouterLink>
      </div>
    </div>

    <p v-if="notice" class="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{{ notice }}</p>

    <!-- Stage -->
    <div class="min-h-0 flex-1 overflow-auto bg-slate-900 p-4 sm:p-6">
      <p v-if="!session" class="grid h-full min-h-64 place-items-center text-center text-slate-400">
        {{ plugin && set && !modes.includes(mode) ? t('lab.preview.notSupported') : t('lab.preview.empty') }}
      </p>

      <div v-else :key="generation" class="flex flex-col items-center gap-6">
        <!-- Settings before the start -->
        <div v-if="showSettingsScreen" class="w-full max-w-3xl">
          <div class="section-label mb-2 text-slate-400">{{ t('lab.preview.settings') }}</div>
          <div class="overflow-hidden rounded-2xl" :class="[frameBg, runtime?.settingsScreen?.size === 'large' ? 'h-[480px]' : 'h-[300px]']">
            <PluginFrame :session="session" :address="SETTINGS_ADDRESS" @error="frameError" />
          </div>
        </div>
        <div v-else-if="showSettingsForm" class="w-full max-w-md rounded-2xl bg-white p-4">
          <div class="section-label mb-3">{{ t('lab.preview.settings') }}</div>
          <SettingsForm :definitions="modeSettings" :model-value="settings" @update:model-value="applySettings" />
        </div>

        <!-- Solo -->
        <template v-if="mode === 'solo'">
          <div
            class="overflow-hidden shadow-2xl"
            :class="[frameBg, soloWide ? 'aspect-video w-full max-w-4xl rounded-2xl' : 'h-[700px] w-[360px] rounded-[2.5rem] border-[10px] border-slate-700']"
          >
            <PluginFrame :session="session" address="me" @error="frameError" />
          </div>
        </template>

        <!-- Multiplayer -->
        <template v-else>
          <div v-if="mode === 'presenter'" class="w-full max-w-4xl">
            <div class="mb-2 flex items-center gap-2">
              <span class="badge bg-primary-blue text-white">{{ t('lab.preview.board') }}</span>
              <button type="button" class="ml-auto text-xs text-slate-400 hover:text-white" @click="reload('board')">
                <ArrowPathIcon class="inline size-3.5" /> {{ t('lab.preview.reload') }}
              </button>
            </div>
            <div class="aspect-video overflow-hidden rounded-2xl border border-slate-700 shadow-2xl" :class="frameBg">
              <PluginFrame :session="session" address="board" @error="frameError" />
            </div>
          </div>

          <div class="flex w-full items-center gap-4 text-slate-400">
            <span class="h-px flex-1 bg-slate-700" />
            <span class="section-label text-slate-400">{{ t('lab.preview.devices') }}</span>
            <span class="h-px flex-1 bg-slate-700" />
          </div>

          <div class="flex flex-wrap justify-center gap-6">
            <div v-for="player in players" :key="player.id" class="flex flex-col gap-2">
              <div class="flex items-center gap-2 text-sm text-white">
                <span class="size-2 rounded-full" :class="player.connected ? 'bg-emerald-400' : 'bg-red-400'" />
                <span class="max-w-40 truncate font-semibold">{{ player.name }}</span>
                <span v-if="player.isHost" class="badge bg-accent-orange text-white">{{ t('lab.preview.host') }}</span>
                <span class="ml-auto flex gap-1">
                  <button
                    type="button"
                    class="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                    :title="player.connected ? t('lab.preview.disconnect') : t('lab.preview.reconnect')"
                    @click="toggleConnection(player)"
                  >
                    <SignalSlashIcon v-if="player.connected" class="size-4" />
                    <SignalIcon v-else class="size-4" />
                  </button>
                  <button type="button" class="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white" :title="t('lab.preview.reload')" @click="reload(player.id)">
                    <ArrowPathIcon class="size-4" />
                  </button>
                  <button
                    v-if="!player.isHost"
                    type="button"
                    class="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-red-400"
                    :title="t('lab.preview.remove')"
                    @click="removePlayer(player.id)"
                  >
                    <TrashIcon class="size-4" />
                  </button>
                </span>
              </div>
              <div
                class="relative overflow-hidden rounded-[2.25rem] border-[10px] border-slate-700 shadow-2xl"
                :class="[frameBg, wide ? 'h-[320px] w-[600px] max-w-[85vw]' : 'h-[600px] w-[300px]']"
              >
                <PluginFrame :key="player.id" :session="session" :address="player.id" @error="frameError" />
                <div v-if="!isConnected(player.id)" class="absolute inset-0 grid place-items-center bg-slate-900/70 text-white">
                  <SignalSlashIcon class="size-10" />
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <LabInspector :entries="log" @clear="log = []" />
  </div>
</template>
