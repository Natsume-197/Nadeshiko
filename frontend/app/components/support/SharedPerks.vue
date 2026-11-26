<script setup lang="ts">
import { mdiBookOpenPageVariantOutline, mdiEyeOffOutline, mdiLock, mdiSync, mdiThumbUp } from '@mdi/js';
import { PATRON_LIMITS } from '~/utils/supportTiers';

/**
 * What every paid tier unlocks, as a bento grid: one card per perk, each with a small static picture of it.
 * The pictures are sample data only.
 */

const { t } = useI18n();

/** Mini windows for the themes card: header colour, page background, and whether text is dark. */
const THEME_WINDOWS = [
  { accent: '#a0522d', bg: '#f4ecd8', light: true },
  { accent: '#6c8cff', bg: '#10141f', light: false },
  { accent: '#ef4444', bg: '#1c1c1f', light: false },
];
const THEME_DOTS = ['#ef4444', '#a0522d', '#2f5d8a', '#6c8cff', '#558b2f', '#1a8a9a', '#d2602a', '#8466e8'];

const DICTIONARIES = [
  { name: 'JMdict', kind: 'EN' },
  { name: '大辞林', kind: 'JA' },
  { name: 'JPDB', kind: '#' },
];

const EPISODE_HUES = [340, 20, 200, 150, 260, 45];
const WATCHED = 3;

const SEARCH_ROWS = [
  { title: '葬送のフリーレン', line: 'また会えるよ。', hue: 160, planning: false },
  { title: 'ダンジョン飯', line: 'お腹が空いた。', hue: 30, planning: true },
  { title: 'ぼっち・ざ・ろっく！', line: 'がんばります！', hue: 330, planning: false },
];

const CUSTOM_LISTS = ['Rewatch', 'Favourites', 'Summer 2026', 'Comfy'];
</script>

<template>
  <div data-testid="support-shared-perks">
    <!-- biome-ignore lint/a11y/noHeaderScope: vue-i18n scope, not a table header -->
    <i18n-t keypath="support.shared.headline" tag="h2" scope="global" class="text-center text-2xl font-black tracking-tight text-ink md:text-3xl">
      <template #accent>
        <span class="text-brand">{{ t('support.shared.headlineAccent') }}</span>
      </template>
    </i18n-t>

    <ul class="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      <!-- Custom themes: tall card -->
      <li class="perk-card lg:row-span-2">
        <p class="perk-title">{{ t('support.perks.customThemes') }}</p>
        <div class="perk-visual relative flex min-h-[11rem] flex-1 items-center justify-center overflow-hidden">
          <div
            v-for="(w, i) in THEME_WINDOWS"
            :key="w.accent"
            class="absolute w-[62%] overflow-hidden rounded-xl shadow-xl ring-1 ring-[#000]/10"
            :style="{
              background: w.bg,
              transform: `translate(${(i - 1) * 12}%, ${(i - 1) * 22}%) rotate(${(i - 1) * 5}deg)`,
              zIndex: i,
            }"
          >
            <div class="flex items-center gap-1.5 px-3 py-2" :style="{ background: w.accent }">
              <span class="h-2 w-2 rounded-full bg-[#fff]/80" />
              <span class="h-1.5 w-12 rounded-full bg-[#fff]/50" />
            </div>
            <div class="space-y-2 p-3">
              <p lang="ja" class="text-sm font-semibold" :style="{ color: w.light ? '#1f2328' : '#f4f4f5' }">
                今日は<span :style="{ color: w.accent }">天気</span>がいい
              </p>
              <span class="block h-1.5 w-4/5 rounded-full" :style="{ background: w.light ? '#0000001a' : '#ffffff1a' }" />
              <span class="block h-1.5 w-3/5 rounded-full" :style="{ background: w.light ? '#0000001a' : '#ffffff1a' }" />
            </div>
          </div>
        </div>
        <div class="mt-4 flex flex-wrap justify-center gap-2" aria-hidden="true">
          <span v-for="c in THEME_DOTS" :key="c" class="h-5 w-5 rounded-full ring-2 ring-card-background" :style="{ background: c }" />
        </div>
      </li>

      <!-- Custom dictionaries -->
      <li class="perk-card">
        <p class="perk-title">{{ t('support.shared.dictionaries') }}</p>
        <div class="perk-visual space-y-2 p-4">
          <div
            v-for="(d, i) in DICTIONARIES"
            :key="d.name"
            class="flex items-center gap-3 rounded-lg bg-card-background px-3 py-2"
          >
            <span class="text-xs tabular-nums text-ink-faint">{{ i + 1 }}</span>
            <UiBaseIcon :path="mdiBookOpenPageVariantOutline" :size="16" class="text-brand" />
            <span class="flex-1 text-sm font-medium text-ink">{{ d.name }}</span>
            <span class="rounded bg-surface-lift px-1.5 py-0.5 text-[10px] font-bold text-ink-muted">{{ d.kind }}</span>
          </div>
        </div>
      </li>

      <!-- Open requests: patron vs free -->
      <li class="perk-card">
        <p class="perk-title">{{ t('support.shared.openRequests') }}</p>
        <div class="perk-visual flex flex-col justify-center gap-4 p-5" aria-hidden="true">
          <div class="flex items-center gap-3">
            <span class="w-7 text-right text-sm font-bold tabular-nums text-brand">{{ PATRON_LIMITS.openRequests.patron }}</span>
            <span class="h-3 flex-1 rounded-full bg-brand-solid" />
          </div>
          <div class="flex items-center gap-3">
            <span class="w-7 text-right text-sm font-bold tabular-nums text-ink-faint">{{ PATRON_LIMITS.openRequests.free }}</span>
            <span class="h-3 rounded-full bg-surface-lift" :style="{ width: `${(PATRON_LIMITS.openRequests.free / PATRON_LIMITS.openRequests.patron) * 100}%` }" />
            <span class="flex-1" />
          </div>
          <div class="flex items-center gap-1.5 self-end rounded-full bg-card-background px-2.5 py-1 text-xs font-semibold text-ink">
            <UiBaseIcon :path="mdiThumbUp" :size="13" class="text-brand" /> 128
          </div>
        </div>
      </li>

      <!-- Spoiler guard: wide card -->
      <li class="perk-card md:col-span-2">
        <p class="perk-title">{{ t('support.shared.spoilerGuard') }}</p>
        <div class="perk-visual grid grid-cols-3 content-center gap-2.5 p-5 sm:grid-cols-6" aria-hidden="true">
          <div v-for="n in EPISODE_HUES.length" :key="n" class="relative aspect-video overflow-hidden rounded-lg">
            <div
              class="absolute inset-0"
              :class="n > WATCHED ? 'scale-110 blur-md' : ''"
              :style="{
                background: `linear-gradient(135deg, hsl(${EPISODE_HUES[n - 1]} 55% 45%), hsl(${(EPISODE_HUES[n - 1] ?? 0) + 40} 60% 25%))`,
              }"
            />
            <span class="absolute bottom-1 left-1.5 text-[11px] font-bold text-[#fff] drop-shadow">{{ n }}</span>
            <span v-if="n > WATCHED" class="absolute inset-0 flex items-center justify-center bg-[#000]/25 text-[#fff]">
              <UiBaseIcon :path="mdiLock" :size="16" />
            </span>
          </div>
        </div>
      </li>

      <!-- Hide Plan to Watch -->
      <li class="perk-card">
        <p class="perk-title">{{ t('support.shared.hidePlanning') }}</p>
        <div class="perk-visual space-y-2 p-4" aria-hidden="true">
          <div
            v-for="row in SEARCH_ROWS"
            :key="row.title"
            class="flex items-center gap-3 rounded-lg bg-card-background px-3 py-2"
            :class="row.planning ? 'opacity-40' : ''"
          >
            <span
              class="h-8 w-6 shrink-0 rounded"
              :style="{ background: `linear-gradient(160deg, hsl(${row.hue} 55% 50%), hsl(${row.hue + 30} 55% 28%))` }"
            />
            <div class="min-w-0 flex-1">
              <p lang="ja" class="truncate text-sm text-ink" :class="row.planning ? 'line-through' : ''">{{ row.line }}</p>
              <p lang="ja" class="truncate text-[11px] text-ink-faint">{{ row.title }}</p>
            </div>
            <UiBaseIcon v-if="row.planning" :path="mdiEyeOffOutline" :size="16" class="text-ink-muted" />
          </div>
        </div>
      </li>

      <!-- Automatic sync -->
      <li class="perk-card">
        <p class="perk-title">{{ t('support.shared.autoSync') }}</p>
        <div class="perk-visual flex items-center justify-center gap-4 p-5" aria-hidden="true">
          <div class="flex flex-col gap-2">
            <span class="flex h-11 w-11 items-center justify-center rounded-xl bg-[#02a9ff] text-xs font-black text-[#fff]">AL</span>
            <span class="flex h-11 w-11 items-center justify-center rounded-xl bg-[#2e51a2] text-[10px] font-black text-[#fff]">MAL</span>
          </div>
          <div class="flex items-center gap-1 text-brand">
            <span class="h-px w-6 bg-brand/50" />
            <UiBaseIcon :path="mdiSync" :size="22" class="motion-safe:animate-[spin_4s_linear_infinite]" />
            <span class="h-px w-6 bg-brand/50" />
          </div>
          <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-solid text-lg font-black text-[#fff] shadow-lg">撫</span>
        </div>
      </li>

      <!-- AniList custom lists -->
      <li class="perk-card">
        <p class="perk-title">{{ t('support.shared.customLists') }}</p>
        <div class="perk-visual flex flex-wrap content-center items-center justify-center gap-2 p-5" aria-hidden="true">
          <span
            v-for="(list, i) in CUSTOM_LISTS"
            :key="list"
            class="rounded-full border px-3 py-1.5 text-sm font-medium"
            :class="i === 0 ? 'border-brand/50 bg-brand/15 text-brand' : 'border-hairline bg-card-background text-ink-muted'"
          >
            {{ list }}
          </span>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.perk-card {
  /* Grid items default to their content's width; truncated text inside needs them free to shrink. */
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-radius: 1.25rem;
  background: var(--card-background);
  padding: 1.125rem;
}
.perk-title {
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--ink);
}
.perk-visual {
  margin-top: 0.75rem;
  min-height: 8rem;
  flex: 1;
  border-radius: 1rem;
  background: var(--surface-soft);
}
</style>
