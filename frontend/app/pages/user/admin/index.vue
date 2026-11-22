<script setup lang="ts">
import { preferredLocalePath } from '~/middleware/locale-preference';

definePageMeta({
  robots: false,
  middleware: defineNuxtRouteMiddleware(() => {
    return navigateTo(preferredLocalePath('/admin'), { replace: true, redirectCode: 301 });
  }),
});
</script>

<template>
  <div />
</template>
