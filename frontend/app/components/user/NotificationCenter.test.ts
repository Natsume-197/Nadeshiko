// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick, reactive, ref } from 'vue';

/** Notification channels and email preferences live together on `/user/notifications`. */
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({
  handleApiError: (...a: unknown[]) => handleApiError(...a),
  apiErrorStatus: () => null,
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('~/utils/toast', () => ({
  useToastSuccess: (...a: unknown[]) => toastSuccess(...a),
  useToastError: (...a: unknown[]) => toastError(...a),
}));
const listWatches = vi.fn();
vi.mock('~/composables/useWordWatches', () => ({
  useWordWatches: () => ({ list: listWatches, update: vi.fn(), remove: vi.fn() }),
  wordWatchErrorKey: () => 'notifications.watch.error',
}));
vi.mock('~/composables/useNotifications', () => ({
  wordPath: (w: { query: string }) => `/search/${w.query}`,
}));

const updateUserPreferences = vi.fn();
const capture = vi.fn();
const preferences = reactive<Record<string, unknown>>({});
const store = reactive({
  preferences: preferences as Record<string, unknown>,
});

vi.stubGlobal('userStore', () => store);
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useLocalePath', () => (p: string) => p);
vi.stubGlobal('useNadeshikoSdk', () => ({ updateUserPreferences }));
vi.stubGlobal('usePostHog', () => ({ capture }));

import NotificationCenter from './NotificationCenter.vue';

const mounted: { unmount: () => void }[] = [];

async function render(prefs: Record<string, unknown> = {}) {
  for (const key of Object.keys(preferences)) delete preferences[key];
  Object.assign(preferences, prefs);
  store.preferences = preferences;

  const wrapper = mount(NotificationCenter, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        UiBaseIcon: true,
        NuxtLink: { props: ['to'], template: '<a><slot /></a>' },
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

const emailToggle = (w: ReturnType<typeof mount>, name: string) => w.get(`[data-testid="email-category-${name}"]`);
const siteToggle = (w: ReturnType<typeof mount>, name: string) => w.get(`[data-testid="channel-${name}-site"]`);

beforeEach(() => {
  vi.clearAllMocks();
  listWatches.mockResolvedValue({ items: [], activeCount: 0, limit: 20 });
  updateUserPreferences.mockResolvedValue({});
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('the per-category email switches', () => {
  test('start ON unless the account explicitly turned one off', async () => {
    const wrapper = await render({ productEmails: { recap: false } });

    expect(emailToggle(wrapper, 'recap').attributes('aria-pressed')).toBe('false');
    expect(emailToggle(wrapper, 'checkins').attributes('aria-pressed')).toBe('true');
    expect(emailToggle(wrapper, 'words').attributes('aria-pressed')).toBe('true');
    expect(emailToggle(wrapper, 'requests').attributes('aria-pressed')).toBe('true');
  });

  test('sends only the key that changed, merged over what is stored', async () => {
    const wrapper = await render({ productEmails: { enabled: true, recap: false } });

    await emailToggle(wrapper, 'checkins').trigger('click');
    await flushPromises();

    expect(updateUserPreferences).toHaveBeenCalledWith({
      productEmails: { enabled: true, recap: false, checkins: false },
    });
  });

  test('moves only after the server agrees', async () => {
    const wrapper = await render({ productEmails: {} });
    updateUserPreferences.mockRejectedValue(new Error('down'));

    await emailToggle(wrapper, 'recap').trigger('click');
    await flushPromises();

    expect(emailToggle(wrapper, 'recap').attributes('aria-pressed')).toBe('true');
    expect(handleApiError).toHaveBeenCalledWith(
      'account:product-emails-category-failed',
      expect.anything(),
      expect.anything(),
    );
  });

  test('names which switch moved in the confirmation toast', async () => {
    const wrapper = await render({ productEmails: {} });

    await emailToggle(wrapper, 'recap').trigger('click');
    await flushPromises();

    expect(toastSuccess).toHaveBeenCalledWith('accountSettings.emails.turnedOff');
  });

  test('ignores a second switch while one is still saving', async () => {
    let release!: () => void;
    updateUserPreferences.mockReturnValue(new Promise<void>((r) => (release = () => r())));
    const wrapper = await render({ productEmails: {} });

    await emailToggle(wrapper, 'recap').trigger('click');
    await nextTick();

    expect(emailToggle(wrapper, 'checkins').attributes('disabled')).toBeDefined();
    await emailToggle(wrapper, 'checkins').trigger('click');
    release();
    await flushPromises();

    expect(updateUserPreferences).toHaveBeenCalledTimes(1);
  });
});

describe('the master email switch', () => {
  test('keeps the per-category settings when it is flipped', async () => {
    const wrapper = await render({ productEmails: { recap: false } });

    await wrapper.get('[data-testid="product-emails-toggle"]').trigger('click');
    await flushPromises();

    expect(updateUserPreferences).toHaveBeenCalledWith({
      productEmails: { recap: false, enabled: false },
    });
  });

  test('writes through to the store and leaves site switches active when emails are off', async () => {
    const wrapper = await render({ productEmails: {} });

    await wrapper.get('[data-testid="product-emails-toggle"]').trigger('click');
    await flushPromises();

    expect((store.preferences.productEmails as Record<string, unknown>).enabled).toBe(false);
    expect(emailToggle(wrapper, 'words').attributes('disabled')).toBeDefined();
    expect(siteToggle(wrapper, 'words').attributes('disabled')).toBeUndefined();
  });

  test('stays where it was if the write failed', async () => {
    const wrapper = await render({ productEmails: {} });
    updateUserPreferences.mockRejectedValue(new Error('down'));

    await wrapper.get('[data-testid="product-emails-toggle"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="product-emails-toggle"]').attributes('aria-pressed')).toBe('true');
  });
});

describe('site notification switches', () => {
  test('render only for words and requests and save merged over stored siteNotifications', async () => {
    const wrapper = await render({ siteNotifications: { requests: false } });

    expect(wrapper.find('[data-testid="channel-recap-site"]').exists()).toBe(false);
    expect(siteToggle(wrapper, 'requests').attributes('aria-pressed')).toBe('false');
    expect(siteToggle(wrapper, 'words').attributes('aria-pressed')).toBe('true');

    await siteToggle(wrapper, 'words').trigger('click');
    await flushPromises();

    expect(updateUserPreferences).toHaveBeenCalledWith({
      siteNotifications: { requests: false, words: false },
    });
  });
});
