<script setup lang="ts">
import { useTimeoutFn } from '@vueuse/core';
import { mdiDotsVertical } from '@mdi/js';
import type { AdminUserWithProviders as AdminUser } from '@brigadasos/nadeshiko-sdk';
import { handleApiError } from '~/utils/apiError';

const AVATAR_TONES = [
  'bg-rose-500/20 text-rose-300',
  'bg-amber-500/20 text-amber-300',
  'bg-emerald-500/20 text-emerald-300',
  'bg-sky-500/20 text-sky-300',
  'bg-violet-500/20 text-violet-300',
  'bg-pink-500/20 text-pink-300',
] as const;

function avatarTone(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length] ?? AVATAR_TONES[0];
}

function avatarLetter(user: AdminUser): string {
  return (user.name || user.email || '?').trim().charAt(0).toUpperCase();
}

const { t } = useI18n();
const { formatNumber, formatDate, formatRelativeTime } = useFormat();
const route = useRoute();
const store = userStore();
const localePath = useLocalePath();

const users = ref<AdminUser[]>([]);
const total = ref(0);
const isLoading = ref(false);
const searchQuery = ref(typeof route.query.q === 'string' ? route.query.q : '');
const currentOffset = ref(0);
const limit = 20;

function roleLabel(role: string | undefined): string {
  switch (role) {
    case 'ADMIN':
      return t('accountSettings.dashboard.roles.ADMIN');
    case 'MOD':
      return t('accountSettings.dashboard.roles.MOD');
    case 'USER':
      return t('accountSettings.dashboard.roles.USER');
    case 'PATREON':
      return t('accountSettings.dashboard.roles.PATREON');
    default:
      return role || '—';
  }
}

const providerLabel = (provider: string) => {
  switch (provider) {
    case 'google':
      return t('accountSettings.dashboard.providers.google');
    case 'discord':
      return t('accountSettings.dashboard.providers.discord');
    case 'magic-link':
    case 'credential':
      return t('accountSettings.dashboard.providers.email');
    default:
      return provider;
  }
};

const statusLabel = (banned: boolean) =>
  banned ? t('accountSettings.dashboard.status.banned') : t('accountSettings.dashboard.status.active');

/** Only the latest request may update the table; search and pagination replies can arrive out of order. */
let latestRequest = 0;

/** Commit the requested offset only after rows arrive, so failed pages do not advance or skip the counter. */
async function fetchUsers(offset = currentOffset.value) {
  const request = ++latestRequest;
  isLoading.value = true;
  try {
    const query: Record<string, string | number> = {
      limit,
      offset,
    };
    if (searchQuery.value.trim()) {
      query.search = searchQuery.value.trim();
    }
    const result = await useNadeshikoSdk().getAdminUsersWithProviders(query);
    if (request !== latestRequest) return;
    users.value = result.users ?? [];
    total.value = result.total ?? 0;
    currentOffset.value = offset;
  } catch (error) {
    if (request !== latestRequest) return;
    handleApiError('admin:users-fetch-failed', error, { toastKey: 'accountSettings.dashboard.loadError' });
  } finally {
    // Only the newest request owns the spinner; an overtaken one turning it off
    // would clear it while the request the reader is waiting for is still out.
    if (request === latestRequest) isLoading.value = false;
  }
}

// `useTimeoutFn` rather than `useDebounceFn`: the latter holds a bare
// `setTimeout` with no scope teardown, so a pending fetch would still run (and
// try to toast) after the admin left this tab.
const { start: scheduleSearch } = useTimeoutFn(
  () => {
    fetchUsers(0);
  },
  300,
  { immediate: false },
);

watch(searchQuery, () => scheduleSearch());

function goToPrev() {
  if (currentOffset.value <= 0) return;
  fetchUsers(Math.max(0, currentOffset.value - limit));
}

function goToNext() {
  if (currentOffset.value + limit >= total.value) return;
  fetchUsers(currentOffset.value + limit);
}

function openEmails(user: AdminUser) {
  navigateTo(localePath({ path: '/admin/emails', query: { q: user.email, days: 365 } }));
}

function openNotificationForUser(user: AdminUser) {
  navigateTo(
    localePath({
      path: '/admin/notifications',
      query: { tab: 'send', userId: String(user.id), username: user.name || user.email },
    }),
  );
}

async function handleImpersonate(user: AdminUser) {
  await store.impersonateUser(user.id);
}

async function handleBan(user: AdminUser) {
  try {
    await useNadeshikoSdk().banUser({ userId: user.id, banReason: '' });
  } catch (error) {
    // Toasted here rather than via `toastKey`: the copy interpolates the user's name.
    handleApiError('admin:ban-user-failed', error, { toastKey: false, context: { 'user.id': String(user.id) } });
    useToastError(t('accountSettings.dashboard.banError', { name: user.name || user.email }));
    return;
  }

  useToastSuccess(t('accountSettings.dashboard.banSuccess', { name: user.name || user.email }));
  await fetchUsers();
}

async function handleUnban(user: AdminUser) {
  try {
    await useNadeshikoSdk().unbanUser({ userId: user.id });
  } catch (error) {
    // Toasted here rather than via `toastKey`: the copy interpolates the user's name.
    handleApiError('admin:unban-user-failed', error, { toastKey: false, context: { 'user.id': String(user.id) } });
    useToastError(t('accountSettings.dashboard.unbanError', { name: user.name || user.email }));
    return;
  }

  useToastSuccess(t('accountSettings.dashboard.unbanSuccess', { name: user.name || user.email }));
  await fetchUsers();
}

onMounted(() => {
  fetchUsers();
});
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold text-white mb-6">{{ t('accountSettings.dashboard.title') }}</h1>

    <div class="flex items-center justify-between mb-4 gap-3">
      <input
        v-model="searchQuery"
        type="text"
        :placeholder="t('accountSettings.dashboard.searchPlaceholder')"
        class="nd-input max-w-sm"
      />
      <span class="text-sm text-gray-400 whitespace-nowrap">{{ t('accountSettings.dashboard.count', { count: formatNumber(total) }) }}</span>
    </div>

    <div v-if="isLoading" class="text-center py-12">
      <div class="animate-spin inline-block w-6 h-6 border-[3px] border-current border-t-transparent text-white rounded-full" role="status" />
    </div>

    <template v-else>
      <div v-if="users.length === 0" class="text-center py-12 text-gray-500 text-sm">
        {{ t('accountSettings.dashboard.empty') }}
      </div>

      <div v-else class="overflow-x-auto rounded-lg border border-hairline bg-card-background">
        <table class="w-full min-w-[820px] text-xs">
          <thead>
            <tr class="border-b border-hairline bg-surface/40 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              <th class="px-3.5 py-2.5">{{ t('accountSettings.dashboard.table.name') }}</th>
              <th class="px-3.5 py-2.5">{{ t('accountSettings.dashboard.table.email') }}</th>
              <th class="px-3.5 py-2.5">{{ t('accountSettings.dashboard.table.role') }}</th>
              <th class="px-3.5 py-2.5">{{ t('accountSettings.dashboard.table.providers') }}</th>
              <th class="px-3.5 py-2.5">{{ t('accountSettings.dashboard.table.registered') }}</th>
              <th class="px-3.5 py-2.5">{{ t('accountSettings.dashboard.table.lastUpdate') }}</th>
              <th class="px-3.5 py-2.5">{{ t('accountSettings.dashboard.table.status') }}</th>
              <th class="w-10 px-3.5 py-2.5" />
            </tr>
          </thead>
          <tbody class="divide-y divide-hairline">
            <tr
              v-for="user in users"
              :key="user.id"
              class="transition-colors hover:bg-surface-hover"
            >
              <td class="px-3.5 py-2 text-ink">
                <div class="flex items-center gap-2.5">
                  <span
                    :class="[
                      'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                      avatarTone(user.email || String(user.id)),
                    ]"
                  >
                    {{ avatarLetter(user) }}
                  </span>
                  <span class="font-medium">{{ user.name || '—' }}</span>
                </div>
              </td>
              <td class="px-3.5 py-2 font-mono text-[11px] text-ink-muted">{{ user.email }}</td>
              <td class="px-3.5 py-2 text-ink-muted capitalize">
                {{ roleLabel(user.role) }}
              </td>
              <td class="px-3.5 py-2">
                <div class="flex flex-wrap gap-1">
                  <template v-if="!user.providers || user.providers.length === 0">
                    <span class="rounded border border-hairline bg-surface-lift px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">{{ t('accountSettings.dashboard.providers.email') }}</span>
                  </template>
                  <template v-for="provider in user.providers" :key="provider">
                    <span
                      v-if="provider === 'google'"
                      class="rounded border border-blue-500/30 bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-300"
                    >{{ providerLabel(provider) }}</span>
                    <span
                      v-else-if="provider === 'discord'"
                      class="rounded border border-indigo-500/30 bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300"
                    >{{ providerLabel(provider) }}</span>
                    <span
                      v-else-if="provider === 'magic-link' || provider === 'credential'"
                      class="rounded border border-hairline bg-surface-lift px-1.5 py-0.5 text-[10px] font-medium text-ink-muted"
                    >{{ providerLabel(provider) }}</span>
                    <span
                      v-else
                      class="rounded border border-hairline bg-surface-lift px-1.5 py-0.5 text-[10px] font-medium text-ink-muted"
                    >{{ provider }}</span>
                  </template>
                </div>
              </td>
              <td class="px-3.5 py-2 text-ink-faint tabular-nums">{{ formatDate(user.createdAt) }}</td>
              <td class="px-3.5 py-2 text-ink-faint tabular-nums">{{ formatRelativeTime(user.updatedAt) }}</td>
              <td class="px-3.5 py-2">
                <span
                  v-if="user.banned"
                  class="rounded-full border border-red-500/30 bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-300"
                >
                  {{ statusLabel(true) }}
                </span>
                <span
                  v-else
                  class="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300"
                >
                  {{ statusLabel(false) }}
                </span>
              </td>
              <td class="relative px-3.5 py-2">
                <SearchDropdownContainer
                  dropdown-id="nd-user-actions"
                  teleport
                  teleport-align="end"
                  dropdown-container-class="z-[60] min-w-[11rem]"
                >
                  <SearchDropdownMainButton
                    :show-chevron="false"
                    test-id="user-menu-toggle"
                    dropdown-button-class="p-1 rounded text-ink-faint hover:text-ink hover:bg-surface-hover transition-colors"
                  >
                    <UiBaseIcon :path="mdiDotsVertical" w="w-4" h="h-4" size="16" />
                  </SearchDropdownMainButton>
                  <template #content>
                    <SearchDropdownItem
                      :text="t('accountSettings.dashboard.actions.impersonate')"
                      @click="handleImpersonate(user)"
                    />
                    <SearchDropdownItem
                      :text="t('adminEmails.title')"
                      @click="openEmails(user)"
                    />
                    <SearchDropdownItem
                      :text="t('adminNotifications.send.submit')"
                      @click="openNotificationForUser(user)"
                    />
                    <SearchDropdownItem
                      v-if="!user.banned"
                      danger
                      :text="t('accountSettings.dashboard.actions.ban')"
                      @click="handleBan(user)"
                    />
                    <SearchDropdownItem
                      v-else
                      :text="t('accountSettings.dashboard.actions.unban')"
                      @click="handleUnban(user)"
                    />
                  </template>
                </SearchDropdownContainer>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="total > limit" class="flex items-center justify-between mt-4 text-sm text-gray-400">
        <span>{{ t('accountSettings.dashboard.pagination.showing', {
          start: formatNumber(currentOffset + 1),
          end: formatNumber(Math.min(currentOffset + limit, total)),
          total: formatNumber(total),
        }) }}</span>
        <div class="flex gap-2">
          <button type="button"
            :disabled="currentOffset <= 0"
            class="px-3 py-1.5 rounded-lg bg-neutral-700 text-white hover:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            @click="goToPrev"
          >
            {{ t('accountSettings.dashboard.pagination.previous') }}
          </button>
          <button type="button"
            :disabled="currentOffset + limit >= total"
            class="px-3 py-1.5 rounded-lg bg-neutral-700 text-white hover:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            @click="goToNext"
          >
            {{ t('accountSettings.dashboard.pagination.next') }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
