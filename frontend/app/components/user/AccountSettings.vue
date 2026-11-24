<script setup lang="ts">
import { useI18n } from 'vue-i18n';

import type { UserSession } from '@/stores/auth';
import { handleApiError } from '~/utils/apiError';

const { t } = useI18n();
const { formatDate } = useFormat();

const user_store = userStore();
const sdk = useNadeshikoSdk();

const sessionsActionLoading = ref(false);
const sessionsError = ref('');
const deletingAccount = ref(false);
const deleteAccountError = ref('');
const loggingOut = ref(false);
const exportingData = ref(false);

const editingEmail = ref(false);
const newEmail = ref('');
const changingEmail = ref(false);
const changeEmailMessage = ref('');
const changeEmailError = ref('');

const requestEmailChange = async () => {
  if (changingEmail.value || !newEmail.value.trim()) return;
  changingEmail.value = true;
  changeEmailMessage.value = '';
  changeEmailError.value = '';
  try {
    const result = await user_store.changeEmail(newEmail.value.trim());
    if (result.success) {
      changeEmailMessage.value = t('accountSettings.account.changeEmailSuccess');
      editingEmail.value = false;
    } else {
      changeEmailError.value = result.error || t('accountSettings.account.changeEmailFailed');
    }
  } finally {
    changingEmail.value = false;
  }
};

const sessionsData = ref<UserSession[]>([]);
const sessionsLoading = ref(false);
const sessionRows = computed(() => sessionsData.value);

const refreshSessions = async () => {
  sessionsLoading.value = true;
  try {
    sessionsData.value = await user_store.listSessions();
  } finally {
    sessionsLoading.value = false;
  }
};

onMounted(() => {
  void refreshSessions();
});

const detectDeviceType = (userAgent?: string | null) => {
  if (!userAgent) return t('accountSettings.account.sessionDetails.unknownDevice');

  const ua = userAgent.toLowerCase();
  if (ua.includes('ipad') || ua.includes('tablet')) return t('accountSettings.account.sessionDetails.tablet');
  if (ua.includes('mobi') || ua.includes('android') || ua.includes('iphone') || ua.includes('ipod'))
    return t('accountSettings.account.sessionDetails.mobile');
  return t('accountSettings.account.sessionDetails.desktop');
};

const detectOperatingSystem = (userAgent?: string | null) => {
  if (!userAgent) return t('accountSettings.account.sessionDetails.unknownOs');

  const ua = userAgent.toLowerCase();
  if (ua.includes('windows')) return 'Windows';
  if (ua.includes('mac os x') || ua.includes('macintosh')) return 'macOS';
  if (ua.includes('android')) return 'Android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) return 'iOS';
  if (ua.includes('cros')) return 'ChromeOS';
  if (ua.includes('linux')) return 'Linux';
  return t('accountSettings.account.sessionDetails.unknownOs');
};

const detectBrowser = (userAgent?: string | null) => {
  if (!userAgent) return t('accountSettings.account.sessionDetails.unknownBrowser');

  const ua = userAgent.toLowerCase();
  if (ua.includes('edg/')) return 'Edge';
  if (ua.includes('opr/') || ua.includes('opera/')) return 'Opera';
  if (ua.includes('firefox/')) return 'Firefox';
  if (ua.includes('chrome/')) return 'Chrome';
  if (ua.includes('safari/')) return 'Safari';
  return t('accountSettings.account.sessionDetails.unknownBrowser');
};

const formatUserAgent = (userAgent?: string | null) => {
  if (!userAgent) return '-';

  return [detectDeviceType(userAgent), detectOperatingSystem(userAgent), detectBrowser(userAgent)].join(' | ');
};

const isCurrentSession = (token?: string) => {
  return token && token === user_store.currentSessionToken;
};

const revokeSingleSession = async (token?: string) => {
  if (!token || sessionsActionLoading.value) return;

  sessionsActionLoading.value = true;
  sessionsError.value = '';
  try {
    const success = await user_store.revokeSession(token);
    if (!success) {
      sessionsError.value = t('accountSettings.account.sessions.errors.revokeSingle');
      return;
    }

    if (user_store.isLoggedIn) {
      await refreshSessions();
    }
  } finally {
    sessionsActionLoading.value = false;
  }
};

const revokeOtherUserSessions = async () => {
  if (sessionsActionLoading.value) return;

  sessionsActionLoading.value = true;
  sessionsError.value = '';
  try {
    const success = await user_store.revokeOtherSessions();
    if (!success) {
      sessionsError.value = t('accountSettings.account.sessions.errors.revokeOthers');
      return;
    }

    await refreshSessions();
  } finally {
    sessionsActionLoading.value = false;
  }
};

const revokeAllUserSessions = async () => {
  if (sessionsActionLoading.value) return;
  if (!confirm(t('accountSettings.account.sessions.confirmRevokeAll'))) return;

  sessionsActionLoading.value = true;
  sessionsError.value = '';
  try {
    const success = await user_store.revokeSessions();
    if (!success) {
      sessionsError.value = t('accountSettings.account.sessions.errors.revokeAll');
      return;
    }
  } finally {
    sessionsActionLoading.value = false;
  }
};

const exportData = async () => {
  if (exportingData.value) return;
  exportingData.value = true;
  try {
    const data = await sdk.exportUserData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nadeshiko-data-export.json';
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    // The download simply never starts otherwise, with nothing on screen to say why.
    handleApiError('account:data-export-failed', error, { toastKey: 'accountSettings.account.exportError' });
  } finally {
    exportingData.value = false;
  }
};

const deleteCurrentAccount = async () => {
  if (deletingAccount.value) return;
  if (!confirm(t('accountSettings.account.confirmDeleteAccount'))) return;

  deletingAccount.value = true;
  deleteAccountError.value = '';
  try {
    const success = await user_store.deleteAccount();
    if (!success) {
      deleteAccountError.value = t('accountSettings.account.deleteAccountError');
      return;
    }

    await user_store.logout(t('accountSettings.account.accountDeleted'));
  } finally {
    deletingAccount.value = false;
  }
};

const logoutCurrentUser = async () => {
  if (loggingOut.value) return;
  loggingOut.value = true;
  try {
    await user_store.logout();
  } finally {
    loggingOut.value = false;
  }
};
</script>

<template>
  <section class="nd-settings-section">
    <h2 class="nd-settings-section-label">{{ $t('accountSettings.account.infoTitle') }}</h2>

    <div class="nd-settings-group">
      <div class="nd-settings-item">
        <div class="nd-settings-row">
          <div class="min-w-0 flex-1">
            <p class="nd-settings-row-desc !mt-0">{{ $t('accountSettings.account.usernameLabel') }}</p>
            <p data-testid="account-username" class="text-sm font-semibold text-ink mt-0.5">
              {{ user_store.userName || $t('accountSettings.account.notAvailable') }}
            </p>
          </div>
          <button
            type="button"
            data-testid="account-sign-out"
            class="nd-btn-accent shrink-0"
            :disabled="loggingOut"
            @click="logoutCurrentUser"
          >
            {{ loggingOut ? $t('accountSettings.account.loggingOut') : $t('accountSettings.account.logout') }}
          </button>
        </div>
      </div>

      <div class="nd-settings-item">
        <div class="nd-settings-row">
          <div class="min-w-0 flex-1">
            <p class="nd-settings-row-desc !mt-0">{{ $t('accountSettings.account.emailLabel') }}</p>
            <template v-if="!editingEmail">
              <p data-testid="account-email" class="text-sm font-semibold text-ink mt-0.5">
                {{ user_store.userEmail || $t('accountSettings.account.notAvailable') }}
              </p>
            </template>
            <template v-else>
              <div class="flex flex-wrap items-center gap-2 mt-2">
                <input
                  v-model="newEmail"
                  type="email"
                  :placeholder="$t('accountSettings.account.changeEmailPlaceholder')"
                  class="nd-select flex-1 min-w-[12rem]"
                  :disabled="changingEmail"
                  @keyup.enter="requestEmailChange"
                />
                <button
                  type="button"
                  class="nd-btn"
                  :disabled="changingEmail || !newEmail.trim()"
                  @click="requestEmailChange"
                >
                  {{ changingEmail ? $t('accountSettings.account.changeEmailSending') : $t('accountSettings.account.changeEmailSend') }}
                </button>
                <button
                  type="button"
                  class="nd-btn"
                  @click="editingEmail = false; changeEmailError = ''"
                >
                  {{ $t('accountSettings.account.changeEmailCancel') }}
                </button>
              </div>
            </template>
            <p v-if="changeEmailMessage" class="text-green-400 text-sm mt-1.5">{{ changeEmailMessage }}</p>
            <p v-if="changeEmailError" class="text-red-300 text-sm mt-1.5">{{ changeEmailError }}</p>
          </div>
          <button
            v-if="!editingEmail"
            type="button"
            class="nd-btn shrink-0"
            @click="editingEmail = true; newEmail = ''; changeEmailMessage = ''; changeEmailError = ''"
          >
            {{ $t('accountSettings.account.changeEmail') }}
          </button>
        </div>
      </div>
    </div>
  </section>

  <section class="nd-settings-section" data-testid="sessions-card">
    <h2 class="nd-settings-section-label">{{ $t('accountSettings.account.sessions.title') }}</h2>

    <div class="nd-settings-group">
      <div class="nd-settings-item flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          class="nd-btn"
          :disabled="sessionsLoading || sessionsActionLoading"
          @click="refreshSessions()"
        >
          {{ $t('accountSettings.account.sessions.refresh') }}
        </button>
        <button
          type="button"
          class="nd-btn"
          :disabled="sessionsLoading || sessionsActionLoading"
          @click="revokeOtherUserSessions"
        >
          {{ $t('accountSettings.account.sessions.logoutOtherDevices') }}
        </button>
        <button
          type="button"
          class="nd-btn-accent"
          :disabled="sessionsLoading || sessionsActionLoading"
          @click="revokeAllUserSessions"
        >
          {{ $t('accountSettings.account.sessions.logoutAllSessions') }}
        </button>
      </div>

      <div class="nd-settings-item">
        <p v-if="sessionsError" class="text-sm text-red-300 mb-3">{{ sessionsError }}</p>
        <p v-if="sessionsLoading" data-testid="sessions-loading" class="text-sm text-ink-muted">
          {{ $t('accountSettings.account.sessions.loading') }}
        </p>

        <!-- Below `md` a session is a block: the device on its own line, then the
             two dates labelled (the header that named them is gone), then Revoke.
             Two full timestamps and a user agent will not share a phone's width. -->
        <div v-else class="md:overflow-x-auto">
          <table v-if="sessionRows.length > 0" class="block w-full md:table md:min-w-full md:divide-y md:divide-line-subtle">
            <thead class="hidden md:table-header-group">
              <tr>
                <th class="pb-2.5 text-left text-xs font-medium text-ink-faint uppercase">
                  {{ $t('accountSettings.account.sessions.table.userAgent') }}
                </th>
                <th class="pb-2.5 text-left text-xs font-medium text-ink-faint uppercase">
                  {{ $t('accountSettings.account.sessions.table.created') }}
                </th>
                <th class="pb-2.5 text-left text-xs font-medium text-ink-faint uppercase">
                  {{ $t('accountSettings.account.sessions.table.expires') }}
                </th>
                <th class="pb-2.5 text-left text-xs font-medium text-ink-faint uppercase" />
              </tr>
            </thead>
            <tbody class="block md:table-row-group md:divide-y md:divide-line-subtle">
              <tr
                v-for="session in sessionRows"
                :key="session.token"
                :data-testid="isCurrentSession(session.token) ? 'session-row-current' : 'session-row'"
                :class="[
                  'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-subtle py-3 last:border-0 md:table-row md:border-0 md:py-0',
                  { 'bg-lift': isCurrentSession(session.token) },
                ]"
              >
                <td class="order-1 w-full min-w-0 break-words text-sm text-ink md:w-auto md:table-cell md:py-3">
                  {{ formatUserAgent(session.userAgent) }}
                  <span
                    v-if="isCurrentSession(session.token)"
                    class="ml-2 inline-flex items-center rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-400"
                  >
                    {{ $t('accountSettings.account.sessions.current') }}
                  </span>
                </td>
                <td class="order-2 text-xs text-ink-muted md:table-cell md:py-3 md:text-sm">
                  <span class="md:hidden">{{ $t('accountSettings.account.sessions.table.created') }}: </span>{{ formatDate(session.createdAt, 'dateTime') }}
                </td>
                <td class="order-3 w-full text-xs text-ink-muted md:w-auto md:table-cell md:py-3 md:text-sm">
                  <span class="md:hidden">{{ $t('accountSettings.account.sessions.table.expires') }}: </span>{{ formatDate(session.expiresAt, 'dateTime') }}
                </td>
                <td class="order-4 ml-auto text-sm md:ml-0 md:table-cell md:py-3 md:text-right">
                  <button
                    v-if="!isCurrentSession(session.token)"
                    type="button"
                    class="nd-btn-accent"
                    :disabled="sessionsActionLoading"
                    @click="revokeSingleSession(session.token)"
                  >
                    {{ $t('accountSettings.account.sessions.revoke') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          <p v-else data-testid="sessions-empty-state" class="text-sm text-ink-muted">
            {{ $t('accountSettings.account.sessions.empty') }}
          </p>
        </div>
      </div>
    </div>
  </section>

  <section class="nd-settings-section">
    <h2 class="nd-settings-section-label">{{ $t('accountSettings.account.additionalTitle') }}</h2>

    <div class="nd-settings-group">
      <div class="nd-settings-item">
        <div class="nd-settings-row">
          <div class="min-w-0 flex-1">
            <p class="nd-settings-row-title">{{ $t('accountSettings.account.exportData') }}</p>
            <p class="nd-settings-row-desc">{{ $t('accountSettings.account.exportDataDescription') }}</p>
          </div>
          <button
            type="button"
            data-testid="account-export"
            class="nd-btn shrink-0"
            :disabled="exportingData"
            @click="exportData"
          >
            {{ exportingData ? $t('accountSettings.account.exportingData') : $t('accountSettings.account.exportData') }}
          </button>
        </div>
      </div>

      <div class="nd-settings-item">
        <div class="nd-settings-row">
          <div class="min-w-0 flex-1">
            <p class="nd-settings-row-title">{{ $t('accountSettings.account.deleteAccount') }}</p>
          </div>
          <button
            type="button"
            data-testid="account-delete"
            class="nd-btn-accent shrink-0"
            :disabled="deletingAccount"
            @click="deleteCurrentAccount"
          >
            {{ deletingAccount ? $t('accountSettings.account.deletingAccount') : $t('accountSettings.account.deleteAccountButton') }}
          </button>
        </div>
        <p v-if="deleteAccountError" class="text-red-300 text-sm mt-2">{{ deleteAccountError }}</p>
      </div>
    </div>
  </section>
</template>
