<script setup lang="ts">
import { mdiCheckBold } from '@mdi/js';
import { handleApiError } from '~/utils/apiError';
import { posthog } from '~/utils/posthogClient';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const localePath = useLocalePath();
const state = ref<'working' | 'done' | 'failed'>('working');
const message = ref('');

onMounted(async () => {
  const code = String(route.query.code ?? '');
  const sealed = String(route.query.state ?? '');
  const error = String(route.query.error ?? '');
  if (error || !code || !sealed) {
    state.value = 'failed';
    message.value = error === 'access_denied' ? t('patreonCallback.declined') : t('patreonCallback.failed');
    return;
  }
  try {
    const data = await $fetch<{ connection?: { active?: boolean; patronStatus?: string | null } }>(
      '/v1/user/connections/patreon/callback',
      { method: 'POST', body: { code, state: sealed } },
    );
    const active = Boolean(data?.connection?.active);
    posthog.capture('patreon_connected', {
      active,
      patron_status: data?.connection?.patronStatus ?? null,
      $set: { patreon_linked: true, is_patron: active },
    });
    await router.replace({ path: route.path, query: {} });
    state.value = 'done';
  } catch (caught) {
    state.value = 'failed';
    message.value = t('patreonCallback.failed');
    handleApiError('patreonConnection.callback', caught, { toastKey: false });
  }
});
</script>

<template>
  <div class="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center text-white" data-testid="patreon-callback">
    <span v-if="state === 'working'" class="nd-spinner" />
    <template v-else-if="state === 'done'">
      <div class="flex size-16 items-center justify-center rounded-full bg-green-500/15 text-green-300"><UiBaseIcon :path="mdiCheckBold" size="30" /></div>
      <h1 class="mt-5 text-3xl font-bold">{{ t('patreonCallback.done') }}</h1>
      <p class="mt-2 text-white/50">{{ t('patreonCallback.doneBody') }}</p>
      <NuxtLink :to="localePath('/user/connections')" class="nd-btn-accent mt-6">{{ t('patreonCallback.backToSettings') }}</NuxtLink>
    </template>
    <template v-else>
      <h1 class="text-3xl font-bold">{{ message }}</h1>
      <NuxtLink :to="localePath('/user/connections')" class="mt-5 text-brand hover:text-brand-hover">{{ t('patreonCallback.backToSettings') }}</NuxtLink>
    </template>
  </div>
</template>
