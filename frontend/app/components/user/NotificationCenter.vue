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
const SITE_CATEGORIES = ['words', 'requests', 'reports'] as const;
type SiteCategory = (typeof SITE_CATEGORIES)[number];
const NOTIFICATION_CATEGORIES = ['words', 'requests', 'recap', 'checkins', 'updates'] as const;
type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

const emailMasterOn = computed(() => store.preferences?.productEmails?.enabled !== false);

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
  <section id="alerts" class="nd-settings-section">
    <div class="mb-2 flex items-center justify-between gap-4 px-1">
      <h2 class="nd-settings-section-label !mb-0 !px-0">{{ $t('notifications.alerts.title') }}</h2>
      <span v-if="alerts" class="shrink-0 text-xs text-ink-muted" data-testid="alerts-count">
        {{ $t('notifications.alerts.count', { active: alerts.activeCount, limit: alerts.limit }) }}
      </span>
    </div>

    <div class="nd-settings-group">
      <div v-if="alertsError" class="nd-settings-item">
        <p class="text-sm text-red-400" role="alert">{{ $t('notifications.alerts.loadError') }}</p>
      </div>
      <div v-else-if="alerts && alerts.items.length === 0" class="nd-settings-item">
        <p class="text-sm text-ink-muted">{{ $t('notifications.alerts.empty') }}</p>
      </div>

      <ul v-if="alerts && alerts.items.length > 0" class="divide-y divide-line-subtle" data-testid="alerts-list">
        <li v-for="alert in alerts.items" :key="alert.id" class="flex flex-wrap items-center gap-3 px-5 py-3.5">
          <NuxtLink :to="localePath(wordPath(alert))" class="min-w-0 flex-1" data-testid="alert-word">
            <span class="text-base font-semibold text-ink" lang="ja">{{ alert.query }}</span>
            <span class="block text-xs text-ink-muted mt-0.5">{{ statusLabel(alert) }}</span>
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
  </section>

  <section data-testid="site-notifications-card" class="nd-settings-section">
    <h2 class="nd-settings-section-label">{{ $t('notifications.channels.siteSection') }}</h2>

    <div class="nd-settings-group">
      <div v-for="category in SITE_CATEGORIES" :key="category" class="nd-settings-item">
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0 flex-1">
            <p class="nd-settings-row-title">{{ $t(`accountSettings.emails.${category}Title`) }}</p>
            <p class="nd-settings-row-desc">{{ $t(`accountSettings.emails.${category}Description`) }}</p>
          </div>
          <button
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
        </div>
      </div>
    </div>
  </section>

  <section data-testid="emails-card" class="nd-settings-section">
    <h2 class="nd-settings-section-label">{{ $t('notifications.channels.emailSection') }}</h2>

    <div class="nd-settings-group">
      <div class="nd-settings-item bg-lift">
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0 flex-1">
            <p class="nd-settings-row-title">{{ $t('accountSettings.emails.allTitle') }}</p>
            <p class="nd-settings-row-desc">{{ $t('accountSettings.emails.allDescription') }}</p>
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
      </div>

      <div
        v-for="category in NOTIFICATION_CATEGORIES"
        :key="category"
        :class="['nd-settings-item transition-opacity', emailMasterOn ? '' : 'opacity-50']"
      >
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0 flex-1">
            <p class="nd-settings-row-title">{{ $t(`accountSettings.emails.${category}Title`) }}</p>
            <p class="nd-settings-row-desc">{{ $t(`accountSettings.emails.${category}Description`) }}</p>
          </div>
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
        </div>
      </div>
    </div>
  </section>
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
