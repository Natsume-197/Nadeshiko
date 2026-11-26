<script setup lang="ts">
/** The Supporters page's note from the dev, shown right after the tiers. */
const { t } = useI18n();
</script>

<template>
  <div class="mx-auto max-w-2xl border-t border-hairline pt-12 text-center" data-testid="supporters-note">
    <h2 class="text-xl font-black tracking-tight text-ink md:text-2xl">{{ t('supporters.note.title') }}</h2>
    <p class="mt-4 text-[15px] leading-relaxed text-ink-muted">{{ t('supporters.note.body') }}</p>
    <p class="mt-5 text-xs font-semibold uppercase tracking-wider text-ink-faint">{{ t('supporters.note.eyebrow') }}</p>
  </div>
</template>
