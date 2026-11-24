// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

/** Account actions identify the destructive and download controls cleanly. */
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({
  handleApiError: (...a: unknown[]) => handleApiError(...a),
  apiErrorStatus: () => null,
}));
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (k: string) => k, locale: ref('en') }),
}));

const store = {
  user: { id: 'u1', name: 'Reader', email: 'r@example.test' },
  userName: 'Reader',
  userEmail: 'r@example.test',
  isLoggedIn: true,
  sessions: [],
  listSessions: vi.fn().mockResolvedValue([]),
  changeEmail: vi.fn(),
};

vi.stubGlobal('userStore', () => store);
vi.stubGlobal('useFormat', () => ({ formatDate: (d: unknown) => String(d) }));
vi.stubGlobal('useNadeshikoSdk', () => ({ exportUserData: vi.fn() }));

import AccountSettings from './AccountSettings.vue';

const mounted: { unmount: () => void }[] = [];

async function render() {
  const Host = defineComponent({
    components: { AccountSettings },
    template: '<Suspense><AccountSettings /></Suspense>',
  });
  const wrapper = mount(Host, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        UserConnectionsCard: true,
        ConnectionsCard: true,
        UiBaseIcon: true,
        NuxtLink: { props: ['to'], template: '<a><slot /></a>' },
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.listSessions.mockResolvedValue([]);
  store.changeEmail.mockResolvedValue({ success: true });
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('stable account actions', () => {
  test('identify the destructive and download controls, not adjacent session actions', async () => {
    const wrapper = await render();

    expect(wrapper.get('[data-testid="account-sign-out"]').text()).toBe('accountSettings.account.logout');
    expect(wrapper.get('[data-testid="account-export"]').text()).toBe('accountSettings.account.exportData');
    expect(wrapper.get('[data-testid="account-delete"]').text()).toBe('accountSettings.account.deleteAccountButton');
  });
});
