<script setup lang="ts">
/** On/off switch used by registry rows, templates and the announcement editor. */
withDefaults(defineProps<{ disabled?: boolean; label?: string; size?: 'sm' | 'md' }>(), {
  disabled: false,
  label: undefined,
  size: 'md',
});
const model = defineModel<boolean>({ required: true });
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="model"
    :aria-label="label"
    :disabled="disabled"
    class="relative inline-flex shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
    :class="[size === 'sm' ? 'h-4 w-7' : 'h-5 w-9', model ? 'bg-brand-solid' : 'bg-surface-lift ring-1 ring-inset ring-hairline']"
    @click="model = !model"
  >
    <span
      class="inline-block rounded-full bg-fixed-white shadow transition-transform"
      :class="
        size === 'sm'
          ? ['size-3', model ? 'translate-x-3.5' : 'translate-x-0.5']
          : ['size-4', model ? 'translate-x-[18px]' : 'translate-x-0.5']
      "
    />
  </button>
</template>
