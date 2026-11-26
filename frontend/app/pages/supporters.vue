<script setup lang="ts">
import { DEFAULT_OG_IMAGE_PATH } from '~/utils/metaTags';

const { t } = useI18n();

useSeoMeta({
  title: () => t('supporters.seoTitle'),
  description: () => t('supporters.seoDescription'),
  ogTitle: () => t('supporters.seoTitle'),
  ogDescription: () => t('supporters.seoDescription'),
  ogImage: `${useRequestURL().origin}${DEFAULT_OG_IMAGE_PATH}`,
  twitterCard: 'summary_large_image',
});
</script>

<template>
  <div class="supporters-page pb-28 text-ink">
    <SupportHero />

    <main class="mx-auto max-w-5xl space-y-28 px-4 md:space-y-36">
      <!-- What you get comes before the price. -->
      <SupportSharedPerks />
      <SupportTiers />
    </main>
  </div>
</template>

<style scoped>
/* Bands reach past the content column to the window's edges; the root clips the scrollbar's few pixels. */
.supporters-page {
  overflow-x: clip;
}
.supporters-page :deep(.supporters-band) {
  margin-inline: calc(50% - 50vw);
  padding: 5.5rem calc(50vw - 50%);
}
/* A hint of the brand over the page, for the perks. */
.supporters-page :deep(.supporters-band-soft) {
  background: color-mix(in srgb, var(--accent) 6%, var(--background));
}

/*
 * Blocks marked `data-reveal` fade up as they scroll into view, driven by the scroll itself (no JavaScript).
 * Browsers without scroll timelines, reduced motion and the site's motion settings all get the page as is.
 */
@media (prefers-reduced-motion: no-preference) {
  @supports (animation-timeline: view()) {
    :root:not([data-motion='none']):not([data-motion='reduced']) .supporters-page :deep([data-reveal]) {
      animation: supporters-reveal linear both;
      animation-timeline: view();
      animation-range: entry 0% entry calc(60% + var(--reveal-step, 0) * 12%);
    }
  }
}
@keyframes supporters-reveal {
  from {
    opacity: 0;
    transform: translateY(1.5rem);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
