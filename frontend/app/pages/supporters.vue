<script setup lang="ts">
import { mdiArrowDown } from '@mdi/js';
import { DEFAULT_OG_IMAGE_PATH } from '~/utils/metaTags';
import { SUPPORT_TIERS } from '~/utils/supportTiers';

const { t } = useI18n();
const { formatUsdWhole } = useFormat();

useSeoMeta({
  title: () => t('supporters.seoTitle'),
  description: () => t('supporters.seoDescription'),
  ogTitle: () => t('supporters.seoTitle'),
  ogDescription: () => t('supporters.seoDescription'),
  ogImage: `${useRequestURL().origin}${DEFAULT_OG_IMAGE_PATH}`,
  twitterCard: 'summary_large_image',
});

const lowestPrice = Math.min(...SUPPORT_TIERS.map((tier) => tier.priceUsd));
</script>

<template>
  <div class="pb-20 text-ink">
    <!-- Hook: headline, the starting price and one way down to the tiers. -->
    <section class="nd-page-narrow px-4 pb-14 pt-10 text-center md:px-0 md:pt-14">
      <!-- biome-ignore lint/a11y/noHeaderScope: vue-i18n scope, not a table header -->
      <i18n-t keypath="supporters.headline" tag="h1" scope="global" class="mx-auto max-w-3xl text-3xl font-black leading-[1.1] tracking-tight text-ink md:text-[2.75rem]">
        <template #accent>
          <span class="text-brand">{{ t('supporters.headlineAccent') }}</span>
        </template>
      </i18n-t>
      <p class="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-ink-muted md:text-base">
        {{ t('supporters.intro') }}
      </p>
      <div class="mt-7 flex flex-wrap items-center justify-center gap-3">
        <span class="text-sm text-ink-muted">{{ t('supporters.fromPrice', { price: formatUsdWhole(lowestPrice) }) }}</span>
        <a
          href="#support"
          data-testid="supporters-see-tiers"
          class="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand-solid px-5 text-sm font-semibold text-on-accent transition-colors hover:bg-brand-hover"
        >
          {{ t('supporters.seeTiers') }} <UiBaseIcon :path="mdiArrowDown" size="16" />
        </a>
      </div>
    </section>

    <main class="nd-page-narrow space-y-20 px-4 md:px-0">
      <!-- What you get comes before the price. -->
      <SupportSharedPerks />
      <SupportTiers />
    </main>
  </div>
</template>
