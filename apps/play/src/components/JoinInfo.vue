<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import QrcodeVue from 'qrcode.vue';
import { ArrowsPointingOutIcon, LinkIcon, XMarkIcon } from '@heroicons/vue/20/solid';
import { joinUrl } from '@/lib/config';
import { useCopy } from '@/lib/clipboard';

const props = defineProps<{ pin: string | null }>();
const { t } = useI18n();
const { copied, copy } = useCopy();
const enlarged = ref(false);
const url = computed(() => (props.pin ? joinUrl(props.pin) : ''));
const shortUrl = computed(() => url.value.replace(/^https?:\/\//, '').replace(/\/join\/\d+$/, '/join'));
</script>

<template>
  <section class="card flex flex-col items-center gap-4 p-6">
    <div class="section-label">{{ t('host.joinInfo') }}</div>
    <template v-if="pin">
      <button type="button" class="group rounded-2xl border border-slate-200 bg-white p-3 transition hover:shadow-soft" @click="enlarged = true">
        <QrcodeVue :value="url" :size="168" level="M" render-as="svg" />
        <span class="mt-1 flex items-center justify-center gap-1 text-[10px] font-semibold tracking-wider text-text-gray uppercase group-hover:text-text-dark">
          <ArrowsPointingOutIcon class="size-3" /> {{ t('host.enlarge') }}
        </span>
      </button>
      <div class="text-center">
        <div class="section-label">{{ t('host.pin') }}</div>
        <div class="btn-primary-gradient mt-2 rounded-2xl px-8 py-3 font-mono text-5xl font-black tracking-[0.15em] text-white shadow-md">{{ pin }}</div>
        <div class="mt-2 text-xs text-text-gray">{{ shortUrl }}</div>
      </div>
      <button type="button" class="btn-ghost text-xs" @click="copy(url, 'link')">
        <LinkIcon class="size-4" /> {{ copied === 'link' ? t('common.copied') : t('host.copyLink') }}
      </button>
    </template>
    <div v-else class="grid h-64 place-items-center">
      <div class="size-10 animate-spin rounded-full border-4 border-orange-100 border-t-accent-orange" />
    </div>

    <Teleport to="body">
      <div v-if="enlarged && pin" class="fixed inset-0 z-50 grid place-items-center bg-white p-6" @click="enlarged = false">
        <button type="button" class="absolute top-4 right-4 btn-ghost" :aria-label="t('common.close')"><XMarkIcon class="size-6" /></button>
        <div class="flex flex-col items-center gap-8 lg:flex-row lg:gap-16">
          <QrcodeVue :value="url" :size="420" level="M" render-as="svg" class="max-w-[80vw]" />
          <div class="text-center">
            <div class="text-2xl font-semibold text-text-gray">{{ shortUrl }}</div>
            <div class="mt-4 text-xl font-semibold tracking-wider text-text-gray uppercase">{{ t('host.pin') }}</div>
            <div class="btn-primary-gradient mt-3 rounded-3xl px-10 py-4 font-mono text-8xl font-black tracking-[0.15em] text-white">{{ pin }}</div>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>
