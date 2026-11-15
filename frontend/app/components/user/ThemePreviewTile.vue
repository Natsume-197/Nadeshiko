<script setup lang="ts">
import { mdiCheck } from '@mdi/js';

/**
 * One choice in the Themes settings: a small drawing of the site in that theme (header, a card with two lines of
 * text and an accent button) above its name. `split` draws a second theme over the lower-right half, for "Match my
 * device".
 */
export interface ThemePreviewPalette {
  background: string;
  surface: string;
  header: string;
  ink: string;
  accent: string;
  line: string;
}

defineProps<{
  palette: ThemePreviewPalette;
  split?: ThemePreviewPalette;
  label: string;
  selected?: boolean;
  dashed?: boolean;
}>();

defineEmits<{ select: [] }>();
</script>

<template>
  <button type="button" class="group flex flex-col gap-2 text-left" :aria-pressed="selected" @click="$emit('select')">
    <span
      class="relative block aspect-[16/10] w-full overflow-hidden rounded-xl border-2 transition-colors motion-reduce:transition-none"
      :class="[
        selected ? 'border-accent' : 'border-hairline group-hover:border-gray-500',
        dashed ? 'border-dashed' : '',
      ]"
    >
      <slot>
        <span class="absolute inset-0" aria-hidden="true">
          <span class="absolute inset-0" :style="{ background: palette.background }" />
          <span class="absolute inset-x-0 top-0 h-[18%]" :style="{ background: palette.header, borderBottom: `1px solid ${palette.line}` }" />
          <span
            class="absolute inset-x-[10%] bottom-[12%] top-[30%] rounded-md p-[6%]"
            :style="{ background: palette.surface, border: `1px solid ${palette.line}` }"
          >
            <span class="block h-[14%] w-3/4 rounded-full opacity-90" :style="{ background: palette.ink }" />
            <span class="mt-[6%] block h-[11%] w-1/2 rounded-full opacity-45" :style="{ background: palette.ink }" />
            <span class="mt-[10%] block h-[22%] w-[38%] rounded-md" :style="{ background: palette.accent }" />
          </span>
        </span>
        <span
          v-if="split"
          class="absolute inset-0"
          style="clip-path: polygon(100% 0, 100% 100%, 0 100%)"
          aria-hidden="true"
        >
          <span class="absolute inset-0" :style="{ background: split.background }" />
          <span class="absolute inset-x-0 top-0 h-[18%]" :style="{ background: split.header }" />
          <span
            class="absolute inset-x-[10%] bottom-[12%] top-[30%] rounded-md p-[6%]"
            :style="{ background: split.surface, border: `1px solid ${split.line}` }"
          >
            <span class="block h-[14%] w-3/4 rounded-full opacity-90" :style="{ background: split.ink }" />
            <span class="mt-[6%] block h-[11%] w-1/2 rounded-full opacity-45" :style="{ background: split.ink }" />
            <span class="mt-[10%] block h-[22%] w-[38%] rounded-md" :style="{ background: split.accent }" />
          </span>
        </span>
      </slot>
      <span
        v-if="selected"
        class="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-accent text-on-accent shadow"
        aria-hidden="true"
      >
        <UiBaseIcon :path="mdiCheck" size="14" />
      </span>
    </span>
    <span class="text-sm" :class="selected ? 'font-medium text-white' : 'text-gray-300 group-hover:text-white'">
      {{ label }}
    </span>
  </button>
</template>
