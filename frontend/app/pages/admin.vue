<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  robots: false,
  middleware: ['auth', 'locale-preference', 'require-admin'],
});
</script>

<template>
  <NuxtPage />
</template>
