<script setup lang="ts">
import DictionaryPreferencesCard from '~/components/user/DictionaryPreferencesCard.vue';
import DictionarySettings from '~/components/user/DictionarySettings.vue';

const store = userStore();
</script>

<template>
  <DictionarySettings v-if="store.customDictionariesAvailable" />
  <DictionaryPreferencesCard />
</template>
