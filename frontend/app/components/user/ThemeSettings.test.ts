// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { reactive, ref } from 'vue';

let status: number | null = null;
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({
  handleApiError: (...a: unknown[]) => handleApiError(...a),
  apiErrorStatus: () => status,
}));
vi.mock('~/utils/toast', () => ({ useToastSuccess: vi.fn() }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }));

const updateUserPreferences = vi.fn();
const store = reactive({ preferences: {} as Record<string, unknown> });
const preference = ref('dark');
const customTheme = ref<unknown>(null);
const setPreference = vi.fn((value: string) => {
  preference.value = value;
});
const setCustomTheme = vi.fn((value: unknown) => {
  customTheme.value = value;
  preference.value = 'custom';
});
const clearCustomTheme = vi.fn();

vi.stubGlobal('userStore', () => store);
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('useNadeshikoSdk', () => ({ updateUserPreferences }));
vi.stubGlobal('useThemePreference', () => ({
  preference,
  setPreference,
  customTheme,
  setCustomTheme,
  clearCustomTheme,
}));

const { default: ThemeSettings } = await import('./ThemeSettings.vue');

const mountIt = () =>
  mount(ThemeSettings, {
    global: { stubs: { UiBaseIcon: true, NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  });
const pressed = (w: ReturnType<typeof mountIt>, id: string) =>
  w.get(`[data-testid="${id}"]`).attributes('aria-pressed');

const OWN = { preset: 'custom', base: 'dark', accent: '#ff0000', background: '#101010' };

beforeEach(() => {
  status = null;
  store.preferences = {};
  preference.value = 'dark';
  customTheme.value = null;
  vi.clearAllMocks();
  updateUserPreferences.mockResolvedValue({});
});

describe('appearance', () => {
  test('a tile applies its theme at once, and the chosen one is marked', async () => {
    const wrapper = mountIt();
    expect(pressed(wrapper, 'theme-option-dark')).toBe('true');

    await wrapper.get('[data-testid="theme-option-light"]').trigger('click');

    expect(setPreference).toHaveBeenCalledWith('light');
    expect(pressed(wrapper, 'theme-option-light')).toBe('true');
    expect(pressed(wrapper, 'theme-option-dark')).toBe('false');
    expect(updateUserPreferences).not.toHaveBeenCalled();
  });
});

describe('patron themes', () => {
  test('a ready-made theme is saved on the account and applied', async () => {
    const wrapper = mountIt();

    await wrapper.get('[data-testid="custom-theme-preset-midnight"]').trigger('click');
    await flushPromises();

    const sent = updateUserPreferences.mock.calls[0]?.[0].customTheme;
    expect(sent).toMatchObject({ preset: 'midnight', base: 'dark' });
    expect(setCustomTheme).toHaveBeenCalledWith(sent);
    expect(pressed(wrapper, 'custom-theme-preset-midnight')).toBe('true');
  });

  test('a reader who is not a patron is told how to become one, and nothing changes', async () => {
    status = 403;
    updateUserPreferences.mockRejectedValue(new Error('403'));
    const wrapper = mountIt();

    await wrapper.get('[data-testid="custom-theme-preset-ocean"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="custom-theme-needs-patron"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="custom-theme-support-link"]').attributes('href')).toBe('/en/supporters#support');
    expect(setCustomTheme).not.toHaveBeenCalled();
    expect(handleApiError).not.toHaveBeenCalled();
  });

  test('your own saved theme gets its own tile, which applies without a round trip', async () => {
    store.preferences = { customTheme: OWN };
    const wrapper = mountIt();

    await wrapper.get('[data-testid="custom-theme-own"]').trigger('click');

    expect(setCustomTheme).toHaveBeenCalledWith(OWN);
    expect(updateUserPreferences).not.toHaveBeenCalled();
  });

  test('a ready-made theme does not also show up as your own', () => {
    store.preferences = { customTheme: { preset: 'sepia', base: 'light', accent: '#a0522d', background: '#f4ecd8' } };

    expect(mountIt().find('[data-testid="custom-theme-own"]').exists()).toBe(false);
  });

  test('creating your own opens the editor, and what it saves is applied', async () => {
    const wrapper = mountIt();
    expect(wrapper.find('[data-testid="custom-theme-editor"]').exists()).toBe(false);

    await wrapper.get('[data-testid="custom-theme-create"]').trigger('click');
    await wrapper.get('[data-testid="custom-theme-accent"]').setValue('#123456');
    await wrapper.get('[data-testid="custom-theme-apply"]').trigger('click');
    await flushPromises();

    expect(updateUserPreferences.mock.calls[0]?.[0].customTheme).toMatchObject({ preset: 'custom', accent: '#123456' });
    expect(wrapper.find('[data-testid="custom-theme-editor"]').exists()).toBe(false);
  });

  test('removing it clears the saved theme', async () => {
    store.preferences = { customTheme: OWN };
    const wrapper = mountIt();

    await wrapper.get('[data-testid="custom-theme-remove"]').trigger('click');
    await flushPromises();

    expect(updateUserPreferences).toHaveBeenCalledWith({ customTheme: null });
    expect(clearCustomTheme).toHaveBeenCalled();
  });
});
