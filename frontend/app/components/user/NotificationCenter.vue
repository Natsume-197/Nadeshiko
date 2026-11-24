<script setup lang="ts">
import { mdiDeleteOutline, mdiPause, mdiPlay, mdiTextBoxSearchOutline } from '@mdi/js';
import type { ListWordWatchesResponse } from '@brigadasos/nadeshiko-sdk';
import { useWordWatches, wordWatchErrorKey, type WordWatch } from '~/composables/useWordWatches';
import { apiErrorStatus, handleApiError } from '~/utils/apiError';
import { wordPath } from '~/composables/useNotifications';
import { useToastError, useToastSuccess } from '~/utils/toast';

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

/**
 * Channels and email preferences: one card for everything Nadeshiko sends (the bell and product emails).
 * Absent means on for both; email categories also follow the master `productEmails.enabled` switch.
 * Sends only the key that changed, merged over stored preferences, so concurrent device edits are kept.
 */
const SITE_CATEGORIES = new Set(['words', 'requests'] as const);
type SiteCategory = 'words' | 'requests';
const NOTIFICATION_CATEGORIES = ['words', 'requests', 'recap', 'checkins', 'updates'] as const;
type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

const emailMasterOn = computed(() => store.preferences?.productEmails?.enabled !== false);

function hasSiteChannel(category: NotificationCategory): category is SiteCategory {
  return SITE_CATEGORIES.has(category as SiteCategory);
}

function isSiteOn(category: SiteCategory): boolean {
  return store.preferences?.siteNotifications?.[category] !== false;
}

function isEmailOn(category: NotificationCategory): boolean {
  return emailMasterOn.value && store.preferences?.productEmails?.[category] !== false;
}

async function toggleEmailMaster() {
  if (busy.value) return;
  busy.value = true;
  const next = !emailMasterOn.value;
  try {
    const productEmails = { ...(store.preferences?.productEmails ?? {}), enabled: next };
    await sdk.updateUserPreferences({ productEmails });
    store.preferences = { ...(store.preferences ?? {}), productEmails };
    usePostHog()?.capture('setting_changed', { setting_name: 'productEmails', value: next });
    useToastSuccess(
      t(next ? 'accountSettings.account.productEmailsOnToast' : 'accountSettings.account.productEmailsOffToast'),
    );
  } catch (caught) {
    handleApiError('account:product-emails-toggle-failed', caught, {
      toastKey: 'accountSettings.account.preferenceError',
      context: { 'preference.key': 'productEmails' },
    });
  } finally {
    busy.value = false;
  }
}

async function toggleSiteChannel(category: SiteCategory) {
  if (busy.value) return;
  busy.value = true;
  const next = !isSiteOn(category);
  try {
    const siteNotifications = { ...(store.preferences?.siteNotifications ?? {}), [category]: next };
    await sdk.updateUserPreferences({ siteNotifications });
    store.preferences = { ...(store.preferences ?? {}), siteNotifications };
    usePostHog()?.capture('setting_changed', { setting_name: `notifications.${category}.site`, value: next });
    useToastSuccess(
      t(next ? 'accountSettings.emails.turnedOn' : 'accountSettings.emails.turnedOff', {
        name: `${t(`accountSettings.emails.${category}Title`)} (${t('notifications.channels.site')})`,
      }),
    );
  } catch (caught) {
    handleApiError('notifications.channel', caught, { toastKey: 'accountSettings.emails.preferenceError' });
  } finally {
    busy.value = false;
  }
}

async function toggleEmailCategory(category: NotificationCategory) {
  if (busy.value || !emailMasterOn.value) return;
  busy.value = true;
  const next = !(store.preferences?.productEmails?.[category] !== false);
  try {
    const productEmails = { ...(store.preferences?.productEmails ?? {}), [category]: next };
    await sdk.updateUserPreferences({ productEmails });
    store.preferences = { ...(store.preferences ?? {}), productEmails };
    usePostHog()?.capture('setting_changed', { setting_name: `productEmails.${category}`, value: next });
    useToastSuccess(
      t(next ? 'accountSettings.emails.turnedOn' : 'accountSettings.emails.turnedOff', {
        name: t(`accountSettings.emails.${category}Title`),
      }),
    );
  } catch (caught) {
    handleApiError('account:product-emails-category-failed', caught, {
      toastKey: 'accountSettings.emails.preferenceError',
      context: { 'preference.key': `productEmails.${category}` },
    });
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

  <div data-testid="emails-card" class="nd-settings-card">
    <h3 class="nd-settings-title">{{ $t('notifications.channels.title') }}</h3>

    <div class="mt-4 flex items-center justify-between gap-4">
      <div>
        <p class="font-medium text-white">{{ $t('accountSettings.emails.allTitle') }}</p>
        <p class="text-sm text-gray-400">{{ $t('accountSettings.emails.allDescription') }}</p>
      </div>
      <button
        type="button"
        data-testid="product-emails-toggle"
        :aria-label="$t('accountSettings.emails.allTitle')"
        :disabled="busy"
        :aria-pressed="emailMasterOn"
        :class="[
          'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:cursor-not-allowed',
          emailMasterOn ? 'bg-brand-solid' : 'bg-gray-600',
        ]"
        @click="toggleEmailMaster"
      >
        <span
          :class="[
            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
            emailMasterOn ? 'translate-x-5' : 'translate-x-0',
          ]"
        />
      </button>
    </div>

    <table class="mt-4 w-full border-t border-white/10 text-sm" data-testid="channels-table">
      <thead>
        <tr class="text-left text-xs text-ink-muted">
          <th class="py-2.5 pr-4" />
          <th class="py-2.5 px-2 text-center font-medium">{{ $t('notifications.channels.site') }}</th>
          <th class="py-2.5 pl-2 text-center font-medium">{{ $t('notifications.channels.email') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="category in NOTIFICATION_CATEGORIES" :key="category" class="border-t border-white/5">
          <td class="py-3 pr-4">
            <p class="text-white">{{ $t(`accountSettings.emails.${category}Title`) }}</p>
            <p class="text-xs text-gray-400">{{ $t(`accountSettings.emails.${category}Description`) }}</p>
          </td>
          <td class="py-3 px-2 text-center align-middle">
            <button
              v-if="hasSiteChannel(category)"
              type="button"
              :data-testid="`channel-${category}-site`"
              :aria-label="`${$t(`accountSettings.emails.${category}Title`)}: ${$t('notifications.channels.site')}`"
              :aria-pressed="isSiteOn(category)"
              :disabled="busy"
              :class="[
                'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:cursor-not-allowed',
                isSiteOn(category) ? 'bg-brand-solid' : 'bg-gray-600',
              ]"
              @click="toggleSiteChannel(category)"
            >
              <span
                :class="[
                  'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                  isSiteOn(category) ? 'translate-x-5' : 'translate-x-0',
                ]"
              />
            </button>
            <span v-else class="text-xs text-ink-muted" aria-hidden="true">—</span>
          </td>
          <td :class="['py-3 pl-2 text-center align-middle transition-opacity', emailMasterOn ? '' : 'opacity-50']">
            <button
              type="button"
              :data-testid="`email-category-${category}`"
              :aria-label="`${$t(`accountSettings.emails.${category}Title`)}: ${$t('notifications.channels.email')}`"
              :aria-pressed="isEmailOn(category)"
              :disabled="busy || !emailMasterOn"
              :class="[
                'relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                emailMasterOn && !busy ? 'cursor-pointer' : 'cursor-not-allowed',
                isEmailOn(category) ? 'bg-brand-solid' : 'bg-gray-600',
              ]"
              @click="toggleEmailCategory(category)"
            >
              <span
                :class="[
                  'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                  isEmailOn(category) ? 'translate-x-5' : 'translate-x-0',
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
