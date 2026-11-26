<script setup lang="ts">
import { FREE_MONTHLY_API_REQUESTS, PATRON_LIMITS, SUPPORT_TIERS, type SupportTier } from '~/utils/supportTiers';

/**
 * Free next to each tier for every limit that changes with a membership. All numbers come from utils/supportTiers.ts,
 * so the table cannot drift from the cards above it.
 */
const props = defineProps<{ activeTierKey?: SupportTier['key'] | null }>();

const { t } = useI18n();
const { formatNumber } = useFormat();

const TIER_TEXT: Record<SupportTier['key'], string> = {
  seed: 'text-emerald-400',
  flower: 'text-pink-400',
  nadeshiko: 'text-brand',
};

const rows = computed(() => [
  {
    key: 'api',
    label: t('support.limits.api'),
    free: formatNumber(FREE_MONTHLY_API_REQUESTS),
    tiers: SUPPORT_TIERS.map((tier) => formatNumber(tier.monthlyApiRequests)),
  },
  {
    key: 'boosts',
    label: t('support.limits.boosts'),
    free: '—',
    tiers: SUPPORT_TIERS.map((tier) => formatNumber(tier.requestBoostsPerMonth)),
  },
  {
    key: 'dictionaries',
    label: t('support.shared.dictionaries'),
    free: formatNumber(PATRON_LIMITS.customDictionaries.free),
    tiers: SUPPORT_TIERS.map(() => formatNumber(PATRON_LIMITS.customDictionaries.patron)),
  },
  {
    key: 'openRequests',
    label: t('support.shared.openRequests'),
    free: formatNumber(PATRON_LIMITS.openRequests.free),
    tiers: SUPPORT_TIERS.map(() => formatNumber(PATRON_LIMITS.openRequests.patron)),
  },
]);

const isActive = (tier: SupportTier) => props.activeTierKey === tier.key;
</script>

<template>
  <div data-testid="support-limits">
    <!-- biome-ignore lint/a11y/noHeaderScope: vue-i18n scope, not a table header -->
    <i18n-t keypath="support.limits.headline" tag="h2" scope="global" class="text-center text-2xl font-black tracking-tight text-ink md:text-3xl">
      <template #accent>
        <span class="text-brand">{{ t('support.limits.headlineAccent') }}</span>
      </template>
    </i18n-t>

    <div class="mx-auto mt-6 max-w-3xl overflow-x-auto rounded-2xl bg-card-background px-4 py-2 md:px-6">
      <table class="w-full min-w-[30rem] text-sm">
        <thead>
          <tr class="border-b border-hairline">
            <th class="py-3 text-left font-medium text-ink-faint" scope="col">
              <span class="sr-only">{{ t('support.limits.headline', { accent: t('support.limits.headlineAccent') }) }}</span>
            </th>
            <th class="py-3 text-right font-medium text-ink-faint" scope="col">{{ t('support.limits.free') }}</th>
            <th
              v-for="tier in SUPPORT_TIERS"
              :key="tier.key"
              class="py-3 text-right font-semibold"
              :class="TIER_TEXT[tier.key]"
              scope="col"
            >
              {{ t(`support.tiers.${tier.key}`) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.key" class="border-b border-hairline last:border-0" :data-testid="`support-limits-${row.key}`">
            <th class="py-3 pr-4 text-left font-normal text-ink" scope="row">{{ row.label }}</th>
            <td class="py-3 text-right tabular-nums text-ink-faint">{{ row.free }}</td>
            <td
              v-for="(value, i) in row.tiers"
              :key="SUPPORT_TIERS[i]?.key"
              class="py-3 pl-3 text-right font-semibold tabular-nums"
              :class="SUPPORT_TIERS[i] && isActive(SUPPORT_TIERS[i]) ? 'text-emerald-400' : 'text-ink'"
            >
              {{ value }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
