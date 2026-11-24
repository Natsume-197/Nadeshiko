<script setup lang="ts">
import { mdiPatreon } from '@mdi/js';
import { PATREON_URL } from '#shared/utils/socialLinks';
import { DEFAULT_OG_IMAGE_PATH } from '~/utils/metaTags';

const { t } = useI18n();
const localePath = useLocalePath();

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
  <div class="-mt-3 pb-20 text-ink">
    <!-- Nadeshiko's Haruhi banner: crisp artwork with only a gentle left-side scrim for text legibility. -->
    <section
      class="relative flex min-h-[16rem] items-center overflow-hidden border-b border-hairline bg-[#161214] px-4 py-10 text-white md:min-h-[17.5rem] md:py-12"
    >
      <div class="supporters-banner-image absolute inset-0" aria-hidden="true" />
      <div class="absolute inset-0 bg-gradient-to-r from-black/55 via-black/20 to-transparent" aria-hidden="true" />
      <div class="nd-page relative">
        <h1 class="max-w-3xl text-4xl font-black leading-[1.04] tracking-tight text-white drop-shadow-sm md:text-5xl">
          {{ t('supporters.title') }}
        </h1>
        <p class="mt-4 max-w-xl text-base leading-relaxed text-white/90 drop-shadow-sm md:text-lg">
          {{ t('supporters.intro') }}
        </p>
        <div class="mt-6 flex flex-wrap gap-3">
          <a
            :href="PATREON_URL"
            target="_blank"
            rel="noopener"
            data-testid="supporters-hero-patreon-cta"
            class="inline-flex h-10 items-center gap-2 rounded-lg bg-[#ff424d] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#ff5962]"
          >
            <UiBaseIcon :path="mdiPatreon" size="18" /> {{ t('supporters.support') }}
          </a>
          <NuxtLink
            :to="localePath('/requests')"
            data-testid="supporters-requests-cta"
            class="inline-flex h-10 items-center justify-center rounded-lg border border-white/25 bg-white/10 px-5 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20"
          >
            {{ t('supporters.proposeCta') }}
          </NuxtLink>
        </div>
      </div>
    </section>

    <main class="nd-page px-4 pt-8 md:px-0">
      <SupportTiers />
    </main>
  </div>
</template>

<style scoped>
.supporters-banner-image {
  background-image: url('/assets/supporters-haruhi.webp');
  background-position: center 82%;
  background-size: cover;
  filter: brightness(82%);
  opacity: 0.78;
}
</style>
