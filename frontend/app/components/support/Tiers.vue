<script setup lang="ts">
import { mdiChevronDown } from '@mdi/js';
import { PATREON_URL } from '#shared/utils/socialLinks';
import { FREE_MONTHLY_API_REQUESTS, SUPPORT_TIERS, type SupportTier } from '~/utils/supportTiers';

/**
 * The support section of the Supporters page (`/supporters#support`): the Patreon tiers and what each one gives back,
 * then the common questions. The roadmap follows it on the same page, since supporting is how readers shape it.
 *
 * Framed as support with thank-you extras, not a paid version of the site. The numbers come from `supportTiers`, the
 * same list the Developer settings hint reads, and the tier cards are worded as on Patreon.
 */

const { t, locale } = useI18n();
const { formatNumber } = useFormat();
const localePath = useLocalePath();

const usd = (amount: number) =>
  new Intl.NumberFormat(locale.value, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);

const tierName = (tier: SupportTier) => t(`support.tiers.${tier.key}`);

/** "$5 / month", in the locale's own order ("月額 $5"). */
const priceLine = (tier: SupportTier) => t('support.perMonth', { price: usd(tier.priceUsd) });

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
      t('support.perks.priority'),
      t('support.perks.apiRequests', { count: formatNumber(tier.monthlyApiRequests) }),
    ];
  }
  return [
    t('support.perks.titleRequests', { count: tier.titleRequestsPerMonth }),
    ...(tier.talkToDevs ? [t('support.perks.talkToDevs')] : []),
    t('support.perks.apiRequests', { count: formatNumber(tier.monthlyApiRequests) }),
    t('support.perks.customThemes'),
  ];
}

const faq = computed(() => [
  { key: 'cancel', q: t('support.faq.cancel.q'), a: t('support.faq.cancel.a', { count: formatNumber(FREE_MONTHLY_API_REQUESTS) }) },
  { key: 'personal', q: t('support.faq.personal.q'), a: t('support.faq.personal.a') },
  { key: 'apps', q: t('support.faq.apps.q'), a: null },
  { key: 'oneAccount', q: t('support.faq.oneAccount.q'), a: t('support.faq.oneAccount.a') },
]);
</script>

<template>
  <section id="support" class="scroll-mt-20 text-white" aria-labelledby="support-title" data-testid="support-section">
    <h2 id="support-title" class="text-center text-3xl font-black tracking-tight md:text-4xl">{{ t('support.title') }}</h2>
    <p class="mt-3 text-center text-sm text-gray-400">{{ t('support.tiersIntro') }}</p>

    <!-- Tiers: laid out like the tier cards on Patreon, with the same words. -->
    <ul class="mt-12 grid gap-5 lg:grid-cols-3" data-testid="support-tier-cards">
      <li
        v-for="(tier, index) in SUPPORT_TIERS"
        :key="tier.key"
        class="relative flex flex-col rounded-xl bg-[#231c1c] p-6 ring-1 transition hover:ring-brand/40"
        :class="tier.priorityRequests ? 'ring-brand/50' : 'ring-white/[0.06]'"
      >
        <span
          v-if="tier.priorityRequests"
          class="absolute -top-2.5 right-6 rounded-full bg-brand-solid px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-on-accent"
          >{{ t('support.everythingBadge') }}</span
        >
        <p class="text-lg font-bold">
          {{ tierName(tier) }} <span lang="ja">{{ tier.kanji }}</span>
        </p>
        <p class="mt-0.5 text-gray-400">{{ priceLine(tier) }}</p>

        <div class="mt-5 space-y-4 text-[15px] leading-relaxed text-gray-200">
          <p>{{ t(`support.tierText.${tier.key}.0`) }}</p>
          <p>{{ t(`support.tierText.${tier.key}.1`) }}</p>
        </div>

        <div class="my-6 h-px bg-white/10" />

        <p class="text-sm font-bold">{{ t('support.whatsIncluded') }}</p>
        <ul class="mt-3 flex-1 space-y-2.5 text-[15px] text-gray-200">
          <li v-for="perk in perks(tier, index)" :key="perk" class="flex gap-3">
            <span aria-hidden="true" class="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" />{{ perk }}
          </li>
        </ul>
        <p class="mt-4 flex items-center gap-2 text-[15px] text-gray-400">
          <svg aria-hidden="true" viewBox="0 -25 260 260" class="h-[18px] w-[18px] shrink-0 fill-current"><path :d="DISCORD_PATH" /></svg>{{ t('support.discord') }}
        </p>

        <a
          :href="PATREON_URL"
          target="_blank"
          rel="noopener"
          data-testid="support-patreon-link"
          class="mt-7 inline-flex h-10 items-center justify-center rounded-lg text-sm font-semibold transition"
          :class="
            tier.priorityRequests
              ? 'bg-brand-solid text-on-accent hover:bg-brand-hover'
              : 'bg-white/[0.06] text-gray-100 hover:bg-white/10'
          "
        >
          {{ t('support.chooseTier', { tier: tierName(tier) }) }}
        </a>
      </li>
    </ul>

    <!-- Questions -->
    <div class="mx-auto mt-24 max-w-3xl">
      <h3 class="text-center text-2xl font-bold tracking-tight">{{ t('support.faq.title') }}</h3>
      <!-- One card per question, in the tier cards' colours. -->
      <div class="mt-8 space-y-3">
        <details
          v-for="item in faq"
          :key="item.key"
          class="group rounded-xl bg-[#231c1c] ring-1 ring-white/[0.06] transition hover:ring-white/15 open:ring-brand/40"
          :data-testid="`support-faq-${item.key}`"
        >
          <summary
            class="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 text-[15px] font-semibold [&::-webkit-details-marker]:hidden"
          >
            {{ item.q }}
            <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] transition group-open:rotate-180 group-open:bg-brand/20">
              <UiBaseIcon :path="mdiChevronDown" size="18" class="text-gray-400 group-open:text-brand" />
            </span>
          </summary>
          <div class="px-6 pb-6 text-[15px] leading-relaxed text-gray-300">
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
