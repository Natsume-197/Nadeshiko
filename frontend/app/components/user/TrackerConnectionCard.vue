<script setup lang="ts">
import { mdiCheck, mdiLockOutline, mdiRefresh, mdiShieldLockOutline, mdiThumbUpOutline } from '@mdi/js';
import { useTrackerSync } from '~/composables/useTrackerSync';
import { apiErrorStatus, handleApiError } from '~/utils/apiError';
import { useToastError } from '~/utils/toast';
import { missingAnimeAction, type TrackerMissingAnime, type TrackerSettings } from '~/utils/trackerFilter';
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
// Until the state arrives nothing is known about the providers: show them as connectable but disabled, rather than
// flashing "Unavailable" / "Coming soon" at a reader whose server has both.
const stateLoaded = computed(() => state.value !== null);
const anilistConfigured = computed(
  () => !stateLoaded.value || (state.value?.configuredProviders.includes('ANILIST') ?? false),
);
const malConfigured = computed(() => !stateLoaded.value || (state.value?.configuredProviders.includes('MAL') ?? false));

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

async function handleDisconnect() {
  if (!confirm(t('connections.tracker.confirmDisconnect'))) return;
  await disconnect();
}

/** The patron settings, shown to everyone: free readers see them locked as a preview. */
const PATRON_SETTINGS: ReadonlyArray<{ key: keyof TrackerSettings; label: string; desc: string; testId: string }> = [
  {
    key: 'spoilerGuardEnabled',
    label: 'connections.tracker.spoilerGuardLabel',
    desc: 'connections.tracker.spoilerGuardDesc',
    testId: 'tracker-toggle-spoiler-guard',
  },
  {
    key: 'hidePlanToWatch',
    label: 'connections.tracker.hidePlanningLabel',
    desc: 'connections.tracker.hidePlanningDesc',
    testId: 'tracker-toggle-hide-planning',
  },
  {
    key: 'autoSyncEnabled',
    label: 'connections.tracker.autoSyncLabel',
    desc: 'connections.tracker.autoSyncDesc',
    testId: 'tracker-toggle-autosync',
  },
];

/** Missing titles requested or voted from this card in this page view, keyed by AniList id. The server reports
 * the ones from before (`item.request`). */
const requested = ref<Record<string, 'busy' | 'done'>>({});

const missingRows = computed(() =>
  (state.value?.missingAnime ?? []).map((item) => ({
    item,
    action: missingAnimeAction(item, requested.value[item.externalId] === 'done'),
  })),
);

/**
 * Files the request straight from the tracker entry: the AniList link is all `/v1/requests` needs, and the server
 * fills the title in. When the title is already requested, the same call adds the reader's vote instead.
 */
async function requestMissing(item: TrackerMissingAnime) {
  if (requested.value[item.externalId]) return;
  requested.value = { ...requested.value, [item.externalId]: 'busy' };
  try {
    await $fetch('/v1/requests', { method: 'POST', body: { sourceUrl: item.sourceUrl, title: item.title } });
    requested.value = { ...requested.value, [item.externalId]: 'done' };
  } catch (caught) {
    const { [item.externalId]: _dropped, ...rest } = requested.value;
    requested.value = rest;
    if (apiErrorStatus(caught) === 403) {
      const allowance = await $fetch<{ openLimit: number }>('/v1/requests/me').catch(() => null);
      useToastError(t('requests.form.limit', { limit: allowance?.openLimit ?? 10 }));
    } else {
      handleApiError('trackerConnection.request', caught);
    }
  }
}

async function toggleSetting(key: keyof TrackerSettings) {
  if (!connection.value || !canUsePatronPerks.value) return;
  const current = connection.value.effectiveSettings[key];
  await updateSettings({ [key]: !current });
}
</script>

<template>
  <section id="anime-tracker" class="nd-settings-section scroll-mt-24" data-testid="tracker-connection-card">
    <h2 class="nd-settings-section-label">{{ t('connections.tracker.title') }}</h2>

    <div class="nd-settings-group">
      <!-- Disconnected state: one tracker at a time; linking another replaces it -->
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
                :disabled="working || loading || !stateLoaded || !anilistConfigured"
                data-testid="tracker-connect-anilist"
                @click="startLink('ANILIST')"
              >
                {{ anilistConfigured ? t('connections.tracker.connect') : t('connections.tracker.unavailable') }}
              </button>
            </div>
          </div>
        </div>

        <div class="nd-settings-item" :class="{ 'opacity-70': !malConfigured }">
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
                  <span
                    v-if="!malConfigured"
                    class="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/70"
                  >
                    {{ t('connections.tracker.comingSoon') }}
                  </span>
                </div>
                <p class="nd-settings-row-desc">{{ t('connections.tracker.malDescription') }}</p>
              </div>
            </div>
            <div v-if="malConfigured" class="flex gap-2 shrink-0">
              <button
                type="button"
                class="nd-btn-accent grow sm:grow-0"
                :disabled="working || loading || !stateLoaded"
                data-testid="tracker-connect-mal"
                @click="startLink('MAL')"
              >
                {{ t('connections.tracker.connectMal') }}
              </button>
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
            :title="connection.lastSyncError"
          >
            {{ t('connections.tracker.syncFailed') }}
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
                v-for="{ item, action } in missingRows"
                :key="`${item.externalSource}-${item.externalId}`"
                class="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-1.5 text-xs"
              >
                <span class="truncate text-white/85">{{ item.title }}</span>
                <span
                  v-if="action.kind === 'declined'"
                  class="shrink-0 font-medium text-ink-faint"
                  data-testid="tracker-request-declined"
                >
                  {{ t('requests.status.DECLINED') }}
                </span>
                <span
                  v-else-if="action.kind === 'requested'"
                  class="inline-flex shrink-0 items-center gap-1 font-medium text-emerald-300"
                  data-testid="tracker-request-done"
                >
                  <UiBaseIcon :path="mdiCheck" size="14" />
                  {{
                    action.status === 'OPEN'
                      ? t('connections.tracker.requested')
                      : t(`requests.status.${action.status}`)
                  }}
                </span>
                <button
                  v-else
                  type="button"
                  class="inline-flex shrink-0 items-center gap-1 font-medium text-brand hover:text-brand-hover disabled:opacity-50"
                  :disabled="requested[item.externalId] === 'busy'"
                  :data-testid="action.kind === 'vote' ? 'tracker-vote-missing' : 'tracker-request-missing'"
                  @click="requestMissing(item)"
                >
                  <template v-if="action.kind === 'vote'">
                    <UiBaseIcon :path="mdiThumbUpOutline" size="14" />
                    {{ action.voteCount }}
                  </template>
                  <template v-else>{{ t('connections.tracker.requestTitle') }}</template>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Patron automation & anti-spoiler controls. Free readers see the same rows locked, as a preview. -->
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

          <div class="space-y-3">
            <template v-for="setting in PATRON_SETTINGS" :key="setting.key">
              <div v-if="canUsePatronPerks" class="flex items-center justify-between gap-4">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-ink">{{ t(setting.label) }}</p>
                  <p class="text-xs text-ink-muted">{{ t(setting.desc) }}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="connection.effectiveSettings[setting.key]"
                  :disabled="working"
                  class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40"
                  :class="connection.effectiveSettings[setting.key] ? 'bg-brand' : 'bg-white/15'"
                  :data-testid="setting.testId"
                  @click="toggleSetting(setting.key)"
                >
                  <span
                    class="inline-block size-4 rounded-full bg-white transition-transform"
                    :class="connection.effectiveSettings[setting.key] ? 'translate-x-6' : 'translate-x-1'"
                  />
                </button>
              </div>
              <NuxtLink
                v-else
                :to="localePath('/supporters')"
                class="-mx-2 flex items-center justify-between gap-4 rounded-lg px-2 py-1 hover:bg-white/5 transition-colors"
                :data-testid="`${setting.testId}-locked`"
              >
                <div class="min-w-0">
                  <p class="text-sm font-medium text-ink/80">{{ t(setting.label) }}</p>
                  <p class="text-xs text-ink-muted">{{ t(setting.desc) }}</p>
                </div>
                <span
                  class="inline-flex h-6 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-ink-muted"
                  :aria-label="t('connections.tracker.unlockPatron')"
                >
                  <UiBaseIcon :path="mdiLockOutline" size="14" />
                </span>
              </NuxtLink>
            </template>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>
