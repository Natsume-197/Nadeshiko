// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { reactive, ref } from 'vue';

const route = reactive<{
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  fullPath: string;
}>({
  path: '/en/admin',
  params: {},
  query: {},
  fullPath: '/en/admin',
});

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k: string) => k, locale: ref('en') }) }));
vi.mock('vue-router', () => ({ useRoute: () => route }));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('definePageMeta', vi.fn());
vi.stubGlobal('defineNuxtRouteMiddleware', (fn: unknown) => fn);
vi.stubGlobal('navigateTo', vi.fn());

import AdminShell from './admin.vue';

const mounted: { unmount: () => void }[] = [];

function render(path = '/en/admin') {
  route.path = path;
  route.fullPath = path;
  const wrapper = mount(AdminShell, {
    global: {
      stubs: {
        NuxtLink: { props: ['to'], inheritAttrs: true, template: '<a :href="to"><slot /></a>' },
        NuxtPage: true,
        UiBaseIcon: true,
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});

describe('Admin shell', () => {
  test('guards with the shared auth and admin middleware', () => {
    render('/en/admin');
    expect(definePageMeta).toHaveBeenCalledWith(
      expect.objectContaining({ middleware: ['auth', 'locale-preference', 'require-admin'] }),
    );
  });

  test('hides the back link on /admin home', () => {
    const wrapper = render('/en/admin');
    expect(wrapper.find('[data-testid="admin-back-home"]').exists()).toBe(false);
  });

  test('shows a back-to-dashboard link on admin sub-pages', () => {
    const wrapper = render('/es/admin/reports');
    const back = wrapper.get('[data-testid="admin-back-home"]');
    expect(back.attributes('href')).toBe('/en/admin');
  });
});
