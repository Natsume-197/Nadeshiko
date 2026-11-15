// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }));

const { default: CustomThemeEditor } = await import('./CustomThemeEditor.vue');

const START = { preset: 'indigo', base: 'light', accent: '#2f5d8a', background: '#eef2f7' } as const;

describe('the custom theme editor', () => {
  test('saves what was edited, as a custom theme', async () => {
    const wrapper = mount(CustomThemeEditor, { props: { initial: START } });

    await wrapper.get('[data-testid="custom-theme-base"]').setValue('dark');
    await wrapper.get('[data-testid="custom-theme-background"]').setValue('#101010');
    await wrapper.get('[data-testid="custom-theme-apply"]').trigger('click');

    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({
      preset: 'custom',
      base: 'dark',
      accent: '#2f5d8a',
      background: '#101010',
    });
  });

  test('warns when the text would not read on the background', async () => {
    const wrapper = mount(CustomThemeEditor, { props: { initial: START } });

    await wrapper.get('[data-testid="custom-theme-base"]').setValue('dark');

    expect(wrapper.find('[data-testid="custom-theme-warnings"]').exists()).toBe(true);
  });

  test('cancel leaves without saving', async () => {
    const wrapper = mount(CustomThemeEditor, { props: { initial: START } });

    await wrapper.get('[data-testid="custom-theme-cancel"]').trigger('click');

    expect(wrapper.emitted('cancel')).toHaveLength(1);
    expect(wrapper.emitted('save')).toBeUndefined();
  });
});
