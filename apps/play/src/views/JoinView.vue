<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ArrowLeftIcon, ArrowPathIcon, RocketLaunchIcon, SignalSlashIcon } from '@heroicons/vue/20/solid';
import { RelayPlayer, type RelayPlayerEvent, type RelayStatus, type RemoteLobbyState } from '@memizy/host-sdk';
import { normalizePlayerName, type RoomInfo } from '@memizy/protocol';
import LocaleSwitch from '@/components/LocaleSwitch.vue';
import StartScreen from '@/components/StartScreen.vue';
import { RELAY_URL } from '@/lib/config';
import { generateName } from '@/lib/names';
import { withSdkSource } from '@/lib/plugins';

type Stage = 'form' | 'joining' | 'joined' | 'gone';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const pin = ref(typeof route.params.pin === 'string' ? route.params.pin.replace(/\D/g, '').slice(0, 6) : '');
// A fresh random nickname on every visit; players cannot type their own (privacy: no real names).
const name = ref(generateName());
const stage = ref<Stage>('form');
const error = ref<string | null>(null);
const goneReason = ref<string | null>(null);
const player = shallowRef<RelayPlayer | null>(null);
const status = ref<RelayStatus>('connecting');
const state = ref<RemoteLobbyState | null>(null);
const hostConnected = ref(true);
const frameActive = ref(false);
const frameBox = ref<HTMLElement | null>(null);
const mountError = ref<string | null>(null);
let wakeLock: { release(): Promise<void> } | null = null;

const tokenKey = (p: string) => `memizy-play:join:${p}`;
function savedToken(p: string): string | null {
  try {
    return localStorage.getItem(tokenKey(p));
  } catch {
    return null;
  }
}
function saveToken(p: string, token: string | null): void {
  try {
    if (token) localStorage.setItem(tokenKey(p), token);
    else localStorage.removeItem(tokenKey(p));
  } catch {
    /* unavailable */
  }
}

const canJoin = computed(() => /^\d{6}$/.test(pin.value) && normalizePlayerName(name.value).length > 0 && stage.value === 'form');

/** Pasting a PIN or a join link joins right away; typing waits for the button. */
function onPaste(event: ClipboardEvent): void {
  const text = event.clipboardData?.getData('text') ?? '';
  const match = /(?:join\/)?(\d{6})(?!\d)/.exec(text);
  if (!match) return;
  event.preventDefault();
  pin.value = match[1];
  void join();
}

async function join(): Promise<void> {
  if (!/^\d{6}$/.test(pin.value)) return;
  error.value = null;
  stage.value = 'joining';
  const token = savedToken(pin.value);
  try {
    const response = await fetch(new URL(`/api/rooms/${pin.value}`, RELAY_URL));
    if (response.status === 404) throw new Error(t('join.notFound'));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const info = (await response.json()) as RoomInfo;
    if (!info.open && !token) throw new Error(t('join.notOpen'));
  } catch (e) {
    error.value = e instanceof TypeError ? t('host.serverDown', { url: RELAY_URL }) : (e as Error).message;
    stage.value = 'form';
    return;
  }
  if (route.params.pin !== pin.value) void router.replace({ name: 'join', params: { pin: pin.value } });
  connect(token);
}

function connect(token: string | null): void {
  const p = new RelayPlayer({
    serverUrl: RELAY_URL,
    pin: pin.value,
    name: normalizePlayerName(name.value),
    token: token ?? undefined,
    container: () => frameBox.value,
    transformHtml: (html) => withSdkSource(html, 'local'),
  });
  player.value = p;
  p.on(onEvent);
}

function onEvent(event: RelayPlayerEvent): void {
  switch (event.type) {
    case 'status':
      status.value = event.status;
      break;
    case 'joined':
      stage.value = 'joined';
      name.value = event.name;
      saveToken(pin.value, event.token);
      break;
    case 'state':
      state.value = event.state;
      if (event.state.phase === 'loading') mountError.value = null;
      break;
    case 'host':
      hostConnected.value = event.connected;
      break;
    case 'frame':
      frameActive.value = event.active;
      if (event.active) void lockScreen();
      else void releaseScreen();
      break;
    case 'error':
      if (event.code === 'MOUNT_FAILED') mountError.value = t('join.mountFailed', { error: event.message });
      else if (event.fatal) {
        if (event.code === 'KICKED') return gone(t('join.kicked'));
        saveToken(pin.value, null);
        player.value = null;
        stage.value = 'form';
        error.value = event.code === 'ROOM_NOT_FOUND' ? t('join.notFound') : event.code === 'ROOM_CLOSED' ? t('join.notOpen') : event.message;
      }
      break;
    case 'closed':
      gone(event.reason === 'kicked' ? t('join.kicked') : event.reason === 'host' ? t('join.closed') : t('join.expired'));
      break;
  }
}

function gone(reason: string): void {
  saveToken(pin.value, null);
  player.value?.leave();
  player.value = null;
  frameActive.value = false;
  goneReason.value = reason;
  stage.value = 'gone';
  void releaseScreen();
}

function leave(): void {
  player.value?.leave();
  player.value = null;
  saveToken(pin.value, null);
  frameActive.value = false;
  state.value = null;
  stage.value = 'form';
  void releaseScreen();
}

let renameTimer: ReturnType<typeof setTimeout> | undefined;
function another(): void {
  name.value = generateName();
  if (stage.value !== 'joined') return;
  // Debounced like the original multiplayer: re-rolling quickly sends one rename.
  clearTimeout(renameTimer);
  renameTimer = setTimeout(() => player.value?.rename(name.value), 500);
}

function startOver(): void {
  goneReason.value = null;
  pin.value = '';
  stage.value = 'form';
  void router.replace({ name: 'join' });
}

async function lockScreen(): Promise<void> {
  try {
    wakeLock = await (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen') ?? null;
  } catch {
    /* not supported or not allowed */
  }
}
async function releaseScreen(): Promise<void> {
  await wakeLock?.release().catch(() => {});
  wakeLock = null;
}

function onVisible(): void {
  if (document.visibilityState === 'visible') {
    player.value?.reconnectNow();
    if (frameActive.value) void lockScreen();
  }
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisible);
  // Coming back after a reload: rejoin as the same player.
  if (/^\d{6}$/.test(pin.value) && savedToken(pin.value)) {
    stage.value = 'joining';
    connect(savedToken(pin.value));
  } else if (/^\d{6}$/.test(pin.value)) {
    // Opened from a link or QR code: join right away with the random nickname.
    void join();
  }
});

onBeforeUnmount(() => {
  clearTimeout(renameTimer);
  document.removeEventListener('visibilitychange', onVisible);
  player.value?.leave();
  void releaseScreen();
});

const offline = computed(() => stage.value === 'joined' && status.value !== 'online');
const waitingForHost = computed(() => !hostConnected.value || state.value?.authorityConnected === false);
</script>

<template>
  <div class="min-h-dvh">
    <StartScreen
      v-if="stage === 'joined' && (state?.phase === 'loading' || state?.phase === 'countdown')"
      :countdown="state.phase === 'countdown' ? state.countdown : null"
      :text="t('start.loading')"
    />
    <!-- The game (the container must exist before the host mounts the plugin) -->
    <div v-show="frameActive" class="fixed inset-0 z-10 bg-white">
      <div ref="frameBox" class="size-full" />
      <div v-if="waitingForHost && state?.phase !== 'ended'" class="absolute inset-0 grid place-items-center bg-black/55 p-6 text-center text-xl font-semibold text-white">
        {{ t('join.hostAway') }}
      </div>
      <div v-if="offline" class="absolute inset-x-0 top-0 flex items-center justify-center gap-2 bg-amber-500 py-1 text-sm font-semibold text-white">
        <SignalSlashIcon class="size-4" /> {{ t('join.reconnecting') }}
      </div>
      <div v-if="state?.phase === 'ended'" class="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-slate-900/85 px-4 py-2 text-sm text-white">
        <span class="font-semibold">{{ t('join.ended') }}</span>
        <button type="button" class="rounded-lg bg-white/15 px-3 py-1 font-semibold" @click="leave">{{ t('join.leave') }}</button>
      </div>
    </div>

    <div v-if="!frameActive" class="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-6">
      <header class="flex items-center justify-between">
        <RouterLink v-if="stage === 'form'" to="/" class="btn-ghost -ml-2 px-2" :aria-label="t('common.back')">
          <ArrowLeftIcon class="size-5" />
        </RouterLink>
        <span v-else />
        <LocaleSwitch />
      </header>

      <!-- PIN and name -->
      <main v-if="stage === 'form' || stage === 'joining'" class="flex flex-1 flex-col justify-center">
        <h1 class="mb-4 text-2xl font-bold">{{ t('join.title') }}</h1>
        <form class="card flex flex-col gap-5 p-6" @submit.prevent="join">
          <input
            v-model="pin"
            inputmode="numeric"
            autocomplete="off"
            maxlength="6"
            placeholder="000000"
            aria-label="PIN"
            class="w-full border-b-2 border-orange-300 bg-transparent pb-2 text-center font-mono text-5xl font-bold tracking-[0.2em] text-accent-orange outline-none placeholder:text-orange-200 focus:border-accent-orange"
            @input="pin = pin.replace(/\D/g, '').slice(0, 6)"
            @paste="onPaste"
          />
          <div class="text-center">
            <div class="text-xs text-text-gray">{{ t('join.yourName') }}</div>
            <div class="mt-1 text-xl font-bold">{{ name }}</div>
            <div class="mt-2 flex justify-center gap-2">
              <button type="button" class="badge bg-orange-50 py-1 text-accent-orange-dark hover:bg-orange-100" @click="another">
                <ArrowPathIcon class="size-3.5" /> {{ t('join.another') }}
              </button>
            </div>
          </div>
          <p v-if="error" class="rounded-xl bg-red-50 p-3 text-center text-sm text-red-700">{{ error }}</p>
          <button type="submit" class="btn bg-primary-blue py-3 text-base text-white hover:bg-primary-blue-dark" :disabled="!canJoin">
            <RocketLaunchIcon class="size-5" />
            {{ stage === 'joining' ? t('join.checking') : t('join.go') }}
          </button>
        </form>
      </main>

      <!-- Lobby -->
      <main v-else-if="stage === 'joined'" class="flex flex-1 flex-col items-center justify-center gap-6 text-center">
        <div class="size-14 animate-spin rounded-full border-4 border-orange-100 border-t-accent-orange" />
        <div>
          <h1 class="text-xl font-bold">{{ state?.phase === 'loading' || state?.phase === 'countdown' ? t('join.loading') : t('join.waiting') }}</h1>
          <div class="mt-1 flex items-center justify-center gap-1.5 text-sm text-text-gray">
            <span class="size-2.5 rounded-full" :class="offline ? 'bg-amber-400' : 'bg-emerald-500'" />
            {{ offline ? t('join.reconnecting') : t('join.live') }}
          </div>
          <p v-if="state?.appName" class="mt-1 text-sm text-text-gray">{{ t('join.game', { name: state.appName }) }}</p>
          <p v-if="!hostConnected" class="mt-2 text-sm text-amber-700">{{ t('join.hostAway') }}</p>
          <p v-if="mountError" class="mt-2 text-sm text-red-600">{{ mountError }}</p>
        </div>
        <div class="card w-full p-6">
          <div class="section-label">{{ t('join.connectedAs') }}</div>
          <div class="mt-2 text-3xl font-black">{{ name }}</div>
          <div class="mt-3 flex justify-center gap-2">
            <button type="button" class="badge bg-orange-50 py-1.5 text-sm text-accent-orange-dark hover:bg-orange-100" @click="another">
              <ArrowPathIcon class="size-4" /> {{ t('join.another') }}
            </button>
          </div>
        </div>
        <button type="button" class="btn-ghost text-xs" @click="leave">{{ t('join.leave') }}</button>
      </main>

      <!-- Removed / closed -->
      <main v-else class="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <p class="text-xl font-bold">{{ goneReason }}</p>
        <button type="button" class="btn-primary" @click="startOver">{{ t('join.again') }}</button>
      </main>
    </div>
  </div>
</template>
