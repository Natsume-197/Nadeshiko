<script setup lang="ts">
import { mdiApi, mdiBellOutline, mdiBookOpenPageVariantOutline, mdiChartBar, mdiRocketLaunchOutline, mdiThumbUpOutline } from '@mdi/js';
import { FREE_MONTHLY_API_REQUESTS, PATRON_LIMITS, SUPPORT_TIERS, type SupportTier } from '~/utils/supportTiers';

/**
 * Free next to each tier for every limit that changes with a membership. All numbers come from utils/supportTiers.ts,
 * so the table cannot drift from the cards above it.
 */
const props = defineProps<{ activeTierKey?: SupportTier['key'] | null }>();

const { t } = useI18n();
const { formatNumber } = useFormat();

/** The same kanji tiles as the tier cards above. */
const TIER_TILE: Record<SupportTier['key'], string> = {
  seed: 'bg-emerald-500/15 text-emerald-500',
  flower: 'bg-pink-500/15 text-pink-500',
  nadeshiko: 'bg-brand/15 text-brand',
};

const rows = computed(() => [
  {
    key: 'api',
    icon: mdiApi,
    label: t('support.limits.api'),
    free: formatNumber(FREE_MONTHLY_API_REQUESTS),
    tiers: SUPPORT_TIERS.map((tier) => formatNumber(tier.monthlyApiRequests)),
    shared: null as string | null,
  },
  {
    key: 'boosts',
    icon: mdiRocketLaunchOutline,
    label: t('support.limits.boosts'),
    free: '—',
    tiers: SUPPORT_TIERS.map((tier) => formatNumber(tier.requestBoostsPerMonth)),
    shared: null as string | null,
  },
  {
    key: 'dictionaries',
    icon: mdiBookOpenPageVariantOutline,
    label: t('support.shared.dictionaries'),
    free: formatNumber(PATRON_LIMITS.customDictionaries.free),
    tiers: null as string[] | null,
    shared: formatNumber(PATRON_LIMITS.customDictionaries.patron),
  },
  {
    key: 'openRequests',
    icon: mdiThumbUpOutline,
    label: t('support.shared.openRequests'),
    free: formatNumber(PATRON_LIMITS.openRequests.free),
    tiers: null as string[] | null,
    shared: formatNumber(PATRON_LIMITS.openRequests.patron),
  },
  {
    key: 'wordAlerts',
    icon: mdiBellOutline,
    label: t('support.limits.wordAlerts'),
    free: formatNumber(PATRON_LIMITS.wordAlerts.free),
    tiers: null as string[] | null,
    shared: formatNumber(PATRON_LIMITS.wordAlerts.patron),
  },
]);

const isActive = (tier: SupportTier) => props.activeTierKey === tier.key;
</script>

<template>
  <div class="mx-auto max-w-4xl overflow-hidden rounded-[1.5rem] bg-card-background" data-testid="support-limits" data-reveal>
    <div class="flex items-center gap-3 border-b border-hairline px-5 py-5 md:px-7">
      <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/15 text-brand">
        <UiBaseIcon :path="mdiChartBar" :size="18" />
      </span>
      <!-- biome-ignore lint/a11y/noHeaderScope: vue-i18n scope, not a table header -->
      <i18n-t keypath="support.limits.headline" tag="h2" scope="global" class="text-xl font-bold tracking-tight text-ink">
        <template #accent>{{ t('support.limits.headlineAccent') }}</template>
      </i18n-t>
    </div>

    <div class="overflow-x-auto px-3 pb-3 sm:px-5 md:px-7">
      <table class="w-full text-sm">
        <thead>
          <tr>
            <th class="py-4 text-left" scope="col">
              <span class="sr-only">{{ t('support.limits.headline', { accent: t('support.limits.headlineAccent') }) }}</span>
            </th>
            <th class="w-12 py-4 text-center align-bottom text-xs font-semibold text-ink-faint sm:w-20" scope="col">{{ t('support.limits.free') }}</th>
            <th v-for="tier in SUPPORT_TIERS" :key="tier.key" class="w-14 py-4 text-center align-bottom sm:w-24" scope="col">
              <span
                lang="ja"
                class="mx-auto flex h-8 w-8 items-center justify-center rounded-xl font-black sm:h-9 sm:w-9"
                :class="[TIER_TILE[tier.key], tier.kanji.length > 1 ? 'text-xs' : 'text-sm']"
                aria-hidden="true"
                >{{ tier.kanji }}</span
              >
              <span class="sr-only mt-1.5 text-xs font-semibold sm:not-sr-only sm:block" :class="isActive(tier) ? 'text-emerald-500' : 'text-ink'">{{
                t(`support.tiers.${tier.key}`)
              }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.key" class="border-t border-hairline" :data-testid="`support-limits-${row.key}`">
            <th class="py-3.5 pr-2 text-left text-[13px] font-normal text-ink sm:pr-4 sm:text-sm" scope="row">
              <span class="flex items-center gap-3">
                <UiBaseIcon :path="row.icon" :size="18" class="hidden shrink-0 text-ink-faint sm:block" />
                {{ row.label }}
              </span>
            </th>
            <td class="py-3.5 text-center text-[13px] tabular-nums text-ink-faint sm:text-sm">{{ row.free }}</td>
            <td v-if="row.shared !== null" :colspan="SUPPORT_TIERS.length" class="px-1.5 py-2.5 text-center sm:px-2">
              <div
                class="mx-auto flex items-center justify-center gap-2 rounded-full border border-hairline bg-surface-lift/70 px-3 py-1"
              >
                <span
                  class="text-sm font-bold tabular-nums sm:text-base"
                  :class="props.activeTierKey ? 'text-emerald-500' : 'text-ink'"
                  >{{ row.shared }}</span
                >
                <span class="text-xs text-ink-faint">{{ t('support.limits.allPaidTiers') }}</span>
              </div>
            </td>
            <template v-else>
              <td
                v-for="(value, i) in row.tiers"
                :key="SUPPORT_TIERS[i]?.key"
                class="py-3.5 text-center text-sm font-bold tabular-nums sm:text-base"
                :class="SUPPORT_TIERS[i] && isActive(SUPPORT_TIERS[i]) ? 'text-emerald-500' : 'text-ink'"
              >
                {{ value }}
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
