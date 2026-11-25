<script setup lang="ts">
import { mdiLockOutline, mdiRefresh, mdiShieldLockOutline, mdiSync } from '@mdi/js';
import { useTrackerSync } from '~/composables/useTrackerSync';
import type { TrackerSettings } from '~/utils/trackerFilter';
import {
  ANILIST_ICON_PATH,
  MYANIMELIST_ICON_PATH,
  trackerBrandBgClass,
  trackerIconPath,
} from '~/utils/trackerIcons';

const { t, locale } = useI18n();
const localePath = useLocalePath();
const { state, loading, working, load, startLink, syncNow, updateSettings, disconnect } = useTrackerSync();

const showMissing = ref(false);

onMounted(() => {
  load(true);
});

const connection = computed(() => state.value?.connection ?? null);
const coverage = computed(() => state.value?.coverage ?? null);
const canUsePatronPerks = computed(() => Boolean(state.value?.canUsePatronPerks));
const anilistConfigured = computed(() => state.value?.configuredProviders.includes('ANILIST') ?? false);

const coveragePercent = computed(() => {
  if (!coverage.value || coverage.value.total === 0) return 0;
  return Math.round((coverage.value.inCatalog / coverage.value.total) * 100);
});

const isCooldownActive = computed(() => {
  const next = connection.value?.nextManualSyncAt;
  if (!next) return false;
  return new Date(next).getTime() > Date.now();
});

const formattedLastSync = computed(() => {
  const raw = connection.value?.lastSyncedAt;
  if (!raw) return t('connections.tracker.neverSynced');
  try {
    return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(raw));
  } catch {
    return raw;
  }
});

const formattedNextSync = computed(() => {
  const raw = connection.value?.nextManualSyncAt;
  if (!raw) return '';
  try {
    return new Intl.DateTimeFormat(locale.value, { timeStyle: 'short' }).format(new Date(raw));
  } catch {
    return raw;
  }
});

const hasPausedPatronSettings = computed(() => {
  if (!connection.value || canUsePatronPerks.value) return false;
  const s = connection.value.settings;
  return s.autoSyncEnabled || s.spoilerGuardEnabled || s.hidePlanToWatch;
});

async function handleDisconnect() {
  if (!confirm(t('connections.tracker.confirmDisconnect'))) return;
  await disconnect();
}

async function toggleSetting(key: keyof TrackerSettings) {
  if (!connection.value) return;
  const current = connection.value.effectiveSettings[key];
  if (!current && !canUsePatronPerks.value) return;
  await updateSettings({ [key]: !current });
}
</script>

<template>
  <section id="anime-tracker" class="nd-settings-section scroll-mt-24" data-testid="tracker-connection-card">
    <h2 class="nd-settings-section-label">{{ t('connections.tracker.title') }}</h2>

    <div class="nd-settings-group">
      <!-- Disconnected state: AniList (live) + MyAnimeList (Phase 2) -->
      <template v-if="!connection">
        <div class="nd-settings-item">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div class="flex items-center gap-3 min-w-0">
              <div
                class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#02a9ff] text-on-accent"
                aria-hidden="true"
              >
                <UiBaseIcon :path="ANILIST_ICON_PATH" size="22" />
              </div>
              <div class="min-w-0">
                <p class="nd-settings-row-title">{{ t('connections.tracker.anilistName') }}</p>
                <p class="nd-settings-row-desc">{{ t('connections.tracker.anilistDescription') }}</p>
              </div>
            </div>
            <div class="flex gap-2 shrink-0">
              <button
                type="button"
                class="nd-btn-accent grow sm:grow-0"
                :disabled="working || loading || !anilistConfigured"
                data-testid="tracker-connect-anilist"
                @click="startLink('ANILIST')"
              >
                {{ anilistConfigured ? t('connections.tracker.connect') : t('connections.tracker.unavailable') }}
              </button>
            </div>
          </div>
        </div>

        <div class="nd-settings-item opacity-70">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div class="flex items-center gap-3 min-w-0">
              <div
                class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#2e51a2] text-on-accent"
                aria-hidden="true"
              >
                <UiBaseIcon :path="MYANIMELIST_ICON_PATH" size="22" />
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <p class="nd-settings-row-title">{{ t('connections.tracker.malName') }}</p>
                  <span class="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/70">
                    {{ t('connections.tracker.comingSoon') }}
                  </span>
                </div>
                <p class="nd-settings-row-desc">{{ t('connections.tracker.malDescription') }}</p>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- Connected state -->
      <template v-else>
        <div class="nd-settings-item">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div class="flex items-center gap-3 min-w-0">
              <div
                class="flex size-10 shrink-0 items-center justify-center rounded-lg text-on-accent"
                :class="trackerBrandBgClass(connection.provider)"
                aria-hidden="true"
              >
                <UiBaseIcon :path="trackerIconPath(connection.provider)" size="22" />
              </div>
              <div class="min-w-0">
                <p class="nd-settings-row-title" data-testid="tracker-connected-title">
                  {{
                    t('connections.tracker.linkedAs', {
                      provider: connection.provider === 'ANILIST' ? t('connections.tracker.anilistName') : t('connections.tracker.malName'),
                      username: connection.externalUsername || t('connections.tracker.defaultAccount'),
                    })
                  }}
                </p>
                <p class="nd-settings-row-desc">
                  {{ t('connections.tracker.lastSynced', { date: formattedLastSync }) }}
                </p>
              </div>
            </div>

            <div class="flex flex-wrap gap-2 shrink-0">
              <button
                type="button"
                class="nd-btn inline-flex items-center gap-1.5"
                :disabled="working || isCooldownActive"
                :title="isCooldownActive ? t('connections.tracker.cooldownHint', { time: formattedNextSync }) : undefined"
                data-testid="tracker-sync-now"
                @click="syncNow()"
              >
                <UiBaseIcon :path="mdiRefresh" size="16" :class="{ 'animate-spin': working }" />
                <span>
                  {{
                    isCooldownActive
                      ? t('connections.tracker.syncCooldown', { time: formattedNextSync })
                      : t('connections.tracker.syncNow')
                  }}
                </span>
              </button>
              <button
                type="button"
                class="nd-btn"
                :disabled="working"
                data-testid="tracker-disconnect"
                @click="handleDisconnect()"
              >
                {{ t('connections.tracker.disconnect') }}
              </button>
            </div>
          </div>

          <p
            v-if="connection.lastSyncError"
            class="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300"
            role="alert"
            data-testid="tracker-sync-error"
          >
            {{ connection.lastSyncError }}
          </p>
        </div>

        <!-- Catalog coverage -->
        <div v-if="coverage" class="nd-settings-item" data-testid="tracker-coverage">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p class="nd-settings-row-title">
                {{
                  t('connections.tracker.coverageTitle', {
                    inCatalog: coverage.inCatalog,
                    total: coverage.total,
                  })
                }}
              </p>
              <p class="nd-settings-row-desc">
                {{
                  t('connections.tracker.coverageBreakdown', {
                    watching: coverage.byStatus.WATCHING,
                    completed: coverage.byStatus.COMPLETED,
                    planning: coverage.byStatus.PLANNING,
                  })
                }}
              </p>
            </div>
            <span class="text-xs font-semibold text-white/70">{{ coveragePercent }}%</span>
          </div>

          <div class="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div class="h-full rounded-full bg-brand transition-all" :style="{ width: `${coveragePercent}%` }" />
          </div>

          <div v-if="state?.missingAnime.length" class="mt-3">
            <button
              type="button"
              class="text-xs font-medium text-brand hover:text-brand-hover underline underline-offset-2"
              data-testid="tracker-toggle-missing"
              @click="showMissing = !showMissing"
            >
              {{
                showMissing
                  ? t('connections.tracker.hideMissing')
                  : t('connections.tracker.showMissing', { count: coverage.missing })
              }}
            </button>

            <div v-if="showMissing" class="mt-2.5 space-y-1.5 max-h-56 overflow-y-auto pr-1">
              <div
                v-for="item in state.missingAnime"
                :key="`${item.externalSource}-${item.externalId}`"
                class="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-1.5 text-xs"
              >
                <span class="truncate text-white/85">{{ item.title }}</span>
                <NuxtLink
                  :to="localePath('/requests')"
                  class="shrink-0 font-medium text-brand hover:text-brand-hover"
                >
                  {{ t('connections.tracker.requestTitle') }}
                </NuxtLink>
              </div>
            </div>
          </div>
        </div>

        <!-- Patron automation & anti-spoiler controls -->
        <div class="nd-settings-item space-y-3" data-testid="tracker-patron-settings">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <UiBaseIcon :path="mdiShieldLockOutline" size="18" class="text-brand" />
              <p class="nd-settings-row-title">{{ t('connections.tracker.patronSectionTitle') }}</p>
            </div>
            <NuxtLink
              v-if="!canUsePatronPerks"
              :to="localePath('/supporters')"
              class="inline-flex items-center gap-1 rounded-full bg-brand/15 px-2.5 py-0.5 text-xs font-medium text-brand hover:bg-brand/25 transition-colors"
              data-testid="tracker-patron-cta"
            >
              <UiBaseIcon :path="mdiLockOutline" size="13" />
              <span>{{ t('connections.tracker.unlockPatron') }}</span>
            </NuxtLink>
          </div>

          <p
            v-if="hasPausedPatronSettings"
            class="rounded-lg bg-white/5 px-3 py-2 text-xs text-white/70"
            data-testid="tracker-lapsed-notice"
          >
            {{ t('connections.tracker.lapsedNotice') }}
          </p>

          <div class="space-y-3">
            <div class="flex items-center justify-between gap-4">
              <div class="min-w-0">
                <p class="text-sm font-medium text-ink">{{ t('connections.tracker.autoSyncLabel') }}</p>
                <p class="text-xs text-ink-muted">{{ t('connections.tracker.autoSyncDesc') }}</p>
              </div>
              <button
                type="button"
                role="switch"
                :aria-checked="connection.effectiveSettings.autoSyncEnabled"
                :disabled="working || (!canUsePatronPerks && !connection.effectiveSettings.autoSyncEnabled)"
                class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40"
                :class="connection.effectiveSettings.autoSyncEnabled ? 'bg-brand' : 'bg-white/15'"
                data-testid="tracker-toggle-autosync"
                @click="toggleSetting('autoSyncEnabled')"
              >
                <span
                  class="inline-block size-4 rounded-full bg-white transition-transform"
                  :class="connection.effectiveSettings.autoSyncEnabled ? 'translate-x-6' : 'translate-x-1'"
                />
              </button>
            </div>

            <div class="flex items-center justify-between gap-4">
              <div class="min-w-0">
                <p class="text-sm font-medium text-ink">{{ t('connections.tracker.spoilerGuardLabel') }}</p>
                <p class="text-xs text-ink-muted">{{ t('connections.tracker.spoilerGuardDesc') }}</p>
              </div>
              <button
                type="button"
                role="switch"
                :aria-checked="connection.effectiveSettings.spoilerGuardEnabled"
                :disabled="working || (!canUsePatronPerks && !connection.effectiveSettings.spoilerGuardEnabled)"
                class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40"
                :class="connection.effectiveSettings.spoilerGuardEnabled ? 'bg-brand' : 'bg-white/15'"
                data-testid="tracker-toggle-spoiler-guard"
                @click="toggleSetting('spoilerGuardEnabled')"
              >
                <span
                  class="inline-block size-4 rounded-full bg-white transition-transform"
                  :class="connection.effectiveSettings.spoilerGuardEnabled ? 'translate-x-6' : 'translate-x-1'"
                />
              </button>
            </div>

            <div class="flex items-center justify-between gap-4">
              <div class="min-w-0">
                <p class="text-sm font-medium text-ink">{{ t('connections.tracker.hidePlanningLabel') }}</p>
                <p class="text-xs text-ink-muted">{{ t('connections.tracker.hidePlanningDesc') }}</p>
              </div>
              <button
                type="button"
                role="switch"
                :aria-checked="connection.effectiveSettings.hidePlanToWatch"
                :disabled="working || (!canUsePatronPerks && !connection.effectiveSettings.hidePlanToWatch)"
                class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40"
                :class="connection.effectiveSettings.hidePlanToWatch ? 'bg-brand' : 'bg-white/15'"
                data-testid="tracker-toggle-hide-planning"
                @click="toggleSetting('hidePlanToWatch')"
              >
                <span
                  class="inline-block size-4 rounded-full bg-white transition-transform"
                  :class="connection.effectiveSettings.hidePlanToWatch ? 'translate-x-6' : 'translate-x-1'"
                />
              </button>
            </div>
          </div>

          <p
            v-if="!canUsePatronPerks && (state?.customListCount ?? 0) > 0"
            class="flex items-center gap-1.5 text-xs text-white/60 pt-1"
            data-testid="tracker-custom-lists-locked"
          >
            <UiBaseIcon :path="mdiSync" size="14" class="shrink-0 text-brand" />
            <span>{{ t('connections.tracker.customListsLocked', { count: state?.customListCount ?? 0 }) }}</span>
          </p>
        </div>
      </template>
    </div>
  </section>
</template>
