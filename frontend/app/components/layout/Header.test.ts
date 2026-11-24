// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick, reactive, ref } from 'vue';

/** Route changes close the drawer automatically; controls opening panels must close it explicitly. */
const isLoggedIn = ref(false);
const isAdmin = ref(false);
const logout = vi.fn();
const openFeedback = vi.fn();
const showLoginModal = vi.fn();
const navigateTo = vi.fn();
const themePreference = ref('dark');
const setThemePreference = vi.fn((next: string) => {
  themePreference.value = next;
});
const route = reactive({ fullPath: '/', path: '/', params: {}, query: {} });

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useRoute', () => route);
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('useThemePreference', () => ({
  attribute: themePreference,
  preference: themePreference,
  setPreference: setThemePreference,
}));
vi.stubGlobal('useLoginModal', () => ({
  openLoginModal: showLoginModal,
  closeLoginModal: vi.fn(),
  isLoginModalOpen: ref(false),
}));
vi.stubGlobal('useFeedbackWidget', () => ({ openFeedback, isFeedbackOpen: ref(false) }));
vi.stubGlobal('navigateTo', navigateTo);
vi.stubGlobal('userStore', () => ({
  get isLoggedIn() {
    return isLoggedIn.value;
  },
  get isAdmin() {
    return isAdmin.value;
  },
  logout,
  user: { id: 'u1', name: 'Reader' },
  userName: 'Reader',
}));

import { useEnterSubmit } from '~/composables/useEnterSubmit';
vi.stubGlobal('useEnterSubmit', useEnterSubmit);

import Header from './Header.vue';

const mounted: { unmount: () => void }[] = [];

function render() {
  const wrapper = mount(Header, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        NuxtImg: true,
        UiBaseIcon: true,
        SearchDropdownContainer: { template: '<div><slot /><slot name="content" /></div>' },
        SearchDropdownMainButton: { template: '<button><slot /></button>' },
        SearchDropdownItem: {
          props: ['text'],
          emits: ['click'],
          template: '<button @click="$emit(\'click\')">{{ text }}</button>',
        },
        // The drawer IS a BaseModal: stubbed as `true` it renders whatever its
        // `open` prop says, and every assertion about the drawer being shut
        // fails -- or worse, passes for the wrong reason.
        CommonBaseModal: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
        LayoutLocaleSwitcher: true,
        CommonFeedbackWidget: true,
      },
    },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return wrapper;
}

const has = (w: ReturnType<typeof render>, id: string) => w.find(`[data-testid="${id}"]`).exists();
const get = (w: ReturnType<typeof render>, id: string) => w.get(`[data-testid="${id}"]`);
const drawerOpen = (w: ReturnType<typeof render>) => w.find('[data-testid="nav-menu"]').exists();

async function openDrawer(w: ReturnType<typeof render>) {
  await get(w, 'hamburger-menu').trigger('click');
  await nextTick();
}

beforeEach(() => {
  vi.clearAllMocks();
  isLoggedIn.value = false;
  isAdmin.value = false;
  route.fullPath = '/';
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.replaceChildren();
});

describe('what a signed-OUT reader is offered', () => {
  test('a way in', async () => {
    const wrapper = render();
    await openDrawer(wrapper);

    expect(has(wrapper, 'nav-login')).toBe(true);
  });

  test('quick theme toggle switches between dark and light even before signing in', async () => {
    themePreference.value = 'dark';
    const wrapper = render();

    await get(wrapper, 'nav-theme-toggle').trigger('click');

    expect(setThemePreference).toHaveBeenCalledWith('light');
  });

  test('and none of the account pages, which would be dead ends', async () => {
    const wrapper = render();
    await openDrawer(wrapper);

    for (const id of ['nav-settings', 'nav-collections', 'nav-anki', 'nav-logout']) {
      expect(has(wrapper, id)).toBe(false);
    }
  });
});

describe('what a signed-IN reader is offered', () => {
  beforeEach(() => {
    isLoggedIn.value = true;
  });

  test('their account pages', async () => {
    const wrapper = render();
    await openDrawer(wrapper);

    for (const id of ['nav-settings', 'nav-anki', 'nav-collections']) {
      expect(has(wrapper, id)).toBe(true);
    }
  });

  test('a way out', async () => {
    const wrapper = render();
    await openDrawer(wrapper);

    expect(has(wrapper, 'nav-logout')).toBe(true);
  });

  test('and not the sign-in prompt', async () => {
    const wrapper = render();
    await openDrawer(wrapper);

    expect(has(wrapper, 'nav-login')).toBe(false);
  });

  test('and not the admin links for a regular reader', async () => {
    const wrapper = render();
    await openDrawer(wrapper);

    expect(has(wrapper, 'nav-admin')).toBe(false);
    expect(has(wrapper, 'nav-admin-mobile')).toBe(false);
  });

  test('admins get admin dashboard links in the profile menu and mobile drawer', async () => {
    isAdmin.value = true;
    const wrapper = render();
    await openDrawer(wrapper);

    expect(has(wrapper, 'nav-admin')).toBe(true);
    expect(has(wrapper, 'nav-admin-mobile')).toBe(true);
  });

  test('signing out closes the drawer as it goes', async () => {
    const wrapper = render();
    await openDrawer(wrapper);

    await get(wrapper, 'nav-logout').trigger('click');
    await nextTick();

    expect(logout).toHaveBeenCalled();
    expect(drawerOpen(wrapper)).toBe(false);
  });
});

describe('the drawer', () => {
  test('starts shut', () => {
    expect(drawerOpen(render())).toBe(false);
  });

  test('the hamburger opens it', async () => {
    const wrapper = render();

    await openDrawer(wrapper);

    expect(drawerOpen(wrapper)).toBe(true);
  });

  test('a navigation closes it, which covers every link inside', async () => {
    const wrapper = render();
    await openDrawer(wrapper);

    route.fullPath = '/en/media';
    await nextTick();

    expect(drawerOpen(wrapper)).toBe(false);
  });

  test('opening feedback closes it too, because a panel is not a navigation', async () => {
    // Left alone the drawer sits open behind the panel it just raised.
    const wrapper = render();
    await openDrawer(wrapper);

    await get(wrapper, 'feedback-nav-link').trigger('click');
    await nextTick();

    expect(openFeedback).toHaveBeenCalled();
    expect(drawerOpen(wrapper)).toBe(false);
  });

  test('and so does the sign-in prompt, which is a modal', async () => {
    const wrapper = render();
    await openDrawer(wrapper);

    await get(wrapper, 'nav-login').trigger('click');
    await nextTick();

    expect(showLoginModal).toHaveBeenCalledWith('header');
    expect(drawerOpen(wrapper)).toBe(false);
  });
});

describe('searching from the drawer', () => {
  async function searchFor(wrapper: ReturnType<typeof render>, term: string) {
    await openDrawer(wrapper);
    const box = wrapper.find('[data-testid="nav-menu"] input');
    if (!box.exists()) throw new Error('no drawer search box');
    await box.setValue(term);
    await box.trigger('keydown', { key: 'Enter' });
    await nextTick();
  }

  test('goes to the search page for what was typed', async () => {
    const wrapper = render();

    await searchFor(wrapper, '猫');

    expect(navigateTo).toHaveBeenCalledWith(`/en/search/${encodeURIComponent('猫')}`);
  });

  test('trims it first', async () => {
    const wrapper = render();

    await searchFor(wrapper, '  猫  ');

    expect(navigateTo).toHaveBeenCalledWith(`/en/search/${encodeURIComponent('猫')}`);
  });

  test('an empty box goes nowhere', async () => {
    const wrapper = render();

    await searchFor(wrapper, '   ');

    expect(navigateTo).not.toHaveBeenCalled();
  });

  test('and closes the drawer on its way', async () => {
    const wrapper = render();

    await searchFor(wrapper, '猫');

    expect(drawerOpen(wrapper)).toBe(false);
  });
});
