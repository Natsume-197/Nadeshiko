<script setup lang="ts">
import { useTimeoutFn } from '@vueuse/core';
import { mdiAccountSearchOutline, mdiDotsVertical, mdiMagnify, mdiRefresh } from '@mdi/js';
import type { AdminUserWithProviders as AdminUser } from '@brigadasos/nadeshiko-sdk';
import { handleApiError } from '~/utils/apiError';
import AdminUiBadge, { type AdminTone } from './ui/Badge.vue';
import AdminUiEmpty from './ui/Empty.vue';
import AdminUiPageHeader from './ui/PageHeader.vue';
import AdminUiPagination from './ui/Pagination.vue';

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

function roleTone(role: string | undefined): AdminTone {
  switch (role) {
    case 'ADMIN':
      return 'violet';
    case 'MOD':
      return 'info';
    case 'PATREON':
      return 'brand';
    default:
      return 'neutral';
  }
}

/** Providers as badge labels; an account with none signed up by email. */
function providerLabels(user: AdminUser): string[] {
  const labels = (user.providers ?? []).map(providerLabel);
  return labels.length ? [...new Set(labels)] : [t('accountSettings.dashboard.providers.email')];
}

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

const page = computed(() => Math.floor(currentOffset.value / limit) + 1);

function goToPage(next: number) {
  const offset = (next - 1) * limit;
  if (offset < 0 || offset >= total.value) return;
  fetchUsers(offset);
}

const mounted = ref(false);
onMounted(() => (mounted.value = true));

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

const pendingBan = ref<AdminUser | null>(null);

function confirmBan() {
  const user = pendingBan.value;
  pendingBan.value = null;
  if (user) void handleBan(user);
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
  <div data-testid="admin-users" class="space-y-5">
    <AdminUiPageHeader :title="t('accountSettings.dashboard.title')" :count="formatNumber(total)">
      <template #actions>
        <button
          type="button"
          data-testid="users-refresh"
          :disabled="mounted && isLoading"
          class="nd-btn !h-8 !text-[13px]"
          @click="fetchUsers()"
        >
          <UiBaseIcon :path="mdiRefresh" :size="15" w="w-4" h="h-4" :class="{ 'animate-spin': mounted && isLoading }" />
          <span>{{ t('adminLayout.reload') }}</span>
        </button>
      </template>
    </AdminUiPageHeader>

    <div class="flex flex-wrap items-center gap-2">
      <div class="relative w-full sm:w-72">
        <UiBaseIcon
          :path="mdiMagnify"
          :size="15"
          w="w-4"
          h="h-4"
          class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
        />
        <input
          v-model="searchQuery"
          data-testid="users-search"
          type="search"
          :placeholder="t('accountSettings.dashboard.searchPlaceholder')"
          class="nd-input !h-8 !pl-8 !text-[13px]"
        />
      </div>
    </div>

    <div v-if="isLoading" role="status" class="nd-admin-table-wrap">
      <div v-for="n in 8" :key="n" class="flex items-center gap-4 border-b border-hairline px-4 py-3 last:border-0">
        <span class="size-7 shrink-0 animate-pulse rounded-full bg-surface-lift" />
        <span class="h-3 w-48 animate-pulse rounded bg-surface-lift" />
        <span class="h-3 w-20 animate-pulse rounded bg-surface-lift" />
        <span class="h-3 flex-1 animate-pulse rounded bg-surface-lift" />
      </div>
    </div>

    <div v-else-if="users.length === 0" class="nd-admin-table-wrap">
      <AdminUiEmpty :icon="mdiAccountSearchOutline" :text="t('accountSettings.dashboard.empty')" />
    </div>

    <div v-else class="nd-admin-table-wrap">
      <table class="nd-admin-table min-w-[820px]">
        <thead>
          <tr>
            <th>{{ t('accountSettings.dashboard.table.name') }}</th>
            <th>{{ t('accountSettings.dashboard.table.role') }}</th>
            <th>{{ t('accountSettings.dashboard.table.providers') }}</th>
            <th>{{ t('accountSettings.dashboard.table.registered') }}</th>
            <th>{{ t('accountSettings.dashboard.table.lastUpdate') }}</th>
            <th>{{ t('accountSettings.dashboard.table.status') }}</th>
            <th class="w-12" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id" data-testid="users-row">
            <td>
              <div class="flex min-w-0 items-center gap-2.5">
                <span
                  :class="[
                    'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    avatarTone(user.email || String(user.id)),
                  ]"
                >
                  {{ avatarLetter(user) }}
                </span>
                <div class="min-w-0">
                  <div class="max-w-[16rem] truncate font-medium text-ink">{{ user.name || '—' }}</div>
                  <div class="max-w-[16rem] truncate text-xs text-ink-faint">{{ user.email }}</div>
                </div>
              </div>
            </td>
            <td>
              <AdminUiBadge :tone="roleTone(user.role)">{{ roleLabel(user.role) }}</AdminUiBadge>
            </td>
            <td>
              <div class="flex flex-wrap gap-1">
                <AdminUiBadge v-for="label in providerLabels(user)" :key="label">{{ label }}</AdminUiBadge>
              </div>
            </td>
            <td class="whitespace-nowrap text-xs tabular-nums text-ink-muted">{{ formatDate(user.createdAt) }}</td>
            <td class="whitespace-nowrap text-xs tabular-nums text-ink-faint">{{ formatRelativeTime(user.updatedAt) }}</td>
            <td>
              <AdminUiBadge :tone="user.banned ? 'danger' : 'success'" dot>{{ statusLabel(Boolean(user.banned)) }}</AdminUiBadge>
            </td>
            <td class="text-right">
              <SearchDropdownContainer
                dropdown-id="nd-user-actions"
                teleport
                teleport-align="end"
                dropdown-container-class="z-[60] min-w-[11rem]"
              >
                <SearchDropdownMainButton
                  :show-chevron="false"
                  test-id="user-menu-toggle"
                  dropdown-button-class="inline-flex size-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
                >
                  <UiBaseIcon :path="mdiDotsVertical" :size="16" w="w-4" h="h-4" />
                </SearchDropdownMainButton>
                <template #content>
                  <SearchDropdownItem
                    :text="t('accountSettings.dashboard.actions.impersonate')"
                    @click="handleImpersonate(user)"
                  />
                  <SearchDropdownItem :text="t('adminEmails.title')" @click="openEmails(user)" />
                  <SearchDropdownItem
                    :text="t('adminNotifications.send.submit')"
                    @click="openNotificationForUser(user)"
                  />
                  <SearchDropdownItem
                    v-if="!user.banned"
                    danger
                    :text="t('accountSettings.dashboard.actions.ban')"
                    @click="pendingBan = user"
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

    <AdminUiPagination :page="page" :page-size="limit" :total="total" @update:page="goToPage" />

    <CommonConfirmModal
      :visible="pendingBan !== null"
      :title="t('accountSettings.dashboard.confirmBan.title', { name: pendingBan?.name || pendingBan?.email || '' })"
      :description="t('accountSettings.dashboard.confirmBan.description')"
      :confirm-label="t('accountSettings.dashboard.actions.ban')"
      @confirm="confirmBan"
      @cancel="pendingBan = null"
    />
  </div>
</template>
