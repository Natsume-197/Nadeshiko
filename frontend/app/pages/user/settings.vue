<script setup lang="ts">
import GeneralSettings from '~/components/user/GeneralSettings.vue';

const route = useRoute();
const localePath = useLocalePath();

// Preserve old bookmarks and external links that pointed at `/user/settings#connections`
// before Patreon connections moved to `/user/connections`.
onMounted(() => {
  if (route.hash === '#connections') {
    void navigateTo(localePath('/user/connections'), { replace: true });
  }
});
</script>

<template>
  <GeneralSettings />
</template>
