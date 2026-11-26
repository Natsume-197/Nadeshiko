<script setup lang="ts">
import { mdiArrowDown } from '@mdi/js';
import { SUPPORT_TIERS } from '~/utils/supportTiers';

/**
 * The Supporters hook: headline and the starting price on the left, the real search on a phone on the right.
 * The phone steps through screenshots of the site in a few custom themes; the dots under it pick one and stop
 * the cycle. Reduced motion keeps it still.
 */

const { t } = useI18n();
const { formatUsdWhole } = useFormat();
const { prefersReducedMotion } = useMotionPreference();

const lowestPrice = Math.min(...SUPPORT_TIERS.map((tier) => tier.priceUsd));

const SHOTS = [
  { id: 'default', dot: '#ef5552', label: 'accountSettings.account.themeOptions.dark' },
  { id: 'sepia', dot: '#a0522d', label: 'accountSettings.account.customTheme.presetNames.sepia' },
  { id: 'indigo', dot: '#2f5d8a', label: 'accountSettings.account.customTheme.presetNames.indigo' },
  { id: 'midnight', dot: '#6c8cff', label: 'accountSettings.account.customTheme.presetNames.midnight' },
] as const;
type ShotId = (typeof SHOTS)[number]['id'];

const STEP_MS = 3200;
const shown = ref<ShotId>('default');
/** The status bar takes the colour of the header under it, as on a phone. */
const statusBar = computed(() => SHOTS.find((s) => s.id === shown.value)?.dot ?? SHOTS[0].dot);
/** Set once the reader picks a theme, so the cycle never takes it back. */
const pinned = ref(false);
const paused = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

function pick(id: ShotId) {
  pinned.value = true;
  shown.value = id;
}

onMounted(() => {
  if (prefersReducedMotion()) return;
  timer = setInterval(() => {
    if (pinned.value || paused.value) return;
    const i = SHOTS.findIndex((s) => s.id === shown.value);
    shown.value = SHOTS[(i + 1) % SHOTS.length]?.id ?? 'default';
  }, STEP_MS);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <section
    class="mx-auto grid max-w-5xl items-center gap-14 px-4 pb-24 pt-12 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] md:pt-20"
    data-testid="support-hero"
  >
    <div class="text-center md:text-start">
      <!-- biome-ignore lint/a11y/noHeaderScope: vue-i18n scope, not a table header -->
      <i18n-t keypath="supporters.headline" tag="h1" scope="global" class="hero-in text-[2.5rem] font-bold leading-[1.08] tracking-[-0.035em] text-ink md:text-5xl lg:text-[3.5rem]">
        <template #accent>
          <span class="text-brand">{{ t('supporters.headlineAccent') }}</span>
        </template>
      </i18n-t>
      <p class="hero-in mx-auto mt-6 max-w-lg text-lg leading-relaxed text-ink-muted md:mx-0 md:text-xl" style="--hero-step: 1">
        {{ t('supporters.intro') }}
      </p>
      <div class="hero-in mt-9 flex flex-col items-center gap-3 md:items-start" style="--hero-step: 2">
        <a
          href="#perks"
          data-testid="support-hero-more"
          class="inline-flex h-14 items-center gap-2 rounded-full bg-brand-solid px-9 text-base font-semibold text-on-accent transition-colors hover:bg-brand-hover"
        >
          {{ t('supporters.hero.more') }} <UiBaseIcon :path="mdiArrowDown" size="18" />
        </a>
        <span class="text-sm text-ink-muted" data-testid="support-hero-price">
          {{ t('supporters.fromPrice', { price: formatUsdWhole(lowestPrice) }) }}
        </span>
      </div>
    </div>

    <div class="hero-in flex flex-col items-center" style="--hero-step: 3">
      <!-- Phone with the real search: bezel, side buttons and island drawn in CSS. -->
      <!-- biome-ignore lint/a11y/noStaticElementInteractions: hover only pauses the cycle; the dots are the controls -->
      <div
        class="phone relative w-[16.5rem] md:w-[18rem] lg:w-[19.5rem]"
        @mouseenter="paused = true"
        @mouseleave="paused = false"
      >
        <span class="phone-button left-[-3px] top-[22%] h-10" aria-hidden="true" />
        <span class="phone-button left-[-3px] top-[32%] h-14" aria-hidden="true" />
        <span class="phone-button right-[-3px] top-[28%] h-20" aria-hidden="true" />
        <div class="phone-body rounded-[3rem] p-[0.6rem]">
          <div class="relative flex aspect-[1/2] flex-col overflow-hidden rounded-[2.45rem] bg-[#000]">
            <!-- Status bar: time, island, signal and battery -->
            <div
              class="relative flex h-9 shrink-0 items-center justify-between px-6 text-[11px] font-semibold text-[#fff] transition-colors duration-500"
              :style="{ background: statusBar }"
              aria-hidden="true"
            >
              <span>9:41</span>
              <span class="absolute left-1/2 top-[0.45rem] h-[1.35rem] w-[5.2rem] -translate-x-1/2 rounded-full bg-[#000]" />
              <span class="flex items-center gap-1.5">
                <span class="flex items-end gap-[2px]">
                  <span class="h-[4px] w-[3px] rounded-[1px] bg-[#fff]" />
                  <span class="h-[6px] w-[3px] rounded-[1px] bg-[#fff]" />
                  <span class="h-[8px] w-[3px] rounded-[1px] bg-[#fff]" />
                  <span class="h-[10px] w-[3px] rounded-[1px] bg-[#fff]" />
                </span>
                <span class="relative h-[10px] w-[20px] rounded-[3px] border border-[#fff]/70 p-[1px]">
                  <span class="block h-full w-3/4 rounded-[1px] bg-[#fff]" />
                </span>
              </span>
            </div>
            <div class="relative flex-1">
            <img
              v-for="(s, i) in SHOTS"
              :key="s.id"
              :src="`/assets/supporters/hero-${s.id}.webp`"
              :alt="i === 0 ? t('supporters.headlineAccent') : ''"
              :aria-hidden="i === 0 ? undefined : 'true'"
              width="780"
              height="1560"
              :loading="i === 0 ? 'eager' : 'lazy'"
              class="absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-500"
              :class="shown === s.id ? 'opacity-100' : 'opacity-0'"
              :data-testid="`support-hero-shot-${s.id}`"
            />
            </div>
          </div>
        </div>
      </div>

      <p class="mt-6 text-xs font-semibold text-ink-muted" data-testid="support-hero-themes-label">{{ t('support.perks.customThemes') }}</p>
      <div class="relative mt-2.5 flex gap-2.5">
        <button
          v-for="s in SHOTS"
          :key="s.id"
          type="button"
          class="h-6 w-6 rounded-full ring-2 ring-offset-2 ring-offset-[var(--background)] transition-transform hover:scale-110"
          :class="shown === s.id ? 'ring-ink' : 'ring-transparent'"
          :style="{ background: s.dot }"
          :aria-label="t(s.label)"
          :aria-pressed="shown === s.id"
          :data-testid="`support-hero-theme-${s.id}`"
          @click="pick(s.id)"
        />
        <span class="absolute left-full top-1/2 ms-3 hidden -translate-y-1/2 sm:block">
          <SupportTryIt pointing="left" />
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero-in {
  animation: hero-in 0.8s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc(var(--hero-step, 0) * 120ms);
}
@keyframes hero-in {
  from {
    opacity: 0;
    transform: translateY(1.25rem);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.phone-body {
  background: linear-gradient(145deg, #3a3a3f, #111114 45%, #26262b);
  box-shadow:
    0 0 0 1px rgb(255 255 255 / 0.08) inset,
    0 30px 60px -20px rgb(0 0 0 / 0.45);
}
.phone-button {
  position: absolute;
  width: 3px;
  border-radius: 2px;
  background: #2a2a2e;
}
</style>
