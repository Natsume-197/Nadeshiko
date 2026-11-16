<script setup lang="ts">
/**
 * The roadmap became a section of the Supporters page in 3.0.0. Old links and bookmarks land on that section, with a
 * permanent redirect so search engines move the page over.
 */
const localePath = useLocalePath();

await navigateTo(`${localePath('/supporters')}#roadmap`, { redirectCode: 301, replace: true });
</script>

<template>
  <div />
</template>
