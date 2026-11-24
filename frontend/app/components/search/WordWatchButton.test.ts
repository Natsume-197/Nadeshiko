// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { reactive, ref } from 'vue';

const sdk = {
  checkWordWatch: vi.fn(),
  setWordWatch: vi.fn(),
  deleteWordWatch: vi.fn(),
};
const toastSuccess = vi.fn();
const toastError = vi.fn();
const openLoginModal = vi.fn();
const store = reactive({ isLoggedIn: true });

vi.stubGlobal('useNadeshikoSdk', () => sdk);
vi.stubGlobal('useI18n', () => ({ t: (key: string) => key, locale: ref('en') }));
vi.stubGlobal('useFormat', () => ({ formatNumber: (value: number) => value.toLocaleString('en') }));
vi.stubGlobal('useLocalePath', () => (path: string) => `/en${path}`);
vi.stubGlobal('userStore', () => store);
vi.stubGlobal('useLoginModal', () => ({ openLoginModal }));
vi.stubGlobal('usePostHog', () => null);
vi.stubGlobal('useToastSuccess', toastSuccess);
vi.stubGlobal('useToastError', toastError);

import WordWatchButton from './WordWatchButton.vue';

const watch = (over: Record<string, unknown> = {}) => ({
  id: 'w-1',
  query: '憧憬',
  matchMode: 'WORD',
  mode: 'FIRST',
  status: 'ACTIVE',
  lastNotifiedAt: null,
  createdAt: '2026-11-23T00:00:00Z',
  ...over,
});

const mounted: { unmount: () => void }[] = [];

async function render(props: Record<string, unknown>) {
  const wrapper = mount(WordWatchButton, {
    props: { query: '憧憬', mode: 'FIRST', ...props },
    global: {
      mocks: { $t: (key: string) => key },
      stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' }, UiBaseIcon: true },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.isLoggedIn = true;
  sdk.checkWordWatch.mockResolvedValue({ watch: null });
  sdk.deleteWordWatch.mockResolvedValue(undefined);
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('WordWatchButton', () => {
  test('offers the first-appearance alert and sets it', async () => {
    sdk.setWordWatch.mockResolvedValue({ watch: watch(), outcome: 'created', sentenceCount: 0, commonWord: false });
    const wrapper = await render({});
    const button = wrapper.get('[data-testid="word-watch-button"]');
    expect(button.text()).toContain('notifications.watch.notify');
    expect(button.attributes('aria-pressed')).toBe('false');

    await button.trigger('click');
    await flushPromises();

    expect(sdk.setWordWatch).toHaveBeenCalledWith({ query: '憧憬', mode: 'FIRST', matchMode: 'WORD' });
    expect(button.attributes('aria-pressed')).toBe('true');
    // The button's own state says it is set; no toast repeats it.
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  test('shows an alert the reader already has, and removes it on a second press', async () => {
    sdk.checkWordWatch.mockResolvedValue({ watch: watch() });
    const wrapper = await render({});
    const button = wrapper.get('[data-testid="word-watch-button"]');
    expect(button.attributes('aria-pressed')).toBe('true');

    await button.trigger('click');
    await flushPromises();
    expect(sdk.deleteWordWatch).toHaveBeenCalledWith({ watchId: 'w-1' });
    expect(button.attributes('aria-pressed')).toBe('false');
  });

  test('asks a signed-out reader to sign in instead', async () => {
    store.isLoggedIn = false;
    const wrapper = await render({});
    await wrapper.get('[data-testid="word-watch-button"]').trigger('click');
    expect(openLoginModal).toHaveBeenCalledWith('word_alert');
    expect(sdk.setWordWatch).not.toHaveBeenCalled();
  });

  test('explains a refused alert by its status', async () => {
    sdk.setWordWatch.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
    const wrapper = await render({});
    await wrapper.get('[data-testid="word-watch-button"]').trigger('click');
    await flushPromises();
    expect(toastError).toHaveBeenCalledWith('notifications.watch.limit');
  });

  test('warns after following a word the API calls very common', async () => {
    sdk.setWordWatch.mockResolvedValue({
      watch: watch({ mode: 'NEW_SENTENCES' }),
      outcome: 'created',
      sentenceCount: 12000,
      commonWord: true,
    });
    const wrapper = await render({ mode: 'NEW_SENTENCES' });
    await wrapper.get('[data-testid="word-watch-button"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('notifications.watch.commonWarning');
  });
});
