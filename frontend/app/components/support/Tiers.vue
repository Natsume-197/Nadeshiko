<script setup lang="ts">
import { mdiCheck, mdiCheckCircleOutline, mdiLinkVariant, mdiPatreon, mdiPlus } from '@mdi/js';
import { handleApiError } from '~/utils/apiError';
import {
  FREE_MONTHLY_API_REQUESTS,
  SUPPORT_TIERS,
  tierCheckoutUrl,
  type SupportTier,
} from '~/utils/supportTiers';

/**
 * The support tab of the Supporters page (`/supporters#support`):
 * 1. Three clean, subgrid-aligned Patreon tier cards + supporter status / link strip
 * 2. Note from the dev (DevNote)
 * 3. Limits, free next to each tier (LimitsTable)
 * 4. FAQ accordion
 * The perks bento (SharedPerks) sits above this section, on the page.
 */

const { t } = useI18n();
const { formatNumber, formatUsdWhole } = useFormat();
const localePath = useLocalePath();
const store = userStore();
const sdk = useNadeshikoSdk();
const { openLoginModal } = useLoginModal();

/** The signed-in reader's quota; null when signed out or the lookup failed. */
const quota = ref<{ tierId: string | null; limit: number | null } | null>(null);

const activeSupportTier = computed<SupportTier | null>(
  () => SUPPORT_TIERS.find((tier) => tier.quotaTierId === quota.value?.tierId) ?? null,
);

const isActiveTier = (tier: SupportTier) => activeSupportTier.value?.quotaTierId === tier.quotaTierId;

async function loadAccountTier() {
  if (!store.isLoggedIn) {
    quota.value = null;
    return;
  }
  const me = await sdk.getMe().catch((error: unknown) => {
    // Non-critical enhancement; the public tier cards still work without account status.
    handleApiError('support:quota-fetch-failed', error, { toastKey: false });
    return null;
  });
  if (me) quota.value = { tierId: me.quota?.tier?.id ?? null, limit: me.quota?.limit ?? null };
}

onMounted(loadAccountTier);
watch(() => store.isLoggedIn, loadAccountTier);

const tierName = (tier: SupportTier) => t(`support.tiers.${tier.key}`);

/** Each tier's own colour: a seed sprouts green, a flower blooms pink, the top tier wears the brand. */
const TIER_ACCENTS: Record<SupportTier['key'], { bar: string; kanji: string; check: string; watermark: string }> = {
  seed: {
    bar: 'from-emerald-500/80 to-emerald-300/40',
    kanji: 'text-emerald-400',
    check: 'text-emerald-400',
    watermark: 'text-emerald-400/[0.06]',
  },
  flower: {
    bar: 'from-pink-500/80 to-pink-300/40',
    kanji: 'text-pink-400',
    check: 'text-pink-400',
    watermark: 'text-pink-400/[0.06]',
  },
  nadeshiko: {
    bar: 'from-brand-solid to-brand/40',
    kanji: 'text-brand',
    check: 'text-brand',
    watermark: 'text-brand/[0.07]',
  },
};
const accent = (tier: SupportTier) => TIER_ACCENTS[tier.key];

/** The Discord mark, as the footer draws it (`@mdi/js` has none). */
const DISCORD_PATH =
  'M216.856339,16.5966031 C200.285002,8.84328665 182.566144,3.2084988 164.041564,0 C161.766523,4.11318106 159.108624,9.64549908 157.276099,14.0464379 C137.583995,11.0849896 118.072967,11.0849896 98.7430163,14.0464379 C96.9108417,9.64549908 94.1925838,4.11318106 91.8971895,0 C73.3526068,3.2084988 55.6133949,8.86399117 39.0420583,16.6376612 C5.61752293,67.146514 -3.4433191,116.400813 1.08711069,164.955721 C23.2560196,181.510915 44.7403634,191.567697 65.8621325,198.148576 C71.0772151,190.971126 75.7283628,183.341335 79.7352139,175.300261 C72.104019,172.400575 64.7949724,168.822202 57.8887866,164.667963 C59.7209612,163.310589 61.5131304,161.891452 63.2445898,160.431257 C105.36741,180.133187 151.134928,180.133187 192.754523,160.431257 C194.506336,161.891452 196.298154,163.310589 198.110326,164.667963 C191.183787,168.842556 183.854737,172.420929 176.223542,175.320965 C180.230393,183.341335 184.861538,190.991831 190.096624,198.16893 C211.238746,191.588051 232.743023,181.531619 254.911949,164.955721 C260.227747,108.668201 245.831087,59.8662432 216.856339,16.5966031 Z M85.4738752,135.09489 C72.8290281,135.09489 62.4592217,123.290155 62.4592217,108.914901 C62.4592217,94.5396472 72.607595,82.7145587 85.4738752,82.7145587 C98.3405064,82.7145587 108.709962,94.5189427 108.488529,108.914901 C108.508531,123.290155 98.3405064,135.09489 85.4738752,135.09489 Z M170.525237,135.09489 C157.88039,135.09489 147.510584,123.290155 147.510584,108.914901 C147.510584,94.5396472 157.658606,82.7145587 170.525237,82.7145587 C183.391518,82.7145587 193.761324,94.5189427 193.539891,108.914901 C193.539891,123.290155 183.391518,135.09489 170.525237,135.09489 Z';

/** What each tier gives, as its card lists it. */
function perks(tier: SupportTier, index: number): string[] {
  const previous = index > 0 ? SUPPORT_TIERS[index - 1] : undefined;
  // The top tier lists what it adds to the one below, as the Patreon page does.
  if (tier.priorityRequests && previous) {
    return [
      t('support.perks.everythingIn', { tier: tierName(previous) }),
      t('support.perks.requestBoosts', { count: tier.requestBoostsPerMonth }),
      t('support.perks.apiRequests', { count: formatNumber(tier.monthlyApiRequests) }),
    ];
  }
  return [
    t('support.perks.requestBoosts', { count: tier.requestBoostsPerMonth }),
    ...(tier.talkToDevs ? [t('support.perks.talkToDevs')] : []),
    t('support.perks.apiRequests', { count: formatNumber(tier.monthlyApiRequests) }),
  ];
}

const faq = computed(() => [
  {
    key: 'cancel',
    q: t('support.faq.cancel.q'),
    a: t('support.faq.cancel.a', { count: formatNumber(FREE_MONTHLY_API_REQUESTS) }),
  },
  { key: 'personal', q: t('support.faq.personal.q'), a: t('support.faq.personal.a') },
  { key: 'apps', q: t('support.faq.apps.q'), a: null },
  { key: 'oneAccount', q: t('support.faq.oneAccount.q'), a: t('support.faq.oneAccount.a') },
]);
</script>

<template>
  <section
    id="support"
    class="scroll-mt-20 space-y-16 text-ink"
    aria-labelledby="support-title"
    data-testid="support-section"
  >
    <!-- 1. Tier Cards + Status / Linking Strip -->
    <div>
      <!-- biome-ignore lint/a11y/noHeaderScope: vue-i18n scope, not a table header -->
      <i18n-t id="support-title" keypath="support.tiersHeadline" tag="h2" scope="global" class="text-center text-2xl font-black tracking-tight text-ink md:text-3xl">
        <template #accent>
          <span class="text-brand">{{ t('support.tiersHeadlineAccent') }}</span>
        </template>
      </i18n-t>
      <p class="mt-3 text-center text-sm text-ink-muted">{{ t('support.tiersIntro') }}</p>

      <div
        v-if="activeSupportTier"
        data-testid="support-active-banner"
        class="mt-6 flex flex-col gap-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="flex items-start gap-3">
          <UiBaseIcon :path="mdiCheckCircleOutline" :size="20" class="mt-0.5 shrink-0 text-emerald-400" />
          <div>
            <p class="text-sm font-semibold text-ink">
              {{ t('support.activeBanner.title', { tier: tierName(activeSupportTier) }) }}
            </p>
            <p v-if="quota?.limit" class="mt-0.5 text-xs text-ink-muted">
              {{ t('support.activeBanner.quota', { limit: formatNumber(quota.limit) }) }}
            </p>
          </div>
        </div>
        <NuxtLink
          :to="localePath('/user/connections')"
          class="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface-lift px-3.5 text-xs font-semibold text-ink transition-colors hover:border-brand/50 hover:bg-surface-hover"
        >
          {{ t('support.activeBanner.manage') }}
        </NuxtLink>
      </div>

      <!-- Tiers: 4 aligned internal sections via CSS subgrid on lg+. -->
      <ul class="tier-cards-grid mt-7 grid gap-5 lg:grid-cols-3" data-testid="support-tier-cards">
        <li
          v-for="(tier, index) in SUPPORT_TIERS"
          :key="tier.key"
          class="tier-card relative flex flex-col rounded-2xl border p-6 transition duration-200 hover:-translate-y-1"
          :class="
            isActiveTier(tier)
              ? 'border-emerald-500/50 bg-card-background ring-1 ring-emerald-500/25'
              : 'border-hairline bg-card-background hover:border-ink-faint/40 hover:shadow-xl hover:shadow-black/20'
          "
        >
          <!-- Decoration, clipped to the card so the badges above can still overflow it. -->
          <div class="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl" aria-hidden="true">
            <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r" :class="accent(tier).bar" />
            <span
              lang="ja"
              class="absolute -right-3 -top-5 select-none text-[7.5rem] font-black leading-none"
              :class="accent(tier).watermark"
              >{{ tier.kanji }}</span
            >
          </div>
          <span
            v-if="isActiveTier(tier)"
            data-testid="support-current-tier-badge"
            class="absolute -top-2.5 right-6 z-10 rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
          >
            {{ t('support.currentTierBadge') }}
          </span>

          <!-- Row 1: Name, kanji, and clear price -->
          <div class="relative">
            <p class="text-lg font-bold tracking-tight text-ink">
              {{ tierName(tier) }} <span lang="ja" class="font-medium" :class="accent(tier).kanji">{{ tier.kanji }}</span>
            </p>

            <!-- biome-ignore lint/a11y/noHeaderScope: vue-i18n scope, not a table header -->
            <i18n-t keypath="support.perMonth" tag="p" scope="global" class="mt-2 flex items-baseline gap-1 text-sm font-medium text-ink-faint">
              <template #price>
                <span class="text-3xl font-black tracking-tight tabular-nums text-ink">{{ formatUsdWhole(tier.priceUsd) }}</span>
              </template>
            </i18n-t>
          </div>

          <!-- Row 2: One concise summary line + aligned hairline divider -->
          <p class="relative mt-4 border-b border-hairline pb-5 text-sm leading-relaxed text-ink-muted">
            {{ t(`support.tierText.${tier.key}`) }}
          </p>

          <!-- Row 3: Perks + Discord -->
          <div class="relative flex flex-1 flex-col pt-5">
            <p class="text-xs font-semibold uppercase tracking-wider text-ink-faint">{{ t('support.whatsIncluded') }}</p>
            <ul class="mt-3 space-y-2.5 text-sm text-ink">
              <li v-for="perk in perks(tier, index)" :key="perk" class="flex items-start gap-2.5">
                <UiBaseIcon
                  :path="mdiCheck"
                  :size="16"
                  class="mt-0.5 shrink-0"
                  :class="isActiveTier(tier) ? 'text-emerald-400' : accent(tier).check"
                />
                <span class="leading-snug">{{ perk }}</span>
              </li>
            </ul>
            <p class="mt-auto flex items-center gap-2 pt-5 text-xs text-ink-faint">
              <svg aria-hidden="true" viewBox="0 -25 260 260" class="h-4 w-4 shrink-0 fill-current">
                <path :d="DISCORD_PATH" />
              </svg>
              {{ t('support.discord') }}
            </p>
          </div>

          <!-- Row 4: Direct tier checkout CTA -->
          <div class="relative pt-6">
            <a
              :href="tierCheckoutUrl(tier)"
              target="_blank"
              rel="noopener"
              data-testid="support-patreon-link"
              class="inline-flex h-10 w-full items-center justify-center rounded-lg text-sm font-semibold transition"
              :class="
                tier.priorityRequests
                  ? 'bg-brand-solid text-on-accent hover:bg-brand-hover'
                  : 'border border-hairline bg-surface-lift text-ink hover:border-brand/50 hover:bg-surface-hover'
              "
            >
              {{ t('support.chooseTier', { tier: tierName(tier) }) }}
            </a>
          </div>
        </li>
      </ul>

      <!-- Already a patron? Link Patreon in Settings (hidden once already active) -->
      <div
        v-if="!activeSupportTier"
        data-testid="support-link-strip"
        class="mt-6 flex flex-col gap-3 rounded-xl border border-hairline bg-card-background px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="flex items-start gap-3">
          <UiBaseIcon :path="mdiPatreon" :size="20" class="mt-0.5 shrink-0 text-[#ff424d]" />
          <div>
            <p class="text-sm font-semibold text-ink">{{ t('support.linkStrip.title') }}</p>
            <p class="mt-0.5 text-xs text-ink-muted">
              {{ store.isLoggedIn ? t('support.linkStrip.loggedInBody') : t('support.linkStrip.loggedOutBody') }}
            </p>
          </div>
        </div>

        <NuxtLink
          v-if="store.isLoggedIn"
          data-testid="support-link-settings-cta"
          :to="localePath('/user/connections')"
          class="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-hairline bg-surface-lift px-3.5 text-xs font-semibold text-ink transition-colors hover:border-brand/50 hover:bg-surface-hover"
        >
          <UiBaseIcon :path="mdiLinkVariant" :size="15" />
          <span>{{ t('support.linkStrip.loggedInCta') }}</span>
        </NuxtLink>

        <button
          v-else
          type="button"
          data-testid="support-link-login-cta"
          class="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-hairline bg-surface-lift px-3.5 text-xs font-semibold text-ink transition-colors hover:border-brand/50 hover:bg-surface-hover"
          @click="openLoginModal()"
        >
          <UiBaseIcon :path="mdiLinkVariant" :size="15" />
          <span>{{ t('support.linkStrip.loggedOutCta') }}</span>
        </button>
      </div>
    </div>

    <!-- 2. Who is behind it, right after the price. -->
    <SupportDevNote />

    <!-- 3. Free next to each tier, for every limit a membership raises. -->
    <SupportLimitsTable :active-tier-key="activeSupportTier?.key ?? null" />

    <!-- 4. Questions: one rounded card per question, a + that turns into × when open. -->
    <div class="mx-auto max-w-3xl">
      <!-- biome-ignore lint/a11y/noHeaderScope: vue-i18n scope, not a table header -->
      <i18n-t keypath="support.faq.headline" tag="h2" scope="global" class="text-center text-2xl font-black tracking-tight text-ink md:text-3xl">
        <template #accent>
          <span class="text-brand">{{ t('support.faq.headlineAccent') }}</span>
        </template>
      </i18n-t>
      <div class="mt-6 space-y-2">
        <details
          v-for="item in faq"
          :key="item.key"
          class="group rounded-2xl bg-card-background transition-colors hover:bg-surface-hover open:hover:bg-card-background"
          :data-testid="`support-faq-${item.key}`"
        >
          <summary
            class="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[15px] font-medium text-ink md:px-6 [&::-webkit-details-marker]:hidden"
          >
            {{ item.q }}
            <span
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-lift text-ink-muted transition group-open:rotate-45"
            >
              <UiBaseIcon :path="mdiPlus" size="16" />
            </span>
          </summary>
          <div class="-mt-1 px-5 pb-5 text-sm leading-relaxed text-ink-muted md:px-6">
            <template v-if="item.a">{{ item.a }}</template>
            <!-- biome-ignore lint/a11y/noHeaderScope: vue-i18n scope, not a table header -->
            <i18n-t v-else keypath="support.faq.apps.a" tag="span" scope="global">
              <template #terms>
                <NuxtLink :to="localePath('/terms-and-conditions')" class="text-brand hover:underline">{{
                  t('support.faq.apps.terms')
                }}</NuxtLink>
              </template>
            </i18n-t>
          </div>
        </details>
      </div>
    </div>
  </section>
</template>

<style scoped>
@media (min-width: 1024px) {
  .tier-cards-grid {
    grid-template-rows: auto auto 1fr auto;
    row-gap: 0;
  }
  .tier-card {
    display: grid;
    grid-row: span 4;
    grid-template-rows: subgrid;
  }
}
</style>
