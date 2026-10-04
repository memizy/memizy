<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { mountPlugin, type LocalSession, type MountedPlugin } from '@memizy/host-sdk';

/** One sandboxed plugin instance of a session (board, controller, solo or settings screen). */
const props = withDefaults(defineProps<{ session: LocalSession; address: string; overlays?: boolean }>(), { overlays: true });
const emit = defineEmits<{ error: [string] }>();

const host = ref<HTMLElement | null>(null);
let mounted: MountedPlugin | null = null;
let disposed = false;

onMounted(async () => {
  try {
    const result = await mountPlugin(props.session, props.address, host.value!, { overlays: props.overlays });
    if (disposed) result.unmount();
    else mounted = result;
  } catch (error) {
    if (!disposed) emit('error', `${props.address}: ${(error as Error).message}`);
  }
});

onBeforeUnmount(() => {
  disposed = true;
  mounted?.unmount();
  mounted = null;
});
</script>

<template>
  <div ref="host" class="size-full" />
</template>
