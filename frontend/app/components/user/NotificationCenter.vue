<script setup lang="ts">
import { mdiDeleteOutline, mdiPause, mdiPlay, mdiTextBoxSearchOutline } from '@mdi/js';
import type { ListWordWatchesResponse } from '@brigadasos/nadeshiko-sdk';
import { useWordWatches, wordWatchErrorKey, type WordWatch } from '~/composables/useWordWatches';
import { apiErrorStatus, handleApiError } from '~/utils/apiError';
import { wordPath } from '~/composables/useNotifications';

/**
 * `/user/notifications` (task 52): notification settings. The reader's word alerts, and where each kind of notice
 * reaches them (the bell, email, or both). The notices themselves are read in the bell's floating panel, not here.
 */
const { t } = useI18n();
const localePath = useLocalePath();
const store = userStore();
const sdk = useNadeshikoSdk();
const watches = useWordWatches();

const alerts = ref<ListWordWatchesResponse | null>(null);
const alertsError = ref(false);
/** One change at a time: an alert action or a channel switch. */
const busy = ref(false);

async function loadAlerts() {
  alertsError.value = false;
  try {
    alerts.value = await watches.list();
  } catch (caught) {
    alertsError.value = true;
    handleApiError('notifications.alerts', caught, { toastKey: false });
  }
}

onMounted(loadAlerts);

/** Applies a change to the list in place; the limit does not move, so there is nothing to fetch again. */
function setAlerts(items: WordWatch[]) {
  if (!alerts.value) return;
  alerts.value = { ...alerts.value, items, activeCount: items.filter((item) => item.status === 'ACTIVE').length };
}

async function changeAlert(alert: WordWatch, patch: { mode?: WordWatch['mode']; paused?: boolean }) {
  if (busy.value) return;
  busy.value = true;
  try {
    const next = await watches.update(alert.id, patch);
    setAlerts((alerts.value?.items ?? []).map((item) => (item.id === next.id ? next : item)));
  } catch (caught) {
    useToastError(t(wordWatchErrorKey(apiErrorStatus(caught), patch.mode ?? alert.mode)));
  } finally {
    busy.value = false;
  }
}

async function removeAlert(alert: WordWatch) {
  if (busy.value) return;
  busy.value = true;
  try {
    await watches.remove(alert.id);
    setAlerts((alerts.value?.items ?? []).filter((item) => item.id !== alert.id));
  } catch (caught) {
    handleApiError('notifications.alert-remove', caught, { toastKey: 'notifications.watch.error' });
  } finally {
    busy.value = false;
  }
}


function statusLabel(alert: WordWatch): string {
  if (alert.status === 'PAUSED') return t('notifications.alerts.statusPaused');
  if (alert.status === 'FULFILLED') return t('notifications.alerts.statusFulfilled');
  return alert.mode === 'FIRST' ? t('notifications.alerts.modeFirst') : t('notifications.alerts.modeNew');
}

/** Channels: one row per category, a site switch and an email switch. Absent means on for both; email also follows
 * the master switch in Settings. */
const CHANNEL_CATEGORIES = ['words', 'requests'] as const;
type ChannelCategory = (typeof CHANNEL_CATEGORIES)[number];

const emailMasterOn = computed(() => store.preferences?.productEmails?.enabled !== false);
type Channel = 'site' | 'email';
const CHANNELS: readonly Channel[] = ['site', 'email'];

function isOn(category: ChannelCategory, channel: Channel): boolean {
  if (channel === 'site') return store.preferences?.siteNotifications?.[category] !== false;
  return emailMasterOn.value && store.preferences?.productEmails?.[category] !== false;
}

async function toggleChannel(category: ChannelCategory, channel: Channel) {
  if (busy.value) return;
  busy.value = true;
  try {
    // Only the one switch changes, merged over what is stored; email keeps its master switch explicit.
    const patch =
      channel === 'site'
        ? { siteNotifications: { ...(store.preferences?.siteNotifications ?? {}), [category]: !isOn(category, 'site') } }
        : {
            productEmails: {
              ...(store.preferences?.productEmails ?? {}),
              enabled: emailMasterOn.value,
              [category]: !isOn(category, 'email'),
            },
          };
    await sdk.updateUserPreferences(patch);
    store.preferences = { ...(store.preferences ?? {}), ...patch };
    usePostHog()?.capture('setting_changed', { setting_name: `notifications.${category}.${channel}` });
  } catch (caught) {
    handleApiError('notifications.channel', caught, { toastKey: 'accountSettings.emails.preferenceError' });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div id="alerts" class="nd-settings-card">
    <div class="flex items-start justify-between gap-4">
      <h3 class="nd-settings-title">{{ $t('notifications.alerts.title') }}</h3>
      <span v-if="alerts" class="shrink-0 text-xs text-ink-muted" data-testid="alerts-count">
        {{ $t('notifications.alerts.count', { active: alerts.activeCount, limit: alerts.limit }) }}
      </span>
    </div>

    <p v-if="alertsError" class="mt-4 text-sm text-red-400" role="alert">{{ $t('notifications.alerts.loadError') }}</p>
    <p v-else-if="alerts && alerts.items.length === 0" class="mt-4 text-sm text-ink-muted">
      {{ $t('notifications.alerts.empty') }}
    </p>

    <ul v-if="alerts && alerts.items.length > 0" class="mt-4 divide-y divide-white/5" data-testid="alerts-list">
      <li v-for="alert in alerts.items" :key="alert.id" class="flex flex-wrap items-center gap-3 py-3">
        <NuxtLink :to="localePath(wordPath(alert))" class="min-w-0 flex-1" data-testid="alert-word">
          <span class="text-lg font-semibold text-white" lang="ja">{{ alert.query }}</span>
          <span class="block text-xs text-ink-muted">{{ statusLabel(alert) }}</span>
        </NuxtLink>
        <div class="flex items-center gap-2">
          <button
            v-if="alert.status === 'FULFILLED' && alert.matchMode !== 'CONTAINS'"
            type="button"
            class="nd-alert-action"
            :disabled="busy"
            data-testid="alert-follow"
            @click="changeAlert(alert, { mode: 'NEW_SENTENCES' })"
          >
            <UiBaseIcon :path="mdiTextBoxSearchOutline" :size="14" w="w-3.5" h="h-3.5" aria-hidden="true" />
            {{ $t('notifications.alerts.followNew') }}
          </button>
          <button
            v-if="alert.status === 'ACTIVE'"
            type="button"
            class="nd-alert-action"
            :disabled="busy"
            data-testid="alert-pause"
            @click="changeAlert(alert, { paused: true })"
          >
            <UiBaseIcon :path="mdiPause" :size="14" w="w-3.5" h="h-3.5" aria-hidden="true" />
            {{ $t('notifications.alerts.pause') }}
          </button>
          <button
            v-if="alert.status === 'PAUSED'"
            type="button"
            class="nd-alert-action"
            :disabled="busy"
            data-testid="alert-resume"
            @click="changeAlert(alert, { paused: false })"
          >
            <UiBaseIcon :path="mdiPlay" :size="14" w="w-3.5" h="h-3.5" aria-hidden="true" />
            {{ $t('notifications.alerts.resume') }}
          </button>
          <button
            type="button"
            class="nd-alert-action"
            :disabled="busy"
            :aria-label="$t('notifications.alerts.removeWord', { word: alert.query })"
            data-testid="alert-remove"
            @click="removeAlert(alert)"
          >
            <UiBaseIcon :path="mdiDeleteOutline" :size="14" w="w-3.5" h="h-3.5" aria-hidden="true" />
            {{ $t('notifications.alerts.remove') }}
          </button>
        </div>
      </li>
    </ul>
  </div>

  <div class="nd-settings-card">
    <h3 class="nd-settings-title">{{ $t('notifications.channels.title') }}</h3>
    <p v-if="!emailMasterOn" class="mt-2 text-sm text-amber-300">
      {{ $t('notifications.channels.emailOff') }}
      <NuxtLink :to="localePath('/user/settings')" class="underline underline-offset-4">{{ $t('notifications.channels.emailOffLink') }}</NuxtLink>
    </p>

    <table class="mt-4 w-full text-sm" data-testid="channels-table">
      <thead>
        <tr class="text-left text-xs text-ink-muted">
          <th class="py-2" />
          <th class="py-2 text-center font-medium">{{ $t('notifications.channels.site') }}</th>
          <th class="py-2 text-center font-medium">{{ $t('notifications.channels.email') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="category in CHANNEL_CATEGORIES" :key="category" class="border-t border-white/5">
          <td class="py-3 pr-4">
            <span class="text-white">{{ $t(`accountSettings.emails.${category}Title`) }}</span>
          </td>
          <td v-for="channel in CHANNELS" :key="channel" class="py-3 text-center">
            <button
              type="button"
              :data-testid="`channel-${category}-${channel}`"
              :aria-label="`${$t(`accountSettings.emails.${category}Title`)}: ${$t(`notifications.channels.${channel}`)}`"
              :aria-pressed="isOn(category, channel)"
              :disabled="busy || (channel === 'email' && !emailMasterOn)"
              :class="[
                'relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:cursor-not-allowed',
                isOn(category, channel) ? 'bg-brand-solid' : 'bg-gray-600',
              ]"
              @click="toggleChannel(category, channel)"
            >
              <span
                :class="[
                  'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                  isOn(category, channel) ? 'translate-x-5' : 'translate-x-0',
                ]"
              />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.nd-alert-action {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.6rem;
  border-radius: 0.5rem;
  font-size: 0.75rem;
  color: var(--ink-muted);
  background: color-mix(in srgb, var(--ink) 8%, var(--surface));
}

.nd-alert-action:hover:not(:disabled) {
  color: var(--ink);
}

.nd-alert-action:disabled {
  opacity: 0.5;
}
</style>
