<script setup lang="ts">
import { computed } from 'vue';
import { markKanji } from '~/utils/kanjiLookup';

/**
 * `text` with every `kanji` in it set in the accent colour (食 in 食べる, 給食), as a kanji's page and card show the
 * kanji inside the words that use it. Bare text and spans, no wrapper, so it sits inside a ruby or a word's label;
 * the template is one line on purpose, since whitespace between the parts would show up inside the word.
 */
const props = defineProps<{ text: string; kanji: string }>();

const parts = computed(() => markKanji(props.text, props.kanji));
</script>

<template><template v-for="(part, index) in parts" :key="index"><span v-if="part.hit" class="marked-kanji__mark">{{ part.text }}</span><template v-else>{{ part.text }}</template></template></template>

<style scoped>
.marked-kanji__mark {
  color: var(--accent-soft);
}
</style>
