<script setup lang="ts">
import { mdiPatreon } from '@mdi/js';
import { handleApiError } from '~/utils/apiError';
import { posthog } from '~/utils/posthogClient';

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
    posthog.setPersonProperties({
      patreon_linked: Boolean(data.connection),
      is_patron: Boolean(data.connection?.active),
    });
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
  const wasActive = Boolean(patreonConnection.value?.active);
  patreonWorking.value = true;
  try {
    await $fetch('/v1/user/connections/patreon', { method: 'DELETE' });
    patreonConnection.value = null;
    posthog.capture('patreon_disconnected', {
      was_active: wasActive,
      $set: { patreon_linked: false, is_patron: false },
    });
  } catch (error) {
    handleApiError('patreonConnection.unlink', error);
  } finally {
    patreonWorking.value = false;
  }
}
</script>

<template>
  <!-- `id` is the target of "link your Patreon account" links from Developer settings and the Support page. -->
  <section id="connections" class="nd-settings-section scroll-mt-24" data-testid="connections-card">
    <h2 class="nd-settings-section-label">{{ t('connections.title') }}</h2>

    <div class="nd-settings-group">
      <div class="nd-settings-item">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div class="flex items-center gap-3 min-w-0">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#ff424d] text-on-accent" aria-hidden="true">
              <UiBaseIcon :path="mdiPatreon" size="22" />
            </div>
            <div class="min-w-0">
              <p class="nd-settings-row-title">{{ t('connections.patreon.name') }}</p>
              <p class="nd-settings-row-desc" data-testid="patreon-connection-description">
                {{ patreonConnection
                  ? t(patreonConnection.active ? 'connections.patreon.active' : 'connections.patreon.inactive', { name: patreonConnection.fullName || t('connections.patreon.member') })
                  : t('connections.patreon.description') }}
              </p>
            </div>
          </div>
          <div class="flex gap-2 shrink-0">
            <a v-if="patreonConnection && !patreonConnection.active" :href="patreonUrl" target="_blank" rel="noopener" class="nd-btn-accent">{{ t('connections.patreon.join') }}</a>
            <button type="button" class="nd-btn grow sm:grow-0" :disabled="patreonWorking" data-testid="patreon-connection-toggle" @click="patreonConnection ? disconnectPatreon() : connectPatreon()">
              {{ t(patreonConnection ? 'connections.patreon.disconnect' : 'connections.patreon.connect') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
