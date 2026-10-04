<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { localize, validateSettingValue, type SettingDefinition, type SettingValue } from '@memizy/protocol';

const props = defineProps<{ definitions: SettingDefinition[]; modelValue: Record<string, SettingValue> }>();
const emit = defineEmits<{ 'update:modelValue': [Record<string, SettingValue>] }>();
const { locale } = useI18n();

function value(def: SettingDefinition): SettingValue {
  return props.modelValue[def.id] ?? def.default;
}

function update(def: SettingDefinition, next: SettingValue): void {
  emit('update:modelValue', { ...props.modelValue, [def.id]: next });
}

function onSelect(def: Extract<SettingDefinition, { type: 'select' }>, index: string): void {
  update(def, def.options[Number(index)].value);
}

function error(def: SettingDefinition): string | null {
  return validateSettingValue(def, value(def));
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <label v-for="def in definitions" :key="def.id" class="flex flex-col gap-1 text-sm">
      <span class="flex items-center justify-between gap-2 font-medium">
        {{ localize(def.label, locale) }}
        <input
          v-if="def.type === 'boolean'"
          type="checkbox"
          class="size-4 accent-accent-orange"
          :checked="value(def) === true"
          @change="update(def, ($event.target as HTMLInputElement).checked)"
        />
      </span>
      <span v-if="def.description" class="text-xs text-text-gray">{{ localize(def.description, locale) }}</span>
      <input
        v-if="def.type === 'number'"
        type="number"
        class="input"
        :min="def.min"
        :max="def.max"
        :step="def.step ?? 'any'"
        :value="value(def)"
        @input="update(def, ($event.target as HTMLInputElement).valueAsNumber)"
      />
      <select
        v-else-if="def.type === 'select'"
        class="input"
        :value="def.options.findIndex((o) => o.value === value(def))"
        @change="onSelect(def, ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="(option, i) in def.options" :key="i" :value="i">{{ localize(option.label, locale) }}</option>
      </select>
      <input
        v-else-if="def.type === 'text'"
        type="text"
        class="input"
        :maxlength="def.maxLength"
        :value="value(def)"
        @input="update(def, ($event.target as HTMLInputElement).value)"
      />
      <span v-if="error(def)" class="text-xs text-red-600">{{ error(def) }}</span>
    </label>
  </div>
</template>
