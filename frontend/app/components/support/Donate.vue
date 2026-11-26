<script setup lang="ts">
import { mdiGithub, mdiHandHeart, mdiHeart } from '@mdi/js';
import { GITHUB_SPONSORS_URL, KOFI_URL } from '#shared/utils/socialLinks';
import { KOFI_ICON_PATH } from '~/utils/donationIcons';

/**
 * Donations without perks, under the tiers: Ko-fi and GitHub Sponsors. A button shows only once its link is set in
 * socialLinks.ts, and the whole card hides while neither is.
 */
const props = withDefaults(defineProps<{ kofiUrl?: string; githubSponsorsUrl?: string }>(), {
  kofiUrl: KOFI_URL,
  githubSponsorsUrl: GITHUB_SPONSORS_URL,
});

const { t } = useI18n();

const links = computed(() =>
  [
    { key: 'kofi', url: props.kofiUrl, label: 'Ko-fi', icon: KOFI_ICON_PATH, color: '#ff5e5b' },
    { key: 'github', url: props.githubSponsorsUrl, label: 'GitHub Sponsors', icon: mdiGithub, color: '' },
  ].filter((link) => link.url),
);
</script>

<template>
  <div
    v-if="links.length"
    class="mx-auto flex max-w-4xl flex-col gap-5 rounded-[1.5rem] bg-card-background p-6 md:flex-row md:items-center md:gap-6 md:p-7"
    data-reveal
    data-testid="support-donate"
  >
    <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand/15 text-brand" aria-hidden="true">
      <UiBaseIcon :path="mdiHandHeart" :size="24" />
    </span>
    <div class="min-w-0 flex-1">
      <h2 class="text-xl font-bold tracking-tight text-ink">{{ t('support.donate.title') }}</h2>
      <p class="mt-1 text-[15px] leading-relaxed text-ink-muted">{{ t('support.donate.body') }}</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <a
        v-for="link in links"
        :key="link.key"
        :href="link.url"
        target="_blank"
        rel="noopener"
        class="inline-flex h-12 items-center gap-2 rounded-full bg-surface-lift px-5 text-[15px] font-semibold text-ink transition-colors hover:bg-surface-hover"
        :data-testid="`support-donate-${link.key}`"
      >
        <UiBaseIcon :path="link.icon" :size="20" :style="link.color ? { color: link.color } : undefined" />
        {{ link.label }}
        <UiBaseIcon v-if="link.key === 'github'" :path="mdiHeart" :size="14" class="text-[#db61a2]" />
      </a>
    </div>
  </div>
</template>
