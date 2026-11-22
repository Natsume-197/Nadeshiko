<script setup lang="ts">
import { preferredLocalePath } from '~/middleware/locale-preference';
import { splitLocalePrefix } from '~/utils/routes';

definePageMeta({
  robots: false,
  middleware: defineNuxtRouteMiddleware((to) => {
    const { localizedPath } = splitLocalePrefix(to.path);
    const targetPath = preferredLocalePath(localizedPath.replace(/^\/user\/admin/, '/admin'));

    return navigateTo(targetPath || useLocalePath()('/admin'), { replace: true, redirectCode: 301 });
  }),
});
</script>

<template>
  <div />
</template>
