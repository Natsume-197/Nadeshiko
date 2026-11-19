<script setup lang="ts">
import DictionarySettings from '~/components/user/DictionarySettings.vue';

// The backend sends `customDictionaries: null` while USER_DICTIONARIES_ENABLED is off. The tab is hidden then, and a
// direct visit goes back to the settings tab instead of showing a load error.
const store = userStore();
const localePath = useLocalePath();
if (store.isLoggedIn && !store.customDictionariesAvailable) {
  await navigateTo(localePath('/user/settings'), { replace: true });
}
</script>

<template>
  <DictionarySettings />
</template>
