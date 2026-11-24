// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { reactive, ref } from 'vue';

const sdk = {
  getUnreadNotificationCount: vi.fn(),
  listNotifications: vi.fn(),
  markNotificationsRead: vi.fn(),
};
const navigateTo = vi.fn();
const store = reactive({ isLoggedIn: true });
const route = reactive({ fullPath: '/search' });
const state = new Map<string, ReturnType<typeof ref>>();

vi.stubGlobal('useNadeshikoSdk', () => sdk);
vi.stubGlobal('useFormat', () => ({
  formatRelativeTime: (value: string) => value.slice(0, 10),
  formatNumber: (value: number) => value.toLocaleString('en'),
}));
vi.stubGlobal('navigateTo', navigateTo);
vi.stubGlobal('useRoute', () => route);
vi.stubGlobal('useI18n', () => ({ t: (key: string) => key, locale: ref('en') }));
vi.stubGlobal('useLocalePath', () => (path: string) => `/en${path}`);
vi.stubGlobal('userStore', () => store);
vi.stubGlobal('useState', <T>(key: string, init: () => T) => {
  if (!state.has(key)) state.set(key, ref(init()));
  return state.get(key);
});

import NotificationBell from './NotificationBell.vue';
import NotificationEntry from './NotificationEntry.vue';
import { notificationTarget } from '~/composables/useNotifications';

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'n-1',
  kind: 'word-available',
  payload: { words: [{ query: '憧憬', matchMode: 'WORD', titles: ['Frieren'], sentences: 2 }] },
  read: false,
  createdAt: '2026-11-24T05:30:00Z',
  ...over,
});

const mounted: { unmount: () => void }[] = [];

async function render(props: Record<string, unknown> = {}) {
  const wrapper = mount(NotificationBell, {
    props,
    attachTo: document.body,
    global: {
      mocks: {
        $t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key),
      },
      stubs: {
        NuxtLink: { props: ['to'], template: '<a :href="to" @click="$emit(\'click\')"><slot /></a>' },
        UiBaseIcon: true,
        NotificationsNotificationEntry: NotificationEntry,
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.clear();
  store.isLoggedIn = true;
  sdk.getUnreadNotificationCount.mockResolvedValue({ count: 3 });
  sdk.listNotifications.mockResolvedValue({ items: [entry()], unreadCount: 3, hasMore: false });
  sdk.markNotificationsRead.mockResolvedValue({ unreadCount: 0 });
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('NotificationBell', () => {
  test('shows the unread count', async () => {
    const wrapper = await render();
    expect(wrapper.get('[data-testid="notification-badge"]').text()).toBe('3');
  });

  test('opens the latest entries and marks them all read', async () => {
    const wrapper = await render();
    await wrapper.get('[data-testid="notification-bell-button"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="notification-panel"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="notification-entry"]')).toHaveLength(1);
    expect(wrapper.text()).toContain('notifications.kinds.wordAvailable');

    await wrapper.get('[data-testid="notification-mark-all"]').trigger('click');
    await flushPromises();
    expect(sdk.markNotificationsRead).toHaveBeenCalledWith({});
    expect(wrapper.find('[data-testid="notification-badge"]').exists()).toBe(false);
    // Marking read keeps the panel open: the reader is still reading it.
    expect(wrapper.find('[data-testid="notification-panel"]').exists()).toBe(true);
  });

  test('opens the same floating panel on a phone, with no page change', async () => {
    const wrapper = await render({ variant: 'mobile' });
    await wrapper.get('[data-testid="notification-bell-button"]').trigger('click');
    await flushPromises();
    expect(navigateTo).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="notification-panel"]').classes()).toContain('fixed');
  });

  test('loads older entries in place, and links to the settings', async () => {
    sdk.listNotifications
      .mockResolvedValueOnce({ items: [entry()], unreadCount: 1, hasMore: true })
      .mockResolvedValueOnce({
        items: [entry({ id: 'n-2', read: true, createdAt: '2026-11-17T05:30:00Z' })],
        unreadCount: 1,
        hasMore: false,
      });
    const wrapper = await render();
    await wrapper.get('[data-testid="notification-bell-button"]').trigger('click');
    await flushPromises();

    await wrapper.get('[data-testid="notification-load-more"]').trigger('click');
    await flushPromises();
    expect(sdk.listNotifications).toHaveBeenLastCalledWith({ take: 10, before: '2026-11-24T05:30:00Z' });
    expect(wrapper.findAll('[data-testid="notification-entry"]')).toHaveLength(2);
    expect(wrapper.find('[data-testid="notification-load-more"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="notification-settings"]').attributes('href')).toBe('/en/user/notifications');
  });

  test('lists each word of a several-word notice as its own link', async () => {
    sdk.listNotifications.mockResolvedValue({
      items: [
        entry({
          kind: 'word-digest',
          payload: {
            words: [
              { query: '行く', matchMode: 'WORD', newSentences: 12 },
              { query: '学校', matchMode: 'CONTAINS', newSentences: 4 },
            ],
          },
        }),
      ],
      unreadCount: 1,
      hasMore: false,
    });
    const wrapper = await render();
    await wrapper.get('[data-testid="notification-bell-button"]').trigger('click');
    await flushPromises();

    const links = wrapper.findAll('[data-testid="notification-word"]');
    expect(links.map((link) => link.attributes('href'))).toEqual([
      `/en/search/${encodeURIComponent('行く')}`,
      `/en/search/${encodeURIComponent('学校')}?match=contains`,
    ]);
    expect(links[0]?.text()).toContain('+12');
  });

  test('asks nothing when signed out', async () => {
    store.isLoggedIn = false;
    await render();
    expect(sdk.getUnreadNotificationCount).not.toHaveBeenCalled();
  });
});

describe('notificationTarget', () => {
  test('leads a single word to its search, and leaves several words to their own links', () => {
    expect(notificationTarget(entry() as never)).toBe(`/search/${encodeURIComponent('憧憬')}`);
    expect(notificationTarget(entry({ payload: { words: [{ query: 'あ' }, { query: 'い' }] } }) as never)).toBeNull();
    expect(notificationTarget(entry({ kind: 'request-update', payload: { path: '/media/frieren' } }) as never)).toBe(
      '/media/frieren',
    );
  });
});
