<script setup lang="ts">
/**
 * A handwritten "Try it!" with a drawn arrow, next to something on the Supporters page the reader can play with.
 * `pointing` is where the arrow ends, seen from the text.
 */
withDefaults(defineProps<{ pointing?: 'left' | 'right' | 'down' }>(), { pointing: 'left' });

const { t } = useI18n();
</script>

<template>
  <span class="try-it inline-flex items-center gap-1 text-brand" :class="`is-${pointing}`" aria-hidden="true">
    <svg aria-hidden="true" v-if="pointing === 'left'" viewBox="0 0 56 32" class="h-6 w-11 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M53 6 C 40 2, 22 6, 8 22" />
      <path d="M6 12 L 7 23 L 18 22" />
    </svg>
    <span class="try-it-text">{{ t('support.shared.tryIt') }}</span>
    <svg aria-hidden="true" v-if="pointing === 'right'" viewBox="0 0 56 32" class="h-6 w-11 shrink-0 -scale-x-100" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M53 6 C 40 2, 22 6, 8 22" />
      <path d="M6 12 L 7 23 L 18 22" />
    </svg>
    <svg aria-hidden="true" v-if="pointing === 'down'" viewBox="0 0 32 48" class="h-9 w-6 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 3 C 22 10, 24 26, 14 42" />
      <path d="M6 34 L 13 43 L 22 36" />
    </svg>
  </span>
</template>

<style scoped>
@font-face {
  font-family: 'Nadeshiko Hand';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('/fonts/caveat-600-latin.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+2000-206F;
}
.try-it-text {
  font-family: 'Nadeshiko Hand', 'Klee One', 'Yu Gothic', cursive;
  font-size: 1.375rem;
  font-weight: 600;
  line-height: 1;
  transform: rotate(-6deg);
  white-space: nowrap;
}
</style>
