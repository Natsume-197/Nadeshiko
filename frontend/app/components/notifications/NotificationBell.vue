<script setup lang="ts">
import { onClickOutside, onKeyStroke } from '@vueuse/core';
import { mdiBellOutline, mdiCogOutline } from '@mdi/js';
import { useNotifications, type NotificationEntry } from '~/composables/useNotifications';
import { posthog } from '~/utils/posthogClient';

/**
 * The bell in the header (task 52). Shows the unread count, refreshed on navigation at most once a minute. The
 * notifications themselves live only here, in a floating panel (a sheet under the header on a phone), with older ones
 * loaded in place; the page behind the gear is for settings, not for reading. An entry is marked read when opened.
 */
withDefaults(defineProps<{ variant?: 'desktop' | 'mobile' }>(), { variant: 'desktop' });

const route = useRoute();
const localePath = useLocalePath();
const store = userStore();
const { unreadCount, items, hasMore, loading, refreshUnread, load, markRead, reset } = useNotifications();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

const badge = computed(() => (unreadCount.value > 99 ? '99+' : String(unreadCount.value)));

watch(
  () => route.fullPath,
  () => {
    open.value = false;
    if (store.isLoggedIn) void refreshUnread();
  },
);
// Runs on mount too. The header holds two bells (phone and desktop) sharing one throttle, so a page load asks once.
watch(
  () => store.isLoggedIn,
  (signedIn) => {
    if (signedIn) void refreshUnread();
    else reset();
  },
  { immediate: true },
);

async function toggle() {
  open.value = !open.value;
  if (open.value) {
    posthog.capture('notification_bell_opened', { unread_count: unreadCount.value });
    await load().catch(() => undefined);
  }
}

async function loadOlder() {
  await load(true).catch(() => undefined);
}

function onEntryOpen(entry: NotificationEntry) {
  open.value = false;
  posthog.capture('notification_clicked', { kind: entry.kind, was_unread: !entry.read });
  if (!entry.read) void markRead([entry.id]).catch(() => undefined);
}

async function markAll() {
  await markRead().catch(() => undefined);
}

onClickOutside(root, () => {
  open.value = false;
});
onKeyStroke('Escape', () => {
  open.value = false;
});
</script>

<template>
  <div ref="root" class="relative flex items-center" data-testid="notification-bell">
    <button
      type="button"
      class="relative inline-flex size-9 items-center justify-center rounded-lg text-white hover:bg-white/10 focus:outline-none focus-visible:bg-white/10"
      :class="{ 'bg-white/10': variant === 'mobile' }"
      :aria-label="unreadCount > 0 ? $t('notifications.bell.labelUnread', { count: unreadCount }) : $t('notifications.bell.label')"
      :aria-expanded="open"
      aria-haspopup="dialog"
      data-testid="notification-bell-button"
      @click="toggle"
    >
      <UiBaseIcon :path="mdiBellOutline" :size="20" w="w-5" h="h-5" aria-hidden="true" />
      <span
        v-if="unreadCount > 0"
        class="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-brand-solid px-1 text-center text-[10px] font-bold leading-[18px] text-white"
        data-testid="notification-badge"
      >{{ badge }}</span>
    </button>

    <div
      v-if="open"
      class="nd-menu z-50 flex flex-col overflow-hidden !p-0"
      :class="
        variant === 'mobile'
          ? 'fixed inset-x-2 top-14 max-h-[calc(100dvh-4.5rem)]'
          : 'absolute right-0 top-full mt-2 w-[22rem] max-h-[min(34rem,calc(100vh-5rem))]'
      "
      role="dialog"
      :aria-label="$t('notifications.bell.label')"
      data-testid="notification-panel"
    >
      <div class="flex items-center justify-between gap-2 border-b border-hairline px-4 py-2.5">
        <span class="text-sm font-semibold text-ink">{{ $t('notifications.bell.label') }}</span>
        <div class="flex items-center gap-0.5">
          <button
            v-if="unreadCount > 0"
            type="button"
            class="rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-lift hover:text-ink"
            data-testid="notification-mark-all"
            @click="markAll"
          >
            {{ $t('notifications.bell.markAllRead') }}
          </button>
          <NuxtLink
            :to="localePath('/user/notifications')"
            class="inline-flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-lift hover:text-ink"
            :aria-label="$t('notifications.bell.settings')"
            :title="$t('notifications.bell.settings')"
            data-testid="notification-settings"
            @click="open = false"
          >
            <UiBaseIcon :path="mdiCogOutline" :size="16" w="w-4" h="h-4" aria-hidden="true" />
          </NuxtLink>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="notification-list">
        <p v-if="loading && items.length === 0" class="px-4 py-10 text-center text-sm text-ink-faint">
          {{ $t('notifications.bell.loading') }}
        </p>
        <div
          v-else-if="items.length === 0"
          class="flex flex-col items-center gap-2 px-4 py-10 text-sm text-ink-faint"
          data-testid="notification-empty"
        >
          <UiBaseIcon :path="mdiBellOutline" :size="28" w="w-7" h="h-7" aria-hidden="true" />
          {{ $t('notifications.bell.empty') }}
        </div>
        <div v-else class="divide-y divide-hairline">
          <NotificationsNotificationEntry v-for="entry in items" :key="entry.id" :entry="entry" @open="onEntryOpen" />
        </div>
      </div>

      <button
        v-if="hasMore"
        type="button"
        class="border-t border-hairline px-4 py-2.5 text-center text-xs font-medium text-ink-muted transition-colors hover:bg-surface-lift hover:text-ink disabled:opacity-60"
        :disabled="loading"
        data-testid="notification-load-more"
        @click="loadOlder"
      >
        {{ $t('notifications.bell.loadMore') }}
      </button>
    </div>
  </div>
</template>
