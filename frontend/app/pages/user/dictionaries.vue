<script setup lang="ts">
import DictionaryPreferencesCard from '~/components/user/DictionaryPreferencesCard.vue';
import DictionarySettings from '~/components/user/DictionarySettings.vue';

const store = userStore();
</script>

<template>
  <DictionaryPreferencesCard />
  <DictionarySettings v-if="store.customDictionariesAvailable" />
</template>
