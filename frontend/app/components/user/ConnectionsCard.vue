<script setup lang="ts">
import { mdiPatreon } from '@mdi/js';
import { handleApiError } from '~/utils/apiError';

interface PatreonConnection {
  linked: true;
  fullName: string | null;
  active: boolean;
  patronStatus: string | null;
}

const { t } = useI18n();

const patreonConnection = ref<PatreonConnection | null>(null);
const patreonWorking = ref(false);
const patreonUrl = ref('https://www.patreon.com/c/NadeshikoApp');

async function load() {
  try {
    const data = await $fetch<{ connection: PatreonConnection | null; patreonUrl: string }>(
      '/v1/user/connections/patreon',
    );
    patreonConnection.value = data.connection;
    patreonUrl.value = data.patreonUrl;
  } catch (error) {
    handleApiError('patreonConnection.load', error, { toastKey: false });
  }
}

onMounted(load);

async function connectPatreon() {
  patreonWorking.value = true;
  try {
    const { authorizeUrl } = await $fetch<{ authorizeUrl: string }>('/v1/user/connections/patreon', {
      method: 'POST',
    });
    window.location.href = authorizeUrl;
  } catch (error) {
    handleApiError('patreonConnection.start', error);
    patreonWorking.value = false;
  }
}

async function disconnectPatreon() {
  if (!confirm(t('connections.patreon.confirmDisconnect'))) return;
  patreonWorking.value = true;
  try {
    await $fetch('/v1/user/connections/patreon', { method: 'DELETE' });
    patreonConnection.value = null;
  } catch (error) {
    handleApiError('patreonConnection.unlink', error);
  } finally {
    patreonWorking.value = false;
  }
}
</script>

<template>
  <!-- `id` is the target of "link your Patreon account" links from Developer settings and the Support page. -->
  <div id="connections" class="nd-settings-card scroll-mt-24" data-testid="connections-card">
    <h3 class="nd-settings-title">{{ t('connections.title') }}</h3>

    <div class="mt-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div class="flex items-center gap-3">
          <div class="flex size-10 shrink-0 items-center justify-center rounded bg-[#ff424d] text-on-accent" aria-hidden="true"><UiBaseIcon :path="mdiPatreon" size="22" /></div>
          <div>
            <p class="text-white">{{ t('connections.patreon.name') }}</p>
            <p class="text-sm text-gray-400" data-testid="patreon-connection-description">
              {{ patreonConnection
                ? t(patreonConnection.active ? 'connections.patreon.active' : 'connections.patreon.inactive', { name: patreonConnection.fullName || t('connections.patreon.member') })
                : t('connections.patreon.description') }}
            </p>
          </div>
        </div>
        <div class="flex gap-2">
          <a v-if="patreonConnection && !patreonConnection.active" :href="patreonUrl" target="_blank" rel="noopener" class="nd-btn-accent">{{ t('connections.patreon.join') }}</a>
          <button type="button" class="nd-btn grow sm:grow-0" :disabled="patreonWorking" data-testid="patreon-connection-toggle" @click="patreonConnection ? disconnectPatreon() : connectPatreon()">
            {{ t(patreonConnection ? 'connections.patreon.disconnect' : 'connections.patreon.connect') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
